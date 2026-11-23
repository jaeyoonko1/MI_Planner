import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import create_app
from app.vault import Vault


@pytest.fixture()
def env(tmp_path: Path):
    db_path, vault = tmp_path / "planner.db", tmp_path / "vault"
    with TestClient(create_app(db_path, vault), raise_server_exceptions=False) as client:
        yield client, db_path, vault


def draft(**extra):
    return {
        "name": "합성 평가",
        "template_id": 1,
        "equipment": [{"name": "EQ-A01"}, {"name": "EQ-A02", "vendor": "TEST-VENDOR"}],
        "lots": [{"lot_no": "LOT-TEST-001", "wafers": ["01", "02"]}, {"lot_no": "LOT-TEST-002", "wafers": ["01"]}],
        "excluded": [{"equipment": "EQ-A02", "lot_no": "LOT-TEST-001", "wafer_no": "02"}],
        **extra,
    }


def test_create_evaluation_snapshot_and_board(env):
    client, db_path, vault = env
    client.post("/api/pages", json={"title": "MI 공정업무"})
    parent = client.post("/api/pages", json={"parent": "MI 공정업무", "title": "설비사 평가"}).json()["path"]
    res = client.post("/api/evaluations", json=draft())
    assert res.status_code == 201, res.text
    assert res.json()["created"]
    entry = res.json()["evaluation"]
    assert entry["page_path"] == parent + "/합성 평가"
    assert entry["cell_count"] == 5
    assert entry["excluded_count"] == 1
    assert client.get("/api/evaluations").json() == {"items": [entry]}
    page = client.get("/api/pages", params={"path": entry["page_path"]}).json()
    assert page["meta"]["type"] == "board"
    assert page["meta"]["eval_id"] == entry["id"]
    assert (vault / entry["page_path"] / "index.md").read_bytes() == b""
    with db.connect(db_path) as conn:
        cells = conn.execute(
            """SELECT e.name, l.lot_no, w.wafer_no, c.stage_key, c.excluded
               FROM eval_cells c JOIN eval_equipment e ON e.id = c.equipment_id
               JOIN eval_wafers w ON w.id = c.wafer_id
               JOIN eval_lots l ON l.id = w.lot_id
               ORDER BY e.sort, l.sort, w.sort"""
        ).fetchall()
        assert len(cells) == 6
        assert [tuple(cell) for cell in cells if cell["excluded"]] == [("EQ-A02", "LOT-TEST-001", "02", None, 1)]
        assert all(cell["stage_key"] is None for cell in cells)
        assert conn.execute("SELECT count(*) FROM eval_stage_log").fetchone()[0] == 0
    patch = client.patch("/api/eval-templates/1", json={"stages": [{"key":"new", "label":"새 단계", "color":"#000000"}]})
    assert patch.status_code == 200
    assert client.get(f"/api/evaluations/{entry['id']}").json()["stages"] == entry["stages"]


def test_create_retry_matches_payload_and_explicit_parent(env):
    client, _, _ = env
    client.post("/api/pages", json={"title": "사용자 폴더"})
    key = "e619aa14-31da-4f46-90b9-618015a7c20d"
    payload = draft(parent="사용자 폴더", request_id=key)
    first = client.post("/api/evaluations", json=payload)
    assert first.status_code == 201, first.text
    entry = first.json()["evaluation"]
    assert entry["page_path"].startswith("사용자 폴더/")
    second = client.post("/api/evaluations", json=payload)
    assert second.status_code == 200
    assert second.json() == {"created": False, "evaluation": entry}
    assert client.post("/api/evaluations", json={**payload, "name": "다른 평가"}).status_code == 409
    assert client.get("/api/evaluations").json() == {"items": [entry]}
    tree = client.get("/api/pages/tree").json()["tree"]
    assert len(tree[0]["children"]) == 1


def test_concurrent_retry_creates_only_one_board(env):
    client, _, _ = env
    payload = draft(request_id="4fe624f5-0439-4f68-8fdf-61fa9053c1a9")
    with ThreadPoolExecutor(max_workers=2) as pool:
        requests = [pool.submit(client.post, "/api/evaluations", json=payload) for _ in range(2)]
        results = [call.result() for call in requests]
    assert sorted(result.status_code for result in results) == [200, 201]
    assert results[0].json()["evaluation"] == results[1].json()["evaluation"]
    assert len(client.get("/api/pages/tree").json()["tree"]) == 1


@pytest.mark.parametrize("patch", [
    {"equipment": [{"name": "EQ-A01"}, {"name": " EQ-A01 "}]},
    {"lots": [{"lot_no": "LOT-TEST-001", "wafers": ["01", "01"]}]},
    {"excluded": [{"equipment": "MISSING", "lot_no": "LOT-TEST-001", "wafer_no": "01"}]},
    {
        "equipment": [{"name": "EQ-A01"}],
        "lots": [{"lot_no": "LOT-TEST-001", "wafers": ["01"]}],
        "excluded": [{"equipment": "EQ-A01", "lot_no": "LOT-TEST-001", "wafer_no": "01"}],
    },
])
def test_invalid_matrix_has_no_side_effects(env, patch):
    client, _, _ = env
    assert client.post("/api/evaluations", json=draft(**patch)).status_code == 422
    assert client.get("/api/evaluations").json()["items"] == []
    assert client.get("/api/pages/tree").json()["tree"] == []


