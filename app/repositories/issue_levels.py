"""Editable issue level definitions (D-49). Rank controls display order."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from typing import Any

from app.repositories.tasks import TaskError

ICONS = ("layers", "grid", "box", "person", "flag", "ring", "issue")
COLORS = ("violet", "mint", "blue", "peach", "pink", "yellow")
MAX_LEVELS = 7  # Six configurable upper levels plus the former implicit level.


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _row(r: sqlite3.Row, used: dict[int, int]) -> dict[str, Any]:
    d = dict(r)
    d["is_default"] = bool(d["is_default"])
    d["used_by"] = used.get(d["id"], 0)
    return d


def list_levels(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """All levels, in display order."""
    used = {r["level_id"]: r["n"] for r in conn.execute(
        "SELECT level_id, COUNT(*) n FROM tasks GROUP BY level_id")}
    return [_row(r, used) for r in conn.execute("SELECT * FROM issue_levels ORDER BY rank DESC, id")]


def get_level(conn: sqlite3.Connection, level_id: int) -> dict[str, Any]:
    r = conn.execute("SELECT * FROM issue_levels WHERE id = ?", (level_id,)).fetchone()
    if r is None:
        raise TaskError("이슈 수준을 찾을 수 없어요.", 404)
    return {**dict(r), "is_default": bool(r["is_default"])}


def find_level_id(conn: sqlite3.Connection, label: str) -> int:
    for level in conn.execute("SELECT id, label FROM issue_levels"):
        if level["label"].casefold() == label.strip().casefold():
            return level["id"]
    raise TaskError(f"'{label}' 이슈 수준을 찾을 수 없어요.", 404)


def validate_level(conn: sqlite3.Connection, level_id: Any) -> None:
    if level_id is None:  # The SQLite trigger applies the current default.
        return
    if type(level_id) is not int:
        raise TaskError("이슈 수준이 올바르지 않아요.")
    get_level(conn, level_id)


def _set_default(conn: sqlite3.Connection, level_id: int) -> None:
    conn.execute("UPDATE issue_levels SET is_default = 0 WHERE is_default = 1")
    conn.execute("UPDATE issue_levels SET is_default = 1, updated_at = ? WHERE id = ?", (_now(), level_id))


def _clean_label(conn: sqlite3.Connection, label: Any, skip: int | None = None) -> str:
    text = str(label or "").strip()
    if not text or len(text) > 30:
        raise TaskError("수준 이름은 1~30자로 입력하세요.")
    taken = {r["label"].casefold() for r in conn.execute("SELECT id, label FROM issue_levels") if r["id"] != skip}
    if text.casefold() in taken:
        raise TaskError(f"'{text}' 이름은 이미 있어요.", 409)
    return text


def _style(data: dict[str, Any], key: str, allowed: tuple[str, ...], default: str) -> str:
    v = data.get(key, default)
    if v not in allowed:
        raise TaskError("아이콘 또는 색이 올바르지 않아요.")
    return v


def _renumber(conn: sqlite3.Connection, ids_top_first: list[int]) -> None:
    n = len(ids_top_first)
    for i, lid in enumerate(ids_top_first):
        conn.execute("UPDATE issue_levels SET rank = ?, updated_at = ? WHERE id = ?", (n - i - 1, _now(), lid))


def _ids(conn: sqlite3.Connection) -> list[int]:
    return [r["id"] for r in conn.execute("SELECT id FROM issue_levels ORDER BY rank DESC, id")]


def create_level(conn: sqlite3.Connection, data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise TaskError("요청 형식이 올바르지 않아요.")
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        ids = _ids(conn)
        if len(ids) >= MAX_LEVELS:
            raise TaskError(f"이슈 수준은 {MAX_LEVELS}개까지 둘 수 있어요.")
        label = _clean_label(conn, data.get("label"))
        slot = len(ids) - 1
        icon = _style(data, "icon", ICONS, ICONS[(slot + 1) % (len(ICONS) - 1)])
        color = _style(data, "color", COLORS, COLORS[(slot + 1) % len(COLORS)])
        index = data.get("index", len(ids) - 1)  # 0 = top; default = above the last level
        if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index <= len(ids):
            raise TaskError("수준 위치가 올바르지 않아요.")
        now = _now()
        new_id = conn.execute(
            "SELECT MAX(COALESCE((SELECT MAX(id) FROM issue_levels), 0), "
            "COALESCE((SELECT MAX(json_extract(payload, '$.level.id')) FROM structure_trash "
            "WHERE json_extract(payload, '$.kind') = 'level'), 0)) + 1"
        ).fetchone()[0]
        conn.execute("INSERT INTO issue_levels (id, label, rank, icon, color, created_at, updated_at) "
                     "VALUES (?, ?, 0, ?, ?, ?, ?)", (new_id, label, icon, color, now, now))
        ids.insert(index, new_id)
        _renumber(conn, ids)  # inserting never changes the relative order of existing levels
        return get_level(conn, new_id)


def update_level(conn: sqlite3.Connection, level_id: int, data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise TaskError("요청 형식이 올바르지 않아요.")
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        cur = get_level(conn, level_id)
        sets: dict[str, Any] = {}
        if "label" in data:
            sets["label"] = _clean_label(conn, data["label"], skip=level_id)
        if "icon" in data:
            sets["icon"] = _style(data, "icon", ICONS, cur["icon"])
        if "color" in data:
            sets["color"] = _style(data, "color", COLORS, cur["color"])
        if "is_default" in data and data["is_default"] is not True:
            raise TaskError("다른 수준을 기본으로 지정해 주세요.")
        if data.get("is_default") and not cur["is_default"]:
            _set_default(conn, level_id)
        if sets:
            cols = ", ".join(f"{k} = ?" for k in sets)
            conn.execute(f"UPDATE issue_levels SET {cols}, updated_at = ? WHERE id = ?", [*sets.values(), _now(), level_id])
        return get_level(conn, level_id)


def reorder(conn: sqlite3.Connection, ids: Any) -> list[dict[str, Any]]:
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        if not isinstance(ids, list) or any(type(i) is not int for i in ids) or sorted(ids) != sorted(_ids(conn)):
            raise TaskError("모든 수준을 한 번씩 보내야 해요.")
        _renumber(conn, ids)
        return list_levels(conn)


# ---- delete (restorable) ----------------------------------------------------------------------
def delete_level(conn: sqlite3.Connection, level_id: int) -> dict[str, Any]:
    """Move issues to the nearest lower level, or up when deleting the last row."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        level = get_level(conn, level_id)
        order = _ids(conn)
        if len(order) == 1:
            raise TaskError("마지막 이슈 수준은 삭제할 수 없어요.", 409)
        index = order.index(level_id)
        target = order[index + 1] if index + 1 < len(order) else order[index - 1]
        target_label = get_level(conn, target)["label"]
        moved = [r["id"] for r in conn.execute("SELECT id FROM tasks WHERE level_id = ?", (level_id,))]
        if level["is_default"]:
            _set_default(conn, target)
        conn.execute("UPDATE tasks SET level_id = ? WHERE level_id = ?", (target, level_id))
        conn.execute("DELETE FROM issue_levels WHERE id = ?", (level_id,))
        _renumber(conn, [i for i in order if i != level_id])
        payload = {"kind": "level", "level": level, "order": order, "tasks": moved, "to": target}
        summary = f"수준 '{level['label']}'"
        cur = conn.execute("INSERT INTO structure_trash (summary, payload, created_at) VALUES (?, ?, ?)",
                           (summary, json.dumps(payload, ensure_ascii=False), _now()))
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return {"trash_id": int(cur.lastrowid), "summary": summary, "moved": len(moved),
            "to": target_label, "issues": [], "groups": [], "journal_days": {}}


