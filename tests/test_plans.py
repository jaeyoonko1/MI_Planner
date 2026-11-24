"""P5-01: stdlib xlsx reader, header mapping, dry-run/confirm import, re-import without duplicates."""
import io
import json
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import plan_import, xlsx
from app.main import create_app
from app.xlsx_read import XlsxError, read_workbook
from scripts.make_sample_plan_xlsx import build_sample


@pytest.fixture()
def client(tmp_path: Path):
    with TestClient(create_app(tmp_path / "p.db", tmp_path / "vault"), raise_server_exceptions=False) as c:
        yield c


def post(client, data: bytes, dry=True, **opts):
    return client.post("/api/plans/import", params={"name": "plan.xlsx", "dry_run": str(dry).lower(),
                       "options": json.dumps(opts)}, content=data)


def test_reader_roundtrip_types():
    sh = xlsx.Sheet("S")
    sh.add(["a", 3, 2.5, "한글 <&>"])
    sh.add([None, None, "x"])
    rows = read_workbook(xlsx.build_workbook([sh, xlsx.Sheet("T")]))
    assert rows[0].name == "S" and rows[0].rows[0] == ["a", "3", "2.5", "한글 <&>"]
    assert rows[0].rows[1] == ["", "", "x"]


def test_reader_rejects_bad_files():
    for data, text in [(b"", "xlsx"), (b"hello world", "xlsx"), (b"PK\x03\x04junk", "손상")]:
        with pytest.raises(XlsxError) as e:
            read_workbook(data)
        assert text in str(e.value)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("a.txt", "x")
    with pytest.raises(XlsxError):
        read_workbook(buf.getvalue())


def test_reader_shared_strings_dates_hidden():
    ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("xl/workbook.xml", f'<workbook xmlns="{ns}" xmlns:r="{rel}"><sheets><sheet name="Z" sheetId="1" r:id="rId1"/>'
                    f'<sheet name="H" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>')
        zf.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>')
        zf.writestr("xl/sharedStrings.xml", f'<sst xmlns="{ns}"><si><t>제품</t></si><si><r><t>A</t></r><r><t>B</t></r></si></sst>')
        zf.writestr("xl/styles.xml", f'<styleSheet xmlns="{ns}"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>')
        zf.writestr("xl/worksheets/sheet1.xml", f'<worksheet xmlns="{ns}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c>'
                    '<c r="C1" t="s"><v>1</v></c></row><row r="3"><c r="A3" s="1"><v>45000</v></c><c r="B3"><v>7.0</v></c></row>'
                    '<row r="4" hidden="1"><c r="A4" t="inlineStr"><is><t>hide</t></is></c></row></sheetData></worksheet>')
        zf.writestr("xl/worksheets/sheet2.xml", f'<worksheet xmlns="{ns}"><sheetData/></worksheet>')
    sheets = read_workbook(buf.getvalue())
    assert [s.name for s in sheets] == ["Z"]  # hidden sheet skipped
    assert sheets[0].rows[0] == ["제품", "", "AB"]
    assert sheets[0].rows[1] == []
    assert sheets[0].rows[2] == ["2023-03-15", "7"]  # date serial -> ISO, 7.0 -> 7
    assert sheets[0].rows[3] == []  # hidden row


def test_header_detection_and_mapping_aliases():
    rows = [["title"], [], ["Product", "Plan Name", "Step No", "Step Description", "Tool Group", "Foo"], ["P", "x"]]
    idx, score = plan_import.detect_header_row(rows)
    assert idx == 2 and score >= 4
    m = plan_import.guess_mapping(rows[2])
    assert m == {"product": "Product", "plan": "Plan Name", "step_code": "Step No", "step_name": "Step Description",
                 "tool_group": "Tool Group"}
    assert plan_import.resolve_mapping(rows[2], {"tool_group": "", "note": "Foo", "area": "nope"}) == {
        **{k: v for k, v in m.items() if k != "tool_group"}, "note": "Foo"}


def test_dry_run_writes_nothing_then_confirm(client):
    data = build_sample(1)
    body = post(client, data, dry=True).json()
    assert body["sheet"] == "Process Plan" and body["header_row"] == 3 and body["applied"] is False
    assert body["counts"] == {"new": 5, "update": 0, "same": 0, "error": 0, "missing": 0}
    assert body["mapping"]["step_code"] == "Step ID" and body["extra_headers"] == ["공정시간(분)"]
    assert {s["name"] for s in body["sheets"]} == {"Process Plan", "PLAN-B", "README"}
    assert client.get("/api/plans").json()["items"] == []
    ok = post(client, data, dry=False)
    assert ok.status_code == 200 and ok.json()["applied"] is True
    plans = client.get("/api/plans").json()["items"]
    assert [(p["product"], p["name"], p["step_count"]) for p in plans] == [
        ("PROD-TEST-A", "PLAN-A1", 3), ("PROD-TEST-A", "PLAN-A2", 2)]
    detail = client.get(f"/api/plans/{plans[0]['id']}").json()
    assert [s["step_code"] for s in detail["steps"]] == ["S0010", "S0020", "S0030"]
    assert detail["steps"][1]["extra"] == {"공정시간(분)": "8.5"} and detail["extra_columns"] == ["공정시간(분)"]
    assert detail["plan"]["source_file"] == "plan.xlsx"