def test_page_path_follows_move_and_trash(env):
    client, _, _ = env
    client.post("/api/pages", json={"title": "부모"})
    entry = client.post("/api/evaluations", json=draft(parent="부모")).json()["evaluation"]
    assert client.patch("/api/pages", params={"path": "부모"}, json={"title": "이동"}).status_code == 200
    get = f"/api/evaluations/{entry['id']}"
    assert client.get(get).json()["page_path"] == entry["page_path"].replace("부모", "이동")
    assert client.delete("/api/pages", params={"path": "이동"}).status_code == 200
    assert client.get(get).json()["page_path"] is None


def test_db_link_failure_rolls_back_and_trashes_only_new_page(env):
    client, db_path, vault = env
    client.post("/api/pages", json={"title": "합성 평가"})
    original = vault / "합성 평가" / "index.md"
    original.write_bytes(b"untouched")
    with db.connect(db_path) as conn:
        conn.execute(
            """CREATE TRIGGER fail_link BEFORE UPDATE OF page_path ON evaluations
               BEGIN SELECT RAISE(ABORT, 'synthetic fault'); END"""
        )
    assert client.post("/api/evaluations", json=draft()).status_code == 500
    assert client.get("/api/evaluations").json()["items"] == []
    assert [item["path"] for item in client.get("/api/pages/tree").json()["tree"]] == ["합성 평가"]
    assert original.read_bytes() == b"untouched"
    records = list((vault / ".trash").iterdir())
    assert len(records) == 1
    assert (records[0] / "_page.json").is_file()
    with db.connect(db_path) as conn:
        assert conn.execute("SELECT count(*) FROM eval_cells").fetchone()[0] == 0


def test_partial_board_write_is_moved_to_trash(env, monkeypatch):
    client, _, vault = env
    original = Vault._write_meta

    def fail(vault_self, page, meta):
        original(vault_self, page, meta)
        if meta["type"] == "board":
            raise OSError("synthetic board file failure")

    monkeypatch.setattr(Vault, "_write_meta", fail)
    assert client.post("/api/evaluations", json=draft()).status_code == 500
    assert client.get("/api/evaluations").json()["items"] == []
    assert client.get("/api/pages/tree").json()["tree"] == []
    assert len(list((vault / ".trash").iterdir())) == 1


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_clipboard_parsers():
    script = Path(__file__).resolve().parent.parent / "web/test/run_evaluation_input.mjs"
    result = subprocess.run(["node", str(script)], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr


def test_board_endpoint_returns_compact_matrix(env):
    client, db_path, _ = env
    created = client.post("/api/evaluations", json=draft()).json()["evaluation"]
    board = client.get(f"/api/evaluations/{created['id']}/board")
    assert board.status_code == 200, board.text
    data = board.json()
    assert data["evaluation"]["id"] == created["id"]
    assert [item["name"] for item in data["equipment"]] == ["EQ-A01", "EQ-A02"]
    assert [(lot["lot_no"], [w["wafer_no"] for w in lot["wafers"]]) for lot in data["lots"]] == [
        ("LOT-TEST-001", ["01", "02"]), ("LOT-TEST-002", ["01"])]
    assert len(data["cells"]) == 6
    assert sum(cell["excluded"] for cell in data["cells"]) == 1
    assert all(cell["stage_key"] is None and cell["at"] is None and cell["values"] == {} for cell in data["cells"])
    # The latest stage entry time comes from the log, never from the cell row (D-09).
    with db.connect(db_path) as conn:
        cell_id = data["cells"][0]["id"]
        conn.execute("INSERT INTO eval_stage_log (cell_id, from_stage, to_stage, at) VALUES (?, NULL, 'closed', '2026-11-20T09:00:00')", (cell_id,))
        conn.execute("INSERT INTO eval_stage_log (cell_id, from_stage, to_stage, at) VALUES (?, 'closed', 'review_wait', '2026-11-21T09:00:00')", (cell_id,))
        conn.commit()
    again = client.get(f"/api/evaluations/{created['id']}/board").json()
    assert next(c for c in again["cells"] if c["id"] == cell_id)["at"] == "2026-11-21T09:00:00"
    assert client.get("/api/evaluations/999/board").status_code == 404


def test_board_for_large_evaluation_has_one_row_per_cell(env):
    client, _, _ = env
    lots = [{"lot_no": f"LOT-TEST-{i:03d}", "wafers": [f"{w:02d}" for w in range(1, 26)]} for i in range(1, 21)]
    body = draft(equipment=[{"name": f"EQ-A{i:02d}"} for i in range(1, 11)], lots=lots, excluded=[])
    evaluation = client.post("/api/evaluations", json=body).json()["evaluation"]
    data = client.get(f"/api/evaluations/{evaluation['id']}/board").json()
    assert len(data["cells"]) == 5000
    assert len({(c["equipment_id"], c["wafer_id"]) for c in data["cells"]}) == 5000
