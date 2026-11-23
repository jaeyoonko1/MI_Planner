from pathlib import Path

import pytest

from app import db


def test_init_creates_tables_and_is_idempotent(tmp_path: Path) -> None:
    path = tmp_path / "t.db"
    assert db.init_db(path) == ["001_init.sql"]
    assert db.init_db(path) == []
    conn = db.connect(path)
    names = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"tasks", "settings", "schema_migrations"} <= names
    conn.execute(
        "INSERT INTO tasks (title, created_at, updated_at) VALUES ('t', 'x', 'x')"
    )
    assert conn.execute("SELECT status FROM tasks").fetchone()["status"] == "todo"
    conn.close()


def test_only_new_migrations_applied(tmp_path: Path) -> None:
    mdir = tmp_path / "m"
    mdir.mkdir()
    (mdir / "001_a.sql").write_text("CREATE TABLE a (id INTEGER);", encoding="utf-8")
    conn = db.connect(tmp_path / "t.db")
    assert db.migrate(conn, mdir) == ["001_a.sql"]
    (mdir / "002_b.sql").write_text("CREATE TABLE b (id INTEGER);", encoding="utf-8")
    assert db.migrate(conn, mdir) == ["002_b.sql"]
    conn.close()


def test_failed_migration_rolls_back(tmp_path: Path) -> None:
    mdir = tmp_path / "m"
    mdir.mkdir()
    (mdir / "001_bad.sql").write_text(
        "CREATE TABLE ok (id INTEGER);\nCREATE TABLE ok (id INTEGER);", encoding="utf-8"
    )
    conn = db.connect(tmp_path / "t.db")
    with pytest.raises(Exception):
        db.migrate(conn, mdir)
    tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "ok" not in tables
    assert conn.execute("SELECT COUNT(*) c FROM schema_migrations").fetchone()["c"] == 0
    conn.close()
