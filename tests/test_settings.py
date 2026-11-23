from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


def _client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(tmp_path / "t.db", tmp_path / "vault"))


def test_theme_density_defaults_and_persist(tmp_path: Path) -> None:
    with _client(tmp_path) as c:
        s = c.get("/api/settings").json()["settings"]
        assert s["theme"] == "system" and s["density"] == "normal"
        assert c.put("/api/settings/theme", json={"value": "dark"}).status_code == 200
        assert c.put("/api/settings/density", json={"value": "compact"}).status_code == 200
        s = c.get("/api/settings").json()["settings"]
        assert (s["theme"], s["density"]) == ("dark", "compact")


def test_theme_density_reject_unknown_value(tmp_path: Path) -> None:
    with _client(tmp_path) as c:
        res = c.put("/api/settings/theme", json={"value": "neon"})
        assert res.status_code == 400 and "error" in res.json()
        assert c.put("/api/settings/density", json={"value": "huge"}).status_code == 400
        assert c.get("/api/settings").json()["settings"]["theme"] == "system"


def test_static_files_revalidate(tmp_path: Path) -> None:
    with _client(tmp_path) as c:
        assert c.get("/css/theme.css").headers["cache-control"] == "no-cache"
