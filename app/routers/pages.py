from __future__ import annotations

from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, model_validator

from app import db, memo, placement
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


class PageRestore(BaseModel):
    trashed: str
    original: str


class PageContent(BaseModel):
    content: str


Percent = Annotated[int, Field(strict=True, gt=0, le=100)]


class NoteLayout(BaseModel):
    mode: Literal["fit", "scroll"]
    widths: Annotated[list[Percent], Field(min_length=2, max_length=4)] | None = None
    # V-008: one width list per column row (1~4 columns each, up to 6 rows). Written only for multi-row notes.
    rows: Annotated[list[Annotated[list[Percent], Field(min_length=1, max_length=4)]], Field(min_length=2, max_length=6)] | None = None

    @model_validator(mode="after")
    def check_total(self) -> NoteLayout:
        if self.widths is not None and sum(self.widths) != 100:
            raise ValueError("단 너비 비율의 합은 100이어야 합니다.")
        if self.rows is not None and any(sum(row) != 100 for row in self.rows):
            raise ValueError("단 너비 비율의 합은 100이어야 합니다.")
        return self


def _relink(request: Request, fn) -> None:
    conn = db.connect(request.app.state.db_path)
    try:
        fn(conn)
        conn.commit()
    finally:
        conn.close()


@router.get("/tree")
def tree(request: Request) -> dict:
    return {"tree": _vault(request).tree()}


@router.get("")
def read_page(request: Request, path: str) -> dict:
    vault = _vault(request)
    page = vault.read(path)
    if page["meta"].get("task_id") is not None and not page["meta"].get(memo.FLAG):
        _relink(request, lambda c: memo.before_page_write(c, vault, path))  # unify an old diverged pair first
        page = vault.read(path)
    return page


@router.put("")
def write_page(request: Request, path: str, body: PageContent) -> dict:
    vault = _vault(request)
    holder: list[int | None] = [None]

    def prepare(conn) -> None:
        holder[0] = memo.before_page_write(conn, vault, path)

    _relink(request, prepare)
    page = vault.write(path, body.content)
    if holder[0] is not None:  # issue page: keep the issue's mirrored memo identical
        _relink(request, lambda c: memo.after_page_write(c, holder[0], body.content))
    return page


@router.put("/layout")
def write_note_layout(request: Request, path: str, body: NoteLayout) -> dict:
    layout = body.model_dump(exclude_none=True)
    _vault(request).set_note_layout(path, layout)
    return {"note_layout": layout}


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
    page = _vault(request).update(path, title=body.title, parent=body.parent, order=body.order)
    if page["path"] != path:  # issue links follow the folder (their page identity is task_id anyway)
        _relink(request, lambda c: placement.repoint(c, path, page["path"]))
    return page


@router.delete("")
def delete_page(request: Request, path: str) -> dict:
    trashed = _vault(request).delete(path)
    _relink(request, lambda c: placement.unlink(c, path))
    return {"trashed": trashed}


@router.post("/restore")
def restore_page(request: Request, body: PageRestore) -> dict:
    """Undo a page delete (V-010 sidebar menu): put the trashed folder back next to where it was."""
    vault = _vault(request)
    return vault.read(vault.restore_page(body.trashed, body.original))
