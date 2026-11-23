"""Persist evaluation snapshots and their board pages."""
from __future__ import annotations

import hashlib
import json
import sqlite3
from itertools import product
from typing import Any

from app.repositories.eval_templates import get_template
from app.vault import Vault, VaultError

BOARD_PARENT = "MI 공정업무/설비사 평가"


class EvaluationError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


_SUMMARY = """
SELECT e.id, e.name, e.page_path, e.stages, e.fields, e.status, e.start_date, e.due_date,
       (SELECT count(*) FROM eval_equipment WHERE evaluation_id = e.id) AS equipment_count,
       (SELECT count(*) FROM eval_lots WHERE evaluation_id = e.id) AS lot_count,
       (SELECT count(*) FROM eval_wafers WHERE evaluation_id = e.id) AS wafer_count,
       (SELECT count(*) FROM eval_cells WHERE evaluation_id = e.id AND excluded = 0) AS cell_count,
       (SELECT count(*) FROM eval_cells WHERE evaluation_id = e.id AND excluded = 1) AS excluded_count
FROM evaluations e
"""


def _summary(row: sqlite3.Row) -> dict[str, Any]:
    return {**dict(row), "stages": json.loads(row["stages"]), "fields": json.loads(row["fields"])}


def get_evaluation(conn: sqlite3.Connection, evaluation_id: int) -> dict[str, Any]:
    row = conn.execute(f"{_SUMMARY} WHERE e.id = ?", (evaluation_id,)).fetchone()
    if row is None:
        raise EvaluationError("평가를 찾을 수 없습니다.", 404)
    return _summary(row)


