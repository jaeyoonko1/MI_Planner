"""V-011: Jira-style issue hierarchy in the structure view (issue levels, parent links, delete / restore)."""
import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db
from app.repositories import structure_trash
from app.vault import Vault
from app.main import create_app


@pytest.fixture()
def paths(tmp_path: Path):
    return tmp_path / "t.db", tmp_path / "vault"


@pytest.fixture()
def client(paths):
    with TestClient(create_app(*paths)) as c:
        yield c


def epic_id(c) -> int:
    return next(lv["id"] for lv in c.get("/api/structure/levels").json()["items"] if lv["label"] == "에픽")


def default_id(c) -> int:
    return next(lv["id"] for lv in c.get("/api/structure/levels").json()["items"] if lv["is_default"])


def issue(c, title, **extra) -> int:
    r = c.post("/api/todos", json={"title": title, **extra})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def get(c, tid):
    return c.get(f"/api/todos/{tid}").json()


def test_acceptance_flow_create_edit_delete_restore_restart(paths) -> None:
    with TestClient(create_app(*paths)) as c:
        ep = epic_id(c)
        heads = {name: issue(c, name, level_id=ep) for name in ("프로젝트", "스터디", "업무", "결혼준비")}
        a = issue(c, "LOT-TEST-001 리뷰", parent_task_id=heads["프로젝트"])
        b = issue(c, "EQ-A01 셋업", parent_task_id=heads["프로젝트"])
        sub = issue(c, "체크리스트", parent_task_id=b)
        # parent change from the issue detail: the structure reads the same row
        r = c.patch(f"/api/todos/{a}", json={"parent_task_id": heads["스터디"]})
        assert r.status_code == 200 and r.json()["parent_task_id"] == heads["스터디"]
        # kind / level change: promote an issue to 에픽 (its parent is an epic, so equal rank is fine)
        assert c.patch(f"/api/todos/{b}", json={"level_id": ep}).json()["level_id"] == ep
        # delete an epic, children move up (to the top level) - then restore the exact links
        res = c.post("/api/structure/delete", json={"items": [{"kind": "issue", "id": heads["프로젝트"]}],
                                                    "children": "move_up"}).json()
        assert res["impact"]["subtasks"] == 1 and get(c, b)["parent_task_id"] is None
        assert get(c, sub)["parent_task_id"] == b
        assert c.post(f"/api/structure/trash/{res['trash_id']}/restore").status_code == 200
        assert get(c, b)["parent_task_id"] == heads["프로젝트"]
        # delete a whole subtree, then restore it
        res = c.post("/api/structure/delete", json={"items": [{"kind": "issue", "id": heads["프로젝트"]}],
                                                    "children": "delete"}).json()
        assert sorted(res["issues"]) == sorted([heads["프로젝트"], b, sub])
        assert c.get(f"/api/todos/{sub}").status_code == 404
        assert c.post(f"/api/structure/trash/{res['trash_id']}/restore").status_code == 200
        assert get(c, sub)["parent_task_id"] == b and get(c, b)["parent_task_id"] == heads["프로젝트"]
    with TestClient(create_app(*paths)) as c:  # restart keeps every relation
        assert get(c, a)["parent_task_id"] == heads["스터디"]
        assert get(c, b)["level_id"] == ep and get(c, b)["parent_task_id"] == heads["프로젝트"]
        assert get(c, heads["결혼준비"])["level_id"] == ep


def test_move_up_goes_to_grandparent_and_back(client) -> None:
    top = issue(client, "상위")
    mid = issue(client, "중간", parent_task_id=top)
    leaf = issue(client, "하위", parent_task_id=mid)
    res = client.post("/api/structure/delete", json={"items": [{"kind": "issue", "id": mid}]}).json()
    assert get(client, leaf)["parent_task_id"] == top
    client.post(f"/api/structure/trash/{res['trash_id']}/restore")
    assert get(client, leaf)["parent_task_id"] == mid


def test_issue_levels_change_without_altering_links(client) -> None:
    ep = epic_id(client)
    plain = default_id(client)
    kind = client.post("/api/structure/levels", json={"label": "유형"}).json()["id"]
    parent = issue(client, "프로젝트", level_id=ep, planned_date="2026-11-25", note="메모")
    child = issue(client, "하위 에픽", level_id=ep, parent_task_id=parent)
    month, date = "/api/journal/2026-11", "2026-11-25"
    journal = client.get(month).json()["days"][date]
    assert f"#{parent}" in journal
    before = get(client, parent)
    for level in (kind, plain, ep, None):
        r = client.patch(f"/api/todos/{parent}", json={"level_id": level})
        assert r.status_code == 200 and r.json()["level_id"] == (level or plain)
        assert get(client, child)["parent_task_id"] == parent
        assert get(client, child)["level_id"] == ep
        assert client.get(month).json()["days"][date] == journal
        assert all(r.json()[key] == before[key] for key in ("id", "title", "note", "props", "planned_date"))
    last = issue(client, "역순", level_id=ep, parent_task_id=parent)
    assert get(client, last)["parent_task_id"] == parent
    assert client.patch(f"/api/todos/{parent}", json={"parent_task_id": child}).status_code == 400
    assert client.patch(f"/api/todos/{parent}", json={"parent_task_id": parent}).status_code == 400
    assert client.post("/api/todos", json={"title": "x", "level_id": 999}).status_code == 404
    assert client.post("/api/todos", json={"title": "x", "level_id": True}).status_code == 422


