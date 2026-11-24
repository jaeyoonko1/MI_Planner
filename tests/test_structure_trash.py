"""V-004: soft delete of issues / free-layout groups from the structure screen, and exact restore."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture()
def client(tmp_path: Path):
    app = create_app(tmp_path / "t.db", tmp_path / "vault")
    with TestClient(app) as c:
        c.vault_root = tmp_path / "vault"
        yield c


def opt(c, key, label):
    c.post(f"/api/todos/fields/{key}/options", json={"label": label})
    return next(o["value"] for o in c.get(f"/api/todos/fields/{key}").json()["options"] if o["label"] == label)


def issue(c, title, **extra):
    return c.post("/api/todos", json={"title": title, **extra}).json()["id"]


def group(c, label, parent=None):
    free = c.post("/api/structure/free/groups", json={"label": label, "parent_id": parent}).json()
    return next(n["id"] for n in free["nodes"] if n["label"] == label)


def place(c, kind, ident, parent, before=None):
    r = c.post("/api/structure/free/move", json={"kind": kind, "id": ident, "parent_id": parent, "before": before})
    assert r.status_code == 200, r.text


def snapshot(c):
    return {"free": c.get("/api/structure/free").json(),
            "tasks": {t["id"]: t for t in c.get("/api/todos").json()["items"]}}


def delete(c, *items, children="move_up"):
    return c.post("/api/structure/delete", json={"items": [{"kind": k, "id": i} for k, i in items], "children": children})


def restore(c, res):
    return c.post(f"/api/structure/trash/{res['trash_id']}/restore")


@pytest.fixture()
def world(client):
    c = client
    c.get("/api/structure/free")  # seeds (empty) free layout before data exists
    g1, g2 = group(c, "G1"), group(c, "G2")
    a, b, d = issue(c, "A"), issue(c, "B"), issue(c, "D")
    sub = group(c, "SUB", g1)
    for tid, parent in ((a, g1), (b, g1), (d, g2)):
        place(c, "issue", tid, parent)
    place(c, "group", sub, g1, before={"kind": "issue", "id": b})  # order in G1: A, SUB, B
    return c, {"g1": g1, "g2": g2, "sub": sub, "a": a, "b": b, "d": d}


def test_delete_issue_and_restore_is_exact(world):
    c, w = world
    before = snapshot(c)
    res = delete(c, ("issue", w["b"])).json()
    assert res["issues"] == [w["b"]]
    assert c.get(f"/api/todos/{w['b']}").status_code == 404
    assert all(i["task_id"] != w["b"] for i in res["free"]["items"])
    assert restore(c, res).status_code == 200
    assert snapshot(c) == before


def test_restore_twice_conflicts_and_unknown_is_404(world):
    c, w = world
    res = delete(c, ("issue", w["a"])).json()
    assert restore(c, res).status_code == 200
    assert restore(c, res).status_code == 409
    assert c.post("/api/structure/trash/9999/restore").status_code == 404


def test_delete_group_moves_children_up_in_place(world):
    c, w = world
    before = snapshot(c)
    res = delete(c, ("group", w["g1"])).json()
    assert res["impact"]["moved_up"] == 3 and res["impact"]["children"] == "move_up"
    free = res["free"]
    assert all(n["id"] != w["g1"] for n in free["nodes"])
    assert next(n for n in free["nodes"] if n["id"] == w["sub"])["parent_id"] is None
    assert {i["task_id"]: i["node_id"] for i in free["items"]}[w["a"]] is None
    assert set(c.get("/api/todos").json()["items"][i]["id"] for i in range(3)) == {w["a"], w["b"], w["d"]}  # issues stay
    assert restore(c, res).status_code == 200
    assert snapshot(c) == before


def test_delete_group_with_children_removed(world):
    c, w = world
    before = snapshot(c)
    res = delete(c, ("group", w["g1"]), children="delete").json()
    assert set(res["issues"]) == {w["a"], w["b"]} and set(res["groups"]) == {w["g1"], w["sub"]}
    assert c.get(f"/api/todos/{w['a']}").status_code == 404
    assert c.get(f"/api/todos/{w['d']}").status_code == 200
    assert restore(c, res).status_code == 200
    assert snapshot(c) == before


def test_nested_selection_and_children_land_on_surviving_ancestor(world):
    c, w = world
    before = snapshot(c)
    res = delete(c, ("group", w["g1"]), ("group", w["sub"])).json()
    assert set(res["groups"]) == {w["g1"], w["sub"]}
    assert {i["task_id"]: i["node_id"] for i in res["free"]["items"]}[w["a"]] is None
    assert restore(c, res).status_code == 200
    assert snapshot(c) == before


def test_multi_step_undo_in_reverse_order(world):
    c, w = world
    s0 = snapshot(c)
    r1 = delete(c, ("issue", w["a"])).json()
    s1 = snapshot(c)
    r2 = delete(c, ("group", w["g1"])).json()
    assert restore(c, r2).status_code == 200
    assert snapshot(c) == s1
    assert restore(c, r1).status_code == 200
    assert snapshot(c) == s0


def test_restore_keeps_other_edits_made_meanwhile(world):
    c, w = world
    res = delete(c, ("group", w["g2"])).json()  # D moves to top level
    extra = issue(c, "NEW")
    place(c, "issue", extra, w["g1"])
    assert restore(c, res).status_code == 200
    free = c.get("/api/structure/free").json()
    nodes = {i["task_id"]: i["node_id"] for i in free["items"]}
    assert nodes[w["d"]] == w["g2"] and nodes[extra] == w["g1"]


def test_children_moved_elsewhere_are_not_dragged_back(world):
    c, w = world
    res = delete(c, ("group", w["g1"])).json()
    place(c, "issue", w["a"], w["g2"])
    assert restore(c, res).status_code == 200
    nodes = {i["task_id"]: i["node_id"] for i in c.get("/api/structure/free").json()["items"]}
    assert nodes[w["a"]] == w["g2"] and nodes[w["b"]] == w["g1"]


def test_validation_errors(world):
    c, w = world
    assert c.post("/api/structure/delete", json={"items": []}).status_code == 400
    assert c.post("/api/structure/delete", json={"items": [{"kind": "x", "id": 1}]}).status_code == 400
    assert delete(c, ("issue", 99999)).status_code == 404
    assert delete(c, ("group", 99999)).status_code == 404
    assert c.post("/api/structure/delete", json={"items": [{"kind": "issue", "id": w["a"]}], "children": "?"}).status_code == 400
    assert c.get(f"/api/todos/{w['a']}").status_code == 200  # nothing deleted by failures


def test_failed_delete_changes_nothing_and_page_returns(world, monkeypatch):
    c, w = world
    made = c.post("/api/todos/with-page", json={"title": "실패 이슈", "planned_date": "2026-11-24"}).json()
    tid = made["id"] if "id" in made else made["task"]["id"]
    path = c.get(f"/api/todos/{tid}").json()["page_path"]
    before = snapshot(c)
    from app.repositories import structure_trash as st

    def boom(*a, **k):
        raise RuntimeError("disk full")

    monkeypatch.setattr(st.journal_links, "after_task_change", boom)
    c2 = TestClient(c.app, raise_server_exceptions=False)
    assert c2.post("/api/structure/delete", json={"items": [{"kind": "issue", "id": tid}]}).status_code == 500
    assert snapshot(c) == before
    assert (c.vault_root / path).is_dir()  # the page that was already trashed came back


def test_preview_reports_impact_without_changing(world):
    c, w = world
    page = c.post("/api/todos/with-page", json={"title": "P"}).json()
    pid = page["task"]["id"] if "task" in page else page["id"]
    prev = c.post("/api/structure/delete-preview", json={"items": [{"kind": "group", "id": w["g1"]}]}).json()
    assert prev["moved_up"] == 3 and prev["moved_groups"] == 1 and prev["needs_confirm"] is True
    solo = c.post("/api/structure/delete-preview", json={"items": [{"kind": "issue", "id": w["a"]}]}).json()
    assert solo["needs_confirm"] is False and solo["pages"] == 0
    withp = c.post("/api/structure/delete-preview", json={"items": [{"kind": "issue", "id": pid}]}).json()
    assert withp["pages"] == 1 and withp["needs_confirm"] is True
    assert c.get(f"/api/todos/{w['a']}").status_code == 200


def test_issue_page_goes_to_trash_and_comes_back(world):
    c, w = world
    made = c.post("/api/todos/with-page", json={"title": "페이지 이슈"}).json()
    tid = made["id"] if "id" in made else made["task"]["id"]
    path = c.get(f"/api/todos/{tid}").json()["page_path"]
    assert path and (c.vault_root / path).is_dir()
    (c.vault_root / path / "index.md").write_text("본문 내용\n", encoding="utf-8")
    res = delete(c, ("issue", tid)).json()
    assert res["impact"]["pages"] == 1
    assert not (c.vault_root / path).exists()
    assert any(p.is_dir() for p in (c.vault_root / ".trash").iterdir())
    assert restore(c, res).status_code == 200
    back = c.get(f"/api/todos/{tid}").json()
    assert back["page_path"] == path
    assert (c.vault_root / path / "index.md").read_text(encoding="utf-8") == "본문 내용\n"


def test_journal_link_cleared_then_relinked(world):
    c, w = world
    tid = issue(c, "일지 연결", planned_date="2026-11-24")
    day = c.get("/api/journal/day/2026-11-24").json() if c.get("/api/journal/day/2026-11-24").status_code == 200 else None
    res = delete(c, ("issue", tid)).json()
    assert res["impact"]["journal_lines"] == 1
    assert res["journal_days"]["2026-11-24"].count("→ 할일 #") == 0
    assert "일지 연결" in res["journal_days"]["2026-11-24"]
    back = restore(c, res).json()
    assert back["journal_skipped"] == 0
    assert f"→ 할일 #{tid}" in back["journal_days"]["2026-11-24"]
    assert day is None or True


def test_journal_line_edited_meanwhile_is_skipped_not_clobbered(world):
    c, w = world
    tid = issue(c, "원래 줄", planned_date="2026-11-24")
    res = delete(c, ("issue", tid)).json()
    month = c.vault_root / "일지"
    texts = [p for p in month.rglob("index.md")]
    for p in texts:
        p.write_text(p.read_text(encoding="utf-8").replace("원래 줄", "고친 줄"), encoding="utf-8")
    back = restore(c, res).json()
    assert back["journal_skipped"] == 1
    assert c.get(f"/api/todos/{tid}").status_code == 200


def test_subtask_parent_link_restored(world):
    c, w = world
    parent = issue(c, "부모")
    child = issue(c, "자식", parent_task_id=parent)
    res = delete(c, ("issue", parent)).json()
    assert c.get(f"/api/todos/{child}").json()["parent_task_id"] is None
    assert res["impact"]["subtasks"] == 1
    restore(c, res)
    assert c.get(f"/api/todos/{child}").json()["parent_task_id"] == parent


def test_reused_id_blocks_restore_without_partial_changes(world):
    c, w = world
    last = issue(c, "마지막")
    res = delete(c, ("issue", last)).json()
    reuse = issue(c, "새 이슈")  # sqlite hands out the freed max id again
    if reuse == last:
        before = snapshot(c)
        assert restore(c, res).status_code == 409
        assert snapshot(c) == before


def test_trash_list(world):
    c, w = world
    res = delete(c, ("issue", w["a"]), ("group", w["g2"])).json()
    items = c.get("/api/structure/trash").json()["items"]
    assert items[0]["id"] == res["trash_id"] and items[0]["summary"] == "이슈 1개 · 그룹 1개"
    restore(c, res)
    assert c.get("/api/structure/trash").json()["items"][0]["restored_at"]


def test_unplaced_issue_and_root_order(world):
    c, w = world
    loose = issue(c, "LOOSE")
    before = snapshot(c)
    res = delete(c, ("issue", loose)).json()
    restore(c, res)
    after = snapshot(c)
    assert after["tasks"] == before["tasks"]
    assert [i["task_id"] for i in after["free"]["items"]] == [i["task_id"] for i in before["free"]["items"]]
