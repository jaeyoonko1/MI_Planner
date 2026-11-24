"""Plan / Step API (P5-01): list, detail, delete and the Excel import (dry run, then confirm)."""
from __future__ import annotations

import json
import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, Request

from app import plan_import
from app.repositories import plans as repo
from app.repositories.plans import PlanError
from app.routers.tasks import get_conn
from app.xlsx_read import XlsxError, read_workbook

router = APIRouter(prefix="/api/plans")


def _options(raw: str) -> dict[str, Any]:
    try:
        data = json.loads(raw) if raw else {}
    except ValueError as exc:
        raise PlanError("가져오기 옵션 형식이 올바르지 않아요.", 422) from exc
    if not isinstance(data, dict):
        raise PlanError("가져오기 옵션 형식이 올바르지 않아요.", 422)
    return data


@router.get("")
def list_plans(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return {"items": repo.list_plans(conn), "imports": repo.last_imports(conn)}


@router.post("/import")
async def import_plans(request: Request, name: str = "plan.xlsx", dry_run: bool = True, options: str = "",
                       conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    """Body = raw .xlsx bytes. options = JSON {sheet, header_row, mapping, product, fill_down, source_path}."""
    data = await request.body()
    if not data:
        raise PlanError("파일이 비어 있어요.", 422)
    opts = _options(options)
    try:
        sheets = read_workbook(data)
    except XlsxError as exc:
        raise PlanError(str(exc), 422) from exc
    if not sheets:
        raise PlanError("읽을 수 있는 시트가 없어요 (숨김 시트는 건너뛰어요).", 422)
    listing = [{"name": s.name, "rows": sum(1 for r in s.rows if any(r))} for s in sheets]
    picked = next((s for s in sheets if s.name == opts.get("sheet")), None) if opts.get("sheet") else None
    if opts.get("sheet") and picked is None:
        raise PlanError("그 시트를 찾을 수 없어요.", 422)
    if picked is None:  # best guess: the sheet whose header row looks most like a plan table
        picked = max(sheets, key=lambda s: (plan_import.detect_header_row(s.rows)[1], sum(1 for r in s.rows if any(r))))
    header_row = opts.get("header_row")
    if header_row is not None and (not isinstance(header_row, int) or isinstance(header_row, bool)):
        raise PlanError("머리글 줄 번호는 숫자여야 해요.", 422)
    chosen = opts.get("mapping")
    if chosen is not None and not (isinstance(chosen, dict) and all(isinstance(v, str) for v in chosen.values())):
        raise PlanError("열 지정 형식이 올바르지 않아요.", 422)
    try:
        parsed = plan_import.parse_sheet(picked, header_row=header_row, mapping=chosen,
                                         product_default=str(opts.get("product") or ""),
                                         fill_down=bool(opts.get("fill_down", True)))
    except plan_import.ImportOptionError as exc:
        raise PlanError(str(exc), 422) from exc
    result = repo.preview(conn, parsed)
    if not dry_run:
        if not parsed.can_apply or not parsed.rows:
            raise PlanError(parsed.problem or "가져올 수 있는 줄이 없어요.", 422)
        repo.apply_import(conn, parsed, result, name[:200], str(opts.get("source_path") or "")[:500])
    payload = repo.preview_payload(parsed, result)
    return {**payload, "sheets": listing, "applied": not dry_run, "file_name": name}


@router.get("/{plan_id}")
def get_plan(plan_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return repo.get_plan(conn, plan_id)


@router.delete("/{plan_id}")
def delete_plan(plan_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    repo.delete_plan(conn, plan_id)
    return {"ok": True}
