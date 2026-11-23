from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


def test_health(tmp_path: Path) -> None:
    with TestClient(create_app(tmp_path / "t.db")) as client:
        res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert (tmp_path / "t.db").exists()