def restore_level(conn: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
    """Inside the caller's transaction: same id, same place in the order, same issues (unless changed since)."""
    level = payload["level"]
    if conn.execute("SELECT 1 FROM issue_levels WHERE id = ?", (level["id"],)).fetchone():
        raise TaskError("같은 번호의 수준이 이미 있어 되돌릴 수 없어요.", 409)
    _clean_label(conn, level["label"])
    conn.execute("INSERT INTO issue_levels (id, label, rank, icon, color, created_at, updated_at) "
                 "VALUES (?, ?, 0, ?, ?, ?, ?)",
                 (level["id"], level["label"], level["icon"], level["color"], level["created_at"], _now()))
    current = _ids(conn)
    snapshot_order = payload["order"]
    following = snapshot_order[snapshot_order.index(level["id"]) + 1:]
    order = [i for i in current if i != level["id"]]
    neighbor = next((i for i in following if i in order), None)
    order.insert(order.index(neighbor) if neighbor is not None else len(order), level["id"])
    _renumber(conn, order)
    to = payload.get("to")
    if level.get("is_default") and conn.execute(
        "SELECT 1 FROM issue_levels WHERE id = ? AND is_default = 1", (to,)
    ).fetchone():
        _set_default(conn, level["id"])
    for tid in payload["tasks"]:
        conn.execute("UPDATE tasks SET level_id = ? WHERE id = ? AND level_id IS ?", (level["id"], tid, to))
    return {"issues": [], "groups": [], "journal_days": {}, "journal_skipped": 0}


# ---- explicit migration path: classification values -> upper-level issues ----------------------
def convert(conn: sqlite3.Connection, data: Any) -> dict[str, Any]:
    """Create one issue per value of a choice classification at `level_id` and put the top-level issues that
    carry that value under it. Values stay on the issues (nothing is lost); running it again reuses the
    issues it made before. One transaction."""
    from app.repositories import task_fields as tf

    if not isinstance(data, dict):
        raise TaskError("요청 형식이 올바르지 않아요.")
    field = tf.get_field(conn, str(data.get("field_key") or ""))
    if field["type"] != "choice" or field["builtin"]:
        raise TaskError("선택형 사용자 분류만 이슈로 바꿀 수 있어요.")
    level_id = data.get("level_id")
    if isinstance(level_id, bool) or not isinstance(level_id, int):
        raise TaskError("이슈 수준을 고르세요.")
    path = f'$."{field["key"]}"'
    created: list[int] = []
    reused: list[int] = []
    linked = 0
    if conn.in_transaction:
        conn.commit()
    conn.execute("BEGIN IMMEDIATE")
    try:
        get_level(conn, level_id)
        for o in field["options"]:
            if o.get("archived"):
                continue
            value = json.dumps(o["value"], ensure_ascii=False)
            head = conn.execute(
                "SELECT id FROM tasks WHERE level_id = ? AND title = ? AND json_extract(props, ?) = json_extract(?, '$')",
                (level_id, o["label"], path, value)).fetchone()
            if head:
                hid = head["id"]
                reused.append(hid)
            else:
                now = _now()
                props = json.dumps({"priority": 2, field["key"]: o["value"]}, ensure_ascii=False)
                hid = int(conn.execute(
                    "INSERT INTO tasks (title, level_id, props, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                    (o["label"], level_id, props, now, now)).lastrowid)
                created.append(hid)
            rows = conn.execute(
                "WITH RECURSIVE ancestors(id) AS (SELECT ? UNION "
                "SELECT t.parent_task_id FROM tasks t JOIN ancestors a ON a.id = t.id "
                "WHERE t.parent_task_id IS NOT NULL) "
                "SELECT id FROM tasks WHERE parent_task_id IS NULL AND id NOT IN (SELECT id FROM ancestors) "
                "AND json_extract(props, ?) = json_extract(?, '$')", (hid, path, value)).fetchall()
            for r in rows:
                conn.execute("UPDATE tasks SET parent_task_id = ?, updated_at = ? WHERE id = ?", (hid, _now(), r["id"]))
            linked += len(rows)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return {"created": created, "reused": reused, "linked": linked}
