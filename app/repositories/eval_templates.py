from __future__ import annotations

import json
import sqlite3
from typing import Any


class TemplateError(Exception):
    def __init__(self, message: str, status: int) -> None:
        super().__init__(message)
        self.status = status


def _decode(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "is_master": bool(row["is_master"]),
        "stages": json.loads(row["stages"]),
        "fields": json.loads(row["fields"]),
    }


def list_templates(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM eval_templates ORDER BY is_master DESC, name COLLATE NOCASE, id"
    )
    return [_decode(row) for row in rows]


def get_template(conn: sqlite3.Connection, template_id: int) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM eval_templates WHERE id = ?", (template_id,)
    ).fetchone()
    if row is None:
        raise TemplateError("평가 템플릿을 찾을 수 없습니다.", 404)
    return _decode(row)


def _parameters(template: dict[str, Any]) -> tuple:
    return (
        template["name"],
        template["is_master"],
        json.dumps(template["stages"], ensure_ascii=False),
        json.dumps(template["fields"], ensure_ascii=False),
    )


def create_template(conn: sqlite3.Connection, template: dict[str, Any]) -> dict[str, Any]:
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        if template["is_master"]:
            conn.execute("UPDATE eval_templates SET is_master = 0 WHERE is_master = 1")
        cursor = conn.execute(
            "INSERT INTO eval_templates (name, is_master, stages, fields) VALUES (?, ?, ?, ?)",
            _parameters(template),
        )
        return get_template(conn, cursor.lastrowid)


def update_template(
    conn: sqlite3.Connection, template_id: int, changes: dict[str, Any]
) -> dict[str, Any]:
    if not changes:
        return get_template(conn, template_id)
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        previous = get_template(conn, template_id)
        template = {**previous, **changes}
        if previous["is_master"] and not template["is_master"]:
            raise TemplateError("다른 템플릿을 마스터로 지정해 주세요.", 409)
        if template["is_master"] and not previous["is_master"]:
            conn.execute("UPDATE eval_templates SET is_master = 0 WHERE is_master = 1")
        conn.execute(
            "UPDATE eval_templates SET name = ?, is_master = ?, stages = ?, fields = ? WHERE id = ?",
            (*_parameters(template), template_id),
        )
        return get_template(conn, template_id)


def delete_template(conn: sqlite3.Connection, template_id: int) -> None:
    """Evaluations keep their own stage copy, so deleting a template never touches them (D-30)."""
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        if get_template(conn, template_id)["is_master"]:
            raise TemplateError("마스터 템플릿은 지울 수 없어요. 다른 템플릿을 마스터로 지정한 뒤 지워 주세요.", 409)
        conn.execute("DELETE FROM eval_templates WHERE id = ?", (template_id,))


def stage_usage(conn: sqlite3.Connection, template_id: int) -> dict[str, Any]:
    """Per stage key of the template: how many evaluations carry a stage with that key and how many
    (non-excluded) cells sit in it now. Evaluations are copies keyed by stage key, not linked rows."""
    template = get_template(conn, template_id)
    counts = {s["key"]: {"evaluations": 0, "cells": 0} for s in template["stages"]}
    evaluations = conn.execute("SELECT id, stages FROM evaluations").fetchall()
    for row in evaluations:
        keys = {s["key"] for s in json.loads(row["stages"])} & counts.keys()
        for key in keys:
            counts[key]["evaluations"] += 1
    for row in conn.execute(
        "SELECT stage_key, count(*) AS n FROM eval_cells WHERE excluded = 0 AND stage_key IS NOT NULL GROUP BY stage_key"
    ):
        if row["stage_key"] in counts:
            counts[row["stage_key"]]["cells"] += row["n"]
    return {"template_id": template_id, "evaluation_count": len(evaluations), "stages": counts}


def from_evaluation(conn: sqlite3.Connection, evaluation_id: int, name: str, is_master: bool) -> dict[str, Any]:
    """Save an evaluation's own stage/field copy as a new template, optionally as the new master."""
    row = conn.execute("SELECT stages, fields FROM evaluations WHERE id = ?", (evaluation_id,)).fetchone()
    if row is None:
        raise TemplateError("평가를 찾을 수 없습니다.", 404)
    return create_template(conn, {
        "name": name, "is_master": is_master, "stages": json.loads(row["stages"]), "fields": json.loads(row["fields"])})
