"""Persist evaluation snapshots and their board pages."""
from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Iterator
from datetime import datetime, timedelta
from itertools import product
from typing import Any

from app import eval_wait
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


def get_board(
    conn: sqlite3.Connection, evaluation_id: int, now: datetime | None = None,
) -> dict[str, Any]:
    """Return one evaluation with compact ID-keyed rows for the board screen (P4-04).

    `at` is the latest stage entry time read from eval_stage_log (D-09); it is never stored on the cell.
    `wait_h` / `warn` (P4-06) are computed here from `at` and `now`, also never stored.
    """
    now = now or eval_wait.now_seoul()
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
    rows = conn.execute(
        """SELECT c.id, c.equipment_id, c.wafer_id, c.stage_key, c.excluded, c.field_values, c.note,
                  (SELECT l.at FROM eval_stage_log l WHERE l.cell_id = c.id
                   ORDER BY l.at DESC, l.id DESC LIMIT 1) AS at,
                  (SELECT l.to_stage FROM eval_stage_log l WHERE l.cell_id = c.id
                   ORDER BY l.at DESC, l.id DESC LIMIT 1) AS at_stage
           FROM eval_cells c WHERE c.evaluation_id = ? ORDER BY c.id""", (evaluation_id,)).fetchall()
    cells = [
        {"id": row["id"], "equipment_id": row["equipment_id"], "wafer_id": row["wafer_id"],
         "stage_key": row["stage_key"], "excluded": bool(row["excluded"]), "values": json.loads(row["field_values"]),
         "note": row["note"], "at": row["at"]}
        for row in rows
    ]
    for cell, row in zip(cells, rows):
        cell["wait_h"], cell["warn"] = eval_wait.cell_wait(cell, evaluation["stages"], row["at"], row["at_stage"], now)
    return {"evaluation": evaluation, "equipment": equipment, "lots": lots, "cells": cells,
            "now": now.isoformat(timespec="seconds")}


def stalled_cells(
    conn: sqlite3.Connection, limit: int = 8, now: datetime | None = None,
) -> dict[str, Any]:
    """Cells over their stage's warn_hours across active evaluations, longest wait first (P4-08, D-09).

    `total` counts every warned cell; `items` holds at most `limit`. Nothing is stored: the same
    `get_board` rules (P4-06) run per evaluation.
    """
    now = now or eval_wait.now_seoul()
    found: list[dict[str, Any]] = []
    for row in conn.execute("SELECT id FROM evaluations WHERE status = 'active' ORDER BY id"):
        board = get_board(conn, row["id"], now)
        warned = [c for c in board["cells"] if c["warn"] and c["wait_h"] is not None]
        if not warned:
            continue
        evaluation = board["evaluation"]
        stages = {stage["key"]: stage for stage in evaluation["stages"]}
        names = {e["id"]: e["name"] for e in board["equipment"]}
        wafers = {w["id"]: (lot["lot_no"], w["wafer_no"]) for lot in board["lots"] for w in lot["wafers"]}
        for cell in warned:
            stage = stages[cell["stage_key"]]
            lot_no, wafer_no = wafers.get(cell["wafer_id"], ("", ""))
            found.append({
                "cell_id": cell["id"], "evaluation_id": evaluation["id"], "evaluation_name": evaluation["name"],
                "page_path": evaluation["page_path"], "equipment": names.get(cell["equipment_id"], ""),
                "lot_no": lot_no, "wafer_no": wafer_no, "stage_key": cell["stage_key"], "stage_label": stage["label"],
                "wait_h": cell["wait_h"], "warn": cell["warn"], "warn_hours": stage.get("warn_hours"), "at": cell["at"],
            })
    found.sort(key=lambda item: (-item["warn"], -item["wait_h"], item["cell_id"]))
    return {"total": len(found), "items": found[:max(0, limit)],
            "levels": {"1": sum(1 for i in found if i["warn"] == 1), "2": sum(1 for i in found if i["warn"] == 2)}}


