"""P7-04: status-brief and fill-table skill helpers run against a temp DB/vault with fake data only."""
import importlib.util
import json
import re
import subprocess
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import cli
from app.main import create_app
from app.vault_content import content_write_lock, replace_content

ROOT = Path(__file__).resolve().parent.parent


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


brief = _load("brief", "skills/status-brief/scripts/brief.py")
fill = _load("fill_table", "skills/fill-table/scripts/fill_table.py")


@pytest.fixture()
def env(tmp_path: Path):
    db_path, vault = tmp_path / "planner.db", tmp_path / "vault"
    with TestClient(create_app(db_path, vault)) as client:
        body = {"name": "합성 평가", "template_id": 1, "equipment": [{"name": "EQ-A01"}, {"name": "EQ-B02"}],
                "lots": [{"lot_no": "LOT-TEST-001", "wafers": ["01", "02"]}]}
        created = client.post("/api/evaluations", json=body).json()["evaluation"]
    return {"db": str(db_path), "vault": str(vault), "tmp": tmp_path, "eval": created}


def cli_call(env, capsys, *argv: str):
    code = cli.main(["--db", env["db"], "--vault", env["vault"], *argv])
    return code, json.loads(capsys.readouterr().out)


def script(mod, env, capsys, *argv: str):
    code = mod.main(["--db", env["db"], "--vault", env["vault"], *argv])
    out = capsys.readouterr().out
    return code, out


def test_cli_set_cell_converts_types_and_labels(env, capsys):
    cells = cli_call(env, capsys, "eval", "show", str(env["eval"]["id"]), "--full")[1]["cells"]
    cid = str(cells[0]["id"])
    code, out = cli_call(env, capsys, "eval", "set-cell", cid, "--value", "scan_time=12.5",
                         "--value", "반복도=OK", "--value", "classified=y", "--value", "디펙 모수=1,204")
    assert code == 0 and out["values"] == {"scan_time": 12.5, "repeatability": "ok", "classified": True,
                                           "defect_count": 1204}
    code, out = cli_call(env, capsys, "eval", "set-cell", cid, "--value", "scan_time=빠름")
    assert code == 1 and "숫자" in out["error"]
    code, out = cli_call(env, capsys, "eval", "set-cell", cid, "--value", "scan_time=")
    assert code == 0 and "scan_time" not in out["values"]


def test_status_brief_filters_equipment_and_tasks(env, capsys):
    eid = env["eval"]["id"]
    cli_call(env, capsys, "task", "add", "EQ-A01 PM 후 재측정", "--due", "2020-01-01")
    cli_call(env, capsys, "task", "add", "EQ-B02 점검")
    cli_call(env, capsys, "task", "add", "결과 보고", "--eval-id", str(eid))
    code, out = script(brief, env, capsys, "--equipment", "eq-a01")
    data = json.loads(out)
    assert code == 0 and data["matched_equipment"] == ["EQ-A01"]
    groups = data["evaluations"][0]["groups"]
    assert [g["equipment"] for g in groups] == ["EQ-A01"] and len(groups[0]["cells"]) == 2
    assert groups[0]["next_stage_label"] and not groups[0]["is_last"]
    assert [t["title"] for t in data["tasks"]["overdue"]] == ["EQ-A01 PM 후 재측정"]
    titles = {t["title"] for t in data["tasks"]["other_open"] + data["tasks"]["due_soon"]}
    assert titles == {"결과 보고"}  # EQ-B02 task excluded, eval-linked task kept
    code, md = script(brief, env, capsys, "--equipment", "EQ-A01", "--md")
    assert code == 0 and "## EQ-A01 현황 브리핑" in md and "기한 지남" in md and "다음:" in md
    code, md = script(brief, env, capsys, "--equipment", "EQ-Z99", "--md")
    assert "찾지 못했습니다" in md
    code, out = script(brief, env, capsys, "--eval", "999")
    assert code == 1 and "error" in json.loads(out)


TABLE = """# 결과

| Wafer | Scan(분) | 메모 |
|---|---:|---|
| 01 |  | a \\| b |
| 02 | 9.9 |  |
| 04 |  |  |

<!-- column -->
아래 글
"""


def _page(env) -> Path:
    page = env["tmp"] / "vault" / "scan"
    page.mkdir(parents=True, exist_ok=True)
    (page / "index.md").write_text(TABLE, encoding="utf-8")
    return page / "index.md"


