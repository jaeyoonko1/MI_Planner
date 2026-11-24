"""V-005: equipment / Lot status, rename, memo and cell exclusion on the evaluation board."""
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import create_app

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture()
def env(tmp_path: Path):
    db_path = tmp_path / "p.db"
    with TestClient(create_app(db_path, tmp_path / "vault"), raise_server_exceptions=False) as client:
        body = {"name": "합성 평가", "template_id": 1,
                "equipment": [{"name": "EQ-A01"}, {"name": "EQ-A02", "vendor": "TEST-VENDOR"}],
                "lots": [{"lot_no": "LOT-TEST-001", "wafers": ["01", "02"]}, {"lot_no": "LOT-TEST-002", "wafers": ["01"]}],
                "excluded": [{"equipment": "EQ-A02", "lot_no": "LOT-TEST-001", "wafer_no": "02"}]}
        ev = client.post("/api/evaluations", json=body).json()["evaluation"]
        yield client, ev, db_path


def board(client, ev):
    return client.get(f"/api/evaluations/{ev['id']}/board").json()


def test_board_carries_status_and_note_defaults(env):
    client, ev, _ = env
    data = board(client, ev)
    assert all(e["status"] == "active" and e["note"] is None for e in data["equipment"])
    assert all(lot["status"] == "active" and lot["note"] is None for lot in data["lots"])


def test_patch_equipment_and_lot(env):
    client, ev, _ = env
    data = board(client, ev)
    eq, lot = data["equipment"][0], data["lots"][0]
    res = client.patch(f"/api/evaluations/{ev['id']}/equipment/{eq['id']}",
                       json={"status": "hold", "name": " EQ-A09 ", "vendor": "VND-X", "note": "  점검 중  "})
    assert res.status_code == 200 and res.json() == {
        "id": eq["id"], "kind": "equipment", "name": "EQ-A09", "status": "hold", "note": "점검 중", "vendor": "VND-X"}
    res = client.patch(f"/api/evaluations/{ev['id']}/lots/{lot['id']}", json={"lot_no": "LOT-TEST-009", "status": "done"})
    assert res.json()["name"] == "LOT-TEST-009" and res.json()["status"] == "done"
    after = board(client, ev)
    assert after["equipment"][0]["name"] == "EQ-A09" and after["lots"][0]["lot_no"] == "LOT-TEST-009"
    res = client.patch(f"/api/evaluations/{ev['id']}/equipment/{eq['id']}", json={"vendor": "", "note": None})
    assert res.json()["vendor"] is None and res.json()["note"] is None


@pytest.mark.parametrize("path,body,status", [
    ("equipment/{eq}", {"name": "EQ-A02"}, 409),
    ("equipment/{eq}", {"name": "   "}, 422),
    ("equipment/{eq}", {"name": None}, 422),
    ("equipment/{eq}", {"status": "bogus"}, 422),
    ("equipment/{eq}", {"status": None}, 422),
    ("equipment/{eq}", {"note": "x" * 1001}, 422),
    ("equipment/{eq}", {}, 400),
    ("lots/{lot}", {"lot_no": "LOT-TEST-002"}, 409),
    ("equipment/9999", {"status": "hold"}, 404),
])
def test_patch_validation(env, path, body, status):
    client, ev, _ = env
    data = board(client, ev)
    path = path.format(eq=data["equipment"][0]["id"], lot=data["lots"][0]["id"])
    res = client.patch(f"/api/evaluations/{ev['id']}/{path}", json=body)
    assert res.status_code == status and "error" in res.json()
    after = board(client, ev)
    assert after["equipment"][0]["name"] == "EQ-A01" and after["equipment"][0]["status"] == "active"


def test_entity_of_other_evaluation_is_404(env):
    client, ev, _ = env
    other = client.post("/api/evaluations", json={"name": "다른 평가", "template_id": 1, "equipment": [{"name": "EQ-B01"}],
                                                   "lots": [{"lot_no": "LOT-TEST-100", "wafers": ["01"]}]}).json()["evaluation"]
    foreign = board(client, other)["equipment"][0]["id"]
    res = client.patch(f"/api/evaluations/{ev['id']}/equipment/{foreign}", json={"status": "hold"})
    assert res.status_code == 404


