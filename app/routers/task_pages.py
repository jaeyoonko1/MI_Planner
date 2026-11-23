"""Optional issue pages and page placement (P2B-09). Mounted under /api/todos before the generic task routes."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from app import journal_links, placement
from app.repositories import task_fields as tf
from app.repositories import tasks as repo
from app.routers.tasks import get_conn

router = APIRouter(prefix="/api/todos")


def _vault(request: Request):
    return request.app.state.vault


def _override(body: dict[str, Any]) -> dict[str, Any] | None:
    o = body.get("override")
    if o is not None and not isinstance(o, dict):
        raise repo.TaskError("override는 객체여야 합니다.")
    return o


@router.post("/page-preview")
def preview(request: Request, body: dict[str, Any], conn=Depends(get_conn)) -> dict:
    """Where would the page go? `{task_id}` for an existing issue or `{draft:{title,props,...}}` for a new one."""
    vault = _vault(request)
    if body.get("task_id") is not None:
        task = repo.get(conn, int(body["task_id"]))
        found = placement.existing_page(vault, task)
        if found and not body.get("relocate"):
            return {"exists": True, "path": found}
        if found:  # moving an existing page: say where it is now
            return {"exists": True, "current": found, **placement.plan(conn, vault, task, _override(body))}
    else:
        task = placement.draft_task(body.get("draft") or {})
        if not task["title"]:
            raise repo.TaskError("제목을 입력하세요.")
    return {"exists": False, **placement.plan(conn, vault, task, _override(body))}


@router.post("/with-page", status_code=201)
def create_with_page(request: Request, body: dict[str, Any], conn=Depends(get_conn)) -> dict:
    """'할일 페이지 추가': the issue and its page in one step (all or nothing)."""
    data = {k: v for k, v in body.items() if k != "override" and v is not None}
    res = placement.create_with_page(conn, _vault(request), data, _override(body))
    task = res["task"]
    return {**res, "task": {**task, "journal_days": journal_links.after_task_change(_vault(request), None, task)}}


@router.post("/{task_id}/page")
def expand_page(request: Request, task_id: int, body: dict[str, Any] | None = None, conn=Depends(get_conn)) -> dict:
    """Issue-only -> issue + page, once. Calling again returns the existing page (created: false)."""
    return placement.expand(conn, _vault(request), task_id, _override(body or {}))


@router.post("/{task_id}/page/relocate")
def relocate_page(request: Request, task_id: int, body: dict[str, Any] | None = None, conn=Depends(get_conn)) -> dict:
    return placement.relocate(conn, _vault(request), task_id, _override(body or {}))


@router.post("/page-rules/overview")
def rules_overview(request: Request, body: dict[str, Any] | None = None, conn=Depends(get_conn)) -> dict:
    body = body or {}
    rules = body.get("rules")
    clean = tf.validate_rules(conn, rules) if rules is not None else None
    return placement.overview(conn, _vault(request), clean, body.get("fallback"))
