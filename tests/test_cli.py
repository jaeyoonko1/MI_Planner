"""P7-01: agent CLI runs against a temp DB/vault with fake data only."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import cli
from app.main import create_app


@pytest.fixture()
def env(tmp_path: Path):
    db_path, vault = tmp_path / "planner.db", tmp_path / "vault"
    with TestClient(create_app(db_path, vault)) as client:
        body = {"name": "합성 평가", "template_id": 1, "equipment": [{"name": "EQ-A01"}],
                "lots": [{"lot_no": "LOT-TEST-001", "wafers": ["01", "02"]}]}
        created = client.post("/api/evaluations", json=body).json()["evaluation"]
    return db_path, vault, created


def call(env, capsys, *argv: str):
    db_path, vault, _ = env
    code = cli.main(["--db", str(db_path), "--vault", str(vault), *argv])
    return code, json.loads(capsys.readouterr().out)


def test_task_add_set_list_done(env, capsys):
    code, task = call(env, capsys, "task", "add", "EQ-A01 점검", "--priority", "1", "--due", "2026-12-01")
    assert code == 0 and task["title"] == "EQ-A01 점검" and task["priority"] == 1
    code, task = call(env, capsys, "task", "set", str(task["id"]), "--status", "doing", "--due", "none")
    assert task["status"] == "doing" and task["due_date"] is None
    code, listed = call(env, capsys, "task", "list", "--open", "--q", "점검")
    assert listed["total"] == 1
    code, task = call(env, capsys, "task", "done", str(task["id"]))
    assert task["status"] == "done"
    assert call(env, capsys, "task", "list", "--open")[1]["total"] == 0
    assert call(env, capsys, "task", "show", str(task["id"]))[1]["id"] == task["id"]


def test_errors_are_json_with_exit_1(env, capsys):
    code, out = call(env, capsys, "task", "show", "9999")
    assert code == 1 and "error" in out
    code, out = call(env, capsys, "task", "add", "x", "--due", "2026-13-40")
    assert code == 1 and "YYYY-MM-DD" in out["error"]
    code, out = call(env, capsys, "task", "set", "1")
    assert code == 1 and "error" in out
    code, out = call(env, capsys, "eval", "set-cell", "1", "--value", "novalue")
    assert code == 1 and "KEY=VALUE" in out["error"]


def test_eval_show_set_stage_history_stalled(env, capsys):
    _, _, created = env
    eid = str(created["id"])
    assert call(env, capsys, "eval", "list")[1]["items"][0]["id"] == created["id"]
    code, shown = call(env, capsys, "eval", "show", eid, "--full")
    cells = shown["cells"]
    assert code == 0 and len(cells) == 2 and cells[0]["equipment"] == "EQ-A01" and cells[0]["lot_no"] == "LOT-TEST-001"
    target = shown["stages"][1]["key"]
    ids = ",".join(str(c["id"]) for c in cells)
    code, moved = call(env, capsys, "eval", "set-stage", eid, "--cells", ids, "--stage", target)
    assert code == 0 and len(moved["changed"]) == 2
    assert call(env, capsys, "eval", "show", eid)[1]["stage_counts"] == {target: 2}
    again = call(env, capsys, "eval", "set-stage", eid, "--cells", ids, "--stage", target)[1]
    assert again["changed"] == [] and len(again["unchanged"]) == 2
    code, out = call(env, capsys, "eval", "set-stage", eid, "--cells", ids, "--stage", "nope")
    assert code == 1 and "error" in out
    code, out = call(env, capsys, "eval", "set-stage", eid, "--cells", "a,b", "--stage", target)
    assert code == 1
    hist = call(env, capsys, "eval", "history", str(cells[0]["id"]))[1]["items"]
    assert hist[0]["to_stage"] == target
    assert "total" in call(env, capsys, "eval", "stalled")[1]


def test_set_cell_note_and_unknown_field(env, capsys):
    _, _, created = env
    cell = call(env, capsys, "eval", "show", str(created["id"]), "--full")[1]["cells"][0]["id"]
    code, out = call(env, capsys, "eval", "set-cell", str(cell), "--note", "MOS 대기")
    assert code == 0 and out["note"] == "MOS 대기"
    code, out = call(env, capsys, "eval", "set-cell", str(cell), "--value", "nofield=1")
    assert code == 1 and "error" in out


def test_search(env, capsys):
    call(env, capsys, "task", "add", "needle 작업")
    code, out = call(env, capsys, "search", "needle")
    assert code == 0 and out["tasks"][0]["title"] == "needle 작업"
