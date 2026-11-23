from contextlib import closing
from pathlib import Path
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import create_app


@pytest.fixture()
def workspace(tmp_path: Path):
    path = tmp_path / "test.db"
    with TestClient(create_app(path, tmp_path / "vault")) as client, closing(db.connect(path)) as conn:
        yield client, conn


def stage(key: str = "ready") -> dict:
    return {"key": key, "label": "준비", "color": "#729eff", "warn_hours": 1.5}


def test_one_master_is_seeded_with_ordered_stages_and_fields(workspace) -> None:
    client, conn = workspace
    items = client.get("/api/eval-templates").json()["items"]
    (master,) = items
    assert master["is_master"] is True
    assert [entry["label"] for entry in master["stages"]] == [
        "검사대기", "검사완료", "리뷰대기", "리뷰완료&분류대기", "분류완료", "정리완료",
    ]
    assert [entry["type"] for entry in master["fields"]] == ["okng", "number", "number", "check", "text"]
    assert db.migrate(conn) == []
    assert client.get("/api/eval-templates").json()["items"] == items


def test_create_patch_and_switch_master(workspace) -> None:
    client, _ = workspace
    url = "/api/eval-templates"
    original = client.get(url).json()["items"][0]
    fields = [{"key": "completed", "label": "완료", "type": "check"}]
    response = client.post(url, json={"name": "  가상 평가  ", "stages": [stage()], "fields": fields})
    assert response.status_code == 201
    custom = response.json()
    assert {k: v for k, v in custom.items() if k != "id"} == {
        "name": "가상 평가", "stages": [stage()], "fields": fields, "is_master": False,
    }
    custom_url = f"{url}/{custom['id']}"
    assert client.patch(custom_url, json={"name": "새 템플릿", "is_master": True}).json() == {
        **custom, "name": "새 템플릿", "is_master": True,
    }
    assert client.patch(custom_url, json={"is_master": False}).status_code == 409
    assert client.get(url).json()["items"][1] == {**original, "is_master": False}
    response = client.post(url, json={"name": "또 다른 템플릿", "stages": [stage()], "is_master": True})
    assert response.status_code == 201
    assert [r["id"] for r in client.get(url).json()["items"] if r["is_master"]] == [response.json()["id"]]
    assert client.patch(f"{url}/999", json={"name": "없음"}).status_code == 404


@pytest.mark.parametrize(
    "changed",
    [
        {"name": " "},
        {"stages": []},
        {"stages": [stage(), stage()]},
        {"stages": [{**stage(), "color": "bad"}]},
        {"stages": [{**stage(), "warn_hours": 0}]},
        {"stages": [{**stage(), "warn_hours": "2"}]},
        {"fields": [{"key": "x", "label": "값", "type": "bad"}]},
        {"fields": [{"key": "x", "label": "하나", "type": "text"}] * 2},
    ],
)
def test_invalid_template_does_not_change_master(workspace, changed: dict) -> None:
    client, _ = workspace
    url = "/api/eval-templates"
    before = client.get(url).json()
    response = client.post(url, json={"name": "테스트", "stages": [stage()], "is_master": True, **changed})
    assert response.status_code == 422
    assert "error" in response.json()
    master_id = before["items"][0]["id"]
    assert client.patch(f"{url}/{master_id}", json={"fields": None}).status_code == 422
    assert client.get(url).json() == before


def test_template_edits_do_not_change_evaluation_snapshot(workspace) -> None:
    client, conn = workspace
    master = client.get("/api/eval-templates").json()["items"][0]
    with conn:
        conn.execute(
            "INSERT INTO evaluations(name, stages, fields) "
            "SELECT '합성 평가', stages, fields FROM eval_templates WHERE id = ?",
            (master["id"],),
        )
    before = dict(conn.execute("SELECT stages, fields FROM evaluations").fetchone())
    response = client.patch(f"/api/eval-templates/{master['id']}", json={"stages": [stage()], "fields": []})
    assert response.status_code == 200
    assert response.json()["stages"] == [stage()]
    assert dict(conn.execute("SELECT stages, fields FROM evaluations").fetchone()) == before


def test_evaluation_cells_cannot_mix_equipment_or_lots_and_cascade_history(workspace) -> None:
    _, conn = workspace
    with conn:
        for evaluation_id, equipment_name in [(1, "EQ-A01"), (2, "EQ-B01")]:
            conn.execute(
                "INSERT INTO evaluations(id, name, stages) SELECT ?, '합성 평가', stages "
                "FROM eval_templates WHERE is_master = 1",
                (evaluation_id,),
            )
            conn.execute(
                "INSERT INTO eval_equipment(id, evaluation_id, name) VALUES (?, ?, ?)",
                (evaluation_id, evaluation_id, equipment_name),
            )
            conn.execute(
                "INSERT INTO eval_lots(id, evaluation_id, lot_no) VALUES (?, ?, 'LOT-TEST-001')",
                (evaluation_id, evaluation_id),
            )
            conn.execute(
                "INSERT INTO eval_wafers(id, evaluation_id, lot_id, wafer_no) VALUES (?, ?, ?, '1')",
                (evaluation_id, evaluation_id, evaluation_id),
            )
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO eval_wafers(evaluation_id, lot_id, wafer_no) VALUES (2, 1, '2')")
        insert_cell = "INSERT INTO eval_cells(evaluation_id, equipment_id, wafer_id) VALUES (?, ?, ?)"
        for ids in [(1, 1, 2), (1, 2, 1), (2, 1, 1)]:
            with pytest.raises(sqlite3.IntegrityError):
                conn.execute(insert_cell, ids)
        conn.execute(insert_cell, (1, 1, 1))
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(insert_cell, (1, 1, 1))
        conn.executemany(
            "INSERT INTO eval_stage_log(cell_id, from_stage, to_stage, at) "
            "VALUES (1, ?, ?, '2026-11-24T10:00:00+09:00')",
            [(None, "inspection_wait"), ("inspection_wait", "inspection_done")],
        )
        latest = conn.execute(
            "SELECT to_stage FROM eval_stage_log WHERE cell_id = 1 ORDER BY at DESC, id DESC LIMIT 1"
        ).fetchone()
        assert latest["to_stage"] == "inspection_done"
        conn.execute("DELETE FROM evaluations WHERE id = 1")
    for table in ("eval_cells", "eval_stage_log"):
        assert conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
    assert conn.execute("SELECT evaluation_id FROM eval_wafers").fetchone()[0] == 2