def test_fill_md_dry_run_then_apply(env, capsys):
    page = _page(env)
    raw = env["tmp"] / "raw.tsv"
    raw.write_text("WF\tscan\tmemo\n1\t12.5\tx|y\n2\t12.8\t\n3\t13.1\tnew\n3\t13.2\tdup\n", encoding="utf-8")
    args = ["md", str(page), "--raw", str(raw), "--key", "Wafer=WF", "--map", "Scan(분)=scan", "--map", "메모=memo"]
    code, out = script(fill, env, capsys, *args)
    res = json.loads(out)
    assert code == 0 and res["applied"] is False and page.read_text(encoding="utf-8") == TABLE
    assert [(c["row"], c["column"], c["new"]) for c in res["changes"]] == [("01", "Scan(분)", "12.5")]
    assert {(c["row"], c["old"], c["new"]) for c in res["conflicts"]} == {("01", "a | b", "x|y"), ("02", "9.9", "12.8")}
    assert res["duplicate_raw_keys"] == ["3"] and res["unmatched_raw"] == []
    code, out = script(fill, env, capsys, *args, "--overwrite", "--apply")
    res = json.loads(out)
    text = page.read_text(encoding="utf-8")
    assert res["applied"] and Path(res["backup"]).read_text(encoding="utf-8") == TABLE
    assert "| 01 | 12.5 | x\\|y |" in text and "| 02 | 12.8 |  |" in text
    assert text.endswith("| 04 |  |  |\n\n<!-- column -->\n아래 글\n")
    assert fill.find_tables(text.splitlines(keepends=True))[0]["rows"][0][2] == "x\\|y"


@pytest.mark.parametrize("mode", ["md", "excel-fill"])
def test_fill_checks_snapshot_after_waiting_for_app_writer(env, mode):
    page = _page(env)
    if mode == "md":
        raw = env["tmp"] / "race.tsv"
        raw.write_text("WF\tscan\n1\t12.5\n", encoding="utf-8")
        options = ["--raw", str(raw), "--key", "Wafer=WF", "--map", "Scan(분)=scan"]
    else:
        table = {"id": "scan", "version": 1, "columns": ["rate"], "rows": [{"id": "r1", "cells": [None]}]}
        page.write_text(f"```mi-excel-table\n{json.dumps(table)}\n```\n", encoding="utf-8")
        values = env["tmp"] / "race.json"
        values.write_text(json.dumps([
            {"rowId": "r1", "columnId": "rate", "displayText": "12.5", "value": {"type": "number", "raw": "12.5"}},
        ]), encoding="utf-8")
        options = ["--table-id", "scan", "--values", str(values)]
    reached_lock = env["tmp"] / "reached-lock"
    # Signal exactly after the CLI has planned its edit, then use the normal OS lock.
    run = """
import runpy
import sys
from pathlib import Path
marker, script, *args = sys.argv[1:]
sys.path.insert(0, str(Path(script).resolve().parents[3]))
from app import vault_content
lock = vault_content.content_write_lock
def tracked(vault):
    Path(marker).touch()
    return lock(vault)
vault_content.content_write_lock = tracked
sys.argv = [script, *args]
runpy.run_path(script, run_name="__main__")
"""
    args = [
        sys.executable, "-c", run, str(reached_lock), str(ROOT / "skills/fill-table/scripts/fill_table.py"),
        "--vault", env["vault"], mode, str(page), *options, "--apply",
    ]
    app_edit = page.read_bytes() + b"\nApp saved this first.\n"
    with content_write_lock(Path(env["vault"])):
        child = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8")
        try:
            end = time.monotonic() + 5
            while not reached_lock.exists() and child.poll() is None and time.monotonic() < end:
                time.sleep(0.025)
            assert reached_lock.exists()
            assert child.poll() is None
            replace_content(page, app_edit)
        except BaseException:
            child.kill()
            child.communicate(timeout=5)
            raise
    try:
        stdout, stderr = child.communicate(timeout=10)
    except subprocess.TimeoutExpired:
        child.kill()
        child.communicate()
        raise
    assert child.returncode == 1, stderr
    assert "바뀌었습니다" in json.loads(stdout)["error"]
    assert page.read_bytes() == app_edit
    assert not (Path(env["vault"]) / ".backup" / "fill-table").exists()


