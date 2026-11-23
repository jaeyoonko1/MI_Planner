from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture()
def client(tmp_path: Path):
    app = create_app(tmp_path / "t.db", tmp_path / "vault")
    with TestClient(app) as c:
        yield c


def add(client, **kw):
    r = client.post("/api/todos", json=kw)
    assert r.status_code == 201, r.text
    return r.json()


def days(n: int) -> str:
    return (date.today() + timedelta(days=n)).isoformat()


def test_create_defaults_and_get(client) -> None:
    t = add(client, title="  LOT-TEST-001 리뷰  ", requester="홍길동")
    assert t["title"] == "LOT-TEST-001 리뷰"
    assert (t["status"], t["priority"]) == ("todo", 2)
    assert client.get(f"/api/todos/{t['id']}").json()["requester"] == "홍길동"


def test_validation_errors_use_error_key(client) -> None:
    for body in ({"title": " "}, {"title": "x", "status": "nope"}, {"title": "x", "priority": 9},
                 {"title": "x", "due_date": "2026/11/01"}):
        r = client.post("/api/todos", json=body)
        assert r.status_code == 400 and "error" in r.json()
    r = client.post("/api/todos", json={})
    assert r.status_code == 422 and "error" in r.json()
    r = client.get("/api/todos/999")
    assert r.status_code == 404 and "error" in r.json()


def test_patch_updates_and_clears(client) -> None:
    t = add(client, title="a", due_date="2026-12-01", note="n")
    r = client.patch(f"/api/todos/{t['id']}", json={"status": "doing", "due_date": None})
    body = r.json()
    assert body["status"] == "doing" and body["due_date"] is None and body["note"] == "n"
    assert client.patch(f"/api/todos/{t['id']}", json={"status": None}).status_code == 400
    assert client.patch("/api/todos/999", json={"note": "x"}).status_code == 404


def test_delete(client) -> None:
    t = add(client, title="a")
    assert client.delete(f"/api/todos/{t['id']}").json()["ok"] is True
    assert client.get(f"/api/todos/{t['id']}").status_code == 404
    assert client.delete(f"/api/todos/{t['id']}").status_code == 404


def test_filters(client) -> None:
    add(client, title="a", status="todo", priority=1, requester="EQ-A01 담당", due_date=days(1))
    add(client, title="b", status="doing", priority=2, requester="김철수", due_date=days(10))
    add(client, title="c", status="done", priority=3, due_date=days(-2), planned_date=days(0))
    add(client, title="d", status="todo", priority=2, due_date=days(-3), note="LOT-TEST-002")
    add(client, title="e")

    def titles(qs: str) -> list[str]:
        return [t["title"] for t in client.get(f"/api/todos?{qs}").json()["items"]]

    assert titles("") == ["d", "c", "a", "b", "e"]  # due asc, nulls last
    assert titles("status=todo,doing") == ["d", "a", "b", "e"]
    assert titles("priority=1,3") == ["c", "a"]
    assert titles("requester=김철수") == ["b"]
    assert titles("due_within=3") == ["a"]
    assert titles("overdue=true") == ["d"]  # done tasks are not overdue
    assert titles(f"planned_date={days(0)}") == ["c"]
    assert titles("q=LOT-TEST-002") == ["d"]
    assert set(client.get("/api/todos").json()["requesters"]) == {"EQ-A01 담당", "김철수"}
    assert client.get("/api/todos?status=bogus").status_code == 400
    assert client.get("/api/todos?priority=x").status_code == 400


def test_subtasks_and_parent_rules(client) -> None:
    p = add(client, title="parent")
    c = add(client, title="child", parent_task_id=p["id"])
    items = client.get(f"/api/todos?parent_task_id={p['id']}").json()["items"]
    assert [t["id"] for t in items] == [c["id"]]
    top = client.get("/api/todos?top_level=true").json()["items"]
    assert [t["id"] for t in top] == [p["id"]]
    # cycle / self / missing parent
    assert client.patch(f"/api/todos/{p['id']}", json={"parent_task_id": c["id"]}).status_code == 400
    assert client.patch(f"/api/todos/{p['id']}", json={"parent_task_id": p["id"]}).status_code == 400
    assert client.post("/api/todos", json={"title": "x", "parent_task_id": 999}).status_code == 404
    # deleting parent detaches the child
    client.delete(f"/api/todos/{p['id']}")
    assert client.get(f"/api/todos/{c['id']}").json()["parent_task_id"] is None


def test_link_filters(client) -> None:
    add(client, title="a", page_path="평가/EQ-A01", eval_id=7)
    add(client, title="b")
    assert len(client.get("/api/todos?page_path=평가/EQ-A01").json()["items"]) == 1
    assert len(client.get("/api/todos?eval_id=7").json()["items"]) == 1
