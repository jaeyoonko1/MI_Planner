"""V-003: inline formatting inside journal lines must never leak into task titles or search, and must survive task changes."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.inline_format import strip_inline
from app.main import create_app

ROOT = Path(__file__).resolve().parent.parent
D1 = "2026-11-24"

CORPUS = [
    "plain", "**bold** text", "*it* and ~~gone~~", "<u>under</u>", "<mark>yellow</mark>", '<mark style="background:#a5f3a5">green</mark>',
    '<span style="color:#d93025;font-size:18px">red big</span>', "한글 **굵게** 와 *기울임*", "a * b * c", "2*3*4", "x \\* y \\# z", "unclosed **bold",
    '<span style="color:#123456">not a preset</span>', "5 > 3 <b>raw</b>", "~~**both**~~", "<mark>**inner**</mark>", "a ~ b ~~ c", "***bi***",
    '<span style="font-size:99px">x</span>', "<u>open", "tail\\", "**a** **b**",
]


@pytest.fixture()
def client(tmp_path: Path):
    with TestClient(create_app(tmp_path / "t.db", tmp_path / "vault")) as c:
        yield c


def put_day(client, text: str) -> None:
    r = client.put(f"/api/journal/{D1[:7]}/{int(D1[8:])}", json={"content": text})
    assert r.status_code == 200, r.text


def day_body(client) -> str:
    return client.get(f"/api/journal/{D1[:7]}").json()["days"].get(D1, "")


def test_strip_inline_basics() -> None:
    assert strip_inline("**굵게** <u>밑줄</u> <mark>형광</mark> ~~취소~~ \\*별") == "굵게 밑줄 형광 취소 *별"
    assert strip_inline('<span style="color:#d93025;font-size:18px">색</span>') == "색"
    assert strip_inline("a * b") == "a * b"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_python_strip_matches_the_editor_reader() -> None:
    """app/inline_format.py mirrors web/js/lineeditor-format.js: same visible text for the same line."""
    res = subprocess.run(
        ["node", str(ROOT / "web" / "test" / "run_lineeditor_format.mjs"), "--plain"],
        input=json.dumps(CORPUS), capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    assert res.returncode == 0, res.stderr
    assert json.loads(res.stdout) == [strip_inline(t) for t in CORPUS]


def test_promoting_a_formatted_line_uses_the_plain_title(client) -> None:
    put_day(client, "- [ ] **EQ-A01** <mark>점검</mark> <u>오늘</u>")
    task = client.post("/api/todos/from-line", json={"date": D1, "line_index": 0}).json()["task"]
    assert task["title"] == "EQ-A01 점검 오늘"
    assert day_body(client).startswith("- [ ] **EQ-A01** <mark>점검</mark> <u>오늘</u> → 할일 #")


def test_editing_a_linked_line_syncs_plain_title_and_keeps_formatting(client) -> None:
    t = client.post("/api/todos", json={"title": "점검", "planned_date": D1}).json()
    put_day(client, f"- [ ] <span style=\"color:#d93025\">**긴급 점검**</span> → 할일 #{t['id']}")
    assert client.get(f"/api/todos/{t['id']}").json()["title"] == "긴급 점검"
    assert "**긴급 점검**" in day_body(client)


def test_status_change_keeps_the_line_formatting(client) -> None:
    t = client.post("/api/todos", json={"title": "점검", "planned_date": D1}).json()
    put_day(client, f"- [ ] **점검** → 할일 #{t['id']}")
    client.patch(f"/api/todos/{t['id']}", json={"status": "done"})
    assert day_body(client) == f"- [x] **점검** → 할일 #{t['id']}"
    client.patch(f"/api/todos/{t['id']}", json={"title": "새 이름"})
    assert day_body(client) == f"- [x] 새 이름 → 할일 #{t['id']}"  # the text no longer matches, so the task title wins
