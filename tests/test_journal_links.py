"""P2B-05: one ID across today / weekly / monthly / todo list."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

D1, D2 = "2026-11-24", "2026-11-25"


@pytest.fixture()
def client(tmp_path: Path):
    with TestClient(create_app(tmp_path / "t.db", tmp_path / "vault")) as c:
        yield c


def put_day(client, day: str, text: str) -> dict:
    r = client.put(f"/api/journal/{day[:7]}/{int(day[8:])}", json={"content": text})
    assert r.status_code == 200, r.text
    return r.json()


def day_body(client, day: str) -> str:
    return client.get(f"/api/journal/{day[:7]}").json()["days"].get(day, "")


def add(client, **kw) -> dict:
    r = client.post("/api/todos", json=kw)
    assert r.status_code == 201, r.text
    return r.json()


def test_planned_task_gets_a_line_and_follows_edits(client) -> None:
    t = add(client, title="EQ-A01 점검", planned_date=D1)
    assert day_body(client, D1) == f"- [ ] EQ-A01 점검 → 할일 #{t['id']}"
    r = client.patch(f"/api/todos/{t['id']}", json={"title": "EQ-A01 정기 점검", "mark": "star"})
    assert r.json()["journal_days"][D1] == f"- [*] EQ-A01 정기 점검 → 할일 #{t['id']}"
    client.patch(f"/api/todos/{t['id']}", json={"status": "done"})
    assert day_body(client, D1).startswith("- [x] EQ-A01 정기 점검")
    client.patch(f"/api/todos/{t['id']}", json={"status": "todo"})
    assert day_body(client, D1).startswith("- [*] ")  # the star comes back after un-doing


def test_moving_planned_day_moves_the_line_with_children_and_undo_restores(client) -> None:
    put_day(client, D1, "- [ ] 상위 일\n  - 하위 메모\n- 다른 줄")
    t = client.post("/api/todos/from-line", json={"date": D1, "line_index": 0}).json()["task"]
    due = "2026-12-01"
    client.patch(f"/api/todos/{t['id']}", json={"due_date": due})
    r = client.patch(f"/api/todos/{t['id']}", json={"planned_date": D2})
    assert day_body(client, D1) == "- 다른 줄"
    assert day_body(client, D2) == f"- [ ] 상위 일 → 할일 #{t['id']}\n  - 하위 메모"
    assert set(r.json()["journal_days"]) == {D1, D2}
    back = client.patch(f"/api/todos/{t['id']}", json={"planned_date": D1}).json()
    assert back["due_date"] == due  # the due date is independent of the plan
    assert day_body(client, D2) == ""
    assert "상위 일" in day_body(client, D1) and "  - 하위 메모" in day_body(client, D1)


def test_clearing_plan_removes_a_plain_line_but_keeps_one_with_children(client) -> None:
    a = add(client, title="단순", planned_date=D1)
    client.patch(f"/api/todos/{a['id']}", json={"planned_date": None})
    assert day_body(client, D1) == ""
    put_day(client, D1, "- [ ] 부모\n  - 자식")
    b = client.post("/api/todos/from-line", json={"date": D1, "line_index": 0}).json()["task"]
    client.patch(f"/api/todos/{b['id']}", json={"planned_date": None})
    assert day_body(client, D1) == "- [ ] 부모\n  - 자식"  # text kept, link cut


def test_line_edits_update_the_task(client) -> None:
    t = add(client, title="원래 제목", planned_date=D1)
    tid = t["id"]
    r = put_day(client, D1, f"- [x] 바뀐 제목 → 할일 #{tid}")
    assert r["changed"] == [tid]
    got = client.get(f"/api/todos/{tid}").json()
    assert (got["title"], got["status"]) == ("바뀐 제목", "done")
    put_day(client, D1, f"- [!] 바뀐 제목 → 할일 #{tid}")
    got = client.get(f"/api/todos/{tid}").json()
    assert (got["status"], got["mark"]) == ("todo", "urgent")
    assert r["tasks"][str(tid)]["title"] == "바뀐 제목"


def test_removed_or_copied_links_never_duplicate_the_issue(client) -> None:
    t = add(client, title="한 번만", planned_date=D1)
    tid = t["id"]
    line = f"- [ ] 한 번만 → 할일 #{tid}"
    r = put_day(client, D1, f"{line}\n{line}")  # copy/paste of a linked line
    assert r["content"].split("\n")[1] == "- [ ] 한 번만"
    put_day(client, D1, "- 지웠다")  # the line is gone: plan on that day cleared, task stays
    got = client.get(f"/api/todos/{tid}").json()
    assert got["planned_date"] is None
    assert client.get("/api/todos").json()["items"][0]["id"] == tid


def test_pasting_a_linked_line_into_another_day_moves_the_plan(client) -> None:
    t = add(client, title="이사", planned_date=D1)
    put_day(client, D2, f"- [ ] 이사 → 할일 #{t['id']}")
    assert client.get(f"/api/todos/{t['id']}").json()["planned_date"] == D2
    assert day_body(client, D1) == ""  # the old copy is gone, only one line stays


def test_promotion_is_not_duplicated(client) -> None:
    put_day(client, D1, "- [ ] LOT-TEST-001 확인\n- [ ] LOT-TEST-001 확인")
    first = client.post("/api/todos/from-line", json={"date": D1, "line_index": 0})
    assert first.status_code == 201 and first.json()["reused"] is False
    # same title on the same day, but the first line is already linked -> the copy is refused
    second = client.post("/api/todos/from-line", json={"date": D1, "line_index": 1})
    assert second.status_code == 409 and "error" in second.json()
    # the linked line itself cannot be promoted again either
    assert client.post("/api/todos/from-line", json={"date": D1, "line_index": 0}).status_code == 400
    assert len(client.get("/api/todos").json()["items"]) == 1


def test_promotion_reads_star_and_urgent_marks(client) -> None:
    put_day(client, D1, "- [!] 급한 일\n- [*] 중요한 일\n- [x] 끝난 일")
    got = [client.post("/api/todos/from-line", json={"date": D1, "line_index": i}).json()["task"] for i in range(3)]
    assert (got[0]["mark"], got[0]["priority"]) == ("urgent", 1)
    assert (got[1]["mark"], got[1]["status"]) == ("star", "todo")
    assert got[2]["status"] == "done"
    assert day_body(client, D1).split("\n")[2].startswith("- [x] 끝난 일")


def test_deleting_a_task_unlinks_its_line(client) -> None:
    t = add(client, title="사라질 일", planned_date=D1)
    client.delete(f"/api/todos/{t['id']}")
    assert day_body(client, D1) == "- [ ] 사라질 일"


def test_list_filters_for_weekly_and_tray(client) -> None:
    a = add(client, title="월", planned_date=D1, due_date="2026-11-30")
    b = add(client, title="날짜 없음")
    c = add(client, title="다음 주", planned_date="2026-12-02", mark="star")
    ids = lambda **q: [t["id"] for t in client.get("/api/todos", params=q).json()["items"]]  # noqa: E731
    assert ids(planned_from=D1, planned_to="2026-11-30") == [a["id"]]
    assert ids(due_from="2026-11-23", due_to="2026-11-29") == []
    assert ids(due_from="2026-11-23", due_to="2026-11-30") == [a["id"]]
    assert ids(unplanned="true") == [b["id"]]
    assert ids(marked="true") == [c["id"]]
    assert sorted(ids(ids=f"{a['id']},{c['id']}")) == sorted([a["id"], c["id"]])
    assert ids(ids="") == []
    month = client.get("/api/journal/2026-11").json()
    assert set(month["tasks"]) == {str(a["id"])}
    assert client.post("/api/todos", json={"title": "x", "mark": "bad"}).status_code == 400
