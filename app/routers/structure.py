from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from app import memo
from app.repositories import structure as repo
from app.repositories import structure_copy, structure_free, structure_trash
from app.routers.tasks import get_conn

router = APIRouter(prefix="/api/structure")


@router.get("/view")
def get_view(conn=Depends(get_conn)) -> dict:
    return repo.get_view(conn)


@router.put("/view")
def put_view(body: dict[str, Any], conn=Depends(get_conn)) -> dict:
    return repo.save_view(conn, body)


@router.get("/classes")
def classes(conn=Depends(get_conn)) -> dict:
    return {"items": repo.overview(conn)}


@router.get("/classes/{key}/impact")
def class_impact(key: str, conn=Depends(get_conn)) -> dict:
    return repo.impact(conn, key)


@router.get("/free")
def get_free(conn=Depends(get_conn)) -> dict:
    return structure_free.get_free(conn)


@router.post("/free/move")
def free_move(body: dict[str, Any], conn=Depends(get_conn)) -> dict:
    return structure_free.move(conn, body)


@router.post("/free/groups", status_code=201)
def free_add_group(body: dict[str, Any], conn=Depends(get_conn)) -> dict:
    return structure_free.add_group(conn, body)


@router.post("/copy", status_code=201)
def copy(request: Request, body: dict[str, Any], conn=Depends(get_conn)) -> dict:
    res = structure_copy.copy(conn, body)
    for old, new in (res.get("map") or {}).items():  # copies get their own copy of the memo's images
        memo.copy_files(conn, request.app.state.vault, int(old), int(new))
    return res


@router.post("/delete-preview")
def delete_preview(request: Request, body: dict[str, Any], conn=Depends(get_conn)) -> dict:
    """What a delete would touch (counts, pages, journal links) - nothing is changed."""
    return structure_trash.preview(conn, request.app.state.vault, body)


@router.post("/delete")
def delete(request: Request, body: dict[str, Any], conn=Depends(get_conn)) -> dict:
    """Soft delete issues / free-layout groups as one atomic, restorable operation (V-004)."""
    return structure_trash.delete(conn, request.app.state.vault, body)


@router.get("/trash")
def trash_list(conn=Depends(get_conn)) -> dict:
    return {"items": structure_trash.list_trash(conn)}


@router.post("/trash/{trash_id}/restore")
def trash_restore(request: Request, trash_id: int, conn=Depends(get_conn)) -> dict:
    return structure_trash.restore(conn, request.app.state.vault, trash_id)
