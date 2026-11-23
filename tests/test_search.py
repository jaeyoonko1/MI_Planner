from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


def _page(client: TestClient, title: str, body: str = "", *, parent: str = "", kind: str = "note") -> str:
    response = client.post("/api/pages", json={"title": title, "parent": parent, "type": kind})
    assert response.status_code == 200, response.text
    path = response.json()["path"]
    response = client.put("/api/pages", params={"path": path}, json={"content": body})
    assert response.status_code == 200, response.text
    return path


def test_search_titles_live_bodies_and_tasks(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    with TestClient(create_app(tmp_path / "db.sqlite", vault)) as client:
        _page(client, "Needle")
        body = _page(client, "기록", "접두사 needle 접미사")
        _page(client, "HTML 자료", "<p>NEEdle 엔진</p><script>var hiddenNeedle = 1</script>", kind="html")
        deleted = _page(client, "삭제 예정", "needle")
        assert client.delete("/api/pages", params={"path": deleted}).status_code == 200
        task = client.post("/api/todos", json={"title": "이슈 제목", "note": "옛 값"}).json()
        linked = client.post(f"/api/todos/{task['id']}/page", json={}).json()["path"]
        path = vault / linked / "index.md"
        contents = b"needle live\r\n"
        path.write_bytes(contents)
        standalone = client.post("/api/todos", json={"title": "다른 이슈", "note": "needle memo"}).json()

        response = client.get("/api/search", params={"q": " needle "})
        assert response.status_code == 200
        results = response.json()
        assert results["pages"][0]["title"] == "Needle"
        assert any(p["path"] == body and "needle" in p["snippet"] for p in results["pages"])
        assert any(t["id"] == task["id"] and t["path"] == linked and "live" in t["snippet"] for t in results["tasks"])
        assert any(t["id"] == standalone["id"] and t["path"] is None for t in results["tasks"])
        assert all(p["path"] != deleted for p in results["pages"])
        assert client.get("/api/search", params={"q": "hiddenNeedle"}).json() == {"pages": [], "tasks": []}
        assert client.get("/api/search", params={"q": "NEEDLE", "limit": 1}).json()["pages"][0]["title"] == "Needle"
        assert client.get("/api/search", params={"q": "  "}).json() == {"pages": [], "tasks": []}
        assert path.read_bytes() == contents


def test_backlinks_resolve_title_or_full_path_and_skip_literal_examples(tmp_path: Path) -> None:
    with TestClient(create_app(tmp_path / "db.sqlite", tmp_path / "vault")) as client:
        group = _page(client, "문서")
        one = _page(client, "첫째", parent=group)
        _page(client, "둘째", parent=group)
        duplicated_title = _page(client, "중복", parent=one)
        second = _page(client, "중복", parent="문서/둘째")
        unique = _page(client, "고유 제목", parent=one)
        _page(client, "제목만", "[[중복]]")
        _page(client, "예시", r"\[[고유 제목]]" + "\n`[[고유 제목]]`\n~~~md\n[[고유 제목]]\n~~~\n"
              "<!--\n```\n[[고유 제목]]\n-->\n")
        real = _page(client, "실제", "[[ 고유 제목 ]] · [[문서/첫째/중복]]\n[[고유 제목]]")
        after_comment = _page(client, "주석 뒤", "<!--\n```\n--> [[고유 제목]]")
        _page(client, "HTML", "<p>[[고유 제목]]</p>", kind="html")

        def sources(path: str) -> set[str]:
            response = client.get("/api/search/backlinks", params={"path": path})
            assert response.status_code == 200
            return {page["path"] for page in response.json()["pages"]}

        assert sources(unique) == {real, after_comment}
        assert sources(duplicated_title) == {real}
        assert sources(second) == set()
        assert client.get("/api/search/backlinks", params={"path": "없는 곳"}).status_code == 404
