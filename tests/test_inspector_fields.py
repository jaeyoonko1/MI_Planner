"""V-006: the issue inspector must show every active classification's current value and options, fresh."""
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture()
def client(tmp_path: Path):
    with TestClient(create_app(tmp_path / "t.db", tmp_path / "vault")) as c:
        yield c


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js not installed")
def test_inspector_model_node() -> None:
    r = subprocess.run(["node", str(ROOT / "web/test/run_inspector_fields.mjs")], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr


def test_inspector_never_caches_field_list() -> None:
    src = (ROOT / "web/js/inspector.js").read_text(encoding="utf-8")
    assert "if (!fields)" not in src.replace("if (!fields) toast", "")  # old module-level cache bug
    assert "kind === \"fields\"" in src


def test_new_class_values_and_options_visible_to_inspector(client) -> None:
    r = client.put("/api/structure/view", json={"mode": "fields", "levels": ["new:a"], "new_fields": [{"tmp": "a", "label": "제품"}], "styles": {}})
    assert r.status_code == 200, r.text
    key = r.json()["levels"][0]["key"]
    assert client.get("/api/todos/fields?include_archived=false").json()["items"]
    f = next(x for x in client.get("/api/todos/fields?include_archived=false").json()["items"] if x["key"] == key)
    assert f["options"] == []  # zero options → inspector shows the empty state
    assert client.post(f"/api/todos/fields/{key}/options", json={"label": "P-A"}).status_code in (200, 201)
    f = next(x for x in client.get("/api/todos/fields?include_archived=false").json()["items"] if x["key"] == key)
    val = f["options"][0]["value"]
    t = client.post("/api/todos", json={"title": "EQ-A01 점검"}).json()
    r = client.patch(f"/api/todos/{t['id']}", json={"props": {key: val}})
    assert r.status_code == 200, r.text
    assert client.get(f"/api/todos/{t['id']}").json()["props"][key] == val