@pytest.mark.parametrize("marker", ["`", "~"])
def test_fill_md_skips_fenced_tables_and_preserves_other_bytes(env, capsys, marker):
    page = _page(env)
    visible_table = "| Wafer | Scan |\r\n|---|---|\r\n| 01 |  |\r\n"
    fence = marker * 4
    # A pipe on an opener immediately after a GFM table does not make it a table row.
    # A shorter run and a same-length run with trailing text do not close the block.
    fenced = (f"{fence}future-table | version\r\n"
              f"{marker * 3}\r\n"
              f"{fence} example\r\n"
              f"{visible_table}"
              f"  {marker * 5}\t\r\n")
    editable_table = visible_table.rstrip("\r\n")
    source = (visible_table + fenced + "\n" + editable_table).encode("utf-8")
    page.write_bytes(source)
    raw = env["tmp"] / "raw.csv"
    raw.write_text("Wafer,Scan\n01,12.5\n", encoding="utf-8")

    code, out = script(fill, env, capsys, "tables", str(page))
    assert code == 0
    assert [(table["table"], table["line"]) for table in json.loads(out)["tables"]] == [(1, 1), (2, 12)]

    code, out = script(fill, env, capsys, "md", str(page), "--table", "2",
                       "--raw", str(raw), "--key", "Wafer", "--apply")
    result = json.loads(out)
    assert code == 0 and result["applied"]
    assert Path(result["backup"]).read_bytes() == source
    assert page.read_bytes() == (visible_table + fenced + "\n"
                                 + editable_table.replace("| 01 |  |", "| 01 | 12.5 |")).encode("utf-8")


def test_fill_md_lists_only_tables_editable_in_notes(env, capsys):
    page = _page(env)
    header = "| Wafer | Scan |\r\n|---|---|\r\n"
    first = header + "| 01 |  |\r\n"
    examples = ("# 제목 | 설명\r\n---|---\r\n"
                "> 인용 | 설명\r\n---|---\r\n"
                "- 목록 | 설명\r\n---|---\r\n"
                "<!-- 예시\r\n" + first + "-->\r\n"
                "|\r\n|\r\n\r\n"
                "| 안내 문구 |\r\n" + first + "\r\n")
    second = header + "| 02 |  |\r\n"
    source = (first + examples + second + "<!-- 열리지 않는 표 예시\r\n" + first).encode("utf-8")
    page.write_bytes(source)
    raw = env["tmp"] / "raw.csv"
    raw.write_text("Wafer,Scan\n02,12.5\n", encoding="utf-8")

    code, out = script(fill, env, capsys, "tables", str(page))
    assert code == 0
    assert [(table["table"], table["row_count"]) for table in json.loads(out)["tables"]] == [(1, 1), (2, 1)]

    code, out = script(fill, env, capsys, "md", str(page), "--table", "2",
                       "--raw", str(raw), "--key", "Wafer", "--apply")
    result = json.loads(out)
    assert code == 0 and result["applied"]
    assert Path(result["backup"]).read_bytes() == source
    assert page.read_bytes() == source.replace(b"| 02 |  |", b"| 02 | 12.5 |")


def test_fill_md_add_missing_and_errors(env, capsys):
    page = _page(env)
    raw = env["tmp"] / "raw.csv"
    raw.write_text("Wafer,Scan(분)\n04,7\n05,8\n", encoding="utf-8")
    code, out = script(fill, env, capsys, "md", str(page), "--raw", str(raw), "--key", "Wafer", "--add-missing", "--apply")
    res = json.loads(out)
    assert code == 0 and res["map"] == [{"table": "Scan(분)", "raw": "Scan(분)"}] and res["added_rows"] == 1
    assert "| 04 | 7 |  |\n| 05 | 8 |  |\n\n<!-- column -->" in page.read_text(encoding="utf-8")
    code, out = script(fill, env, capsys, "md", str(page), "--raw", str(raw), "--key", "Lot")
    assert code == 1 and "Lot" in json.loads(out)["error"]
    outside = env["tmp"] / "index.md"
    outside.write_text(TABLE, encoding="utf-8")
    code, out = script(fill, env, capsys, "md", str(outside), "--raw", str(raw), "--key", "Wafer")
    assert code == 1 and "vault" in json.loads(out)["error"]


