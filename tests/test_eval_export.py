"""P4-07: Excel export (stdlib xlsx writer, re-read structurally) + template usage/delete/save-as-template."""
import io
import re
import zipfile
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree as ET

import pytest
from fastapi.testclient import TestClient

from app import xlsx
from app.main import create_app

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}


@pytest.fixture()
def env(tmp_path: Path):
    with TestClient(create_app(tmp_path / "p.db", tmp_path / "vault"), raise_server_exceptions=False) as client:
        body = {"name": "합성/평가: 1?", "template_id": 1, "equipment": [{"name": "EQ-A01", "vendor": "VND-TEST"}, {"name": "EQ-A02"}],
                "lots": [{"lot_no": "LOT-TEST-001", "wafers": ["01", "02"]}],
                "excluded": [{"equipment": "EQ-A02", "lot_no": "LOT-TEST-001", "wafer_no": "02"}]}
        yield client, client.post("/api/evaluations", json=body).json()["evaluation"]


def read_xlsx(data: bytes) -> dict[str, list[list[str]]]:
    """Re-read the workbook with only zipfile + ElementTree: every part must parse."""
    zf = zipfile.ZipFile(io.BytesIO(data))
    assert zf.testzip() is None
    for name in zf.namelist():
        ET.fromstring(zf.read(name))
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))}
    out = {}
    for sheet in wb.find("m:sheets", NS):
        target = rels[sheet.get(f"{{{NS['r']}}}id")]
        root = ET.fromstring(zf.read("xl/" + target))
        rows = []
        for row in root.iter(f"{{{NS['m']}}}row"):
            cells = {}
            for c in row:
                col = re.match(r"[A-Z]+", c.get("r")).group()
                t = c.find(".//m:t", NS)
                v = c.find("m:v", NS)
                cells[col] = t.text if t is not None else (v.text if v is not None else "")
            width = max((xlsx_col(k) for k in cells), default=-1) + 1
            rows.append([cells.get(xlsx.column_letter(i), "") for i in range(width)])
        out[sheet.get("name")] = rows
    return out


def xlsx_col(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n - 1


def test_writer_basics():
    assert [xlsx.column_letter(i) for i in (0, 25, 26, 701, 702)] == ["A", "Z", "AA", "ZZ", "AAA"]
    taken: set[str] = set()
    assert xlsx.sheet_name("a:b/c[d]" + "x" * 40, taken) == "a b c d " + "x" * 23
    assert xlsx.sheet_name("A", taken) == "A" and xlsx.sheet_name("a", taken) == "a (2)"
    sheet = xlsx.Sheet("S")
    sheet.add(["=1+1", "x<&>\x01y", 3, 2.5, True, None])
    rows = read_xlsx(xlsx.build_workbook([sheet]))["S"]
    assert rows[0][:5] == ["=1+1", "x<&>y", "3", "2.5", "예"]


def test_export_structure_and_content(env):
    client, ev = env
    board = client.get(f"/api/evaluations/{ev['id']}/board").json()
    first, second = [c for c in board["cells"] if not c["excluded"]][:2]
    client.post(f"/api/evaluations/{ev['id']}/cells/stage", json={"cell_ids": [first["id"]], "stage_key": "inspection_done"})
    client.patch(f"/api/eval-cells/{first['id']}", json={"values": {"repeatability": "ng", "scan_time": 12.5,
                 "classified": True, "issue": "테스트 이슈"}, "note": "메모\n둘째 줄"})
    res = client.get(f"/api/evaluations/{ev['id']}/export.xlsx")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    assert unquote(res.headers["content-disposition"].split("filename*=UTF-8''")[1]) == "합성_평가_ 1_.xlsx"
    book = read_xlsx(res.content)
    assert list(book) == ["요약", "칸 목록", "설비별 단계"]
    assert book["요약"][0][0] == "합성/평가: 1?"
    stage_rows = {r[0]: r for r in book["요약"] if r and r[0] in ("검사완료", "검사대기", "미배정")}
    assert stage_rows["검사완료"][1] == "1" and stage_rows["미배정"][1] == "2"
    cells = book["칸 목록"]
    assert cells[0][:11] == ["설비", "설비사", "Lot", "웨이퍼", "단계", "제외", "단계 진입 시각", "대기(시간)", "대기 상태",
                             "설비 상태", "Lot 상태"]
    assert cells[0][11:] == ["반복도", "스캔 시간 (분)", "디펙 모수", "분류 완료", "이슈", "메모"]
    assert len(cells) == 1 + 4                       # excluded cells are listed too
    done = next(r for r in cells[1:] if r[4] == "검사완료")
    assert done[11:] == ["NG", "12.5", "", "예", "테스트 이슈", "메모\n둘째 줄"] and done[8] == "정상"
    assert done[9:11] == ["진행", "진행"]
    assert sum(r[5] == "제외" for r in cells[1:]) == 1
    grid = book["설비별 단계"]
    assert grid[0] == ["Lot · 웨이퍼", "EQ-A01", "EQ-A02"]
    assert grid[2][2] == "제외" and len(grid) == 3


def test_export_unknown_evaluation_is_404(env):
    client, _ = env
    res = client.get("/api/evaluations/999/export.xlsx")
    assert res.status_code == 404 and "error" in res.json()


def test_template_usage_delete_and_save_as_master(env):
    client, ev = env
    master = client.get("/api/eval-templates").json()["items"][0]
    first = client.get(f"/api/evaluations/{ev['id']}/board").json()["cells"][0]
    client.post(f"/api/evaluations/{ev['id']}/cells/stage", json={"cell_ids": [first["id"]], "stage_key": "review_wait"})
    usage = client.get(f"/api/eval-templates/{master['id']}/usage").json()
    assert usage["stages"]["review_wait"] == {"evaluations": 1, "cells": 1}
    assert usage["stages"]["closed"] == {"evaluations": 1, "cells": 0} and usage["evaluation_count"] == 1
    assert client.get("/api/eval-templates/999/usage").status_code == 404

    assert client.delete(f"/api/eval-templates/{master['id']}").status_code == 409
    saved = client.post(f"/api/evaluations/{ev['id']}/save-as-template", json={"name": "새 마스터", "is_master": True})
    assert saved.status_code == 201 and saved.json()["is_master"] is True
    assert saved.json()["stages"] == ev["stages"]
    items = client.get("/api/eval-templates").json()["items"]
    assert [t["is_master"] for t in items] == [True, False] and items[0]["name"] == "새 마스터"
    assert client.delete(f"/api/eval-templates/{master['id']}").json() == {"deleted": master["id"]}
    assert client.get(f"/api/evaluations/{ev['id']}").json()["stages"] == ev["stages"]   # copies stay untouched
    assert client.post("/api/evaluations/999/save-as-template", json={"name": "x"}).status_code == 404
