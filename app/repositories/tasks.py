from __future__ import annotations

import json
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
# Legacy columns mirrored in tasks.props under the same key (D-22, migration 002).
MIRRORED = ("priority", "requester", "due_date", "planned_date")


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
    d = dict(row)
    try:
        d["props"] = json.loads(d.get("props") or "{}")
    except ValueError:
        d["props"] = {}
    return d


def _prepare(
    conn: sqlite3.Connection, data: dict[str, Any], current: dict[str, Any] | None
) -> dict[str, Any]:
    """Validate columns and fold user-defined values (`props`) in; returns the columns to write.

    Mirrored keys (priority, requester, due_date, planned_date) may arrive as top-level
    fields or inside props; top-level wins. A null value removes the key."""
    from app.repositories import task_fields as tf  # lazy: avoids an import cycle

    data = dict(data)
    incoming = data.pop("props", None)
    if incoming is not None and not isinstance(incoming, dict):
        raise TaskError("props는 객체여야 합니다.")
    incoming = dict(incoming or {})
    for k in MIRRORED:
        if k in incoming:
            data.setdefault(k, incoming.pop(k))
    clean = _clean(data, creating=current is None)
    props: dict[str, Any] = dict((current or {}).get("props") or {})
    fields = {f["key"]: f for f in tf.list_fields(conn)} if incoming else {}
    for k, v in incoming.items():
        f = fields.get(k)
        if f is None:
            raise TaskError(f"정의되지 않은 항목입니다: {k}")
        if v is None:
            props.pop(k, None)
            continue
        if f["archived"]:
            raise TaskError(f"보관된 항목에는 값을 쓸 수 없습니다: {f['label']}")
        props[k] = tf.validate_value(f, v)
    for k in MIRRORED:
        if k in clean:
            if clean[k] is None:
                props.pop(k, None)
            else:
                props[k] = clean[k]
    if current is None:
        props.setdefault("priority", 2)
    clean["props"] = json.dumps(props, ensure_ascii=False)
    return clean


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
    clean = _prepare(conn, data, None)
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
    current = get(conn, task_id)
    clean = _prepare(conn, data, current)
    if "parent_task_id" in clean:
        _check_parent(conn, task_id, clean["parent_task_id"])
    if clean:  # always non-empty: props is rewritten
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
    field_filters: dict[str, list[str]] | None = None,
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
    if field_filters:
        _field_filters(conn, field_filters, where, args)
    sql = "SELECT * FROM tasks"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY (due_date IS NULL), due_date, priority, id"
    return [_row(r) for r in conn.execute(sql, args)]


def _field_filters(
    conn: sqlite3.Connection, filters: dict[str, list[str]], where: list[str], args: list[Any]
) -> None:
    """User-defined field filters: key -> accepted values (OR within a field, AND across)."""
    from app.repositories import task_fields as tf

    for key, raw in filters.items():
        field = tf.get_field(conn, key)  # 404 for unknown fields
        path = f'$."{key}"'
        if field["type"] in tf.OPTION_TYPES:  # match option values regardless of int/str typing
            by_str = {str(o["value"]): o["value"] for o in field["options"]}
            vals: list[Any] = [by_str.get(v, v) for v in raw]
        elif field["type"] == "number":
            try:
                vals = [float(v) if "." in v else int(v) for v in raw]
            except ValueError:
                raise TaskError(f"{field['label']} 필터는 숫자여야 합니다.") from None
        elif field["type"] == "check":
            vals = [1 if v.lower() in ("1", "true", "yes", "on") else 0 for v in raw]
        else:
            vals = list(raw)
        marks = ", ".join("?" * len(vals))
        if field["type"] == "multi":
            where.append(
                f"EXISTS (SELECT 1 FROM json_each(tasks.props, ?) WHERE value IN ({marks}))"
            )
        else:
            where.append(f"json_extract(tasks.props, ?) IN ({marks})")
        args += [path, *vals]


def requesters(conn: sqlite3.Connection) -> list[str]:
    """Distinct requesters, for the filter chips."""
    rows = conn.execute(
        "SELECT DISTINCT requester FROM tasks WHERE requester IS NOT NULL AND requester != '' "
        "ORDER BY requester"
    )
    return [r["requester"] for r in rows]


def open_conn(db_path: Path) -> sqlite3.Connection:
    return db.connect(db_path)
