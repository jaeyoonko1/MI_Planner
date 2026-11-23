"""P2B-08: free layout (move, cycles, order), copy with new IDs, independence of copies."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture()
def client(tmp_path: Path):
    with TestClient(create_app(tmp_path / "t.db", tmp_path / "vault")) as c:
        yield c


def opt(c, key, label):
    c.post(f"/api/todos/fields/{key}/options", json={"label": label})
    return next(o["value"] for o in c.get(f"/api/todos/fields/{key}").json()["options"] if o["label"] == label)


def issue(c, title, **props):
    return c.post("/api/todos", json={"title": title, "props": props}).json()["id"]


@pytest.fixture()
def world(client):
    e1, e2 = opt(client, "epic", "E1"), opt(client, "epic", "E2")
    ta, tb = opt(client, "type", "셋업"), opt(client, "type", "평가")
    ids = {
        "a": issue(client, "A", epic=e1, type=ta),
        "b": issue(client, "B", epic=e1, type=tb),  # same epic, other type branch
        "c": issue(client, "C", epic=e2, type=ta),
    }
    return client, ids, {"e1": e1, "e2": e2, "ta": ta, "tb": tb}


def group_id(free, label, parent=None):
    return next(n["id"] for n in free["nodes"] if n["label"] == label and n["parent_id"] == parent)


def test_free_layout_seeds_from_hierarchy_and_stays_out_of_vault(world, tmp_path) -> None:
    c, ids, _ = world
    free = c.get("/api/structure/free").json()
    e1 = group_id(free, "E1")
    assert {n["label"] for n in free["nodes"] if n["parent_id"] == e1} == {"셋업", "평가"}
    assert {i["task_id"] for i in free["items"]} == set(ids.values())
    assert not list((tmp_path / "vault").rglob("*structure*"))  # positions are not page-tree files


def test_move_issue_changes_values_and_keeps_id(world) -> None:
    c, ids, v = world
    free = c.get("/api/structure/free").json()
    e2 = group_id(free, "E2")
    ta2 = group_id(free, "셋업", e2)
    r = c.post("/api/structure/free/move", json={"kind": "issue", "id": ids["b"], "parent_id": ta2})
    assert r.status_code == 200 and r.json()["changed"] == [ids["b"]]
    t = c.get(f"/api/todos/{ids['b']}").json()
    assert t["id"] == ids["b"] and t["props"]["epic"] == v["e2"] and t["props"]["type"] == v["ta"]


def test_move_group_carries_children_and_rewrites_values(world) -> None:
    c, ids, v = world
    free = c.get("/api/structure/free").json()
    e1, e2 = group_id(free, "E1"), group_id(free, "E2")
    tb = group_id(free, "평가", e1)
    r = c.post("/api/structure/free/move", json={"kind": "group", "id": tb, "parent_id": e2})
    assert r.status_code == 200
    assert c.get(f"/api/todos/{ids['b']}").json()["props"]["epic"] == v["e2"]
    assert c.get(f"/api/todos/{ids['a']}").json()["props"]["epic"] == v["e1"]  # untouched sibling


def test_cycles_are_rejected_and_nothing_changes(world) -> None:
    c, _, _ = world
    free = c.get("/api/structure/free").json()
    e1 = group_id(free, "E1")
    child = group_id(free, "셋업", e1)
    for target in (e1, child):
        r = c.post("/api/structure/free/move", json={"kind": "group", "id": e1, "parent_id": target})
        assert r.status_code == 400 and "순환" in r.json()["error"]
    assert c.get("/api/structure/free").json() == free


def test_reorder_before_sibling_and_bad_requests(world) -> None:
    c, _, _ = world
    free = c.get("/api/structure/free").json()
    e1, e2 = group_id(free, "E1"), group_id(free, "E2")
    r = c.post("/api/structure/free/move", json={"kind": "group", "id": e2, "parent_id": None, "before": {"kind": "group", "id": e1}})
    roots = [n["id"] for n in r.json()["free"]["nodes"] if n["parent_id"] is None]
    assert roots.index(e2) < roots.index(e1)
    assert c.post("/api/structure/free/move", json={"kind": "group", "id": e2, "parent_id": e1, "before": {"kind": "group", "id": e1}}).status_code == 400
    assert c.post("/api/structure/free/move", json={"kind": "issue", "id": 9999, "parent_id": None}).status_code == 404
    assert c.post("/api/structure/free/move", json={"kind": "x", "id": 1}).status_code == 400


def test_add_group_and_unbound_move_keeps_values(world) -> None:
    c, ids, v = world
    free = c.post("/api/structure/free/groups", json={"label": "검토 중", "parent_id": None}).json()
    g = group_id(free, "검토 중")
    assert c.post("/api/structure/free/groups", json={"label": " "}).status_code == 400
    c.post("/api/structure/free/move", json={"kind": "issue", "id": ids["c"], "parent_id": g})
    assert c.get(f"/api/todos/{ids['c']}").json()["props"]["epic"] == v["e2"]  # unbound group: no value change


def test_copy_issue_gets_new_id_and_is_independent(world) -> None:
    c, ids, _ = world
    c.patch(f"/api/todos/{ids['a']}", json={"note": "원본 메모", "status": "doing", "planned_date": "2026-11-25"})
    r = c.post("/api/structure/copy", json={"kind": "issue", "task_id": ids["a"]})
    assert r.status_code == 201
    new = r.json()["created"][0]
    assert new not in ids.values()
    cp = c.get(f"/api/todos/{new}").json()
    assert cp["title"] == "A · 복사본" and cp["note"] == "원본 메모" and cp["status"] == "doing"
    assert cp["planned_date"] is None and "planned_date" not in cp["props"]
    c.patch(f"/api/todos/{new}", json={"note": "복사본 메모", "status": "done"})
    c.patch(f"/api/todos/{ids['a']}", json={"title": "A2"})
    orig, cp = c.get(f"/api/todos/{ids['a']}").json(), c.get(f"/api/todos/{new}").json()
    assert orig["note"] == "원본 메모" and orig["status"] == "doing" and cp["title"] == "A · 복사본"
    ids_now = [t["id"] for t in c.get("/api/todos").json()["items"]]
    assert ids_now.count(ids["a"]) == 1 and len(set(ids_now)) == len(ids_now)


def test_epic_copy_includes_other_type_branches(world) -> None:
    c, ids, v = world
    r = c.post("/api/structure/copy", json={"kind": "group", "field_key": "epic", "value": v["e1"], "task_ids": [ids["a"]]})
    assert r.status_code == 201, r.text
    body = r.json()
    assert len(body["created"]) == 2  # A and B, though only A was sent: epic copy spans type branches
    new_epic = body["option"]["value"]
    copies = [c.get(f"/api/todos/{i}").json() for i in body["created"]]
    assert {t["props"]["type"] for t in copies} == {v["ta"], v["tb"]} and all(t["props"]["epic"] == new_epic for t in copies)
    assert c.get(f"/api/todos/{ids['a']}").json()["props"]["epic"] == v["e1"]  # originals stay
    assert body["option"]["label"] == "E1 · 복사본"


def test_type_group_copy_limited_to_given_issues_and_validated(world) -> None:
    c, ids, v = world
    r = c.post("/api/structure/copy", json={"kind": "group", "field_key": "type", "value": v["ta"], "task_ids": [ids["c"]]})
    assert len(r.json()["created"]) == 1
    bad = c.post("/api/structure/copy", json={"kind": "group", "field_key": "type", "value": v["ta"], "task_ids": [ids["b"]]})
    assert bad.status_code == 400
    assert c.post("/api/structure/copy", json={"kind": "group", "field_key": "type", "value": None, "task_ids": []}).status_code == 400
    assert c.post("/api/structure/copy", json={"kind": "nope"}).status_code == 400


def test_free_group_copy_is_selected_subtree_only(world) -> None:
    c, ids, v = world
    free = c.get("/api/structure/free").json()
    e1 = group_id(free, "E1")
    ta = group_id(free, "셋업", e1)
    r = c.post("/api/structure/copy", json={"kind": "node", "node_id": ta})
    assert r.status_code == 201, r.text
    body = r.json()
    assert len(body["created"]) == 1  # only A: the sub-tree, not B under the other type group
    cp = c.get(f"/api/todos/{body['created'][0]}").json()
    assert cp["title"] == "A" and cp["props"]["type"] != v["ta"]  # filed under the new type option
    labels = [n["label"] for n in body["free"]["nodes"] if n["parent_id"] == e1]
    assert labels == ["셋업", "셋업 · 복사본", "평가"]  # copy sits right after the original
    placed = {i["task_id"]: i["node_id"] for i in body["free"]["items"]}
    assert placed[body["created"][0]] == body["node_id"] and placed[ids["a"]] == ta


def test_issue_ids_stable_through_view_changes(world) -> None:
    c, ids, _ = world
    before = sorted(t["id"] for t in c.get("/api/todos").json()["items"])
    c.put("/api/structure/view", json={"mode": "fields", "levels": ["type", "epic"]})
    c.get("/api/structure/free")
    c.post("/api/structure/free/move", json={"kind": "issue", "id": ids["a"], "parent_id": None})
    assert sorted(t["id"] for t in c.get("/api/todos").json()["items"]) == before
