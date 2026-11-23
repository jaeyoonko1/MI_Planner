from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from app import db

STATUSES = ("todo", "doing", "done", "hold")
FIELDS = (
    "title", "status", "priority", "requester", "due_date", "planned_date",
    "parent_task_id", "eval_id", "page_path", "note",
)
_DATE_FIELDS = ("due_date", "planned_date")


class TaskError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _check_date(name: str, value: Any) -> None:
    if value is None:
        return
    try:
        date.fromisoformat(str(value))
    except ValueError:
        raise TaskError(f"{name}은(는) YYYY-MM-DD 형식이어야 합니다.") from None


def _clean(data: dict[str, Any], *, creating: bool) -> dict[str, Any]:
    """Validate known fields; unknown keys are ignored."""
    out = {k: data[k] for k in FIELDS if k in data}
    if creating or "title" in out:
        title = (out.get("title") or "").strip()
        if not title:
            raise TaskError("제목을 입력하세요.")
        out["title"] = title
    if "status" in out and out["status"] not in STATUSES:
        raise TaskError(f"상태는 {', '.join(STATUSES)} 중 하나여야 합니다.")
    if "priority" in out and out["priority"] not in (1, 2, 3):
        raise TaskError("우선순위는 1~3이어야 합니다.")
    for f in _DATE_FIELDS:
        if f in out:
            _check_date(f, out[f])
    for f in ("status", "priority"):
        if f in out and out[f] is None:
            raise TaskError(f"{f}은(는) 비울 수 없습니다.")
    return out


def _row(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def get(conn: sqlite3.Connection, task_id: int) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if row is None:
        raise TaskError("할일을 찾을 수 없습니다.", 404)
    return _row(row)


def _check_parent(conn: sqlite3.Connection, task_id: int | None, parent_id: int | None) -> None:
    if parent_id is None:
        return
    if parent_id == task_id:
        raise TaskError("자기 자신을 상위 할일로 지정할 수 없습니다.")
    get(conn, parent_id)  # 404 if missing
    # walk up to reject cycles
    cur: int | None = parent_id
    while cur is not None and task_id is not None:
        if cur == task_id:
            raise TaskError("상위 할일이 순환됩니다.")
        r = conn.execute("SELECT parent_task_id FROM tasks WHERE id = ?", (cur,)).fetchone()
        cur = r["parent_task_id"] if r else None


def create(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    clean = _clean(data, creating=True)
    _check_parent(conn, None, clean.get("parent_task_id"))
    now = _now()
    cols = [*clean, "created_at", "updated_at"]
    vals = [*clean.values(), now, now]
    cur = conn.execute(
        f"INSERT INTO tasks ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", vals
    )
    conn.commit()
    return get(conn, int(cur.lastrowid))


def update(conn: sqlite3.Connection, task_id: int, data: dict[str, Any]) -> dict[str, Any]:
    get(conn, task_id)
    clean = _clean(data, creating=False)
    if "parent_task_id" in clean:
        _check_parent(conn, task_id, clean["parent_task_id"])
    if clean:
        sets = ", ".join(f"{k} = ?" for k in clean)
        conn.execute(
            f"UPDATE tasks SET {sets}, updated_at = ? WHERE id = ?",
            [*clean.values(), _now(), task_id],
        )
        conn.commit()
    return get(conn, task_id)


def delete(conn: sqlite3.Connection, task_id: int) -> None:
    get(conn, task_id)
    conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.commit()


def list_tasks(
    conn: sqlite3.Connection,
    *,
    status: list[str] | None = None,
    priority: list[int] | None = None,
    requester: str | None = None,
    due_within: int | None = None,
    overdue: bool = False,
    planned_date: str | None = None,
    eval_id: int | None = None,
    page_path: str | None = None,
    parent_task_id: int | None = None,
    top_level: bool = False,
    q: str | None = None,
    today: date | None = None,
) -> list[dict[str, Any]]:
    """Filter tasks. due_within=N: open tasks due today..today+N days. overdue: open and past due."""
    where: list[str] = []
    args: list[Any] = []
    today = today or date.today()
    if status:
        bad = [s for s in status if s not in STATUSES]
        if bad:
            raise TaskError(f"알 수 없는 상태: {', '.join(bad)}")
        where.append(f"status IN ({', '.join('?' * len(status))})")
        args += status
    if priority:
        where.append(f"priority IN ({', '.join('?' * len(priority))})")
        args += priority
    if requester:
        where.append("requester = ?")
        args.append(requester)
    if due_within is not None:
        where.append("due_date IS NOT NULL AND due_date >= ? AND due_date <= ? AND status != 'done'")
        args += [today.isoformat(), (today + timedelta(days=due_within)).isoformat()]
    if overdue:
        where.append("due_date IS NOT NULL AND due_date < ? AND status != 'done'")
        args.append(today.isoformat())
    if planned_date:
        _check_date("planned_date", planned_date)
        where.append("planned_date = ?")
        args.append(planned_date)
    if eval_id is not None:
        where.append("eval_id = ?")
        args.append(eval_id)
    if page_path:
        where.append("page_path = ?")
        args.append(page_path)
    if parent_task_id is not None:
        where.append("parent_task_id = ?")
        args.append(parent_task_id)
    elif top_level:
        where.append("parent_task_id IS NULL")
    if q:
        where.append("(title LIKE ? OR note LIKE ?)")
        args += [f"%{q}%", f"%{q}%"]
    sql = "SELECT * FROM tasks"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY (due_date IS NULL), due_date, priority, id"
    return [_row(r) for r in conn.execute(sql, args)]


def requesters(conn: sqlite3.Connection) -> list[str]:
    """Distinct requesters, for the filter chips."""
    rows = conn.execute(
        "SELECT DISTINCT requester FROM tasks WHERE requester IS NOT NULL AND requester != '' "
        "ORDER BY requester"
    )
    return [r["requester"] for r in rows]


def open_conn(db_path: Path) -> sqlite3.Connection:
    return db.connect(db_path)
