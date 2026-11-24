from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture()
def client(tmp_path: Path):
    with TestClient(create_app(tmp_path / "t.db", tmp_path / "vault")) as c:
        c.vault_dir = tmp_path / "vault"  # type: ignore[attr-defined]
        yield c


def test_create_and_tree(client) -> None:
    a = client.post("/api/pages", json={"parent": "", "title": "일지"}).json()
    assert a["path"] == "일지"
    client.post("/api/pages", json={"parent": "일지", "title": "2026-11", "type": "journal"})
    client.post("/api/pages", json={"parent": "", "title": "스터디", "type": "html"})
    tree = client.get("/api/pages/tree").json()["tree"]
    assert [n["title"] for n in tree] == ["일지", "스터디"]
    assert tree[0]["children"][0]["path"] == "일지/2026-11"
    assert tree[0]["children"][0]["type"] == "journal"


def test_duplicate_title_gets_suffix(client) -> None:
    client.post("/api/pages", json={"title": "메모"})
    b = client.post("/api/pages", json={"title": "메모"}).json()
    assert b["path"] == "메모 (2)"


def test_read_write_content(client) -> None:
    client.post("/api/pages", json={"title": "n"})
    r = client.put("/api/pages", params={"path": "n"}, json={"content": "# hi"})
    assert r.json()["content"] == "# hi"
    assert (client.vault_dir / "n" / "index.md").read_text(encoding="utf-8") == "# hi"
    client.post("/api/pages", json={"title": "h", "type": "html"})
    client.put("/api/pages", params={"path": "h"}, json={"content": "<p>x</p>"})
    assert (client.vault_dir / "h" / "index.html").is_file()


def test_note_preserves_mixed_line_endings(client) -> None:
    client.post("/api/pages", json={"title": "line-endings"})
    content = "# 제목\r\n\r\n```\n한글\r```\n"
    path = {"path": "line-endings"}
    stored = client.vault_dir / "line-endings" / "index.md"
    stored.write_bytes(content.encode("utf-8"))
    assert client.get("/api/pages", params=path).json()["content"] == content
    updated = content.replace("제목", "수정")
    assert client.put("/api/pages", params=path, json={"content": updated}).json()["content"] == updated
    assert stored.read_bytes() == updated.encode("utf-8")


def test_note_layout_round_trip_without_rewriting_markdown(client) -> None:
    path = {"path": "columns"}
    client.post("/api/pages", json={"title": "columns"})
    content = "# 왼쪽\r\n\r\n<!-- column -->\r\n\r\n# 오른쪽\r\n"
    client.put("/api/pages", params=path, json={"content": content})
    assert "note_layout" not in client.get("/api/pages", params=path).json()["meta"]
    layout = {"mode": "scroll", "widths": [30, 70]}
    saved = client.put("/api/pages/layout", params=path, json=layout)
    assert saved.json() == {"note_layout": layout}
    assert (client.vault_dir / "columns" / "index.md").read_bytes() == content.encode("utf-8")
    client.put("/api/pages", params=path, json={"content": content.replace("오른쪽", "수정")})
    page = client.patch("/api/pages", params=path, json={"title": "renamed"}).json()
    assert client.get("/api/pages", params={"path": page["path"]}).json()["meta"]["note_layout"] == layout


def test_note_layout_rows_round_trip_and_validation(client) -> None:
    client.post("/api/pages", json={"title": "grid"})
    path = {"path": "grid"}
    content = "A\n<!-- column -->\nB\n<!-- row -->\nC\n"
    client.put("/api/pages", params=path, json={"content": content})
    layout = {"mode": "fit", "rows": [[40, 60], [100]]}
    assert client.put("/api/pages/layout", params=path, json=layout).json() == {"note_layout": layout}
    assert client.get("/api/pages", params=path).json()["meta"]["note_layout"] == layout
    assert (client.vault_dir / "grid" / "index.md").read_bytes() == content.encode("utf-8")
    for bad in ([[40, 50], [100]], [[100]], [[40, 60], []], [[20] * 5, [100]], [[100]] * 7):
        assert client.put("/api/pages/layout", params=path, json={"mode": "fit", "rows": bad}).status_code == 422
    assert client.get("/api/pages", params=path).json()["meta"]["note_layout"] == layout


@pytest.mark.parametrize("layout", [
    {"mode": "invalid", "widths": [50, 50]},
    {"mode": "fit", "widths": [30, 60]},
    {"mode": "fit", "widths": [0, 100]},
    {"mode": "fit", "widths": [100]},
    {"mode": "fit", "widths": [20, 20, 20, 20, 20]},
    {"mode": "fit", "widths": ["50", 50]},
])
def test_note_layout_rejects_invalid_values(client, layout) -> None:
    client.post("/api/pages", json={"title": "columns"})
    path = {"path": "columns"}
    assert client.put("/api/pages/layout", params=path, json=layout).status_code == 422
    assert "note_layout" not in client.get("/api/pages", params=path).json()["meta"]


def test_note_layout_rejects_other_page_types(client) -> None:
    client.post("/api/pages", json={"title": "html", "type": "html"})
    layout = {"mode": "fit"}
    assert client.put("/api/pages/layout", params={"path": "html"}, json=layout).status_code == 400
    assert client.put("/api/pages/layout", params={"path": "missing"}, json=layout).status_code == 404


def test_rename_move_order(client) -> None:
    client.post("/api/pages", json={"title": "a"})
    client.post("/api/pages", json={"title": "b"})
    r = client.patch("/api/pages", params={"path": "a"}, json={"title": "renamed", "parent": "b"})
    assert r.json()["path"] == "b/renamed"
    assert r.json()["meta"]["title"] == "renamed"
    r = client.patch("/api/pages", params={"path": "b"}, json={"order": 9})
    assert r.json()["meta"]["order"] == 9


def test_cannot_move_into_self(client) -> None:
    client.post("/api/pages", json={"title": "a"})
    client.post("/api/pages", json={"parent": "a", "title": "c"})
    r = client.patch("/api/pages", params={"path": "a"}, json={"parent": "a/c"})
    assert r.status_code == 400 and "error" in r.json()


def test_delete_goes_to_trash(client) -> None:
    client.post("/api/pages", json={"title": "gone"})
    r = client.delete("/api/pages", params={"path": "gone"})
    trashed = r.json()["trashed"]
    assert trashed.startswith(".trash/")
    assert (client.vault_dir / trashed / "_page.json").is_file()
    assert client.get("/api/pages/tree").json()["tree"] == []
    assert client.get("/api/pages", params={"path": "gone"}).status_code == 404


@pytest.mark.parametrize("bad", ["../x", "..", ".trash/x", "a/../../x", "files"])
def test_path_traversal_rejected(client, bad) -> None:
    r = client.get("/api/pages", params={"path": bad})
    assert r.status_code in (400, 404)
    assert "error" in r.json()


def test_bad_title_and_type(client) -> None:
    assert client.post("/api/pages", json={"title": "///"}).status_code == 400
    assert client.post("/api/pages", json={"title": "x", "type": "zzz"}).status_code == 400
