"""Free layout of the structure worksheet (P2B-08): groups nested under groups, issues placed in groups.
Positions live in structure_nodes / structure_items only; the vault page tree is never touched (D-27).
A group may be bound to a field value; placing an issue under it assigns that value (issue IDs never change)."""
from __future__ import annotations

import json
import sqlite3
from typing import Any

from app.repositories import structure as sv
from app.repositories import task_fields as tf
from app.repositories import tasks as tasks_repo
from app.repositories.tasks import TaskError

SEEDED = "structure_free_seeded"
UNPLACED = 1_000_000_000


def _node(r: sqlite3.Row) -> dict[str, Any]:
    d = dict(r)
    d["field_value"] = json.loads(d["field_value"]) if d["field_value"] is not None else None
    return d


def nodes_by_id(conn: sqlite3.Connection) -> dict[int, dict[str, Any]]:
    return {r["id"]: _node(r) for r in conn.execute("SELECT * FROM structure_nodes")}


def _seed(conn: sqlite3.Connection) -> None:
    """First entry: mirror the classification hierarchy as free groups, once. Later edits are kept."""
    fields = {f["key"]: f for f in tf.list_fields(conn)}
    stored = sv._stored(conn)  # noqa: SLF001 - same package
    wanted = (stored or {}).get("levels", sv.DEFAULT_LEVELS)
    keys = [k for k in wanted if k in fields and sv._usable(fields[k])]  # noqa: SLF001
    props = {r["id"]: json.loads(r["props"] or "{}") for r in conn.execute("SELECT id, props FROM tasks ORDER BY id")}

    def build(ids: list[int], depth: int, parent: int | None) -> None:
        if depth == len(keys):
            for pos, tid in enumerate(ids):
                conn.execute("INSERT INTO structure_items (task_id, node_id, position) VALUES (?, ?, ?)", (tid, parent, pos))
            return
        key = keys[depth]
        opts = fields[key]["options"]
        order = {o["value"]: i for i, o in enumerate(opts)}
        buckets: dict[Any, list[int]] = {}
        for tid in ids:
            buckets.setdefault(props[tid].get(key), []).append(tid)
        values = sorted(buckets, key=lambda v: (v is None, order.get(v, 10**6), str(v)))
        for pos, v in enumerate(values):
            label = next((o["label"] for o in opts if o["value"] == v), None) or ("미분류" if v is None else str(v))
            cur = conn.execute(
                "INSERT INTO structure_nodes (parent_id, label, field_key, field_value, position) VALUES (?, ?, ?, ?, ?)",
                (parent, label, key, json.dumps(v, ensure_ascii=False), pos))
            build(buckets[v], depth + 1, int(cur.lastrowid))

    build(list(props), 0, None)
    conn.execute("INSERT INTO settings (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = '1'", (SEEDED,))
    conn.commit()


def ensure(conn: sqlite3.Connection) -> None:
    if not conn.execute("SELECT 1 FROM settings WHERE key = ?", (SEEDED,)).fetchone():
        _seed(conn)


def get_free(conn: sqlite3.Connection) -> dict[str, Any]:
    ensure(conn)
    nodes = sorted(nodes_by_id(conn).values(), key=lambda n: (n["position"], n["id"]))
    rows = {r["task_id"]: r for r in conn.execute("SELECT * FROM structure_items")}
    items = []
    for r in conn.execute("SELECT id FROM tasks ORDER BY id"):
        row = rows.get(r["id"])
        items.append({"task_id": r["id"], "node_id": row["node_id"] if row else None,
                      "position": row["position"] if row else UNPLACED + r["id"]})
    items.sort(key=lambda i: (i["position"], i["task_id"]))
    return {"nodes": nodes, "items": items}


def siblings(conn: sqlite3.Connection, parent: int | None) -> list[tuple[str, int]]:
    """Children of one parent in display order as ('group'|'issue', id). Unplaced issues are root children."""
    out: list[tuple[int, str, int]] = []
    for r in conn.execute("SELECT id, position FROM structure_nodes WHERE parent_id IS ?", (parent,)):
        out.append((r["position"], "group", r["id"]))
    placed = {r["task_id"]: (r["node_id"], r["position"]) for r in conn.execute("SELECT * FROM structure_items")}
    for r in conn.execute("SELECT id FROM tasks"):
        node, pos = placed.get(r["id"], (None, UNPLACED + r["id"]))
        if node == parent:
            out.append((pos, "issue", r["id"]))
    out.sort(key=lambda x: (x[0], x[1] != "group", x[2]))
    return [(k, i) for _, k, i in out]


def write_order(conn: sqlite3.Connection, parent: int | None, order: list[tuple[str, int]]) -> None:
    for pos, (kind, ident) in enumerate(order):
        if kind == "group":
            conn.execute("UPDATE structure_nodes SET parent_id = ?, position = ? WHERE id = ?", (parent, pos, ident))
        else:
            conn.execute(
                "INSERT INTO structure_items (task_id, node_id, position) VALUES (?, ?, ?) "
                "ON CONFLICT(task_id) DO UPDATE SET node_id = excluded.node_id, position = excluded.position",
                (ident, parent, pos))


