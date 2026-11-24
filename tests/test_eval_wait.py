"""P4-06: wait time and warning levels are computed from eval_stage_log at query time (D-09)."""
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db, eval_wait
from app.main import create_app
from app.repositories import evaluations as repo

KST = timezone(timedelta(hours=9))
NOW = datetime(2026, 11, 24, 12, 0, tzinfo=KST)


@pytest.fixture()
def env(tmp_path: Path):
    db_path = tmp_path / "planner.db"
    with TestClient(create_app(db_path, tmp_path / "vault"), raise_server_exceptions=False) as client:
        body = {"name": "합성 평가", "template_id": 1, "equipment": [{"name": "EQ-A01"}, {"name": "EQ-A02"}],
                "lots": [{"lot_no": "LOT-TEST-001", "wafers": ["01", "02"]}],
                "excluded": [{"equipment": "EQ-A02", "lot_no": "LOT-TEST-001", "wafer_no": "02"}]}
        created = client.post("/api/evaluations", json=body).json()["evaluation"]
        yield client, db_path, created


def put_stage(db_path, cell_id, stage, at, prev=None):
    with db.connect(db_path) as conn:
        conn.execute("UPDATE eval_cells SET stage_key = ? WHERE id = ?", (stage, cell_id))
        conn.execute("INSERT INTO eval_stage_log (cell_id, from_stage, to_stage, at) VALUES (?, ?, ?, ?)",
                     (cell_id, prev, stage, at))


def board(db_path, evaluation_id, now=NOW):
    with db.connect(db_path) as conn:
        return {c["id"]: c for c in repo.get_board(conn, evaluation_id, now)["cells"]}


def test_pure_rules():
    assert eval_wait.warn_level(None, 10) == 0
    assert eval_wait.warn_level(50, None) == 0
    assert eval_wait.warn_level(10, 10) == 0          # exactly at the threshold is not yet over
    assert eval_wait.warn_level(10.01, 10) == 1
    assert eval_wait.warn_level(20, 10) == 1
    assert eval_wait.warn_level(20.01, 10) == 2
    assert eval_wait.wait_hours("2026-11-24T10:00:00+09:00", NOW) == 2
    assert eval_wait.wait_hours("2026-11-24T10:00:00", NOW) == 2                 # naive = Asia/Seoul
    assert eval_wait.wait_hours("2026-11-24T01:00:00+00:00", NOW) == 2           # UTC instant
    assert eval_wait.wait_hours("2026-11-25T10:00:00+09:00", NOW) == 0           # future clamps to 0
    assert eval_wait.wait_hours("garbage", NOW) is None and eval_wait.wait_hours(None, NOW) is None


def test_board_wait_levels_and_edge_cases(env):
    client, db_path, ev = env
    stages = [s["key"] for s in ev["stages"]]
    res = client.put(f"/api/evaluations/{ev['id']}/warn-hours", json={"warn_hours": {stages[0]: 24, stages[1]: 8}})
    assert res.status_code == 200 and res.json()["stages"][0]["warn_hours"] == 24
    cells = client.get(f"/api/evaluations/{ev['id']}/board").json()["cells"]
    active = [c["id"] for c in cells if not c["excluded"]]
    excluded = [c["id"] for c in cells if c["excluded"]][0]
    a, b, c = active
    put_stage(db_path, a, stages[0], "2026-11-23T08:00:00+09:00")                       # 28h, warn 24 -> level 1
    put_stage(db_path, b, stages[1], "2026-11-23T08:00:00+09:00")                       # 28h, warn 8 -> level 2
    # c: never moved -> no log, unassigned
    got = board(db_path, ev["id"])
    assert (got[a]["wait_h"], got[a]["warn"]) == (28.0, 1)
    assert (got[b]["wait_h"], got[b]["warn"]) == (28.0, 2)
    assert (got[c]["wait_h"], got[c]["warn"]) == (None, 0)
    assert (got[excluded]["wait_h"], got[excluded]["warn"]) == (None, 0)
    # frozen clock: nothing is stored, so a later "now" yields a later wait for the same data
    later = board(db_path, ev["id"], NOW + timedelta(hours=24))
    assert later[a]["wait_h"] == 52.0 and later[a]["warn"] == 2
    with db.connect(db_path) as conn:
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(eval_cells)")]
    assert not any("wait" in name or "warn" in name for name in cols)


def test_reentered_stage_restarts_and_last_stage_and_threshold_none(env):
    client, db_path, ev = env
    stages = [s["key"] for s in ev["stages"]]
    cells = client.get(f"/api/evaluations/{ev['id']}/board").json()["cells"]
    a, b = [c["id"] for c in cells if not c["excluded"]][:2]
    client.put(f"/api/evaluations/{ev['id']}/warn-hours", json={"warn_hours": {stages[0]: 10}})
    put_stage(db_path, a, stages[0], "2026-11-20T08:00:00+09:00")
    put_stage(db_path, a, stages[1], "2026-11-21T08:00:00+09:00", stages[0])
    put_stage(db_path, a, stages[0], "2026-11-24T09:00:00+09:00", stages[1])          # sent back: clock restarts
    got = board(db_path, ev["id"])
    assert (got[a]["wait_h"], got[a]["warn"]) == (3.0, 0)
    put_stage(db_path, b, stages[-1], "2026-11-01T08:00:00+09:00")                    # finished cells never wait
    assert board(db_path, ev["id"])[b]["warn"] == 0 and board(db_path, ev["id"])[b]["wait_h"] is None
    put_stage(db_path, b, stages[1], "2026-11-01T08:00:00+09:00", stages[-1])         # stage without threshold
    assert board(db_path, ev["id"])[b]["warn"] == 0 and board(db_path, ev["id"])[b]["wait_h"] > 24


def test_stage_without_matching_log_is_unknown(env):
    client, db_path, ev = env
    stages = [s["key"] for s in ev["stages"]]
    a = [c["id"] for c in client.get(f"/api/evaluations/{ev['id']}/board").json()["cells"] if not c["excluded"]][0]
    with db.connect(db_path) as conn:
        conn.execute("UPDATE eval_cells SET stage_key = ? WHERE id = ?", (stages[0], a))   # no log at all
    assert board(db_path, ev["id"])[a]["wait_h"] is None


def test_warn_hours_validation(env):
    client, _, ev = env
    key = ev["stages"][0]["key"]
    url = f"/api/evaluations/{ev['id']}/warn-hours"
    for bad in ({}, {"nope": 5}, {key: 0}, {key: -3}, {key: 9999}, {key: True}, {key: "x"}):
        assert client.put(url, json={"warn_hours": bad}).status_code in (422, 400), bad
    assert client.put(url, json={"warn_hours": {key: 12.5}}).json()["stages"][0]["warn_hours"] == 12.5
    assert client.put(url, json={"warn_hours": {key: None}}).json()["stages"][0]["warn_hours"] is None
    assert client.put("/api/evaluations/9999/warn-hours", json={"warn_hours": {key: 1}}).status_code == 404
