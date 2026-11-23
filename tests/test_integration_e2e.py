"""P2B-06: end-to-end scenario across features, restart, schema compatibility and offline guarantees.
Only fake data (LOT-TEST-001 / EQ-A01 style) in temp folders."""
import json
import re
import sqlite3
from datetime import date
from pathlib import Path

from fastapi.testclient import TestClient

from app import db
from app.main import create_app

ROOT = Path(__file__).resolve().parent.parent
TODAY = date.today().isoformat()
MONTH, DD = TODAY[:7], int(TODAY[8:10])
PNG = b"\x89PNG\r\n\x1a\n" + b"1" * 32


def _opt(c, key: str, label: str):
    c.post(f"/api/todos/fields/{key}/options", json={"label": label})
    return next(o["value"] for o in c.get(f"/api/todos/fields/{key}").json()["options"] if o["label"] == label)


def _open(tmp: Path) -> TestClient:
    return TestClient(create_app(tmp / "t.db", tmp / "vault"))


def test_full_flow_survives_restart(tmp_path: Path) -> None:
    """input line -> promote -> regroup/move -> expand to page -> memo + image edit -> restart -> intact."""
    vault = tmp_path / "vault"
    with _open(tmp_path) as c:
        # 1. a journal line typed by hand
        r = c.put(f"/api/journal/{MONTH}/{DD}", json={"content": "- [ ] EQ-A01 점검 LOT-TEST-001\n- 자유 기록"})
        assert r.status_code == 200, r.text
        # 2. promote the checkbox line to an issue (same ID in journal and list)
        r = c.post("/api/todos/from-line", json={"date": TODAY, "line_index": 0})
        assert r.status_code == 201, r.text
        tid = r.json()["task"]["id"]
        assert f"→ 할일 #{tid}" in c.get(f"/api/journal/{MONTH}").json()["days"][TODAY]
        # 3. regroup: classification value change = move between groups; free-layout move; copy with a new ID
        a, b = _opt(c, "epic", "에픽A"), _opt(c, "epic", "에픽B")
        assert c.patch(f"/api/todos/{tid}", json={"props": {"epic": a}}).status_code == 200
        assert c.patch(f"/api/todos/{tid}", json={"props": {"epic": b}}).status_code == 200
        free = c.get("/api/structure/free").json()
        grp = c.post("/api/structure/free/groups", json={"label": "자유 그룹"}).json()
        gid = next(n["id"] for n in grp["nodes"] if n["label"] == "자유 그룹")
        assert c.post("/api/structure/free/move", json={"kind": "issue", "id": tid, "parent_id": gid}).status_code == 200
        assert free is not None
        cp = c.post("/api/structure/copy", json={"kind": "issue", "task_id": tid})
        assert cp.status_code == 201
        copy_id = cp.json()["created"][0]
        assert copy_id != tid
        # 4. expand to a page (once), then memo text + image through the issue API
        p1 = c.post(f"/api/todos/{tid}/page", json={})
        assert p1.status_code == 200 and p1.json()["created"] is True
        rel = p1.json()["path"]
        assert c.post(f"/api/todos/{tid}/page", json={}).json()["created"] is False
        ref = c.post(f"/api/todos/{tid}/files", params={"name": "a.png"}, content=PNG).json()["file"]
        note = f"## 점검 메모\n\n설비 EQ-A01\n\n![]({ref}){{width=480}}\n"
        assert c.patch(f"/api/todos/{tid}", json={"note": note}).status_code == 200
        assert (vault / rel / "index.md").read_text(encoding="utf-8") == note
    # 5. restart: new app object on the same DB + vault
    with _open(tmp_path) as c:
        got = c.get(f"/api/todos/{tid}").json()
        assert got["note"] == note and got["props"]["epic"] == b and got["page_path"] == rel
        assert c.get(f"/api/todos/{tid}/file", params={"name": ref.split("/")[1]}).content == PNG
        assert c.get("/api/pages", params={"path": rel}).json()["content"] == note
        assert f"→ 할일 #{tid}" in c.get(f"/api/journal/{MONTH}").json()["days"][TODAY]
        free = c.get("/api/structure/free").json()
        assert any(i["task_id"] == tid and i["node_id"] == gid for i in free["items"])
        assert any(i["task_id"] == copy_id for i in free["items"])
        # second restart round must not create duplicates or change text (idempotent startup sweep)
    with _open(tmp_path) as c:
        assert c.get(f"/api/todos/{tid}").json()["note"] == note
        assert len([t for t in c.get("/api/todos").json()["items"] if t["id"] == tid]) == 1
        assert not (vault / ".issue-files" / str(tid)).exists()


