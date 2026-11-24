from pathlib import Path

import pytest

from app import db


def test_init_creates_tables_and_is_idempotent(tmp_path: Path) -> None:
    path = tmp_path / "t.db"
    assert db.init_db(path) == ["001_init.sql", "002_task_fields.sql", "003_task_mark.sql", "004_structure_defaults.sql", "005_structure_free.sql", "006_evaluations.sql", "007_evaluation_requests.sql", "008_plans.sql", "009_doi.sql", "010_recipes.sql"]
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


def test_connection_can_be_closed_from_another_thread(tmp_path) -> None:
    # Regression: FastAPI opens a yielded connection and closes it on a different worker
    # thread; sqlite3's default thread check turned that into an intermittent 500.
    import threading
    from app import db

    conn = db.connect(tmp_path / "t.db")
    errors: list[Exception] = []

    def close() -> None:
        try:
            conn.execute("SELECT 1")
            conn.close()
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    t = threading.Thread(target=close)
    t.start()
    t.join()
    assert errors == []


def test_concurrent_api_requests_do_not_500(tmp_path) -> None:
    import threading
    from fastapi.testclient import TestClient
    from app.main import create_app

    statuses: list[int] = []
    errors: list[Exception] = []
    with TestClient(create_app(tmp_path / "t.db", tmp_path / "vault")) as c:
        def work(i: int) -> None:
            try:
                for k in range(25):
                    if i % 3 == 0:
                        r = c.put("/api/settings/theme", json={"value": ["dark", "light"][k % 2]})
                    elif i % 3 == 1:
                        r = c.get("/api/todos")
                    else:
                        r = c.post("/api/todos", json={"title": f"LOT-TEST-{i}-{k}"})
                    statuses.append(r.status_code)
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        ts = [threading.Thread(target=work, args=(i,)) for i in range(9)]
        [t.start() for t in ts]
        [t.join() for t in ts]
    assert errors == []
    assert all(s < 500 for s in statuses), sorted(set(statuses))
