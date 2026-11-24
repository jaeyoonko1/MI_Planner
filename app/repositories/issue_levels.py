"""Issue levels (V-011, D-48): Jira-style kinds of issue such as 에픽 above the plain 이슈.

An upper-level item is an ordinary row in `tasks` with `level_id`; the hierarchy itself is `tasks.parent_task_id`.
Leaf issues have no level (rank 0). A child may never sit above its parent: rank(child) <= rank(parent).
Deleting a level never deletes issues: they move to the next lower level, and the operation is a
`structure_trash` record so Ctrl+Z restores it exactly.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from typing import Any

from app.repositories.tasks import TaskError

ICONS = ("layers", "grid", "box", "person", "flag", "ring")
COLORS = ("violet", "mint", "blue", "peach", "pink", "yellow")
LEAF_LABEL = "이슈"
MAX_LEVELS = 6


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _row(r: sqlite3.Row, used: dict[int, int]) -> dict[str, Any]:
    d = dict(r)
    d["used_by"] = used.get(d["id"], 0)
    return d


def list_levels(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Upper levels, top first. The leaf "이슈" is implicit (level_id NULL)."""
    used = {r["level_id"]: r["n"] for r in conn.execute(
        "SELECT level_id, COUNT(*) n FROM tasks WHERE level_id IS NOT NULL GROUP BY level_id")}
    return [_row(r, used) for r in conn.execute("SELECT * FROM issue_levels ORDER BY rank DESC, id")]


def get_level(conn: sqlite3.Connection, level_id: int) -> dict[str, Any]:
    r = conn.execute("SELECT * FROM issue_levels WHERE id = ?", (level_id,)).fetchone()
    if r is None:
        raise TaskError("이슈 수준을 찾을 수 없어요.", 404)
    return dict(r)


def rank_of(conn: sqlite3.Connection, level_id: int | None) -> int:
    if level_id is None:
        return 0
    r = conn.execute("SELECT rank FROM issue_levels WHERE id = ?", (level_id,)).fetchone()
    return int(r["rank"]) if r else 0


def label_of(conn: sqlite3.Connection, level_id: int | None) -> str:
    if level_id is None:
        return LEAF_LABEL
    r = conn.execute("SELECT label FROM issue_levels WHERE id = ?", (level_id,)).fetchone()
    return r["label"] if r else LEAF_LABEL


# ---- the one hierarchy rule ------------------------------------------------------------------
def check_placement(conn: sqlite3.Connection, task_id: int | None, level_id: Any, parent_id: int | None) -> None:
    """A child's level may not be above its parent's; an issue's own children may not be above it."""
    if level_id is not None:
        if isinstance(level_id, bool) or not isinstance(level_id, int):
            raise TaskError("이슈 수준이 올바르지 않아요.")
        get_level(conn, level_id)
    mine = rank_of(conn, level_id)
    if parent_id is not None:
        p = conn.execute("SELECT level_id FROM tasks WHERE id = ?", (parent_id,)).fetchone()
        if p is not None and rank_of(conn, p["level_id"]) < mine:
            raise TaskError(
                f"'{label_of(conn, level_id)}'은(는) '{label_of(conn, p['level_id'])}' 아래에 둘 수 없어요. "
                "상위 이슈는 같거나 더 높은 수준이어야 해요.")
    if task_id is not None:
        for c in conn.execute("SELECT level_id FROM tasks WHERE parent_task_id = ?", (task_id,)):
            if rank_of(conn, c["level_id"]) > mine:
                raise TaskError(
                    f"하위에 '{label_of(conn, c['level_id'])}' 이슈가 있어 '{label_of(conn, level_id)}'(으)로 바꿀 수 없어요.")


def violations(conn: sqlite3.Connection) -> int:
    """How many parent links break the rank rule (used to refuse a reorder)."""
    return conn.execute(
        "SELECT COUNT(*) FROM tasks c JOIN tasks p ON c.parent_task_id = p.id "
        "LEFT JOIN issue_levels lc ON lc.id = c.level_id LEFT JOIN issue_levels lp ON lp.id = p.level_id "
        "WHERE COALESCE(lc.rank, 0) > COALESCE(lp.rank, 0)").fetchone()[0]


# ---- definitions --------------------------------------------------------------------------
def _clean_label(conn: sqlite3.Connection, label: Any, skip: int | None = None) -> str:
    text = str(label or "").strip()
    if not text or len(text) > 30:
        raise TaskError("수준 이름은 1~30자로 입력하세요.")
    taken = {r["label"].casefold() for r in conn.execute("SELECT id, label FROM issue_levels") if r["id"] != skip}
    if text.casefold() in taken or text.casefold() == LEAF_LABEL:
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
        conn.execute("UPDATE issue_levels SET rank = ?, updated_at = ? WHERE id = ?", (n - i, _now(), lid))


def _ids(conn: sqlite3.Connection) -> list[int]:
    return [r["id"] for r in conn.execute("SELECT id FROM issue_levels ORDER BY rank DESC, id")]


