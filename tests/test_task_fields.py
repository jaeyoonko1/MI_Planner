import json
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db
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


def mk_field(client, **kw):
    r = client.post("/api/todos/fields", json=kw)
    assert r.status_code == 201, r.text
    return r.json()


def test_migration_moves_existing_data_to_props(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "old.db")
    only1 = tmp_path / "m1"
    only1.mkdir()
    (only1 / "001_init.sql").write_text(
        (db.MIGRATIONS_DIR / "001_init.sql").read_text(encoding="utf-8"), encoding="utf-8"
    )
    db.migrate(conn, only1)  # legacy database with data
    conn.execute(
        "INSERT INTO tasks (title, priority, requester, due_date, planned_date, created_at, updated_at) "
        "VALUES ('a', 1, 'EQ-A01 담당', '2026-12-01', '2026-11-30', 'x', 'x')"
    )
    conn.execute("INSERT INTO tasks (title, created_at, updated_at) VALUES ('b', 'x', 'x')")
    conn.commit()
    assert db.migrate(conn) == ["002_task_fields.sql", "003_task_mark.sql", "004_structure_defaults.sql", "005_structure_free.sql", "006_evaluations.sql", "007_evaluation_requests.sql", "008_plans.sql", "009_doi.sql", "010_recipes.sql"]
    a, b = (dict(r) for r in conn.execute("SELECT * FROM tasks ORDER BY id"))
    assert json.loads(a["props"]) == {
        "priority": 1, "requester": "EQ-A01 담당", "due_date": "2026-12-01", "planned_date": "2026-11-30",
    }
    assert json.loads(b["props"]) == {"priority": 2}
    assert (a["priority"], a["due_date"], a["title"]) == (1, "2026-12-01", "a")  # columns untouched
    keys = [r["key"] for r in conn.execute("SELECT key FROM task_fields ORDER BY sort_order")]
    assert keys == ["priority", "requester", "due_date", "planned_date", "epic", "type"]
    conn.close()


def test_builtin_fields_listed(client) -> None:
    items = client.get("/api/todos/fields").json()["items"]
    assert [f["key"] for f in items][:4] == ["priority", "requester", "due_date", "planned_date"]
    assert items[0]["options"][0] == {"value": 1, "label": "높음", "color": "red"}
    assert all(f["builtin"] for f in items[:4])
    assert [f["key"] for f in items if not f["builtin"]] == ["epic", "type"]


def test_legacy_fields_and_props_stay_in_sync(client) -> None:
    t = add(client, title="x", priority=1, requester="김", due_date="2026-12-01")
    assert t["props"] == {"priority": 1, "requester": "김", "due_date": "2026-12-01"}
    t = client.patch(f"/api/todos/{t['id']}", json={"props": {"requester": "이", "due_date": None}}).json()
    assert t["requester"] == "이" and t["due_date"] is None
    assert t["props"] == {"priority": 1, "requester": "이"}
    t = client.patch(f"/api/todos/{t['id']}", json={"priority": 3}).json()
    assert t["props"]["priority"] == 3
    r = client.patch(f"/api/todos/{t['id']}", json={"props": {"priority": 9}})
    assert r.status_code == 400 and "error" in r.json()  # legacy validation applies to props too
    assert add(client, title="d")["props"] == {"priority": 2}


def test_custom_field_values_and_validation(client) -> None:
    mk_field(client, key="product", label="제품", type="choice",
             options=[{"value": "HBM", "label": "HBM"}, {"value": "HBM-A", "label": "HBM-A", "parent": "HBM"}])
    mk_field(client, key="tags", label="태그", type="multi",
             options=[{"value": "a", "label": "A"}, {"value": "b", "label": "B"}])
    mk_field(client, key="score", label="점수", type="number")
    mk_field(client, key="ok", label="확인", type="check")
    t = add(client, title="x", props={"product": "HBM-A", "tags": ["a", "a", "b"], "score": 3.5, "ok": True})
    assert t["props"]["tags"] == ["a", "b"] and t["props"]["product"] == "HBM-A"
    for bad in ({"product": "nope"}, {"tags": ["zz"]}, {"score": "3"}, {"ok": "yes"}, {"unknown": 1}):
        r = client.patch(f"/api/todos/{t['id']}", json={"props": bad})
        assert r.status_code == 400 and "error" in r.json(), bad
    r = client.patch(f"/api/todos/{t['id']}", json={"props": {"score": None}})
    assert "score" not in r.json()["props"]


