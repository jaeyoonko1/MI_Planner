from __future__ import annotations

from typing import Iterator, Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, StrictInt

from app import db, journal, journal_links, memo, placement, search
from app.repositories import structure_free, tasks as repo
from app.vault import VaultError, content_revision

router = APIRouter(prefix="/api/todos")


class FreeAnchor(BaseModel):
    kind: Literal["group", "issue"]
    id: StrictInt


class FreePlacement(BaseModel):
    parent_id: StrictInt | None = None
    before: FreeAnchor | None = None


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
    props: dict | None = None
    mark: str | None = None
    level_id: StrictInt | None = None

    free_placement: FreePlacement | None = None


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
    note_revision: str | None = None
    props: dict | None = None
    mark: str | None = None
    level_id: StrictInt | None = None


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
    request: Request,
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
    ids: str | None = Query(None, description="comma-separated task ids"),
    planned_from: str | None = None,
    planned_to: str | None = None,
    due_from: str | None = None,
    due_to: str | None = None,
    unplanned: bool = False,
    marked: bool = False,
    open_only: bool = False,
) -> dict:
    try:
        prios = [int(p) for p in _csv(priority)]
    except ValueError:
        raise repo.TaskError("priority는 쉼표로 구분한 숫자여야 합니다.") from None
    try:
        id_list = [int(i) for i in _csv(ids)] if ids is not None else None
    except ValueError:
        raise repo.TaskError("ids는 쉼표로 구분한 숫자여야 합니다.") from None
    # user-defined fields: ?field_<key>=a,b (OR within a field, AND across fields)
    ff = {k[6:]: _csv(v) for k, v in request.query_params.items() if k.startswith("field_")}
    items = repo.list_tasks(
        conn, status=_csv(status), priority=prios, requester=requester,
        due_within=due_within, overdue=overdue, planned_date=planned_date,
        eval_id=eval_id, page_path=page_path, parent_task_id=parent_task_id,
        top_level=top_level, q=q, field_filters=ff or None,
        search_body=search.task_list_body(request.app.state.vault) if q else None,
        ids=id_list, planned_from=planned_from, planned_to=planned_to, due_from=due_from,
        due_to=due_to, unplanned=unplanned, marked=marked, open_only=open_only,
    )
    return {"items": items, "requesters": repo.requesters(conn)}


@router.post("", status_code=201)
def create_todo(request: Request, body: TodoIn, conn=Depends(get_conn)) -> dict:
    data = body.model_dump(exclude_none=True, exclude={"free_placement"})
    place = body.free_placement
    if place is None:
        task = repo.create(conn, data)
    else:
        before = (place.before.kind, place.before.id) if place.before else None
        task = structure_free.create_task(conn, data, place.parent_id, before)
    return {**task, "journal_days": journal_links.after_task_change(request.app.state.vault, None, task)}


class FromLine(BaseModel):
    date: str  # journal day, YYYY-MM-DD
    line_index: int  # 0-based line within that day's body


@router.post("/from-line", status_code=201)
def promote_line(request: Request, body: FromLine, conn=Depends(get_conn)) -> dict:
    """Journal checkbox line -> task (planned_date = that day); the line keeps a link."""
    def make(spec: dict) -> dict:
        return repo.create(conn, spec)

    def existing(title: str, day: str) -> dict | None:
        key = title.casefold()
        for t in repo.list_tasks(conn, planned_date=day, open_only=True):
            if t["title"].strip().casefold() == key:
                return t
        return None

    res = journal.promote_line(request.app.state.vault, body.date, body.line_index, make, existing)
    res["tasks"] = journal_links.task_map(conn, list(res["days"].values()))
    return res


@router.get("/{task_id}")
def get_todo(request: Request, task_id: int, conn=Depends(get_conn)) -> dict:
    # the memo of an issue with a page IS the page body (P2B-10); reading unifies old diverged pairs once
    vault = request.app.state.vault
    with vault.page_lock:
        return memo.read(conn, vault, task_id)


def _restore_page(vault, rel: str, old_body: str, written: str) -> None:
    """Undo this request's page write after a later step failed. The write is conditional on the page still being
    exactly what this request wrote (checked under the vault's cross-process content lock), so a body another app
    saved in the meantime is never removed; in that case the other app's text simply stays."""
    try:
        if vault.read(rel)["content"] != old_body:
            vault.write(rel, old_body, content_revision(written))
    except (VaultError, OSError):
        pass  # changed by someone else (409) or unwritable: keep what is there, the original error is raised


@router.patch("/{task_id}")
def patch_todo(request: Request, task_id: int, body: TodoPatch, conn=Depends(get_conn)) -> dict:
    # fields_set lets clients clear a field by sending null explicitly
    data = body.model_dump(exclude_unset=True, exclude={"note_revision"})
    vault = request.app.state.vault
    with vault.page_lock:
        before = repo.get(conn, task_id)
        repo.validate_update(conn, task_id, data)  # a doomed request must not touch the page body
        rel = old_body = None
        if "note" in data:
            rel = placement.existing_page(vault, before)
            old_body = vault.read(rel)["content"] if rel else None
        try:
            if "note" in data:
                memo.write_note(conn, vault, before, data["note"], body.note_revision)
            task = repo.update(conn, task_id, data)
        except Exception:
            if old_body is not None:
                _restore_page(vault, rel, old_body, data["note"] or "")
            raise
        if "note" in data:
            task["note_revision"] = content_revision(task.get("note"))
    # the linked journal line follows the task (title, check, mark, planned day)
    return {**task, "journal_days": journal_links.after_task_change(request.app.state.vault, before, task)}


@router.delete("/{task_id}")
def delete_todo(request: Request, task_id: int, conn=Depends(get_conn)) -> dict:
    before = repo.get(conn, task_id)
    repo.delete(conn, task_id)
    try:  # leftover pre-page images go to .trash/ so a reused id never inherits them
        request.app.state.vault.trash_issue_files(task_id)
    except OSError:
        pass
    return {"ok": True, "journal_days": journal_links.after_task_change(request.app.state.vault, before, None)}