def create_level(conn: sqlite3.Connection, data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise TaskError("요청 형식이 올바르지 않아요.")
    ids = _ids(conn)
    if len(ids) >= MAX_LEVELS:
        raise TaskError(f"이슈 수준은 {MAX_LEVELS}개까지 둘 수 있어요.")
    label = _clean_label(conn, data.get("label"))
    slot = len(ids) % len(ICONS)
    icon = _style(data, "icon", ICONS, ICONS[(slot + 1) % len(ICONS)])
    color = _style(data, "color", COLORS, COLORS[(slot + 1) % len(COLORS)])
    index = data.get("index", len(ids))  # 0 = top; default = just above the plain issue
    if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index <= len(ids):
        raise TaskError("수준 위치가 올바르지 않아요.")
    now = _now()
    cur = conn.execute("INSERT INTO issue_levels (label, rank, icon, color, created_at, updated_at) "
                       "VALUES (?, 0, ?, ?, ?, ?)", (label, icon, color, now, now))
    new_id = int(cur.lastrowid)
    ids.insert(index, new_id)
    _renumber(conn, ids)  # inserting never changes the relative order of existing levels
    conn.commit()
    return get_level(conn, new_id)


def update_level(conn: sqlite3.Connection, level_id: int, data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise TaskError("요청 형식이 올바르지 않아요.")
    cur = get_level(conn, level_id)
    sets: dict[str, Any] = {}
    if "label" in data:
        sets["label"] = _clean_label(conn, data["label"], skip=level_id)
    if "icon" in data:
        sets["icon"] = _style(data, "icon", ICONS, cur["icon"])
    if "color" in data:
        sets["color"] = _style(data, "color", COLORS, cur["color"])
    if sets:
        cols = ", ".join(f"{k} = ?" for k in sets)
        conn.execute(f"UPDATE issue_levels SET {cols}, updated_at = ? WHERE id = ?", [*sets.values(), _now(), level_id])
        conn.commit()
    return get_level(conn, level_id)


def reorder(conn: sqlite3.Connection, ids: Any) -> list[dict[str, Any]]:
    if not isinstance(ids, list) or sorted(ids) != sorted(_ids(conn)):
        raise TaskError("모든 수준을 한 번씩 보내야 해요.")
    _renumber(conn, ids)
    bad = violations(conn)
    if bad:
        conn.rollback()
        raise TaskError(f"이 순서로 바꾸면 이슈 {bad}개가 더 낮은 수준의 이슈 아래에 놓여요. 먼저 상위를 바꾸세요.", 409)
    conn.commit()
    return list_levels(conn)


# ---- delete (restorable) ----------------------------------------------------------------------
def delete_level(conn: sqlite3.Connection, level_id: int) -> dict[str, Any]:
    """Issues of this level move to the next lower level (or become plain issues). One trash record."""
    level = get_level(conn, level_id)
    order = _ids(conn)
    below = order[order.index(level_id) + 1] if order.index(level_id) + 1 < len(order) else None
    moved = [r["id"] for r in conn.execute("SELECT id FROM tasks WHERE level_id = ?", (level_id,))]
    if conn.in_transaction:
        conn.commit()
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("UPDATE tasks SET level_id = ? WHERE level_id = ?", (below, level_id))
        conn.execute("DELETE FROM issue_levels WHERE id = ?", (level_id,))
        _renumber(conn, [i for i in order if i != level_id])
        payload = {"kind": "level", "level": level, "order": order, "tasks": moved, "to": below}
        summary = f"수준 '{level['label']}'"
        cur = conn.execute("INSERT INTO structure_trash (summary, payload, created_at) VALUES (?, ?, ?)",
                           (summary, json.dumps(payload, ensure_ascii=False), _now()))
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return {"trash_id": int(cur.lastrowid), "summary": summary, "moved": len(moved),
            "to": label_of(conn, below), "issues": [], "groups": [], "journal_days": {}}


def restore_level(conn: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
    """Inside the caller's transaction: same id, same place in the order, same issues (unless changed since)."""
    level = payload["level"]
    if conn.execute("SELECT 1 FROM issue_levels WHERE id = ?", (level["id"],)).fetchone():
        raise TaskError("같은 번호의 수준이 이미 있어 되돌릴 수 없어요.", 409)
    conn.execute("INSERT INTO issue_levels (id, label, rank, icon, color, created_at, updated_at) "
                 "VALUES (?, ?, 0, ?, ?, ?, ?)",
                 (level["id"], level["label"], level["icon"], level["color"], level["created_at"], _now()))
    current = _ids(conn)
    want = [i for i in payload["order"] if i in current]
    order = want + [i for i in current if i not in want]
    _renumber(conn, order)
    to = payload.get("to")
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
    get_level(conn, level_id)
    target = rank_of(conn, level_id)
    path = f'$."{field["key"]}"'
    created: list[int] = []
    reused: list[int] = []
    linked = 0
    if conn.in_transaction:
        conn.commit()
    conn.execute("BEGIN IMMEDIATE")
    try:
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
                "SELECT t.id FROM tasks t LEFT JOIN issue_levels l ON l.id = t.level_id "
                "WHERE t.parent_task_id IS NULL AND t.id != ? AND json_extract(t.props, ?) = json_extract(?, '$') "
                "AND COALESCE(l.rank, 0) <= ?", (hid, path, value, target)).fetchall()
            for r in rows:
                conn.execute("UPDATE tasks SET parent_task_id = ?, updated_at = ? WHERE id = ?", (hid, _now(), r["id"]))
            linked += len(rows)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return {"created": created, "reused": reused, "linked": linked}