def test_levels_crud_reorder_and_restorable_delete(client) -> None:
    ep, plain = epic_id(client), default_id(client)
    r = client.post("/api/structure/levels", json={"label": "작업"})
    assert r.status_code == 201
    work = r.json()["id"]
    labels = [lv["label"] for lv in client.get("/api/structure/levels").json()["items"]]
    assert labels == ["에픽", "작업", "이슈"]
    assert client.post("/api/structure/levels", json={"label": "작업"}).status_code == 409
    assert client.post("/api/structure/levels", json={"label": "이슈"}).status_code == 409
    assert client.patch(f"/api/structure/levels/{ep}", json={"label": "유형", "color": "mint"}).json()["label"] == "유형"
    assert client.patch(f"/api/structure/levels/{plain}", json={"label": "일반", "icon": "issue"}).status_code == 200
    head = issue(client, "프로젝트", level_id=ep)
    w = issue(client, "작업 1", level_id=work, parent_task_id=head)
    r = client.put("/api/structure/levels/order", json={"ids": [work, ep, plain]})
    assert r.status_code == 200
    assert [lv["rank"] for lv in r.json()["items"]] == [2, 1, 0]
    assert client.put("/api/structure/levels/order", json={"ids": [work, None, plain]}).status_code == 400
    regular = issue(client, "일반 작업")
    res = client.delete(f"/api/structure/levels/{plain}").json()
    assert res["moved"] == 1 and res["to"] == "유형"
    assert get(client, regular)["level_id"] == ep == default_id(client)
    assert client.post(f"/api/structure/trash/{res['trash_id']}/restore").status_code == 200
    assert get(client, regular)["level_id"] == plain == default_id(client)
    assert [lv["label"] for lv in client.get("/api/structure/levels").json()["items"]] == ["작업", "유형", "일반"]
    assert client.delete(f"/api/structure/levels/{work}").json()["to"] == "유형"
    assert get(client, w)["level_id"] == ep
    assert get(client, w)["parent_task_id"] == head
    assert client.patch(f"/api/structure/levels/{ep}", json={"is_default": True}).json()["is_default"]
    assert get(client, issue(client, "기본 수준 변경 후"))["level_id"] == ep
    assert client.delete(f"/api/structure/levels/{plain}").status_code == 200
    assert client.delete(f"/api/structure/levels/{ep}").status_code == 409


def opt(c, key, label):
    c.post(f"/api/todos/fields/{key}/options", json={"label": label})
    return next(o["value"] for o in c.get(f"/api/todos/fields/{key}").json()["options"] if o["label"] == label)


def test_classification_value_delete_and_restore(client) -> None:
    """The cause of "분류 삭제 불가": the structure blocked every classification group and 분류 관리 only
    archived used classifications. A value group can now be deleted (and undone) from the structure."""
    p = opt(client, "epic", "프로젝트")
    s = opt(client, "epic", "스터디")
    t1 = issue(client, "a", props={"epic": p})
    t2 = issue(client, "b", props={"epic": p})
    item = {"kind": "value", "key": "epic", "value": p}
    prev = client.post("/api/structure/delete-preview", json={"items": [item]}).json()
    assert prev["cleared"] == 2 and prev["needs_confirm"] and prev["values"] == 1
    res = client.post("/api/structure/delete", json={"items": [item]}).json()
    assert "epic" not in get(client, t1)["props"]
    assert [o["value"] for o in client.get("/api/todos/fields/epic").json()["options"]] == [s]
    client.post(f"/api/structure/trash/{res['trash_id']}/restore")
    assert get(client, t1)["props"]["epic"] == p
    assert [o["value"] for o in client.get("/api/todos/fields/epic").json()["options"]] == [p, s]
    # children=delete takes the issues too (soft, restorable)
    res = client.post("/api/structure/delete", json={"items": [item], "children": "delete"}).json()
    assert sorted(res["issues"]) == [t1, t2] and client.get(f"/api/todos/{t2}").status_code == 404
    client.post(f"/api/structure/trash/{res['trash_id']}/restore")
    assert get(client, t2)["props"]["epic"] == p
    # a page-location rule that uses the value blocks the delete
    client.put("/api/todos/page-rules", json={"rules": [
        {"conditions": [{"field": "epic", "op": "is", "value": s}], "path": "MI 공정업무/{epic}"}]})
    r = client.post("/api/structure/delete", json={"items": [{"kind": "value", "key": "epic", "value": s}]})
    assert r.status_code == 409
    bad = client.post("/api/structure/delete", json={"items": [{"kind": "value", "key": "priority", "value": 1}]})
    assert bad.status_code == 400