def test_second_sheet_uses_sheet_name_as_plan(client):
    res = post(client, build_sample(1), dry=False, sheet="PLAN-B").json()
    assert res["mapping"]["step_code"] == "Step No" and res["mapping"]["step_name"] == "Step Description"
    plans = client.get("/api/plans").json()["items"]
    assert [(p["product"], p["name"], p["step_count"]) for p in plans] == [("PROD-TEST-B", "PLAN-B", 2)]


def test_reimport_updates_without_duplicates_and_marks_missing(client):
    post(client, build_sample(1), dry=False)
    again = post(client, build_sample(1), dry=True).json()
    assert again["counts"] == {"new": 0, "update": 0, "same": 5, "error": 0, "missing": 0}
    post(client, build_sample(1), dry=False)
    assert sum(p["step_count"] for p in client.get("/api/plans").json()["items"]) == 5
    v2 = post(client, build_sample(2), dry=True).json()
    assert v2["counts"] == {"new": 1, "update": 1, "same": 3, "error": 0, "missing": 1}
    changed = [r for r in v2["rows"] if r["status"] == "update"][0]
    assert changed["changes"] == ["Step 이름"]
    post(client, build_sample(2), dry=False)
    plans = client.get("/api/plans").json()["items"]
    a1 = next(p for p in plans if p["name"] == "PLAN-A1")
    assert a1["step_count"] == 2 and a1["stale_count"] == 1
    steps = client.get(f"/api/plans/{a1['id']}").json()["steps"]
    assert [s["step_code"] for s in steps if s["stale"]] == ["S0030"]
    assert any("rev" in s["name"] for s in steps)
    # the step comes back in the next file: revived, still no duplicate
    post(client, build_sample(1), dry=False)
    steps = client.get(f"/api/plans/{a1['id']}").json()["steps"]
    assert len(steps) == 3 and not any(s["stale"] for s in steps)


def test_row_errors_and_duplicates(client):
    sh = xlsx.Sheet("P1")
    sh.add(["Product", "Step ID", "Step Name"])
    sh.add(["PROD-TEST-A", "S1", "ok"])
    sh.add(["PROD-TEST-A", "S1", "dup"])
    sh.add(["", "S2", "no product"])
    sh.add(["PROD-TEST-A", "", ""])
    sh.add(["PROD-TEST-A", "", "name only"])
    sh.add(["", "", ""])
    data = xlsx.build_workbook([sh])
    body = post(client, data, dry=True).json()
    msgs = {e["row"]: e["message"] for e in body["errors"]}
    assert body["counts"]["new"] == 3 and body["counts"]["error"] == 2, msgs
    assert "2행" in msgs[3] and "비어" in msgs[5] and 4 not in msgs  # fill-down gives row 4 the product above
    solo = xlsx.Sheet("P1")
    solo.add(["Product", "Step ID", "Step Name"])
    solo.add(["", "S2", "no product"])
    one = xlsx.build_workbook([solo])
    assert "제품" in post(client, one, dry=True).json()["errors"][0]["message"]
    fixed = post(client, one, dry=True, product="PROD-TEST-Z").json()
    assert fixed["counts"]["new"] == 1 and fixed["counts"]["error"] == 0
    assert post(client, data, dry=False).status_code == 200
    assert [s["name"] for s in client.get("/api/plans/1").json()["steps"]] == ["ok", "no product", "name only"]


def test_unmappable_sheet_cannot_apply_and_user_mapping_fixes(client):
    sh = xlsx.Sheet("X")
    sh.add(["Product", "Seq", "Whatever"])
    sh.add(["PROD-TEST-A", "1", "Insp"])
    data = xlsx.build_workbook([sh])
    body = post(client, data, dry=True).json()
    assert body["can_apply"] is False and "열" in body["problem"]
    res = post(client, data, dry=False)
    assert res.status_code == 422 and "error" in res.json()
    ok = post(client, data, dry=False, mapping={"step_name": "Whatever", "step_code": "Seq"})
    assert ok.status_code == 200 and ok.json()["counts"]["new"] == 1


def test_bad_requests(client):
    assert post(client, b"", dry=True).status_code == 422
    assert post(client, b"not a zip", dry=True).status_code == 422
    data = build_sample(1)
    assert post(client, data, sheet="nope").status_code == 422
    assert post(client, data, header_row="x").status_code == 422
    assert post(client, data, header_row=0).status_code == 422
    assert client.post("/api/plans/import", params={"options": "{bad"}, content=data).status_code == 422
    assert client.get("/api/plans/999").status_code == 404


def test_delete_plan_and_mapping_setting(client):
    post(client, build_sample(1), dry=False)
    pid = client.get("/api/plans").json()["items"][0]["id"]
    assert client.delete(f"/api/plans/{pid}").json() == {"ok": True}
    assert client.get(f"/api/plans/{pid}").status_code == 404
    assert client.delete(f"/api/plans/{pid}").status_code == 404
    assert len(client.get("/api/plans").json()["items"]) == 1
    ok = client.put("/api/settings/plan_mapping", json={"value": json.dumps({"product": "제품"})})
    assert ok.status_code == 200
    assert client.put("/api/settings/plan_mapping", json={"value": "[1]"}).status_code == 400
