"""DOI library API (P5-02): records, images (raw bytes in, files under data/doi/), trash and restore."""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Depends, Request
from fastapi.responses import FileResponse

from app.repositories import doi as repo
from app.routers.tasks import get_conn

router = APIRouter(prefix="/api/doi")
image_router = APIRouter(prefix="/api/doi-images")


def doi_root(request: Request) -> Path:
    return Path(request.app.state.db_path).parent / "doi"


@router.get("")
def list_doi(trash: bool = False, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return {"items": repo.list_items(conn, trash)}


@router.post("")
def create_doi(body: dict[str, Any] = Body(...), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return repo.create(conn, body)


@router.get("/{doi_id}")
def get_doi(doi_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return repo.get(conn, doi_id)


@router.patch("/{doi_id}")
def patch_doi(doi_id: int, body: dict[str, Any] = Body(...), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return repo.update(conn, doi_id, body)


@router.delete("/{doi_id}")
def trash_doi(doi_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    repo.trash(conn, doi_id)
    return {"ok": True}


@router.post("/{doi_id}/restore")
def restore_doi(doi_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return repo.restore(conn, doi_id)


@router.post("/{doi_id}/images")
async def add_image(request: Request, doi_id: int, width: int = 0, height: int = 0, caption: str = "",
                    conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    """Body = raw image bytes. width/height come from the browser (informational)."""
    return repo.add_image(conn, doi_root(request), doi_id, await request.body(), width=width, height=height, caption=caption)


@router.put("/{doi_id}/images/order")
def order_images(doi_id: int, body: dict[str, Any] = Body(...), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return {"images": repo.reorder_images(conn, doi_id, body.get("ids"))}


@router.patch("/{doi_id}/images/{image_id}")
def patch_image(doi_id: int, image_id: int, body: dict[str, Any] = Body(...), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return repo.update_image(conn, doi_id, image_id, body.get("caption", ""))


@router.delete("/{doi_id}/images/{image_id}")
def delete_image(request: Request, doi_id: int, image_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    repo.delete_image(conn, doi_root(request), doi_id, image_id)
    return {"ok": True}


@image_router.get("/{image_id}/file")
def image_file(request: Request, image_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> FileResponse:
    path, mime = repo.image_file(conn, doi_root(request), image_id)
    return FileResponse(path, media_type=mime, headers={"X-Content-Type-Options": "nosniff"})


@image_router.get("/{image_id}/thumb")
def image_thumb(request: Request, image_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> FileResponse:
    path, mime = repo.image_file(conn, doi_root(request), image_id, thumb=True)
    return FileResponse(path, media_type=mime, headers={"X-Content-Type-Options": "nosniff"})


@image_router.put("/{image_id}/thumb")
async def put_thumb(request: Request, image_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    repo.set_thumb(conn, doi_root(request), image_id, await request.body())
    return {"ok": True}
