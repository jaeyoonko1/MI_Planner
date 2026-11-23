from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.html_page import find_external_refs
from app.main import create_app


@pytest.fixture()
def client(tmp_path: Path):
    with TestClient(create_app(tmp_path / "t.db", tmp_path / "vault")) as c:
        c.vault_dir = tmp_path / "vault"  # type: ignore[attr-defined]
        yield c


def _html_page(client, html: str = "<p>x</p>") -> str:
    p = client.post("/api/pages", json={"title": "lec", "type": "html"}).json()["path"]
    client.put("/api/pages", params={"path": p}, json={"content": html})
    return p


def test_state_roundtrip(client) -> None:
    p = _html_page(client)
    assert client.get("/api/pages/state", params={"path": p}).json() == {"state": {}}
    r = client.put("/api/pages/state", params={"path": p}, json={"state": {"done": [1, 2], "메모": "ok"}})
    assert r.status_code == 200
    assert client.get("/api/pages/state", params={"path": p}).json()["state"]["done"] == [1, 2]
    assert (client.vault_dir / p / "_state.json").is_file()


def test_state_rejects_non_html_and_bad_body(client) -> None:
    n = client.post("/api/pages", json={"title": "n"}).json()["path"]
    assert client.get("/api/pages/state", params={"path": n}).status_code == 400
    p = _html_page(client)
    assert client.put("/api/pages/state", params={"path": p}, json={"state": [1]}).status_code == 400
    assert client.get("/api/pages/state", params={"path": "../x"}).status_code == 400
    assert client.get("/api/pages/state", params={"path": "nope"}).status_code == 404


def test_external_refs_endpoint(client) -> None:
    html = (
        '<script src="https://cdn.example.test/a.js"></script>'
        '<link href="//fonts.example.test/x.css" rel="stylesheet">'
        "<style>@import 'http://e.test/s.css'; a{background:url(http://e.test/i.png)}</style>"
        "<script>fetch('https://api.example.test/d')</script><a href=\"#local\">ok</a>"
    )
    p = _html_page(client, html)
    ext = client.get("/api/pages/external-refs", params={"path": p}).json()["external"]
    assert "https://cdn.example.test/a.js" in ext
    assert "//fonts.example.test/x.css" in ext
    assert "https://api.example.test/d" in ext
    assert len(ext) == 5


def test_clean_html_has_no_refs() -> None:
    assert find_external_refs('<img src="data:image/png;base64,AA"><a href="#a">x</a>') == []