def test_bulk_status_is_atomic_and_reports_changes(env):
    client, ev, _ = env
    data = board(client, ev)
    targets = [{"kind": "equipment", "id": e["id"], "status": "hold"} for e in data["equipment"]]
    targets.append({"kind": "lot", "id": data["lots"][0]["id"], "status": "active"})   # already active
    res = client.post(f"/api/evaluations/{ev['id']}/status", json={"targets": targets})
    assert res.status_code == 200
    out = res.json()
    assert len(out["changed"]) == 2 and out["unchanged"] == [{"kind": "lot", "id": data["lots"][0]["id"]}]
    assert {c["from"] for c in out["changed"]} == {"active"} and {c["to"] for c in out["changed"]} == {"hold"}
    back = [{"kind": c["kind"], "id": c["id"], "status": c["from"]} for c in out["changed"]]
    client.post(f"/api/evaluations/{ev['id']}/status", json={"targets": back})
    assert {e["status"] for e in board(client, ev)["equipment"]} == {"active"}
    bad = [{"kind": "equipment", "id": data["equipment"][0]["id"], "status": "done"},
           {"kind": "lot", "id": 99999, "status": "done"}]
    assert client.post(f"/api/evaluations/{ev['id']}/status", json={"targets": bad}).status_code == 404
    assert board(client, ev)["equipment"][0]["status"] == "active"
    dup = [{"kind": "lot", "id": data["lots"][0]["id"], "status": "hold"}] * 2
    assert client.post(f"/api/evaluations/{ev['id']}/status", json={"targets": dup}).status_code == 400
    assert client.post(f"/api/evaluations/{ev['id']}/status", json={"targets": []}).status_code == 400
    assert client.post(f"/api/evaluations/{ev['id']}/status",
                       json={"targets": [{"kind": "lot", "id": 1, "status": "nope"}]}).status_code == 422


def test_evaluation_status(env):
    client, ev, _ = env
    res = client.patch(f"/api/evaluations/{ev['id']}", json={"status": "hold"})
    assert res.json() == {"from": "active", "status": "hold"}
    assert board(client, ev)["evaluation"]["status"] == "hold"
    assert client.patch(f"/api/evaluations/{ev['id']}", json={"status": "wait"}).status_code == 422
    assert client.patch("/api/evaluations/9999", json={"status": "done"}).status_code == 404


def test_exclude_and_include_keeps_stage_and_restarts_wait(env):
    client, ev, db_path = env
    data = board(client, ev)
    cell = [c for c in data["cells"] if not c["excluded"]][0]
    client.post(f"/api/evaluations/{ev['id']}/cells/stage", json={"cell_ids": [cell["id"]], "stage_key": "review_wait"})
    res = client.post(f"/api/evaluations/{ev['id']}/cells/exclude", json={"cell_ids": [cell["id"]], "excluded": True})
    assert res.json()["changed"] == [cell["id"]]
    mid = next(c for c in board(client, ev)["cells"] if c["id"] == cell["id"])
    assert mid["excluded"] is True and mid["stage_key"] == "review_wait"
    assert client.post(f"/api/evaluations/{ev['id']}/cells/stage",
                       json={"cell_ids": [cell["id"]], "stage_key": "closed"}).status_code == 409
    res = client.post(f"/api/evaluations/{ev['id']}/cells/exclude", json={"cell_ids": [cell["id"]], "excluded": False})
    assert res.json()["changed"] == [cell["id"]]
    with db.connect(db_path) as conn:
        log = [tuple(r) for r in conn.execute(
            "SELECT from_stage, to_stage FROM eval_stage_log WHERE cell_id = ? ORDER BY id", (cell["id"],))]
    assert log == [(None, "review_wait"), ("review_wait", "review_wait")]
    again = client.post(f"/api/evaluations/{ev['id']}/cells/exclude", json={"cell_ids": [cell["id"]], "excluded": False})
    assert again.json()["changed"] == [] and again.json()["unchanged"] == [cell["id"]]
    assert board(client, ev)["evaluation"]["excluded_count"] == 1


def test_exclude_rejections_are_atomic(env):
    client, ev, _ = env
    data = board(client, ev)
    live = [c["id"] for c in data["cells"] if not c["excluded"]]
    url = f"/api/evaluations/{ev['id']}/cells/exclude"
    assert client.post(url, json={"cell_ids": live, "excluded": True}).status_code == 409
    assert client.post(url, json={"cell_ids": [live[0], 99999], "excluded": True}).status_code == 404
    assert client.post(url, json={"cell_ids": [live[0], live[0]], "excluded": True}).status_code == 400
    assert client.post(url, json={"cell_ids": [], "excluded": True}).status_code == 400
    assert board(client, ev)["evaluation"]["excluded_count"] == 1
    res = client.post(url, json={"cell_ids": live[:-1], "excluded": True})
    assert res.status_code == 200 and len(res.json()["changed"]) == len(live) - 1


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_eval_entity_model():
    """V-005: status metadata, targets, undo and name validation (web/test/run_eval_entity.mjs)."""
    res = subprocess.run(["node", str(ROOT / "web" / "test" / "run_eval_entity.mjs")],
                         capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stdout + res.stderr
