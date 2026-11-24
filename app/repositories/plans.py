"""Plan / Step storage and Excel import (P5-01). Re-import updates by (product, plan, step_key); nothing duplicates."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from typing import Any

from app import plan_import
from app.plan_import import MAX_PREVIEW, Parsed


class PlanError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _step(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["extra"] = json.loads(d["extra"] or "{}")
    d["stale"] = bool(d["stale"])
    return d


def list_plans(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT p.*, (SELECT count(*) FROM steps s WHERE s.plan_id = p.id AND s.stale = 0) AS step_count,"
        " (SELECT count(*) FROM steps s WHERE s.plan_id = p.id AND s.stale = 1) AS stale_count "
        "FROM plans p ORDER BY p.product COLLATE NOCASE, p.name COLLATE NOCASE").fetchall()
    return [dict(r) for r in rows]


def get_plan(conn: sqlite3.Connection, plan_id: int) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM plans WHERE id = ?", (plan_id,)).fetchone()
    if row is None:
        raise PlanError("Plan을 찾을 수 없어요.", 404)
    steps = [_step(r) for r in conn.execute("SELECT * FROM steps WHERE plan_id = ? ORDER BY seq, id", (plan_id,))]
    columns: list[str] = []
    for s in steps:
        for k in s["extra"]:
            if k not in columns:
                columns.append(k)
    return {"plan": dict(row), "steps": steps, "extra_columns": columns}


def delete_plan(conn: sqlite3.Connection, plan_id: int) -> None:
    if conn.execute("DELETE FROM plans WHERE id = ?", (plan_id,)).rowcount == 0:
        raise PlanError("Plan을 찾을 수 없어요.", 404)
    conn.commit()


def _existing(conn: sqlite3.Connection, pairs: set[tuple[str, str]]) -> dict[tuple[str, str], dict[str, dict[str, Any]]]:
    out: dict[tuple[str, str], dict[str, dict[str, Any]]] = {}
    for product, name in pairs:
        plan = conn.execute("SELECT id FROM plans WHERE product = ? AND name = ?", (product, name)).fetchone()
        if plan is None:
            continue
        out[(product, name)] = {r["step_key"]: _step(r) for r in
                                conn.execute("SELECT * FROM steps WHERE plan_id = ?", (plan["id"],))}
    return out


def preview(conn: sqlite3.Connection, parsed: Parsed) -> dict[str, Any]:
    pairs = {(r["product"], r["plan"]) for r in parsed.rows}
    result = plan_import.classify(parsed, _existing(conn, pairs))
    return result


def apply_import(conn: sqlite3.Connection, parsed: Parsed, result: dict[str, Any], file_name: str, source_path: str) -> None:
    """Write the classified rows in one transaction."""
    now = _now()
    try:
        conn.execute("BEGIN IMMEDIATE")
        plan_ids: dict[tuple[str, str], int] = {}
        seq: dict[tuple[str, str], int] = {}
        for rec in parsed.rows:
            pk = (rec["product"], rec["plan"])
            if pk not in plan_ids:
                row = conn.execute("SELECT id FROM plans WHERE product = ? AND name = ?", pk).fetchone()
                if row is None:
                    cur = conn.execute(
                        "INSERT INTO plans (product, name, source_file, source_path, sheet, imported_at) VALUES (?,?,?,?,?,?)",
                        (pk[0], pk[1], file_name, source_path, parsed.sheet, now))
                    plan_ids[pk] = int(cur.lastrowid)
                else:
                    plan_ids[pk] = int(row["id"])
                    conn.execute("UPDATE plans SET source_file = ?, source_path = ?, sheet = ?, imported_at = ? WHERE id = ?",
                                 (file_name, source_path, parsed.sheet, now, plan_ids[pk]))
            seq[pk] = seq.get(pk, 0) + 1
            values = (rec["step_code"], rec["name"], rec["area"], rec["tool_group"], rec["recipe"], rec["layer"],
                      rec["note"], json.dumps(rec["extra"], ensure_ascii=False))
            if rec["status"] == "new":
                conn.execute(
                    "INSERT INTO steps (plan_id, step_key, seq, step_code, name, area, tool_group, recipe, layer, note, extra, stale, updated_at)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?)", (plan_ids[pk], rec["key"], seq[pk], *values, now))
            else:  # update / same: keep order and revive a step that had gone missing earlier
                changed = 1 if rec["status"] == "update" else 0
                conn.execute(
                    "UPDATE steps SET seq = ?, step_code = ?, name = ?, area = ?, tool_group = ?, recipe = ?, layer = ?, note = ?,"
                    " extra = ?, stale = 0, updated_at = CASE WHEN ? THEN ? ELSE updated_at END WHERE id = ?",
                    (seq[pk], *values, changed, now, rec["step_id"]))
        for info in result["plans"]:
            pid = plan_ids.get((info["product"], info["plan"]))
            for key in info["missing_keys"]:
                conn.execute("UPDATE steps SET stale = 1 WHERE plan_id = ? AND step_key = ?", (pid, key))
        c = result["counts"]
        conn.execute("INSERT INTO plan_imports (file_name, sheet, at, created, updated, unchanged, errors, missing)"
                     " VALUES (?,?,?,?,?,?,?,?)",
                     (file_name, parsed.sheet, now, c["new"], c["update"], c["same"], c["error"], c["missing"]))
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


def last_imports(conn: sqlite3.Connection, limit: int = 5) -> list[dict[str, Any]]:
    return [dict(r) for r in conn.execute("SELECT * FROM plan_imports ORDER BY id DESC LIMIT ?", (limit,))]


def preview_payload(parsed: Parsed, result: dict[str, Any]) -> dict[str, Any]:
    rows = [{k: r[k] for k in ("row", "product", "plan", "step_code", "name", "area", "tool_group", "recipe",
                               "layer", "note", "extra", "status", "changes")} for r in parsed.rows[:MAX_PREVIEW]]
    for p in result["plans"]:
        p.pop("missing_keys", None)
    return {"sheet": parsed.sheet, "header_row": parsed.header_row, "headers": parsed.headers,
            "mapping": parsed.mapping, "extra_headers": parsed.extra_headers, "total_rows": parsed.total_rows,
            "can_apply": parsed.can_apply and bool(parsed.rows), "problem": parsed.problem,
            "counts": result["counts"], "plans": result["plans"], "rows": rows,
            "rows_truncated": len(parsed.rows) > MAX_PREVIEW, "errors": parsed.errors[:200]}
