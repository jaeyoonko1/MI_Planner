"""P4-08: MOS-time stage moves, the stalled-cells query for the 오늘 screen, and the mapping setting."""
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import create_app
from app.repositories import evaluations as repo

KST = timezone(timedelta(hours=9))
NOW = datetime(2026, 11, 24, 12, 0, tzinfo=KST)


@pytest.fixture()
def env(tmp_path: Path):
    db_path = tmp_path / "planner.db"
    with TestClient(create_app(db_path, tmp_path / "vault"), raise_server_exceptions=False) as client:
        body = {"name": "합성 평가", "template_id": 1, "equipment": [{"name": "EQ-A01"}, {"name": "EQ-A02"}],
                "lots": [{"lot_no": "LOT-TEST-001", "wafers": ["01", "02"]}]}
        created = client.post("/api/evaluations", json=body).json()["evaluation"]
        board = client.get(f"/api/evaluations/{created['id']}/board").json()
        yield client, db_path, created, board


def put_stage(db_path, cell_id, stage, at):
    with db.connect(db_path) as conn:
        conn.execute("UPDATE eval_cells SET stage_key = ? WHERE id = ?", (stage, cell_id))
        conn.execute("INSERT INTO eval_stage_log (cell_id, from_stage, to_stage, at) VALUES (?, NULL, ?, ?)",
                     (cell_id, stage, at))


def first_stage(created):
    return created["stages"][0]["key"]


def test_move_with_mos_time_logs_that_time(env) -> None:
    client, _, created, board = env
    cell = board["cells"][0]["id"]
    stage = first_stage(created)
    res = client.post(f"/api/evaluations/{created['id']}/cells/stage",
                      json={"moves": [{"cell_id": cell, "stage_key": stage, "at": "2026-11-24 09:30:00".replace(" ", "T")}]})
    assert res.status_code == 200
    assert res.json()["changed"][0]["at"] == "2026-11-24T09:30:00+09:00"
    history = client.get(f"/api/eval-cells/{cell}/history").json()["items"]
    assert history[0]["at"] == "2026-11-24T09:30:00+09:00"


def test_move_rejects_future_or_garbage_time_atomically(env) -> None:
    client, _, created, board = env
    a, b = board["cells"][0]["id"], board["cells"][1]["id"]
    stage = first_stage(created)
    url = f"/api/evaluations/{created['id']}/cells/stage"
    future = (datetime.now(KST) + timedelta(days=2)).isoformat()
    for bad in (future, "not a time"):
        res = client.post(url, json={"moves": [{"cell_id": a, "stage_key": stage}, {"cell_id": b, "stage_key": stage, "at": bad}]})
        assert res.status_code == 422
    cells = client.get(f"/api/evaluations/{created['id']}/board").json()["cells"]
    assert all(c["stage_key"] is None for c in cells)  # nothing half-applied


def test_undo_restores_previous_stage(env) -> None:
    client, _, created, board = env
    cell = board["cells"][0]["id"]
    stage = first_stage(created)
    url = f"/api/evaluations/{created['id']}/cells/stage"
    moved = client.post(url, json={"moves": [{"cell_id": cell, "stage_key": stage, "at": "2026-11-24T09:00:00"}]}).json()
    back = [{"cell_id": c["id"], "stage_key": c["from"]} for c in moved["changed"]]
    assert client.post(url, json={"moves": back}).status_code == 200
    now = client.get(f"/api/evaluations/{created['id']}/board").json()["cells"]
    assert next(c for c in now if c["id"] == cell)["stage_key"] is None


def test_stalled_cells_sorted_and_limited(env) -> None:
    client, db_path, created, board = env
    ids = [c["id"] for c in board["cells"]]
    s0, s1 = created["stages"][0]["key"], created["stages"][1]["key"]
    client.put(f"/api/evaluations/{created['id']}/warn-hours", json={"warn_hours": {s0: 10, s1: 10}})
    put_stage(db_path, ids[0], s0, "2026-11-24T08:00:00+09:00")   # 4h: fine
    put_stage(db_path, ids[1], s0, "2026-11-24T00:00:00+09:00")   # 12h: warn
    put_stage(db_path, ids[2], s1, "2026-11-22T00:00:00+09:00")   # 60h: severe
    with db.connect(db_path) as conn:
        out = repo.stalled_cells(conn, 5, NOW)
        assert [i["cell_id"] for i in out["items"]] == [ids[2], ids[1]]
        assert out["total"] == 2 and out["levels"] == {"1": 1, "2": 1}
        top = out["items"][0]
        assert (top["equipment"], top["lot_no"], top["warn"]) == ("EQ-A02", "LOT-TEST-001", 2)
        assert top["page_path"] and top["stage_label"] and top["warn_hours"] == 10
        limited = repo.stalled_cells(conn, 1, NOW)
        assert limited["total"] == 2 and len(limited["items"]) == 1
        conn.execute("UPDATE evaluations SET status = 'done' WHERE id = ?", (created["id"],))
        assert repo.stalled_cells(conn, 5, NOW)["total"] == 0  # finished evaluations are not "밀린"


def test_today_and_stalled_endpoints(env) -> None:
    client, db_path, created, board = env
    cell = board["cells"][0]["id"]
    s0 = created["stages"][0]["key"]
    client.put(f"/api/evaluations/{created['id']}/warn-hours", json={"warn_hours": {s0: 1}})
    put_stage(db_path, cell, s0, "2020-01-01T00:00:00+09:00")
    today = client.get("/api/dashboard/today").json()
    assert [i["cell_id"] for i in today["evaluations"]] == [cell]
    assert today["evaluations_stalled"]["total"] == 1 and today["evaluations_stalled"]["limit"] >= 1
    assert client.get("/api/evaluations/stalled?limit=1").json()["total"] == 1


def test_mos_mapping_setting(env) -> None:
    client, *_ = env
    assert client.get("/api/settings").json()["settings"]["mos_mapping"] == ""
    ok = client.put("/api/settings/mos_mapping", json={"value": '{"lot": "LOTNO", "stageMap": {"RCVD": "접수"}}'})
    assert ok.status_code == 200 and "LOTNO" in ok.json()["settings"]["mos_mapping"]
    for bad in ("not json", "[1]", '{"lot": 5}'):
        assert client.put("/api/settings/mos_mapping", json={"value": bad}).status_code == 400