def test_field_filters(client) -> None:
    mk_field(client, key="product", label="제품", type="choice",
             options=[{"value": "A", "label": "A"}, {"value": "B", "label": "B"}])
    mk_field(client, key="tags", label="태그", type="multi",
             options=[{"value": "x", "label": "X"}, {"value": "y", "label": "Y"}])
    add(client, title="1", props={"product": "A", "tags": ["x"]})
    add(client, title="2", props={"product": "B", "tags": ["x", "y"]})
    add(client, title="3", props={"product": "A"}, priority=1)

    def titles(q: str) -> list[str]:
        return sorted(i["title"] for i in client.get(f"/api/todos?{q}").json()["items"])

    assert titles("field_product=A") == ["1", "3"]
    assert titles("field_product=A,B&field_tags=y") == ["2"]
    assert titles("field_tags=x") == ["1", "2"]
    assert titles("field_priority=1") == ["3"]
    assert titles("priority=1") == ["3"]  # legacy filter unchanged
    assert client.get("/api/todos?field_nope=1").status_code == 404


def test_create_field_validation(client) -> None:
    bad_bodies = (
        {"key": "Bad Key", "label": "x", "type": "text"}, {"key": "title", "label": "x", "type": "text"},
        {"key": "k", "label": " ", "type": "text"}, {"key": "k", "label": "x", "type": "nope"},
        {"key": "k", "label": "x", "type": "text", "options": [{"value": "a"}]},
        {"key": "k", "label": "x", "type": "choice", "options": [{"value": "a"}, {"value": "a"}]},
        {"key": "k", "label": "x", "type": "choice", "options": [{"value": "a", "parent": "zz"}]},
    )
    for body in bad_bodies:
        r = client.post("/api/todos/fields", json=body)
        assert r.status_code == 400 and "error" in r.json(), body
    mk_field(client, key="k", label="x", type="text")
    assert client.post("/api/todos/fields", json={"key": "k", "label": "y", "type": "text"}).status_code == 409


def test_add_option_inline_and_reorder(client) -> None:
    mk_field(client, key="kind", label="유형", type="choice")
    f = client.post("/api/todos/fields/kind/options", json={"label": "셋업", "color": "blue"}).json()
    assert f["options"] == [{"value": "셋업", "label": "셋업", "color": "blue"}]
    assert client.post("/api/todos/fields/kind/options", json={"label": "셋업"}).status_code == 409
    assert client.post("/api/todos/fields/priority/options", json={"label": "긴급"}).status_code == 400
    keys = [f["key"] for f in client.get("/api/todos/fields").json()["items"]]
    new = ["kind", *[k for k in keys if k != "kind"]]
    assert [f["key"] for f in client.put("/api/todos/fields/order", json={"keys": new}).json()["items"]] == new
    assert client.put("/api/todos/fields/order", json={"keys": ["kind"]}).status_code == 400


def test_update_field_rename_and_flags(client) -> None:
    f = client.patch("/api/todos/fields/requester", json={"label": "의뢰자", "show_filter": False}).json()
    assert f["label"] == "의뢰자" and f["show_filter"] is False and f["key"] == "requester"
    assert client.patch("/api/todos/fields/requester", json={"type": "text"}).status_code == 409
    assert client.patch("/api/todos/fields/nope", json={"label": "x"}).status_code == 404


def test_option_removal_requires_moves_when_in_use(client) -> None:
    mk_field(client, key="kind", label="유형", type="choice",
             options=[{"value": "a", "label": "A"}, {"value": "b", "label": "B"},
                      {"value": "c", "label": "C", "parent": "b"}])
    t1 = add(client, title="1", props={"kind": "b"})
    t2 = add(client, title="2", props={"kind": "a"})
    keep = [{"value": "a", "label": "A"}, {"value": "c", "label": "C", "parent": "b"}]
    r = client.patch("/api/todos/fields/kind", json={"options": keep})
    assert r.status_code == 400  # child points at the removed parent
    keep = [{"value": "a", "label": "A"}, {"value": "c", "label": "C"}]
    r = client.patch("/api/todos/fields/kind", json={"options": keep})
    assert r.status_code == 409 and "error" in r.json()  # b is in use, no move given
    r = client.patch("/api/todos/fields/kind", json={"options": keep, "option_moves": {"b": "zz"}})
    assert r.status_code == 400
    r = client.patch("/api/todos/fields/kind", json={"options": keep, "option_moves": {"b": "a"}})
    assert r.status_code == 200
    assert client.get(f"/api/todos/{t1['id']}").json()["props"]["kind"] == "a"
    assert client.get(f"/api/todos/{t2['id']}").json()["props"]["kind"] == "a"
    r = client.patch("/api/todos/fields/kind",
                     json={"options": [{"value": "c", "label": "C"}], "option_moves": {"a": None}})
    assert r.status_code == 200
    assert "kind" not in client.get(f"/api/todos/{t1['id']}").json()["props"]
    bad = [{"value": 1, "label": "상"}, {"value": 2, "label": "중"}]  # priority options are fixed
    assert client.patch("/api/todos/fields/priority", json={"options": bad}).status_code == 400


