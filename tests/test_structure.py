from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture()
def client(tmp_path: Path):
    app = create_app(tmp_path / "t.db", tmp_path / "vault")
    with TestClient(app) as c:
        yield c


def keys(view, name="levels"):
    return [lv["key"] for lv in view[name]]


def test_initial_view_is_issue_hierarchy_with_epic_type_ready(client) -> None:
    # V-011: an unsaved view opens as the issue hierarchy; the classification levels stay ready for 분류 기준
    v = client.get("/api/structure/view").json()
    assert v["mode"] == "issues" and keys(v) == ["epic", "type"] and not v["saved"]
    assert [lv["label"] for lv in v["issue_levels"]] == ["에픽"]
    assert (v["levels"][0]["icon"], v["levels"][0]["color"]) == ("layers", "violet")
    assert "priority" in keys(v, "available") and "due_date" not in keys(v, "available")


def test_apply_persists_order_styles_and_new_class(client) -> None:
    body = {
        "mode": "fields", "levels": ["type", "new:a", "epic"],
        "new_fields": [{"tmp": "a", "label": "제품군"}],
        "styles": {"new:a": {"icon": "box", "color": "blue"}, "type": {"icon": "flag", "color": "pink"}},
    }
    r = client.put("/api/structure/view", json=body)
    assert r.status_code == 200, r.text
    v = r.json()
    assert keys(v) == ["type", "c1", "epic"] and v["saved"]
    assert (v["levels"][0]["icon"], v["levels"][0]["color"]) == ("flag", "pink")
    assert (v["levels"][1]["icon"], v["levels"][1]["label"]) == ("box", "제품군")
    # restored by a fresh read (what a restart does) and the definition really exists
    assert keys(client.get("/api/structure/view").json()) == ["type", "c1", "epic"]
    fields = {f["key"]: f for f in client.get("/api/todos/fields").json()["items"]}
    assert fields["c1"]["type"] == "choice"


def test_invalid_apply_changes_nothing(client) -> None:
    bad = [
        {"levels": ["epic", "epic"]},
        {"levels": ["due_date"]},  # dates cannot group
        {"levels": ["nope"]},
        {"levels": ["new:zz"]},
        {"levels": [], "mode": "weird"},
        {"levels": ["epic"], "styles": {"epic": {"icon": "star", "color": "blue"}}},
        {"levels": ["new:a"], "new_fields": [{"tmp": "a", "label": "에픽"}]},  # duplicate label
        {"levels": ["new:a"], "new_fields": [{"tmp": "a", "label": "이슈"}]},
        {"levels": ["new:a"], "new_fields": [{"tmp": "a", "label": " "}]},
    ]
    for b in bad:
        r = client.put("/api/structure/view", json=b)
        assert r.status_code in (400, 409) and "error" in r.json(), b
    assert len(client.get("/api/todos/fields").json()["items"]) == 6
    assert not client.get("/api/structure/view").json()["saved"]


def test_hiding_level_keeps_values_deleting_definition_breaks_rule(client) -> None:
    t = client.post("/api/todos", json={"title": "a"}).json()
    assert client.post("/api/todos/fields/type/options", json={"label": "셋업"}).status_code == 201
    val = client.get("/api/todos/fields/type").json()["options"][0]["value"]
    client.patch(f"/api/todos/{t['id']}", json={"props": {"type": val}})
    # hide the level from the view: value stays
    v = client.put("/api/structure/view", json={"mode": "fields", "levels": ["epic"]}).json()
    assert keys(v) == ["epic"] and "type" in keys(v, "available")
    assert client.get(f"/api/todos/{t['id']}").json()["props"]["type"] == val
    # bring it back, then archive the definition: view falls back to free mode
    client.put("/api/structure/view", json={"mode": "fields", "levels": ["epic", "type"]})
    imp = client.get("/api/structure/classes/type/impact").json()
    assert imp["used_by"] == 1 and imp["in_view"] and imp["options"][0]["count"] == 1
    assert client.delete("/api/todos/fields/type").json()["archived"] is True
    v = client.get("/api/structure/view").json()
    assert v["mode"] == "free" and "자유" in v["free_reason"] and keys(v) == ["epic"]
    assert client.get(f"/api/todos/{t['id']}").json()["props"]["type"] == val  # value preserved
    # applying a valid view again recovers field mode
    assert client.put("/api/structure/view", json={"mode": "fields", "levels": ["epic"]}).json()["mode"] == "fields"


def test_impact_reports_rules_and_classes_overview(client) -> None:
    client.post("/api/todos/fields/epic/options", json={"label": "E1"})
    val = client.get("/api/todos/fields/epic").json()["options"][0]["value"]
    r = client.put("/api/todos/page-rules", json={"rules": [
        {"conditions": [{"field": "epic", "op": "is", "value": val}], "path": "MI 공정업무/{epic}"}]})
    assert r.status_code == 200, r.text
    imp = client.get("/api/structure/classes/epic/impact").json()
    assert imp["rules"] == [1] and imp["options"][0]["rules"] == [1]
    assert client.delete("/api/todos/fields/epic?purge=true").status_code == 409
    client.put("/api/structure/view", json={"mode": "fields", "levels": ["epic", "type"]})  # default is now "issues"
    rows = {c["key"]: c for c in client.get("/api/structure/classes").json()["items"]}
    assert rows["epic"]["rules"] == [1] and rows["epic"]["in_view"] and rows["due_date"]["groupable"] is False
    assert client.get("/api/structure/classes/zzz/impact").status_code == 404


def test_free_mode_is_saved_and_restored(client) -> None:
    v = client.put("/api/structure/view", json={"mode": "free", "levels": ["epic", "type"]}).json()
    assert v["mode"] == "free" and v["free_reason"] is None
    assert client.get("/api/structure/view").json()["mode"] == "free"