def list_evaluations(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    return [_summary(row) for row in conn.execute(f"{_SUMMARY} ORDER BY e.id DESC")]


def _write_matrix(conn: sqlite3.Connection, evaluation_id: int, data: dict[str, Any]) -> None:
    equipment = {}
    for order, entry in enumerate(data["equipment"]):
        equipment[entry["name"]] = conn.execute(
            "INSERT INTO eval_equipment (evaluation_id, name, vendor, sort) VALUES (?, ?, ?, ?)",
            (evaluation_id, entry["name"], entry["vendor"], order),
        ).lastrowid

    wafers = {}
    for order, entry in enumerate(data["lots"]):
        lot_no = entry["lot_no"]
        lot_id = conn.execute(
            "INSERT INTO eval_lots (evaluation_id, lot_no, sort) VALUES (?, ?, ?)",
            (evaluation_id, lot_no, order),
        ).lastrowid
        for sort, wafer_no in enumerate(entry["wafers"]):
            wafers[(lot_no, wafer_no)] = conn.execute(
                "INSERT INTO eval_wafers (evaluation_id, lot_id, wafer_no, sort) VALUES (?, ?, ?, ?)",
                (evaluation_id, lot_id, wafer_no, sort),
            ).lastrowid

    excluded = {(item["equipment"], item["lot_no"], item["wafer_no"]) for item in data["excluded"]}
    conn.executemany(
        "INSERT INTO eval_cells (evaluation_id, equipment_id, wafer_id, excluded) VALUES (?, ?, ?, ?)",
        (
            (evaluation_id, equipment_id, wafer_id, int((name, lot, wafer) in excluded))
            for (name, equipment_id), ((lot, wafer), wafer_id) in product(equipment.items(), wafers.items())
        ),
    )


def _fingerprint(data: dict[str, Any]) -> str:
    payload = {key: value for key, value in data.items() if key != "request_id"}
    payload["excluded"] = sorted(payload["excluded"], key=lambda e: (e["equipment"], e["lot_no"], e["wafer_no"]))
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _parent(vault: Vault, explicit: str | None) -> str:
    if explicit is not None:
        return explicit
    if vault.exists(BOARD_PARENT):
        return BOARD_PARENT
    root = BOARD_PARENT.partition("/")[0]
    return root if vault.exists(root) else ""


def create_evaluation(conn: sqlite3.Connection, vault: Vault, data: dict[str, Any]) -> dict[str, Any]:
    """Build a snapshot and matrix before creating the page. Compensate on recoverable DB failure."""
    board_path = None
    request_id = data["request_id"]
    fingerprint = _fingerprint(data) if request_id else None
    try:
        with conn:
            conn.execute("BEGIN IMMEDIATE")
            if request_id:
                prior = conn.execute(
                    "SELECT id, request_fingerprint FROM evaluations WHERE request_id = ?", (request_id,)
                ).fetchone()
                if prior is not None:
                    if prior["request_fingerprint"] != fingerprint:
                        raise EvaluationError("같은 생성 요청 번호에 다른 내용이 들어 있어요.", 409)
                    return {"created": False, "evaluation": get_evaluation(conn, prior["id"])}

            template = get_template(conn, data["template_id"])
            evaluation_id = conn.execute(
                "INSERT INTO evaluations (name, stages, fields, request_id, request_fingerprint) "
                "VALUES (?, ?, ?, ?, ?)",
                (data["name"], json.dumps(template["stages"], ensure_ascii=False),
                 json.dumps(template["fields"], ensure_ascii=False), request_id, fingerprint),
            ).lastrowid
            _write_matrix(conn, evaluation_id, data)
            page = vault.create(_parent(vault, data["parent"]), data["name"], "board", extra_meta={"eval_id": evaluation_id})
            board_path = page["path"]
            conn.execute("UPDATE evaluations SET page_path = ? WHERE id = ?", (board_path, evaluation_id))
            return {"created": True, "evaluation": get_evaluation(conn, evaluation_id)}
    except Exception as error:
        if board_path is not None and vault.exists(board_path):
            try:
                vault.delete(board_path, expected_meta={"type": "board", "eval_id": evaluation_id})
            except (OSError, VaultError) as cleanup_error:
                error.add_note(f"Could not move the evaluation page to trash: {cleanup_error}")
        raise


def get_board(conn: sqlite3.Connection, evaluation_id: int) -> dict[str, Any]:
    """Return one evaluation with compact ID-keyed rows for the board screen (P4-04).

    `at` is the latest stage entry time read from eval_stage_log (D-09); it is never stored on the cell.
    """
    evaluation = get_evaluation(conn, evaluation_id)
    equipment = [dict(row) for row in conn.execute(
        "SELECT id, name, vendor FROM eval_equipment WHERE evaluation_id = ? ORDER BY sort, id", (evaluation_id,))]
    wafers_by_lot: dict[int, list[dict[str, Any]]] = {}
    for row in conn.execute(
        "SELECT id, lot_id, wafer_no FROM eval_wafers WHERE evaluation_id = ? ORDER BY sort, id", (evaluation_id,)
    ):
        wafers_by_lot.setdefault(row["lot_id"], []).append({"id": row["id"], "wafer_no": row["wafer_no"]})
    lots = [
        {"id": row["id"], "lot_no": row["lot_no"], "wafers": wafers_by_lot.get(row["id"], [])}
        for row in conn.execute(
            "SELECT id, lot_no FROM eval_lots WHERE evaluation_id = ? ORDER BY sort, id", (evaluation_id,))
    ]
    cells = [
        {"id": row["id"], "equipment_id": row["equipment_id"], "wafer_id": row["wafer_id"],
         "stage_key": row["stage_key"], "excluded": bool(row["excluded"]), "values": json.loads(row["field_values"]),
         "note": row["note"], "at": row["at"]}
        for row in conn.execute(
            """SELECT c.id, c.equipment_id, c.wafer_id, c.stage_key, c.excluded, c.field_values, c.note,
                      (SELECT l.at FROM eval_stage_log l WHERE l.cell_id = c.id
                       ORDER BY l.at DESC, l.id DESC LIMIT 1) AS at
               FROM eval_cells c WHERE c.evaluation_id = ? ORDER BY c.id""", (evaluation_id,))
    ]
    return {"evaluation": evaluation, "equipment": equipment, "lots": lots, "cells": cells}
