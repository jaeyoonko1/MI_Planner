from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = ROOT / "data" / "mi_planner.db"
MIGRATIONS_DIR = ROOT / "migrations"
_MIGRATION_NAME = re.compile(r"^(\d{3})_.+\.sql$")


def connect(db_path: Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _list_migrations(directory: Path) -> list[tuple[str, Path]]:
    found = [(p.name, p) for p in directory.glob("*.sql") if _MIGRATION_NAME.match(p.name)]
    return sorted(found)


def migrate(conn: sqlite3.Connection, directory: Path = MIGRATIONS_DIR) -> list[str]:
    """Apply pending migrations in filename order. Returns names applied now."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        "name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
    )
    conn.commit()
    done = {r["name"] for r in conn.execute("SELECT name FROM schema_migrations")}
    applied: list[str] = []
    for name, path in _list_migrations(directory):
        if name in done:
            continue
        script = path.read_text(encoding="utf-8")
        try:
            conn.execute("BEGIN")
            for stmt in _split_statements(script):
                conn.execute(stmt)
            conn.execute(
                "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
                (name, datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")),
            )
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        applied.append(name)
    return applied


def _split_statements(script: str) -> list[str]:
    """Split on ';' using sqlite3.complete_statement (handles quoted semicolons)."""
    stmts: list[str] = []
    buf = ""
    for line in script.splitlines(keepends=True):
        buf += line
        if sqlite3.complete_statement(buf):
            if buf.strip():
                stmts.append(buf.strip())
            buf = ""
    if buf.strip() and not all(l.strip().startswith("--") or not l.strip() for l in buf.splitlines()):
        stmts.append(buf.strip())
    return stmts


def init_db(db_path: Path = DEFAULT_DB_PATH) -> list[str]:
    conn = connect(db_path)
    try:
        return migrate(conn)
    finally:
        conn.close()