def ancestors(nodes: dict[int, dict[str, Any]], node_id: int | None) -> list[int]:
    """Node id first, root last."""
    chain: list[int] = []
    while node_id is not None and node_id in nodes and node_id not in chain:
        chain.append(node_id)
        node_id = nodes[node_id]["parent_id"]
    return chain


def subtree_ids(nodes: dict[int, dict[str, Any]], root: int) -> set[int]:
    ids = {root}
    grew = True
    while grew:
        grew = False
        for n in nodes.values():
            if n["parent_id"] in ids and n["id"] not in ids:
                ids.add(n["id"])
                grew = True
    return ids


def descendant_issues(conn: sqlite3.Connection, nodes: dict[int, dict[str, Any]], root: int) -> list[int]:
    ids = list(subtree_ids(nodes, root))
    marks = ", ".join("?" * len(ids))
    return [r["task_id"] for r in conn.execute(f"SELECT task_id FROM structure_items WHERE node_id IN ({marks})", ids)]


def assignments(nodes: dict[int, dict[str, Any]], node_id: int | None) -> dict[str, Any]:
    """Field values implied by sitting under node_id (outer groups first, inner groups win)."""
    out: dict[str, Any] = {}
    for nid in reversed(ancestors(nodes, node_id)):
        n = nodes[nid]
        if n["field_key"]:
            out[n["field_key"]] = n["field_value"]
    return out


def _apply(conn: sqlite3.Connection, task_ids: list[int], nodes: dict[int, dict[str, Any]]) -> list[int]:
    """Give each issue the field values of the group it now sits in. Returns ids whose values changed."""
    changed: list[int] = []
    for tid in task_ids:
        row = conn.execute("SELECT node_id FROM structure_items WHERE task_id = ?", (tid,)).fetchone()
        want = assignments(nodes, row["node_id"] if row else None)
        cur = tasks_repo.get(conn, tid)
        diff = {k: v for k, v in want.items() if cur["props"].get(k) != v}
        if diff:
            tasks_repo.update(conn, tid, {"props": diff})
            changed.append(tid)
    return changed


def move(conn: sqlite3.Connection, data: Any) -> dict[str, Any]:
    """Move a group (with its children) or an issue under `parent_id` (null = top level), before `before`
    ({kind, id}) or at the end. Groups cannot enter their own subtree."""
    if not isinstance(data, dict):
        raise TaskError("요청 형식이 올바르지 않습니다.")
    kind, ident, parent = data.get("kind"), data.get("id"), data.get("parent_id")
    if kind not in ("group", "issue") or not isinstance(ident, int):
        raise TaskError("이동할 대상이 올바르지 않습니다.")
    if parent is not None and not isinstance(parent, int):
        raise TaskError("대상 그룹이 올바르지 않습니다.")
    ensure(conn)
    nodes = nodes_by_id(conn)
    if kind == "group" and ident not in nodes:
        raise TaskError("그룹을 찾을 수 없습니다.", 404)
    if kind == "issue":
        tasks_repo.get(conn, ident)
    if parent is not None and parent not in nodes:
        raise TaskError("대상 그룹을 찾을 수 없습니다.", 404)
    if kind == "group" and parent is not None and ident in ancestors(nodes, parent):
        raise TaskError("그룹을 자기 하위로 옮길 수 없어요. 순환이 생겨요.")
    before = data.get("before")
    order = [s for s in siblings(conn, parent) if s != (kind, ident)]
    if before is not None:
        key = (before.get("kind"), before.get("id")) if isinstance(before, dict) else None
        if key not in order:
            raise TaskError("기준 위치가 대상 그룹 안에 없습니다.")
        order.insert(order.index(key), (kind, ident))
    else:
        order.append((kind, ident))
    old_parent = nodes[ident]["parent_id"] if kind == "group" else None
    write_order(conn, parent, order)
    if kind == "group" and old_parent != parent:
        write_order(conn, old_parent, siblings(conn, old_parent))
    conn.commit()
    nodes = nodes_by_id(conn)
    moved = descendant_issues(conn, nodes, ident) if kind == "group" else [ident]
    changed = _apply(conn, moved, nodes)
    return {"free": get_free(conn), "changed": changed}


def add_group(conn: sqlite3.Connection, data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise TaskError("요청 형식이 올바르지 않습니다.")
    label = str(data.get("label") or "").strip()
    if not label or len(label) > 50:
        raise TaskError("그룹 이름은 1~50자로 입력하세요.")
    parent = data.get("parent_id")
    ensure(conn)
    if parent is not None and parent not in nodes_by_id(conn):
        raise TaskError("대상 그룹을 찾을 수 없습니다.", 404)
    pos = len(siblings(conn, parent))
    conn.execute("INSERT INTO structure_nodes (parent_id, label, position) VALUES (?, ?, ?)", (parent, label, pos))
    conn.commit()
    return get_free(conn)