def test_delete_field_archives_when_used_and_purges_on_request(client) -> None:
    mk_field(client, key="product", label="제품", type="text")
    mk_field(client, key="unused", label="안씀", type="text")
    t = add(client, title="x", props={"product": "A"})
    assert client.delete("/api/todos/fields/unused").json() == {"ok": True, "archived": False, "purged": 0}
    assert client.get("/api/todos/fields/unused").status_code == 404
    r = client.delete("/api/todos/fields/product").json()
    assert r["archived"] is True and r["used_by"] == 1
    assert client.get(f"/api/todos/{t['id']}").json()["props"]["product"] == "A"  # value preserved
    r = client.patch(f"/api/todos/{t['id']}", json={"props": {"product": "B"}})
    assert r.status_code == 400  # archived fields reject writes
    assert client.delete("/api/todos/fields/product?purge=true").json()["purged"] == 1
    assert "product" not in client.get(f"/api/todos/{t['id']}").json()["props"]


def test_purge_builtin_resets_mirror_column(client) -> None:
    t = add(client, title="x", requester="김", priority=1)
    assert client.delete("/api/todos/fields/requester?purge=true").status_code == 200
    got = client.get(f"/api/todos/{t['id']}").json()
    assert got["requester"] is None and "requester" not in got["props"]
    assert client.delete("/api/todos/fields/priority?purge=true").status_code == 200
    assert client.get(f"/api/todos/{t['id']}").json()["priority"] == 2
    # legacy API still accepts the old keys after the definition is gone
    assert client.patch(f"/api/todos/{t['id']}", json={"requester": "이"}).json()["requester"] == "이"


def test_rules_validation_and_reference_protection(client) -> None:
    mk_field(client, key="kind", label="유형", type="choice",
             options=[{"value": "setup", "label": "셋업"}, {"value": "issue", "label": "이슈"}])
    mk_field(client, key="product", label="제품", type="text")
    rules = [{"conditions": [{"field": "kind", "op": "is", "value": "setup"}],
              "path": "MI 공정업무/{유형}/{제품}/{연}"}]
    assert client.put("/api/todos/page-rules", json={"rules": rules}).status_code == 200
    assert client.get("/api/todos/page-rules").json()["rules"] == rules
    bad_rules = (
        [{"conditions": [{"field": "zz", "op": "is", "value": 1}], "path": "a"}],
        [{"conditions": [{"field": "kind", "op": "is", "value": "nope"}], "path": "a"}],
        [{"conditions": [{"field": "kind", "op": "like", "value": "setup"}], "path": "a"}],
        [{"conditions": [], "path": "{없는변수}"}], [{"conditions": []}], "x",
    )
    for bad in bad_rules:
        r = client.put("/api/todos/page-rules", json={"rules": bad})
        assert r.status_code == 400 and "error" in r.json(), bad
    r = client.delete("/api/todos/fields/kind?purge=true")
    assert r.status_code == 409 and "1번" in r.json()["error"]
    assert client.delete("/api/todos/fields/product?purge=true").status_code == 409  # via template only
    r = client.patch("/api/todos/fields/kind", json={"options": [{"value": "issue", "label": "이슈"}]})
    assert r.status_code == 409  # option used by a rule condition
    client.put("/api/todos/page-rules", json={"rules": []})
    assert client.delete("/api/todos/fields/kind?purge=true").status_code == 200


def test_existing_filters_dates_and_dashboard_still_work(client) -> None:
    today = date.today().isoformat()
    add(client, title="soon", due_date=(date.today() + timedelta(days=1)).isoformat(),
        planned_date=today, requester="김", priority=1)
    assert len(client.get("/api/todos?due_within=3").json()["items"]) == 1
    assert len(client.get(f"/api/todos?planned_date={today}&requester=김").json()["items"]) == 1
    assert client.get("/api/dashboard/today").status_code == 200