def test_convert_classification_values_to_upper_issues(client) -> None:
    ep = epic_id(client)
    p = opt(client, "epic", "프로젝트")
    opt(client, "epic", "스터디")
    a = issue(client, "a", props={"epic": p})
    parent = issue(client, "부모 있음")
    b = issue(client, "b", props={"epic": p}, parent_task_id=parent)
    res = client.post("/api/structure/levels/convert", json={"field_key": "epic", "level_id": ep}).json()
    assert len(res["created"]) == 2 and res["linked"] == 1
    head = get(client, a)["parent_task_id"]
    assert get(client, head)["title"] == "프로젝트" and get(client, head)["level_id"] == ep
    assert get(client, b)["parent_task_id"] == parent  # existing parent links are never overwritten
    assert get(client, a)["props"]["epic"] == p  # the classification value stays
    again = client.post("/api/structure/levels/convert", json={"field_key": "epic", "level_id": ep}).json()
    assert again["created"] == [] and len(again["reused"]) == 2
    assert client.post("/api/structure/levels/convert", json={"field_key": "priority", "level_id": ep}).status_code == 400


def test_view_mode_issues_round_trip(client) -> None:
    v = client.put("/api/structure/view", json={"mode": "issues", "levels": ["epic", "type"]}).json()
    assert v["mode"] == "issues" and v["saved"]
    assert client.put("/api/structure/view", json={"mode": "bogus", "levels": []}).status_code == 400


def test_copy_keeps_issue_level(client) -> None:
    ep = epic_id(client)
    head = issue(client, "프로젝트", level_id=ep)
    res = client.post("/api/structure/copy", json={"kind": "issue", "task_id": head}).json()
    assert get(client, res["created"][0])["level_id"] == ep


def test_migration_014_keeps_tasks_and_old_trash(tmp_path: Path) -> None:
    old = tmp_path / "mig"
    old.mkdir()
    for f in sorted(db.MIGRATIONS_DIR.glob("*.sql")):
        if f.name < "014":
            shutil.copy(f, old / f.name)
    conn = db.connect(tmp_path / "x.db")
    vault = Vault(tmp_path / "vault")
    try:
        db.migrate(conn, old)
        conn.execute("INSERT INTO tasks (title, props, created_at, updated_at) "
                     "VALUES ('LOT-TEST-001', '{\"epic\":\"A\"}', '2026-11-24', '2026-11-24')")
        conn.execute("INSERT INTO tasks (title, parent_task_id, created_at, updated_at, level_id) "
                     "VALUES ('child', 1, 'x', 'x', 1)")
        conn.execute("INSERT INTO tasks (title, created_at, updated_at) VALUES ('old trash', 'x', 'x')")
        conn.commit()
        removed = structure_trash.delete(conn, vault, {"items": [{"kind": "issue", "id": 3}]})["trash_id"]
        old_level = {"id": 2, "label": "작업", "rank": 1, "icon": "grid", "color": "mint", "created_at": "x"}
        level_trash = conn.execute(
            "INSERT INTO structure_trash (summary, payload, created_at) VALUES ('level', ?, 'x')",
            (json.dumps({"kind": "level", "level": old_level, "order": [1, 2], "tasks": [1], "to": None}),),
        ).lastrowid
        conn.commit()
        assert db.migrate(conn) == ["014_issue_level_unify.sql"]
        default = conn.execute("SELECT id FROM issue_levels WHERE is_default = 1").fetchone()["id"]
        assert default > old_level["id"]
        rows = [dict(r) for r in conn.execute("SELECT id, title, parent_task_id, props, level_id FROM tasks ORDER BY id")]
        assert rows[0]["props"] == '{"epic":"A"}' and rows[0]["level_id"] == default
        assert rows[1]["parent_task_id"] == 1 and rows[1]["level_id"] == 1
        structure_trash.restore(conn, vault, removed)
        assert conn.execute("SELECT level_id FROM tasks WHERE id = 3").fetchone()[0] == default
        structure_trash.restore(conn, vault, level_trash)
        assert conn.execute("SELECT level_id FROM tasks WHERE id = 1").fetchone()[0] == 2
        assert [r["id"] for r in conn.execute("SELECT id FROM issue_levels ORDER BY rank DESC")] == [1, 2, default]
        assert conn.execute("SELECT COUNT(*) FROM tasks WHERE level_id IS NULL").fetchone()[0] == 0
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        conn.close()


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_issue_tree_model_js() -> None:
    import subprocess

    root = Path(__file__).resolve().parent.parent
    res = subprocess.run(["node", str(root / "web" / "test" / "run_issue_tree.mjs")],
                         capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, res.stdout + res.stderr
