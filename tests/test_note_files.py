from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 16


@pytest.fixture()
def client(tmp_path: Path):
    with TestClient(create_app(tmp_path / "t.db", tmp_path / "vault")) as c:
        c.vault_dir = tmp_path / "vault"  # type: ignore[attr-defined]
        c.post("/api/pages", json={"title": "메모"})
        yield c


def test_upload_and_fetch_image(client) -> None:
    r = client.post("/api/pages/files", params={"path": "메모", "name": "image.png"}, content=PNG)
    assert r.status_code == 200
    rel = r.json()["file"]
    assert rel.startswith("files/img-") and rel.endswith(".png")
    assert (client.vault_dir / "메모" / rel).read_bytes() == PNG
    got = client.get("/api/pages/file", params={"path": "메모", "name": rel.split("/")[1]})
    assert got.status_code == 200 and got.content == PNG


def test_two_uploads_do_not_collide(client) -> None:
    a = client.post("/api/pages/files", params={"path": "메모", "name": "a.png"}, content=PNG).json()["file"]
    b = client.post("/api/pages/files", params={"path": "메모", "name": "a.png"}, content=PNG).json()["file"]
    assert a != b


def test_rejects_bad_type_empty_and_traversal(client) -> None:
    bad = client.post("/api/pages/files", params={"path": "메모", "name": "x.svg"}, content=PNG)
    assert bad.status_code == 400 and "error" in bad.json()
    assert client.post("/api/pages/files", params={"path": "메모", "name": "x.png"}, content=b"").status_code == 400
    assert client.get("/api/pages/file", params={"path": "메모", "name": "../_page.json"}).status_code == 400


def test_files_dir_is_not_a_page(client) -> None:
    client.post("/api/pages/files", params={"path": "메모", "name": "a.png"}, content=PNG)
    tree = client.get("/api/pages/tree").json()["tree"]
    assert tree[0]["children"] == []
