"""Copy issues and groups (P2B-08). Every copy gets a NEW issue ID and shares nothing with its original
(status, memo, props are plain value copies). Not copied: planned_date (no duplicate journal plan), page link,
eval link. Issue copies keep the original's parent issue unless the parent is copied too."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from typing import Any

from app.repositories import structure_free as fr
from app.repositories import task_fields as tf
from app.repositories import tasks as tasks_repo
from app.repositories.tasks import TaskError

SUFFIX = " · 복사본"


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _clone_task(conn: sqlite3.Connection, src: dict[str, Any], title: str, override: dict[str, Any],
                parent_map: dict[int, int]) -> int:
    """INSERT one copy without committing (callers commit once, so a failed copy leaves nothing behind)."""
    props = {k: v for k, v in src["props"].items() if k != "planned_date"}
    props.update(override)
    parent = src["parent_task_id"]
    now = _now()
    cur = conn.execute(
        "INSERT INTO tasks (title, status, priority, requester, due_date, planned_date, parent_task_id, "
        "eval_id, page_path, note, mark, props, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?)",
        (title, src["status"], src["priority"], src["requester"], src["due_date"], parent_map.get(parent, parent),
         src["note"], src["mark"], json.dumps(props, ensure_ascii=False), now, now))
    return int(cur.lastrowid)


def _new_option(conn: sqlite3.Connection, key: str, label: str) -> dict[str, Any]:
    field = tf.get_field(conn, key)
    taken = {o["label"] for o in field["options"]}
    name, n = label + SUFFIX, 2
    while name in taken:
        name = f"{label}{SUFFIX} {n}"
        n += 1
    updated = tf.add_option(conn, key, {"label": name})
    return next(o for o in updated["options"] if o["label"] == name)


def _place_after(conn: sqlite3.Connection, pairs: list[tuple[int, int]]) -> None:
    """Free layout: put each copy right after its original (same group). No-op before the layout exists."""
    if not conn.execute("SELECT 1 FROM settings WHERE key = ?", (fr.SEEDED,)).fetchone():
        return
    for old, new in pairs:
        row = conn.execute("SELECT node_id FROM structure_items WHERE task_id = ?", (old,)).fetchone()
        parent = row["node_id"] if row else None
        order = [s for s in fr.siblings(conn, parent) if s != ("issue", new)]
        order.insert(order.index(("issue", old)) + 1 if ("issue", old) in order else len(order), ("issue", new))
        fr.write_order(conn, parent, order)


def _choice(conn: sqlite3.Connection, key: str, value: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    field = tf.get_field(conn, key)
    if field["type"] != "choice":
        raise TaskError("이 분류의 그룹은 복사할 수 없어요. (단일 선택 분류만 복사)")
    opt = next((o for o in field["options"] if o["value"] == value), None)
    if value is None or opt is None:
        raise TaskError("미분류 그룹은 복사할 수 없어요.")
    return field, opt


def copy_issue(conn: sqlite3.Connection, task_id: int) -> dict[str, Any]:
    src = tasks_repo.get(conn, task_id)
    new = _clone_task(conn, src, src["title"] + SUFFIX, {}, {})
    _place_after(conn, [(task_id, new)])
    conn.commit()
    return {"created": [new], "map": {str(task_id): new}}


def copy_group(conn: sqlite3.Connection, key: str, value: Any, task_ids: list[int]) -> dict[str, Any]:
    """Classification view. A new option is created for the copy; the copies are filed under it.
    Epic copies take every issue of that epic, whichever branch (type...) it sits in."""
    _field, opt = _choice(conn, key, value)
    if key == "epic":
        ids = [r["id"] for r in conn.execute(
            "SELECT id FROM tasks WHERE json_extract(props, ?) IS ? ORDER BY id", (f'$."{key}"', value))]
    else:
        ids = []
        for tid in task_ids:
            if tasks_repo.get(conn, tid)["props"].get(key) != value:
                raise TaskError("이 그룹에 속하지 않은 이슈가 있어요.")
            ids.append(tid)
    new_opt = _new_option(conn, key, opt["label"])
    parent_map: dict[int, int] = {}
    pairs: list[tuple[int, int]] = []
    for tid in ids:
        src = tasks_repo.get(conn, tid)
        new = _clone_task(conn, src, src["title"], {key: new_opt["value"]}, parent_map)
        parent_map[tid] = new
        pairs.append((tid, new))
    _place_after(conn, pairs)
    conn.commit()
    return {"created": [n for _, n in pairs], "map": {str(o): n for o, n in pairs}, "option": new_opt}


def copy_node(conn: sqlite3.Connection, node_id: int) -> dict[str, Any]:
    """Free layout: copy the selected group and everything below it (sub-groups and their issues)."""
    fr.ensure(conn)
    nodes = fr.nodes_by_id(conn)
    root = nodes.get(node_id)
    if root is None:
        raise TaskError("그룹을 찾을 수 없습니다.", 404)
    label, override = root["label"] + SUFFIX, {}
    bind_key, bind_val = root["field_key"], root["field_value"]
    if bind_key and bind_val is not None and tf.get_field(conn, bind_key)["type"] == "choice":
        opt = next((o for o in tf.get_field(conn, bind_key)["options"] if o["value"] == bind_val), None)
        if opt is not None:
            new_opt = _new_option(conn, bind_key, opt["label"])
            label, bind_val, override = new_opt["label"], new_opt["value"], {bind_key: new_opt["value"]}
    ids = fr.subtree_ids(nodes, node_id)
    node_map: dict[int, int] = {}
    pairs: list[tuple[int, int]] = []
    marks = ", ".join("?" * len(ids))
    parent_map = {r["task_id"]: 0 for r in conn.execute(f"SELECT task_id FROM structure_items WHERE node_id IN ({marks})", list(ids))}
    for nid in sorted(ids, key=lambda i: (len(fr.ancestors(nodes, i)), i)):  # parents before children
        n = nodes[nid]
        is_root = nid == node_id
        cur = conn.execute(
            "INSERT INTO structure_nodes (parent_id, label, field_key, field_value, position) VALUES (?, ?, ?, ?, ?)",
            (node_map.get(n["parent_id"]) if not is_root else n["parent_id"], label if is_root else n["label"], n["field_key"],
             json.dumps(bind_val if is_root else n["field_value"], ensure_ascii=False) if n["field_key"] else None,
             n["position"]))
        node_map[nid] = int(cur.lastrowid)
        for it in conn.execute("SELECT task_id, position FROM structure_items WHERE node_id = ? ORDER BY position", (nid,)).fetchall():
            src = tasks_repo.get(conn, it["task_id"])
            new = _clone_task(conn, src, src["title"], override, {})
            parent_map[it["task_id"]] = new
            pairs.append((it["task_id"], new))
            conn.execute("INSERT INTO structure_items (task_id, node_id, position) VALUES (?, ?, ?)",
                         (new, node_map[nid], it["position"]))
    for old, new in pairs:  # sub-issues whose parent was copied too keep pointing inside the copy
        p = tasks_repo.get(conn, old)["parent_task_id"]
        if p in parent_map and parent_map[p]:
            conn.execute("UPDATE tasks SET parent_task_id = ? WHERE id = ?", (parent_map[p], new))
    order = [s for s in fr.siblings(conn, root["parent_id"]) if s != ("group", node_map[node_id])]
    order.insert(order.index(("group", node_id)) + 1, ("group", node_map[node_id]))
    fr.write_order(conn, root["parent_id"], order)
    conn.commit()
    return {"created": [n for _, n in pairs], "map": {str(o): n for o, n in pairs},
            "node_id": node_map[node_id], "free": fr.get_free(conn)}


def copy(conn: sqlite3.Connection, data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise TaskError("요청 형식이 올바르지 않습니다.")
    kind = data.get("kind")
    try:
        if kind == "issue" and isinstance(data.get("task_id"), int):
            return copy_issue(conn, data["task_id"])
        if kind == "group" and isinstance(data.get("field_key"), str):
            ids = data.get("task_ids") or []
            if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
                raise TaskError("task_ids 형식이 올바르지 않습니다.")
            return copy_group(conn, data["field_key"], data.get("value"), ids)
        if kind == "node" and isinstance(data.get("node_id"), int):
            return copy_node(conn, data["node_id"])
    except Exception:
        conn.rollback()
        raise
    raise TaskError("복사할 대상이 올바르지 않습니다.")