def test_excel_export_by_id_preserves_value_types_and_gfm_numbers(env, capsys):
    page = _page(env)
    text = {"displayText": "01 | 한글😀\n다음 줄", "value": {"type": "text", "raw": "01"}}
    percent = {"displayText": "12.50%", "value": {"type": "number", "raw": "0.125"},
               "numberFormat": "0.00%", "colSpan": 2}
    literal = {"displayText": "=1+2", "value": None}

    def fence(table):
        return "```mi-excel-table\r\n" + json.dumps(table) + "\r\n```\r\n"

    table = {"version": 1, "id": "scan-1", "columns": ["wafer", "scan", "notes"], "rows": [
        {"id": "r-2", "cells": [text, percent, None]},
        {"id": "r-1", "cells": [None, literal, None]},
    ]}
    source = (TABLE + fence({"id": "future", "version": 2}) + fence(table)
              + fence({**table, "id": "collision"}) + fence({"id": "collision", "version": 2})
              + fence({**table, "id": "damaged", "rows": [{"id": "r", "cells": [percent, literal, None]}]})
              + "```mi-excel-table\n{invalid JSON\n```\n" + TABLE.rstrip()).encode("utf-8")
    page.write_bytes(source)

    code, out = script(fill, env, capsys, "excel-tables", str(page))
    assert code == 0 and json.loads(out) == {"tables": [
        {"id": "scan-1", "row_count": 2, "columns": ["wafer", "scan", "notes"]},
    ]}
    code, out = script(fill, env, capsys, "excel-export", str(page), "--table-id", "scan-1")
    assert code == 0
    exported = json.loads(out)["table"]
    assert exported == {
        "version": 1, "id": "scan-1", "columns": table["columns"],
        "rows": [
            {"id": "r-2", "cells": [
                {**text, "rowSpan": 1, "colSpan": 1},
                {"displayText": "12.50%", "value": percent["value"], "rowSpan": 1, "colSpan": 2},
                None,
            ]},
            {"id": "r-1", "cells": [None, {**literal, "rowSpan": 1, "colSpan": 1}, None]},
        ],
    }
    for table_id in ("future", "collision", "damaged", "missing"):
        code, out = script(fill, env, capsys, "excel-export", str(page), "--table-id", table_id)
        assert code == 1 and table_id in json.loads(out)["error"]

    code, out = script(fill, env, capsys, "tables", str(page))
    assert code == 0 and [t["table"] for t in json.loads(out)["tables"]] == [1, 2]
    assert page.read_bytes() == source
    raw = env["tmp"] / "raw.csv"
    raw.write_text("Wafer,Scan(분)\n01,12.5\n", encoding="utf-8")
    code, out = script(fill, env, capsys, "md", str(page), "--table", "2",
                       "--raw", str(raw), "--key", "Wafer", "--apply")
    result = json.loads(out)
    assert code == 0 and result["applied"]
    assert Path(result["backup"]).read_bytes() == source
    before, _, after = source.rpartition(b"| 01 |  |")
    assert page.read_bytes() == before + b"| 01 | 12.5 |" + after


def test_fill_board_uses_cli_and_validates(env, capsys):
    eid = str(env["eval"]["id"])
    raw = env["tmp"] / "raw.csv"
    raw.write_text("Tool,Lot,WF,scan,result,defects\n"
                   "EQ-A01,LOT-TEST-001,1,12.5,OK,340\n"
                   "EQ-A01,LOT-TEST-001,2,fast,NG,512\n"
                   "EQ-C03,LOT-TEST-001,1,1,OK,1\n", encoding="cp949")
    args = ["board", eid, "--raw", str(raw), "--match", "equipment=Tool", "--match", "lot=Lot", "--match", "wafer=WF",
            "--map", "scan_time=scan", "--map", "반복도=result", "--map", "note=defects"]
    code, out = script(fill, env, capsys, *args)
    res = json.loads(out)
    assert code == 0 and not res["applied"] and len(res["changes"]) == 5
    assert [(i["field"], i["new"]) for i in res["invalid"]] == [("scan_time", "fast")]
    assert res["unmatched_raw"] == ["EQ-C03 / LOT-TEST-001 / 1"]
    code, out = script(fill, env, capsys, *args, "--apply")
    assert json.loads(out)["errors"] == []
    cells = cli_call(env, capsys, "eval", "show", eid, "--full")[1]["cells"]
    a01 = {c["wafer_no"]: c for c in cells if c["equipment"] == "EQ-A01"}
    assert a01["01"]["values"] == {"scan_time": 12.5, "repeatability": "ok"} and a01["01"]["note"] == "340"
    assert a01["02"]["values"] == {"repeatability": "ng"}
    code, out = script(fill, env, capsys, "board", eid, "--raw", str(raw), "--match", "wafer=WF", "--map", "nope=scan")
    assert code == 1 and "nope" in json.loads(out)["error"]