def set_warn_hours(conn: sqlite3.Connection, evaluation_id: int, warn: dict[str, float | None]) -> dict[str, Any]:
    """Set per-stage warning thresholds of ONE evaluation (stored with its stage copy, not per cell)."""
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        evaluation = get_evaluation(conn, evaluation_id)
        keys = {stage["key"] for stage in evaluation["stages"]}
        if not warn or any(key not in keys for key in warn):
            raise EvaluationError("이 평가에 없는 단계예요.", 422)
        for value in warn.values():
            if value is not None and not (isinstance(value, (int, float)) and not isinstance(value, bool)
                                          and 0 < value <= eval_wait.MAX_WARN_HOURS):
                raise EvaluationError("경고 시간은 0보다 크고 8,760시간 이하여야 해요.", 422)
        stages = [{**stage, "warn_hours": warn[stage["key"]]} if stage["key"] in warn else stage
                  for stage in evaluation["stages"]]
        conn.execute("UPDATE evaluations SET stages = ? WHERE id = ?", (json.dumps(stages, ensure_ascii=False), evaluation_id))
    return {"stages": stages}


# ---- cell edits (P4-05) ----------------------------------------------------------------------

MAX_MOVES = 5_000
MAX_NOTE = 2_000
MAX_TEXT = 500
_CHUNK = 400


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _chunks(items: list[int]) -> Iterator[list[int]]:
    for start in range(0, len(items), _CHUNK):
        yield items[start:start + _CHUNK]


def _stage_keys(conn: sqlite3.Connection, evaluation_id: int) -> set[str]:
    return {stage["key"] for stage in get_evaluation(conn, evaluation_id)["stages"]}


def apply_stage_moves(
    conn: sqlite3.Connection, evaluation_id: int, moves: list[tuple],
) -> dict[str, Any]:
    """Move cells to stages in ONE transaction and log each real change (D-09).

    A move is `(cell_id, stage_key)` or `(cell_id, stage_key, at)`; `at` (ISO, e.g. a MOS time, P4-08) is the
    log time instead of "now". A time in the future or an unparsable one rejects the whole request.

    Any unknown cell, excluded cell or unknown stage rejects the whole request, so a bulk
    transition never half-applies. Cells already at the target stage are reported as unchanged.
    """
    if not moves:
        raise EvaluationError("옮길 칸을 하나 이상 선택해 주세요.")
    if len(moves) > MAX_MOVES:
        raise EvaluationError(f"한 번에 {MAX_MOVES:,}칸까지만 옮길 수 있어요.")
    ids = [move[0] for move in moves]
    if len(set(ids)) != len(ids):
        raise EvaluationError("같은 칸이 두 번 들어 있어요.")
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        stages = _stage_keys(conn, evaluation_id)
        if any(move[1] is not None and move[1] not in stages for move in moves):
            raise EvaluationError("이 평가에 없는 단계예요.", 422)
        stamp = eval_wait.now_seoul()
        times: dict[int, str] = {}
        for move in moves:
            if len(move) > 2 and move[2]:
                when = eval_wait.parse_at(move[2])
                if when is None or when > stamp + timedelta(minutes=5):
                    raise EvaluationError("단계 시각이 올바르지 않거나 미래예요.", 422)
                times[move[0]] = when.isoformat(timespec="seconds")
        current: dict[int, tuple[str | None, int]] = {}
        for chunk in _chunks(ids):
            marks = ",".join("?" * len(chunk))
            for row in conn.execute(
                f"SELECT id, stage_key, excluded FROM eval_cells WHERE evaluation_id = ? AND id IN ({marks})",
                (evaluation_id, *chunk),
            ):
                current[row["id"]] = (row["stage_key"], row["excluded"])
        missing = [cell_id for cell_id in ids if cell_id not in current]
        if missing:
            raise EvaluationError(f"이 평가에 없는 칸이 {len(missing)}개 있어요. 현황판을 새로 불러와 주세요.", 404)
        excluded = [cell_id for cell_id in ids if current[cell_id][1]]
        if excluded:
            raise EvaluationError(f"제외한 칸 {len(excluded)}개는 단계를 바꿀 수 없어요.", 409)
        at = _now()
        changed, unchanged = [], []
        for move in moves:
            cell_id, target = move[0], move[1]
            before = current[cell_id][0]
            if before == target:
                unchanged.append(cell_id)
                continue
            conn.execute("UPDATE eval_cells SET stage_key = ? WHERE id = ?", (target, cell_id))
            conn.execute(
                "INSERT INTO eval_stage_log (cell_id, from_stage, to_stage, at) VALUES (?, ?, ?, ?)",
                (cell_id, before, target, times.get(cell_id, at)))
            changed.append({"id": cell_id, "from": before, "to": target, "at": times.get(cell_id, at)})
    return {"changed": changed, "unchanged": unchanged, "at": at}


