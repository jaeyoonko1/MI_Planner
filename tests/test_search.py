import json
import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from app.cli import run
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


def _excel_table(table_id: str, display: str, *, version: int = 1, **cell: object) -> str:
    payload = {
        "version": version, "id": table_id, "columns": ["excel-column-meta"],
        "rows": [{"id": "excel-row-meta", "cells": [{
            "displayText": display, "value": {"type": "number", "raw": "987654321.0123"},
            "numberFormat": "excel-format-meta", **cell,
        }]}],
    }
    return "```mi-excel-table\n" + json.dumps(payload, ensure_ascii=False) + "\n```"


def test_excel_display_search_uses_live_page_and_preserves_stored_memos(tmp_path: Path) -> None:
    vault, db_path = tmp_path / "vault", tmp_path / "db.sqlite"
    display = '가짜 "측정값" *표시* 😀 12.5%'
    plain_table = _excel_table("page-block-meta", display)
    linked_table = _excel_table("linked-block-meta", display)
    standalone_table = _excel_table("standalone-block-meta", display)
    with TestClient(create_app(db_path, vault)) as client:
        plain_path = _page(client, "별도 문서", "앞 문단\n" + plain_table + "\n뒤 문단")
        task = client.post("/api/todos", json={"title": "Linked", "note": "stale-mirror-only"}).json()
        linked = client.post(f"/api/todos/{task['id']}/page", json={}).json()["path"]
        live_path = vault / linked / "index.md"
        live = linked_table.replace("\n", "\r\n").encode()
        live_path.write_bytes(live)
        solo = client.post("/api/todos", json={"title": "Standalone", "note": standalone_table}).json()

        ids = {task["id"], solo["id"]}
        results = client.get("/api/search", params={"q": display}).json()
        assert {item["path"] for item in results["pages"]} == {plain_path, linked}
        assert {item["id"] for item in results["tasks"]} == ids
        assert all(display in item["snippet"] for item in results["pages"] + results["tasks"])
        assert all("block-meta" not in item["snippet"] for item in results["pages"] + results["tasks"])
        assert {item["id"] for item in client.get("/api/todos", params={"q": display}).json()["items"]} == ids
        assert [item["id"] for item in client.get("/api/todos", params={"q": display, "ids": solo["id"]}).json()["items"]] == [solo["id"]]

        for hidden in ("mi-excel-table", "block-meta", "excel-row-meta", "excel-format-meta", "987654321.0123", "stale-mirror-only"):
            assert client.get("/api/search", params={"q": hidden}).json() == {"pages": [], "tasks": []}
            assert client.get("/api/todos", params={"q": hidden}).json()["items"] == []
        assert client.get("/api/search", params={"q": "뒤 문단"}).json()["pages"][0]["path"] == plain_path
        assert {item["id"] for item in run([
            "--db", str(db_path), "--vault", str(vault), "task", "list", "--q", display,
        ])["items"]} == ids
        assert live_path.read_bytes() == live
        with sqlite3.connect(db_path) as conn:
            assert dict(conn.execute("SELECT id, note FROM tasks")) == {
                task["id"]: "stale-mirror-only", solo["id"]: standalone_table,
            }


def test_excel_search_skips_invalid_unsupported_and_ambiguous_tables(tmp_path: Path) -> None:
    malformed = "```mi-excel-table\ninvalid-json-token\n```"
    unclosed = "```mi-excel-table\nunfinished-token"
    target = "링크 대상"
    visible = _excel_table("valid", f"merged anchor [[{target}]]").replace("`", "~")
    cases = [
        visible,
        _excel_table("duplicate", "duplicated-display"),
        _excel_table("duplicate", "future-duplicate-display", version=2),
        _excel_table("future", "future-display", version=2),
        _excel_table("invalid-grid", "invalid-span-display", rowSpan=2),
        malformed,
        "<!--\n" + _excel_table("valid", "comment-example") + "\n-->",
        "````md\n" + _excel_table("valid", "fence-example") + "\n````",
        "| GFM 열 |\n| --- |\n| ordinary-gfm |",
        unclosed,
    ]
    body = "\n\n".join(cases)
    with TestClient(create_app(tmp_path / "db.sqlite", tmp_path / "vault")) as client:
        path = _page(client, "표 자료", body)
        target_path = _page(client, target)
        task = client.post("/api/todos", json={"title": "표 메모", "note": body}).json()
        for marker in ("duplicated-display", "future-duplicate-display", "future-display",
                       "invalid-span-display", "invalid-json-token", "unfinished-token"):
            assert client.get("/api/search", params={"q": marker}).json() == {"pages": [], "tasks": []}
            assert client.get("/api/todos", params={"q": marker}).json()["items"] == []
        for marker in ("merged anchor", "ordinary-gfm"):
            result = client.get("/api/search", params={"q": marker}).json()
            assert [item["path"] for item in result["pages"]] == [path]
            assert [item["id"] for item in result["tasks"]] == [task["id"]]
            assert [item["id"] for item in client.get("/api/todos", params={"q": marker}).json()["items"]] == [task["id"]]
        assert client.get("/api/search/backlinks", params={"path": target_path}).json() == {"pages": []}
