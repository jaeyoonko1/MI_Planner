from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture()
def client(tmp_path: Path):
    with TestClient(create_app(tmp_path / "t.db", tmp_path / "vault")) as c:
        yield c


def iso(n: int = 0) -> str:
    return (date.today() + timedelta(days=n)).isoformat()


def test_settings_default_and_toggle(client) -> None:
    assert client.get("/api/settings").json()["settings"]["journal_auto_show"] == "on"
    r = client.put("/api/settings/journal_auto_show", json={"value": "off"})
    assert r.json()["settings"]["journal_auto_show"] == "off"
    assert client.put("/api/settings/nope", json={"value": "x"}).status_code == 404


def test_journal_auto_respects_option(client) -> None:
    due = iso(0)
    month = due[:7]
    client.post("/api/todos", json={"title": "LOT-TEST-001 리뷰", "due_date": due})
    client.post("/api/todos", json={"title": "끝난 일", "due_date": due, "status": "done"})
    d = client.get(f"/api/journal/{month}/auto").json()
    assert d["enabled"] and [t["title"] for t in d["days"][due]] == ["LOT-TEST-001 리뷰"]
    client.put("/api/settings/journal_auto_show", json={"value": "off"})
    d = client.get(f"/api/journal/{month}/auto").json()
    assert d["enabled"] is False and d["days"] == {}
    # auto display never writes into the journal file
    assert client.get(f"/api/journal/{month}").json()["days"] == {}


def test_promote_line_creates_task_and_leaves_link(client) -> None:
    day = iso(0)
    month, dd = day[:7], int(day[8:])
    client.put(f"/api/journal/{month}/{dd}", json={"content": "메모\n- [ ] EQ-A01 점검\n- [x] 끝"})
    r = client.post("/api/todos/from-line", json={"date": day, "line_index": 1})
    assert r.status_code == 201
    body = r.json()
    task = body["task"]
    assert task["title"] == "EQ-A01 점검" and task["planned_date"] == day
    assert body["days"][day].split("\n")[1] == f"- [ ] EQ-A01 점검 → 할일 #{task['id']}"
    # second promotion of the same line, non-checkbox line, bad index -> errors
    for idx in (1, 0, 9):
        r = client.post("/api/todos/from-line", json={"date": day, "line_index": idx})
        assert r.status_code >= 400 and "error" in r.json()
    assert len(client.get("/api/todos").json()["items"]) == 1


def test_dashboard_today(client) -> None:
    day = iso(0)
    client.put(f"/api/journal/{day[:7]}/{int(day[8:])}", json={"content": "- [ ] 오늘 할 것"})
    client.post("/api/todos", json={"title": "오늘 하기로", "planned_date": day})
    client.post("/api/todos", json={"title": "곧 납기", "due_date": iso(2)})
    client.post("/api/todos", json={"title": "지난 납기", "due_date": iso(-1)})
    client.post("/api/todos", json={"title": "먼 납기", "due_date": iso(30)})
    d = client.get("/api/dashboard/today").json()
    # a task planned for today also gets a linked line in today's journal (P2B-05)
    first, second = d["journal"].split(chr(10))
    assert first == "- [ ] 오늘 할 것" and second.startswith("- [ ] 오늘 하기로 → 할일 #")
    assert [t["title"] for t in d["planned"]] == ["오늘 하기로"]
    assert [t["title"] for t in d["due_soon"]] == ["곧 납기"]
    assert [t["title"] for t in d["overdue"]] == ["지난 납기"]
    assert d["evaluations"] == []