def _load_cell(conn: sqlite3.Connection, cell_id: int) -> sqlite3.Row:
    row = conn.execute(
        "SELECT c.id, c.evaluation_id, c.stage_key, c.excluded, c.field_values, c.note, e.fields "
        "FROM eval_cells c JOIN evaluations e ON e.id = c.evaluation_id WHERE c.id = ?", (cell_id,)).fetchone()
    if row is None:
        raise EvaluationError("칸을 찾을 수 없습니다.", 404)
    return row


def _clean_value(field: dict[str, Any], value: Any) -> Any:
    """Return the stored value for one field, or None to clear it. Raises on a wrong type."""
    label = field["label"]
    if value is None or value == "":
        return None
    kind = field["type"]
    if kind == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise EvaluationError(f"'{label}'에는 숫자를 입력해 주세요.", 422)
        if value != value or value in (float("inf"), float("-inf")):
            raise EvaluationError(f"'{label}'에는 유한한 숫자를 입력해 주세요.", 422)
        return value
    if kind == "okng":
        if value not in ("ok", "ng"):
            raise EvaluationError(f"'{label}'은 OK 또는 NG만 고를 수 있어요.", 422)
        return value
    if kind == "check":
        if not isinstance(value, bool):
            raise EvaluationError(f"'{label}'은 체크 여부만 저장해요.", 422)
        return value
    if not isinstance(value, str):
        raise EvaluationError(f"'{label}'에는 글자를 입력해 주세요.", 422)
    text = value.strip()
    if len(text) > MAX_TEXT:
        raise EvaluationError(f"'{label}'은 {MAX_TEXT}자까지 입력할 수 있어요.", 422)
    return text or None


def update_cell(
    conn: sqlite3.Connection, cell_id: int, values: dict[str, Any] | None, note: str | None, has_note: bool,
) -> dict[str, Any]:
    """Merge field values (null clears one) and/or replace the memo of a cell."""
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        row = _load_cell(conn, cell_id)
        if row["excluded"]:
            raise EvaluationError("제외한 칸은 수정할 수 없어요.", 409)
        stored = json.loads(row["field_values"])
        if values:
            fields = {field["key"]: field for field in json.loads(row["fields"])}
            unknown = [key for key in values if key not in fields]
            if unknown:
                raise EvaluationError("이 평가에 없는 값 항목이에요: " + ", ".join(unknown), 422)
            for key, raw in values.items():
                clean = _clean_value(fields[key], raw)
                if clean is None:
                    stored.pop(key, None)
                else:
                    stored[key] = clean
        new_note = row["note"]
        if has_note:
            text = (note or "").strip()
            if len(text) > MAX_NOTE:
                raise EvaluationError(f"메모는 {MAX_NOTE:,}자까지 쓸 수 있어요.", 422)
            new_note = text or None
        conn.execute(
            "UPDATE eval_cells SET field_values = ?, note = ? WHERE id = ?",
            (json.dumps(stored, ensure_ascii=False), new_note, cell_id))
    return {"id": cell_id, "values": stored, "note": new_note}


def cell_history(conn: sqlite3.Connection, cell_id: int, limit: int = 50) -> list[dict[str, Any]]:
    _load_cell(conn, cell_id)
    return [dict(row) for row in conn.execute(
        "SELECT id, from_stage, to_stage, at FROM eval_stage_log WHERE cell_id = ? "
        "ORDER BY at DESC, id DESC LIMIT ?", (cell_id, limit))]
