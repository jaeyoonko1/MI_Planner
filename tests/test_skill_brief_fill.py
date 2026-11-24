"""P7-04: status-brief and fill-table skill helpers run against a temp DB/vault with fake data only."""
import importlib.util
import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import cli
from app.main import create_app

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


def test_skill_files_stay_offline_and_fake():
    for skill in ("status-brief", "fill-table"):
        folder = ROOT / "skills" / skill
        assert (folder / "SKILL.md").is_file()
        for f in folder.rglob("*.py"):
            text = f.read_text(encoding="utf-8")
            assert not re.search(r"^\s*(import|from)\s+(urllib|http|socket|requests|sqlite3)\b", text, re.M), f
        assert "--apply" in (ROOT / "skills" / "fill-table" / "SKILL.md").read_text(encoding="utf-8")
