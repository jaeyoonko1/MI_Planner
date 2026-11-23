from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.vault import Vault

router = APIRouter(prefix="/api/pages")


def _vault(request: Request) -> Vault:
    return request.app.state.vault


class PageCreate(BaseModel):
    parent: str = ""
    title: str
    type: str = "note"


class PageUpdate(BaseModel):
    title: Optional[str] = None
    parent: Optional[str] = None
    order: Optional[int] = None


class PageContent(BaseModel):
    content: str


@router.get("/tree")
def tree(request: Request) -> dict:
    return {"tree": _vault(request).tree()}


@router.get("")
def read_page(request: Request, path: str) -> dict:
    return _vault(request).read(path)


@router.put("")
def write_page(request: Request, path: str, body: PageContent) -> dict:
    return _vault(request).write(path, body.content)


@router.post("/files")
async def upload_file(request: Request, path: str, name: str = "image.png") -> dict:
    """Raw-body image upload (pasted screenshots). Returns the page-relative file path."""
    return {"file": _vault(request).save_file(path, name, await request.body())}


@router.get("/file")
def get_file(request: Request, path: str, name: str) -> FileResponse:
    return FileResponse(_vault(request).file_path(path, name))


@router.post("")
def create_page(request: Request, body: PageCreate) -> dict:
    return _vault(request).create(body.parent, body.title, body.type)


@router.patch("")
def update_page(request: Request, path: str, body: PageUpdate) -> dict:
    return _vault(request).update(path, title=body.title, parent=body.parent, order=body.order)


@router.delete("")
def delete_page(request: Request, path: str) -> dict:
    return {"trashed": _vault(request).delete(path)}
