from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from app import memo
from app.repositories import structure as repo
from app.repositories import issue_levels, structure_copy, structure_free, structure_trash
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


@router.patch("/free/groups/{node_id}")
def free_rename_group(node_id: int, body: dict[str, Any], conn=Depends(get_conn)) -> dict:
    return structure_free.rename_group(conn, node_id, body)


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


# ---- issue levels (V-011): 에픽 and other kinds of issue above the plain 이슈 ----------------------------
@router.get("/levels")
def levels(conn=Depends(get_conn)) -> dict:
    return {"items": issue_levels.list_levels(conn)}


@router.post("/levels", status_code=201)
def add_level(body: dict[str, Any], conn=Depends(get_conn)) -> dict:
    return issue_levels.create_level(conn, body)


@router.put("/levels/order")
def order_levels(body: dict[str, Any], conn=Depends(get_conn)) -> dict:
    return {"items": issue_levels.reorder(conn, body.get("ids"))}


@router.post("/levels/convert")
def convert_levels(body: dict[str, Any], conn=Depends(get_conn)) -> dict:
    """Explicit migration: one upper-level issue per classification value; values stay on the issues."""
    return issue_levels.convert(conn, body)


@router.patch("/levels/{level_id}")
def patch_level(level_id: int, body: dict[str, Any], conn=Depends(get_conn)) -> dict:
    return issue_levels.update_level(conn, level_id, body)


@router.delete("/levels/{level_id}")
def delete_level(level_id: int, conn=Depends(get_conn)) -> dict:
    """Issues move to an adjacent level; restorable through /trash/{id}/restore."""
    return issue_levels.delete_level(conn, level_id)