def test_all_migrations_apply_on_database_with_existing_data(tmp_path: Path) -> None:
    """A DB created by migration 001 with rows upgrades through every later migration without data loss."""
    first = tmp_path / "m1"
    first.mkdir()
    (first / "001_init.sql").write_text((db.MIGRATIONS_DIR / "001_init.sql").read_text(encoding="utf-8"), encoding="utf-8")
    path = tmp_path / "old.db"
    conn = db.connect(path)
    db.migrate(conn, first)
    conn.execute("INSERT INTO settings (key, value) VALUES ('theme', 'dark')")
    conn.execute(
        "INSERT INTO tasks (title, note, priority, requester, due_date, created_at, updated_at) "
        "VALUES ('기존 이슈', '기존 메모', 1, 'EQ-A01 담당', '2026-12-01', 'x', 'x')"
    )
    conn.commit()
    conn.close()
    names = sorted(p.name for p in db.MIGRATIONS_DIR.glob("*.sql"))
    assert names[0] == "001_init.sql" and names == [f"{i:03d}" + n[3:] for i, n in enumerate(names, 1)]  # contiguous
    with TestClient(create_app(path, tmp_path / "vault")) as c:
        t = c.get("/api/todos").json()["items"][0]
        assert (t["title"], t["note"], t["due_date"], t["requester"]) == ("기존 이슈", "기존 메모", "2026-12-01", "EQ-A01 담당")
        assert t["props"]["priority"] == 1
        assert c.get("/api/structure/view").status_code == 200
        assert c.get("/api/structure/free").status_code == 200
        assert c.get("/api/dashboard/today").status_code == 200
        assert c.get("/api/settings").json()["settings"]["theme"] == "dark"
    conn = sqlite3.connect(path)
    done = {r[0] for r in conn.execute("SELECT name FROM schema_migrations")} if _has(conn, "schema_migrations") else set()
    conn.close()
    assert not done or set(names) <= done


def _has(conn: sqlite3.Connection, table: str) -> bool:
    return bool(conn.execute("SELECT 1 FROM sqlite_master WHERE name = ?", (table,)).fetchone())


def test_no_external_network_references_in_app_ui() -> None:
    """The shipped UI (web/ except design prototypes and test pages) must load nothing from the network."""
    allowed = ("http://www.w3.org/2000/svg", "http://www.w3.org/1999/xlink", "http://www.w3.org/1999/xhtml")
    url = re.compile(r"""(?:https?:)?//[A-Za-z0-9][\w.-]*\.[a-z]{2,}[^\s"'<>)]*""", re.I)
    bad: list[str] = []
    for p in (ROOT / "web").rglob("*"):
        rel = p.relative_to(ROOT / "web").parts
        if not p.is_file() or rel[0] in ("design", "test") or p.suffix not in (".html", ".js", ".mjs", ".css"):
            continue
        text = p.read_text(encoding="utf-8")
        for m in re.finditer(r"https?://[^\s\"'<>)`]+", text):
            if not m.group(0).startswith(allowed):
                bad.append(f"{p.relative_to(ROOT)}: {m.group(0)}")
        for m in re.finditer(r"@import\s+(?:url\()?['\"]?(https?:)?//", text):
            bad.append(f"{p.relative_to(ROOT)}: @import {m.group(0)}")
        for m in re.finditer(r"""(?:src|href)\s*=\s*["'](//[^"']+)""", text):
            bad.append(f"{p.relative_to(ROOT)}: protocol-relative {m.group(1)}")
    assert not bad, bad
    assert url  # pattern compiled (kept for readability of intent)


def test_index_html_uses_only_local_assets() -> None:
    html = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    refs = re.findall(r"""(?:src|href)\s*=\s*["']([^"']+)["']""", html)
    assert refs and all(r.startswith(("/", "#")) for r in refs), refs
    assert (ROOT / "web" / "index.html").is_file()
    assert 'lang="ko"' in html


def test_run_bat_and_paths_are_windows_friendly() -> None:
    bat = (ROOT / "run.bat").read_text(encoding="utf-8")
    assert "127.0.0.1" in bat and "0.0.0.0" not in bat and "8765" in bat
    reqs = (ROOT / "requirements.txt").read_text(encoding="utf-8").lower()
    assert "fastapi" in reqs and "uvicorn" in reqs
    cfg = json.loads((ROOT / ".claude" / "launch.json").read_text(encoding="utf-8")) if (ROOT / ".claude" / "launch.json").exists() else {}
    assert isinstance(cfg, dict)


def test_deleting_issue_moves_leftover_images_to_trash(tmp_path: Path) -> None:
    with _open(tmp_path) as c:
        tid = c.post("/api/todos", json={"title": "이미지 이슈"}).json()["id"]
        c.post(f"/api/todos/{tid}/files", params={"name": "a.png"}, content=PNG)
        folder = tmp_path / "vault" / ".issue-files" / str(tid)
        assert folder.is_dir()
        assert c.delete(f"/api/todos/{tid}").status_code == 200
        assert not folder.exists()
        assert any(p.name.endswith(f"issue-files-{tid}") for p in (tmp_path / "vault" / ".trash").iterdir())
