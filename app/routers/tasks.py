from __future__ import annotations

from typing import Iterator

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel

from app import db
from app.repositories import tasks as repo

router = APIRouter(prefix="/api/todos")


class TodoIn(BaseModel):
    title: str
    status: str | None = None
    priority: int | None = None
    requester: str | None = None
    due_date: str | None = None
    planned_date: str | None = None
    parent_task_id: int | None = None
    eval_id: int | None = None
    page_path: str | None = None
    note: str | None = None


class TodoPatch(BaseModel):
    title: str | None = None
    status: str | None = None
    priority: int | None = None
    requester: str | None = None
    due_date: str | None = None
    planned_date: str | None = None
    parent_task_id: int | None = None
    eval_id: int | None = None
    page_path: str | None = None
    note: str | None = None


def get_conn(request: Request) -> Iterator:
    conn = db.connect(request.app.state.db_path)
    try:
        yield conn
    finally:
        conn.close()


def _csv(value: str | None) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()] if value else []


@router.get("")
def list_todos(
    conn=Depends(get_conn),
    status: str | None = Query(None, description="comma-separated"),
    priority: str | None = Query(None, description="comma-separated 1-3"),
    requester: str | None = None,
    due_within: int | None = Query(None, ge=0),
    overdue: bool = False,
    planned_date: str | None = None,
    eval_id: int | None = None,
    page_path: str | None = None,
    parent_task_id: int | None = None,
    top_level: bool = False,
    q: str | None = None,
) -> dict:
    try:
        prios = [int(p) for p in _csv(priority)]
    except ValueError:
        raise repo.TaskError("priority는 쉼표로 구분한 숫자여야 합니다.") from None
    items = repo.list_tasks(
        conn, status=_csv(status), priority=prios, requester=requester,
        due_within=due_within, overdue=overdue, planned_date=planned_date,
        eval_id=eval_id, page_path=page_path, parent_task_id=parent_task_id,
        top_level=top_level, q=q,
    )
    return {"items": items, "requesters": repo.requesters(conn)}


@router.post("", status_code=201)
def create_todo(body: TodoIn, conn=Depends(get_conn)) -> dict:
    data = body.model_dump(exclude_none=True)
    return repo.create(conn, data)


@router.get("/{task_id}")
def get_todo(task_id: int, conn=Depends(get_conn)) -> dict:
    return repo.get(conn, task_id)


@router.patch("/{task_id}")
def patch_todo(task_id: int, body: TodoPatch, conn=Depends(get_conn)) -> dict:
    # fields_set lets clients clear a field by sending null explicitly
    data = {k: getattr(body, k) for k in body.model_fields_set}
    return repo.update(conn, task_id, data)


@router.delete("/{task_id}")
def delete_todo(task_id: int, conn=Depends(get_conn)) -> dict:
    repo.delete(conn, task_id)
    return {"ok": True}