def test_excel_fill_keeps_explicit_types_styles_and_neighbor_bytes(env, capsys):
    page = _page(env)
    formatted = {"displayText": "", "value": None, "numberFormat": "0.00%",
                 "styles": {"background-color": "#123456"}}
    merge = {"displayText": "LOT-TEST", "value": None, "colSpan": 2,
             "richText": [[{"text": "LOT-TEST", "styles": {"color": "#123456"}}]]}
    table = {"version": 1, "id": "scan", "columns": ["lot", "rate", "note"],
             "rows": [{"id": "r1", "cells": [None, formatted, None]},
                      {"id": "r2", "cells": [merge, None, None]}],
             "numberSeparators": {"decimal": ",", "thousands": "."}}
    before = b"Example\n<!-- column -->\r\n~~~~mi-excel-table\r\n"
    after = b"\r\n~~~~\n<!-- row -->\r\n" + TABLE.rstrip().encode("utf-8")
    source = before + json.dumps(table).encode("utf-8") + after
    page.write_bytes(source)
    values = env["tmp"] / "cells.json"
    edits = [
        {"rowId": "r1", "columnId": "lot", "displayText": "001",
         "value": {"type": "text", "raw": "001"}},
        {"rowId": "r1", "columnId": "rate", "displayText": "12,50%",
         "value": {"type": "number", "raw": "0.125"}},
        {"rowId": "r1", "columnId": "note", "displayText": "1,234", "value": None},
        {"rowId": "r2", "columnId": "lot", "displayText": "LOT-TEST-001", "value": None},
    ]
    args = ("excel-fill", str(page), "--table-id", "scan", "--values", str(values))
    values.write_text(json.dumps(edits), encoding="utf-8-sig")

    code, out = script(fill, env, capsys, *args, "--apply")
    blocked = json.loads(out)
    assert code == 0 and not blocked["applied"] and len(blocked["conflicts"]) == 1
    assert [item["action"] for item in blocked["changes"]] == ["fill"] * 3
    assert blocked["changes"][1]["numberFormat"] == "0.00%"
    assert page.read_bytes() == source
    assert not (Path(env["vault"]) / ".backup").exists()

    code, out = script(fill, env, capsys, *args, "--overwrite")
    assert code == 0 and not json.loads(out)["applied"] and page.read_bytes() == source
    code, out = script(fill, env, capsys, *args, "--overwrite", "--apply")
    result = json.loads(out)
    assert code == 0 and result["applied"] and Path(result["backup"]).read_bytes() == source
    updated = page.read_bytes()
    assert updated.startswith(before) and updated.endswith(after)
    stored = json.loads(updated[len(before):-len(after)])
    assert stored["numberSeparators"] == table["numberSeparators"]
    assert stored["rows"][0]["cells"] == [
        {"displayText": "001", "value": {"type": "text", "raw": "001"}},
        {**formatted, "displayText": "12,50%", "value": {"type": "number", "raw": "0.125"}},
        {"displayText": "1,234", "value": None},
    ]
    assert stored["rows"][1]["cells"] == [
        {"displayText": "LOT-TEST-001", "value": None, "colSpan": 2}, None, None,
    ]
    code, out = script(fill, env, capsys, *args, "--apply")
    assert code == 0 and json.loads(out) == {"tableId": "scan", "changes": [], "conflicts": [], "applied": False}

    invalid_edits = [
        {**edits[1], "value": {"type": "number", "raw": "0,125"}},
        {**edits[1], "value": 0.125},
        {**edits[1], "value": {"type": "number", "raw": "9e999"}},
        {**edits[1], "rowId": "unknown"},
        {**edits[1], "rowId": "r2"},
        edits[0],
    ]
    for invalid in invalid_edits:
        values.write_text(json.dumps([edits[0], invalid]), encoding="utf-8")
        code, out = script(fill, env, capsys, *args, "--overwrite", "--apply")
        assert code == 1 and "error" in json.loads(out)
        assert page.read_bytes() == updated
    assert list(Path(result["backup"]).parent.iterdir()) == [Path(result["backup"])]


def test_skill_files_stay_offline_and_fake():
    for skill in ("status-brief", "fill-table"):
        folder = ROOT / "skills" / skill
        assert (folder / "SKILL.md").is_file()
        for f in folder.rglob("*.py"):
            text = f.read_text(encoding="utf-8")
            assert not re.search(r"^\s*(import|from)\s+(urllib|http|socket|requests|sqlite3)\b", text, re.M), f
        assert "--apply" in (ROOT / "skills" / "fill-table" / "SKILL.md").read_text(encoding="utf-8")
