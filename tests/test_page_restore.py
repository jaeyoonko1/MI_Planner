"""V-010: sidebar "휴지통으로 이동" can be undone through POST /api/pages/restore."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture()
def client(tmp_path: Path):
    with TestClient(create_app(tmp_path / "t.db", tmp_path / "vault")) as c:
        yield c


def test_trash_then_restore_keeps_children_and_place(client) -> None:
    parent = client.post("/api/pages", json={"parent": "", "title": "상위", "type": "note"}).json()
    child = client.post("/api/pages", json={"parent": parent["path"], "title": "하위", "type": "note"}).json()
    client.put("/api/pages", params={"path": child["path"]}, json={"content": "본문 TEST"})
    trashed = client.delete("/api/pages", params={"path": parent["path"]}).json()["trashed"]
    assert [n["title"] for n in client.get("/api/pages/tree").json()["tree"]] == []
    back = client.post("/api/pages/restore", json={"trashed": trashed, "original": parent["path"]})
    assert back.status_code == 200 and back.json()["path"] == parent["path"]
    tree = client.get("/api/pages/tree").json()["tree"]
    assert [n["title"] for n in tree] == ["상위"] and [c["title"] for c in tree[0]["children"]] == ["하위"]
    assert client.get("/api/pages", params={"path": child["path"]}).json()["content"] == "본문 TEST"


def test_restore_rejects_paths_outside_the_trash(client) -> None:
    page = client.post("/api/pages", json={"parent": "", "title": "그대로", "type": "note"}).json()
    res = client.post("/api/pages/restore", json={"trashed": page["path"], "original": "x"})
    assert res.status_code == 404
