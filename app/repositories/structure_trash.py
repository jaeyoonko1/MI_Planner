"""Soft delete + exact restore for the structure screen (V-004).

Deleting is never destructive: one operation = one `structure_trash` row holding a JSON snapshot (task rows, group
rows, prior sibling order, page / journal-line bookkeeping). Issue pages and leftover image folders go to
`vault/.trash/`; restoring moves them back. Deleting a group keeps its children by default (they move up in place of
the group); `children="delete"` deletes the whole subtree instead. Restore re-creates everything with the same ids.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from typing import Any, Callable

from app import journal_links, placement
from app.repositories import structure_free as sf
from app.repositories import tasks as tasks_repo
from app.repositories.tasks import TaskError
from app.vault import Vault, VaultError

MAX_ITEMS = 500
ROOT_KEY = "root"
_PAGE_TABLES = ("tasks", "evaluations")


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _key(parent: int | None) -> str:
    return ROOT_KEY if parent is None else str(parent)


def _unkey(key: str) -> int | None:
    return None if key == ROOT_KEY else int(key)


def _parse(data: Any) -> tuple[list[int], list[int], str]:
    if not isinstance(data, dict) or not isinstance(data.get("items"), list) or not data["items"]:
        raise TaskError("삭제할 대상을 고르세요.")
    if len(data["items"]) > MAX_ITEMS:
        raise TaskError(f"한 번에 {MAX_ITEMS}개까지만 지울 수 있어요.")
    children = data.get("children", "move_up")
    if children not in ("move_up", "delete"):
        raise TaskError("하위 항목 처리 방식이 올바르지 않습니다.")
    issues: list[int] = []
    groups: list[int] = []
    for it in data["items"]:
        kind, ident = (it.get("kind"), it.get("id")) if isinstance(it, dict) else (None, None)
        if kind not in ("issue", "group") or not isinstance(ident, int) or isinstance(ident, bool):
            raise TaskError("삭제할 대상이 올바르지 않습니다.")
        bucket = issues if kind == "issue" else groups
        if ident not in bucket:
            bucket.append(ident)
    return issues, groups, children


class _Plan:
    """What one delete request will touch. Pure reads."""

    def __init__(self, conn: sqlite3.Connection, vault: Vault, data: Any) -> None:
        issues, groups, self.children = _parse(data)
        sf.ensure(conn)
        self.nodes = sf.nodes_by_id(conn)
        for g in groups:
            if g not in self.nodes:
                raise TaskError("그룹을 찾을 수 없습니다.", 404)
        for t in issues:
            tasks_repo.get(conn, t)
        self.group_ids = set(groups)
        self.issue_ids = list(issues)
        if self.children == "delete":
            for g in groups:
                self.group_ids |= sf.subtree_ids(self.nodes, g)
            extra = [t for g in groups for t in sf.descendant_issues(conn, self.nodes, g)]
            self.issue_ids += [t for t in dict.fromkeys(extra) if t not in self.issue_ids]
        self.tasks = {t: tasks_repo.get(conn, t) for t in self.issue_ids}
        self.item_row = {r["task_id"]: dict(r) for r in conn.execute("SELECT * FROM structure_items")}
        self.pages: dict[int, str] = {}
        for t, task in self.tasks.items():
            found = placement.existing_page(vault, task)
            if found:
                self.pages[t] = found
        docs = journal_links._Docs(vault)  # noqa: SLF001 - same package family
        self.journal: dict[int, list[dict[str, Any]]] = {
            t: [{"day": d, "line": docs.lines(d)[i]} for d, i in docs.find(t)] for t in self.issue_ids
        }
        # direct kids that survive and have to move up
        self.moved: list[dict[str, Any]] = []
        for g in sorted(self.group_ids):
            for kind, ident in sf.siblings(conn, g):
                if kind == "group" and ident in self.group_ids:
                    continue
                if kind == "issue" and ident in self.tasks:
                    continue
                self.moved.append({"kind": kind, "id": ident, "from": g, "to": self.survivor(g)})
        marks = ",".join("?" * len(self.tasks))
        self.subtasks = [r["id"] for r in conn.execute(
            f"SELECT id FROM tasks WHERE parent_task_id IN ({marks})", list(self.tasks))
            if r["id"] not in self.tasks] if self.tasks else []

    def survivor(self, node_id: int | None) -> int | None:
        """Nearest ancestor-or-self of `node_id` that is not deleted (None = top level)."""
        seen: set[int] = set()
        while node_id is not None and node_id in self.group_ids and node_id not in seen:
            seen.add(node_id)
            node_id = self.nodes[node_id]["parent_id"]
        return node_id if node_id not in self.group_ids else None

    def impact(self) -> dict[str, Any]:
        labels = [self.nodes[g]["label"] for g in sorted(self.group_ids)]
        moving = self.children != "delete"
        return {
            "issues": len(self.issue_ids), "groups": len(self.group_ids), "children": self.children,
            "moved_up": len(self.moved) if moving else 0,
            "moved_groups": sum(m["kind"] == "group" for m in self.moved) if moving else 0,
            "pages": len(self.pages), "journal_lines": sum(len(v) for v in self.journal.values()),
            "subtasks": len(self.subtasks), "group_labels": labels[:5],
            "issue_titles": [self.tasks[t]["title"] for t in self.issue_ids[:5]],
            "needs_confirm": bool(self.pages or any(self.journal.values()) or self.subtasks
                                  or (self.group_ids and (self.moved or not moving))),
        }


def preview(conn: sqlite3.Connection, vault: Vault, data: Any) -> dict[str, Any]:
    return _Plan(conn, vault, data).impact()


def _summary(plan: _Plan) -> str:
    parts = []
    if plan.issue_ids:
        parts.append(f"이슈 {len(plan.issue_ids)}개")
    if plan.group_ids:
        parts.append(f"그룹 {len(plan.group_ids)}개")
    return " · ".join(parts)


def _new_order(entries: list[tuple[str, int]], plan: _Plan, before: dict[str, list], out: list) -> None:
    """Expand deleted groups into the children that replace them; drop deleted issues."""
    for kind, ident in entries:
        if kind == "group" and ident in plan.group_ids:
            _new_order([tuple(x) for x in before[_key(ident)]], plan, before, out)  # type: ignore[arg-type]
        elif kind == "issue" and ident in plan.tasks:
            continue
        else:
            out.append((kind, ident))


def delete(conn: sqlite3.Connection, vault: Vault, data: Any) -> dict[str, Any]:
    if conn.in_transaction:
        conn.commit()
    conn.execute("BEGIN IMMEDIATE")
    undo: list[Callable[[], None]] = []
    try:
        plan = _Plan(conn, vault, data)
        res = _apply_delete(conn, vault, plan, undo)
        conn.commit()
        return res
    except BaseException:
        conn.rollback()
        for fn in reversed(undo):
            try:
                fn()
            except Exception:  # noqa: BLE001 - best effort; the page stays in .trash/ either way
                pass
        raise


def _apply_delete(conn: sqlite3.Connection, vault: Vault, plan: _Plan, undo: list[Callable[[], None]]) -> dict[str, Any]:
    nodes = plan.nodes
    touched: set[int | None] = {None}
    for g in plan.group_ids:
        touched |= {g, nodes[g]["parent_id"]}
    for t in plan.tasks:
        touched.add((plan.item_row.get(t) or {}).get("node_id"))
    touched |= {m["to"] for m in plan.moved} | {m["from"] for m in plan.moved}
    touched = {p for p in touched if p is None or p in nodes}
    before = {_key(p): [list(x) for x in sf.siblings(conn, p)] for p in touched}
    paths = _page_rows(conn, plan)
    snap_tasks: list[dict[str, Any]] = []
    for t in plan.issue_ids:
        row = dict(conn.execute("SELECT * FROM tasks WHERE id = ?", (t,)).fetchone())
        orphans = [r["id"] for r in conn.execute("SELECT id FROM tasks WHERE parent_task_id = ?", (t,))
                   if r["id"] not in plan.tasks]
        snap_tasks.append({"row": row, "item": plan.item_row.get(t), "orphans": orphans, "page": None,
                           "files": None, "journal": plan.journal[t]})
    snap_groups = [{"row": {**nodes[g], "field_value": None if nodes[g]["field_value"] is None
                            else json.dumps(nodes[g]["field_value"], ensure_ascii=False)}}
                   for g in sorted(plan.group_ids)]
    # --- database ---
    for t in plan.issue_ids:
        conn.execute("DELETE FROM tasks WHERE id = ?", (t,))
    survivors = [p for p in touched if p not in plan.group_ids]
    for p in sorted(survivors, key=lambda x: -1 if x is None else x):
        out: list[tuple[str, int]] = []
        _new_order([tuple(x) for x in before[_key(p)]], plan, before, out)  # type: ignore[arg-type]
        sf.write_order(conn, p, out)
    for g in sorted(plan.group_ids):
        conn.execute("DELETE FROM structure_nodes WHERE id = ?", (g,))
    # --- vault: pages (shallow first), leftover image folders, journal links ---
    for t in sorted(plan.pages, key=lambda x: len(plan.pages[x])):
        rel = plan.pages[t]
        if not vault.exists(rel):  # nested inside another deleted issue's page: travels with it
            continue
        trashed = vault.delete(rel)
        undo.append(lambda a=trashed, b=rel: vault.restore_page(a, b))
        next(s for s in snap_tasks if s["row"]["id"] == t)["page"] = {"original": rel, "trashed": trashed}
    for s in snap_tasks:
        tid = s["row"]["id"]
        try:
            trashed = vault.trash_issue_files(tid)
        except OSError:
            trashed = None
        if trashed:
            s["files"] = trashed
            undo.append(lambda a=trashed, i=tid: vault.restore_issue_files(a, i))
    days: dict[str, str] = {}
    for t in plan.issue_ids:
        if plan.journal[t]:
            days.update(journal_links.after_task_change(vault, plan.tasks[t], None))
    for pg in {s["page"]["original"] for s in snap_tasks if s["page"]}:
        placement.unlink(conn, pg)
    payload = {"tasks": snap_tasks, "groups": snap_groups, "before": before,
               "moved": [] if plan.children == "delete" else plan.moved, "paths": paths}
    cur = conn.execute("INSERT INTO structure_trash (summary, payload, created_at) VALUES (?, ?, ?)",
                       (_summary(plan), json.dumps(payload, ensure_ascii=False), _now()))
    return {"trash_id": int(cur.lastrowid), "summary": _summary(plan), "issues": plan.issue_ids,
            "groups": sorted(plan.group_ids), "impact": plan.impact(), "journal_days": days,
            "free": sf.get_free(conn)}


def _page_rows(conn: sqlite3.Connection, plan: _Plan) -> list[dict[str, Any]]:
    """Cached page paths (tasks, evaluations) under the pages that are about to be trashed."""
    out: list[dict[str, Any]] = []
    for rel in plan.pages.values():
        for table in _PAGE_TABLES:
            for r in conn.execute(
                    f"SELECT id, page_path FROM {table} WHERE page_path = ? OR substr(page_path, 1, ?) = ?",
                    (rel, len(rel) + 1, rel + "/")):
                row = {"table": table, "id": r["id"], "path": r["page_path"]}
                if row not in out:
                    out.append(row)
    return out


# ---- restore -------------------------------------------------------------------------------
def _insert(conn: sqlite3.Connection, table: str, row: dict[str, Any], skip: tuple[str, ...] = ()) -> None:
    cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
    data = {k: v for k, v in row.items() if k in cols and k not in skip}
    conn.execute(f"INSERT INTO {table} ({', '.join(data)}) VALUES ({', '.join('?' * len(data))})", list(data.values()))


def list_trash(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    return [dict(r) for r in conn.execute(
        "SELECT id, summary, created_at, restored_at FROM structure_trash ORDER BY id DESC LIMIT 100")]


def restore(conn: sqlite3.Connection, vault: Vault, trash_id: int) -> dict[str, Any]:
    if conn.in_transaction:
        conn.commit()
    conn.execute("BEGIN IMMEDIATE")
    undo: list[Callable[[], None]] = []
    try:
        res = _apply_restore(conn, vault, trash_id, undo)
        conn.commit()
        return res
    except BaseException:
        conn.rollback()
        for fn in reversed(undo):
            try:
                fn()
            except Exception:  # noqa: BLE001
                pass
        raise


def _apply_restore(conn: sqlite3.Connection, vault: Vault, trash_id: int,
                   undo: list[Callable[[], None]]) -> dict[str, Any]:
    rec = conn.execute("SELECT * FROM structure_trash WHERE id = ?", (trash_id,)).fetchone()
    if rec is None:
        raise TaskError("되돌릴 삭제 기록을 찾을 수 없어요.", 404)
    if rec["restored_at"]:
        raise TaskError("이미 되돌린 삭제예요.", 409)
    p = json.loads(rec["payload"])
    sf.ensure(conn)
    ids = [s["row"]["id"] for s in p["tasks"]]
    if ids and conn.execute(f"SELECT 1 FROM tasks WHERE id IN ({','.join('?' * len(ids))})", ids).fetchone():
        raise TaskError("같은 번호의 이슈가 이미 있어 되돌릴 수 없어요.", 409)
    gids = [g["row"]["id"] for g in p["groups"]]
    if gids and conn.execute(f"SELECT 1 FROM structure_nodes WHERE id IN ({','.join('?' * len(gids))})", gids).fetchone():
        raise TaskError("같은 그룹이 이미 있어 되돌릴 수 없어요.", 409)
    by_id = {g["row"]["id"]: g["row"] for g in p["groups"]}
    done: set[int] = set()
    existing = set(sf.nodes_by_id(conn))

    def put(gid: int, depth: int = 0) -> None:  # parents first; a vanished parent falls back to the top level
        if gid in done or depth > len(by_id):
            return
        row = dict(by_id[gid])
        par = row.get("parent_id")
        if par in by_id:
            put(par, depth + 1)
        elif par not in existing:
            row["parent_id"] = None
        if par in by_id and par not in done:
            row["parent_id"] = None  # corrupt cycle in the snapshot
        _insert(conn, "structure_nodes", row)
        done.add(gid)

    for gid in by_id:
        put(gid)
    nodes_now = set(sf.nodes_by_id(conn))
    for s in p["tasks"]:
        _insert(conn, "tasks", s["row"], skip=("parent_task_id",))
    for s in p["tasks"]:
        tid, par = s["row"]["id"], s["row"].get("parent_task_id")
        if par is not None and conn.execute("SELECT 1 FROM tasks WHERE id = ?", (par,)).fetchone():
            conn.execute("UPDATE tasks SET parent_task_id = ? WHERE id = ?", (par, tid))
        for child in s["orphans"]:
            conn.execute("UPDATE tasks SET parent_task_id = ? WHERE id = ? AND parent_task_id IS NULL", (tid, child))
        item = s["item"]
        node = item["node_id"] if item and item["node_id"] in nodes_now else None
        conn.execute("INSERT INTO structure_items (task_id, node_id, position) VALUES (?, ?, ?) "
                     "ON CONFLICT(task_id) DO UPDATE SET node_id = excluded.node_id, position = excluded.position",
                     (tid, node, item["position"] if item else sf.UNPLACED))
    for m in p["moved"]:  # kids that moved up go back, unless someone moved them since
        src = m["from"]
        if src not in nodes_now:
            continue
        if m["kind"] == "group":
            r = conn.execute("SELECT parent_id FROM structure_nodes WHERE id = ?", (m["id"],)).fetchone()
            if r and r["parent_id"] == m["to"] and m["id"] != src:
                conn.execute("UPDATE structure_nodes SET parent_id = ? WHERE id = ?", (src, m["id"]))
        else:
            r = conn.execute("SELECT node_id FROM structure_items WHERE task_id = ?", (m["id"],)).fetchone()
            if r and r["node_id"] == m["to"]:
                conn.execute("UPDATE structure_items SET node_id = ? WHERE task_id = ?", (src, m["id"]))
    for key, rec_order in p["before"].items():  # exact sibling order, tolerant of later edits
        parent = _unkey(key)
        if parent is not None and parent not in nodes_now:
            continue
        cur = sf.siblings(conn, parent)
        want = [tuple(x) for x in rec_order]
        order = [x for x in want if x in set(cur)] + [x for x in cur if x not in set(want)]
        sf.write_order(conn, parent, order)  # type: ignore[arg-type]
    new_paths: dict[str, str] = {}
    for s in sorted((s for s in p["tasks"] if s["page"]), key=lambda s: len(s["page"]["original"])):
        pg = s["page"]
        try:
            new = vault.restore_page(pg["trashed"], pg["original"])
        except VaultError:
            continue  # the trash copy is gone: the issue returns without its page
        undo.append(lambda n=new: vault._move_to_trash(vault._dir(n)))  # noqa: SLF001
        new_paths[pg["original"]] = new
    for s in p["tasks"]:
        if s["files"]:
            try:
                vault.restore_issue_files(s["files"], s["row"]["id"])
            except VaultError:
                pass
    for pr in p["paths"]:
        conn.execute(f"UPDATE {pr['table']} SET page_path = ? WHERE id = ? AND (page_path IS NULL OR page_path = ?)",
                     (_remap(pr["path"], new_paths), pr["id"], pr["path"]))
    for s in p["tasks"]:
        if s["page"] and s["page"]["original"] not in new_paths:
            conn.execute("UPDATE tasks SET page_path = NULL WHERE id = ? AND page_path = ?",
                         (s["row"]["id"], s["page"]["original"]))
    days, skipped = _relink_journal(vault, p["tasks"])
    conn.execute("UPDATE structure_trash SET restored_at = ? WHERE id = ?", (_now(), trash_id))
    return {"trash_id": trash_id, "summary": rec["summary"], "issues": ids, "groups": gids,
            "journal_days": days, "journal_skipped": skipped, "free": sf.get_free(conn)}


def _remap(path: str | None, moved: dict[str, str]) -> str | None:
    if path is None:
        return None
    for old, new in moved.items():
        if path == old:
            return new
        if path.startswith(old + "/"):
            return new + path[len(old):]
    return path


def _relink_journal(vault: Vault, task_snaps: list[dict[str, Any]]) -> tuple[dict[str, str], int]:
    """Put the ` → 할일 #id` links back on the lines the delete unlinked, if those lines are still as left."""
    wanted = [(j["day"], j["line"]) for s in task_snaps for j in s["journal"]]
    if not wanted:
        return {}, 0
    docs = journal_links._Docs(vault)  # noqa: SLF001
    skipped = 0
    for day, original in wanted:
        lines = list(docs.lines(day))
        plain = journal_links.unlink(original)
        hit = next((i for i, raw in enumerate(lines) if raw == plain), None)
        if hit is None:
            skipped += 1
            continue
        lines[hit] = original
        docs.put(day, lines)
    return docs.flush(), skipped
