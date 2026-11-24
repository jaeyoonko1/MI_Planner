"""PowerPoint attachments of a page (V-002). See app/ppt_attach.py for the rules."""
from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from app.ppt_attach import PptError, PptStore

router = APIRouter(prefix="/api/ppt")
LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}


def _store(request: Request) -> PptStore:
    store = getattr(request.app.state, "ppt", None)
    if store is None:
        store = request.app.state.ppt = PptStore(request.app.state.vault, request.app.state.db_path.parent / "ppt_cache")
    return store


def _guard(request: Request) -> None:
    """Opening a program on this PC is only for this PC's own browser: loopback client, loopback Host, and (when the
    browser sends one) a same-origin Origin. A web page on another site therefore cannot trigger it."""
    host = request.client.host if request.client else ""
    if host not in LOCAL_HOSTS:
        raise PptError("이 컴퓨터에서만 열 수 있어요.", 403)
    hostname = urlsplit("//" + (request.headers.get("host") or "")).hostname or ""
    if hostname not in LOCAL_HOSTS:
        raise PptError("이 컴퓨터에서만 열 수 있어요.", 403)
    origin = request.headers.get("origin")
    if origin and origin != "null" and urlsplit(origin).netloc != request.headers.get("host"):
        raise PptError("다른 사이트에서는 열 수 없어요.", 403)


def _error(exc: PptError) -> JSONResponse:
    return JSONResponse({"error": str(exc)}, status_code=exc.status)


@router.get("")
def list_items(request: Request, path: str):
    try:
        return {"items": _store(request).list(path)}
    except PptError as exc:
        return _error(exc)


@router.post("/upload", status_code=201)
async def upload(request: Request, path: str, name: str = "presentation.pptx"):
    try:
        return _store(request).add_upload(path, name, await request.body())
    except PptError as exc:
        return _error(exc)


@router.post("/link", status_code=201)
def link(request: Request, path: str, body: dict[str, Any]):
    try:
        return _store(request).add_link(path, str(body.get("link", "")))
    except PptError as exc:
        return _error(exc)


@router.post("/check-link")
def check(request: Request, body: dict[str, Any]):
    """Validate a typed path without saving anything (shown live in the dialog)."""
    from app.ppt_attach import check_link
    try:
        text, p = check_link(str(body.get("link", "")))
        return {"ok": True, "name": p.name, "size": p.stat().st_size, "link": text}
    except PptError as exc:
        return _error(exc)


@router.get("/{pid}/outline")
def outline(request: Request, pid: str, path: str):
    try:
        return _store(request).outline(path, pid)
    except PptError as exc:
        return _error(exc)


@router.get("/{pid}/slide/{n}")
def slide_picture(request: Request, pid: str, n: int, path: str):
    try:
        return FileResponse(_store(request).rendered_slide(path, pid, n))
    except PptError as exc:
        return _error(exc)


@router.get("/{pid}/media/{name}")
def media(request: Request, pid: str, name: str, path: str):
    key, _, ext = name.partition(".")
    try:
        return FileResponse(_store(request).media(path, pid, key, ext))
    except PptError as exc:
        return _error(exc)


@router.get("/{pid}/cover")
def cover(request: Request, pid: str, path: str):
    try:
        data, mime = _store(request).cover(path, pid)
        return Response(data, media_type=mime)
    except PptError as exc:
        if exc.status == 404:
            return Response(status_code=204)  # no stored first-slide picture: the card keeps its icon (and no console noise)
        return _error(exc)


@router.post("/{pid}/refresh")
def refresh(request: Request, pid: str, path: str):
    try:
        return _store(request).refresh(path, pid)
    except PptError as exc:
        return _error(exc)


@router.post("/{pid}/open")
def open_file(request: Request, pid: str, path: str, body: dict[str, Any]):
    try:
        _guard(request)
        if body.get("confirm") is not True:
            raise PptError("열기 전에 확인이 필요해요.", 400)
        return _store(request).open_in_powerpoint(path, pid, opener=getattr(request.app.state, "ppt_opener", None))
    except PptError as exc:
        return _error(exc)


@router.delete("/{pid}")
def remove(request: Request, pid: str, path: str):
    try:
        return _store(request).remove(path, pid)
    except PptError as exc:
        return _error(exc)
