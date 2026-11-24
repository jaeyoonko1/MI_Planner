"""DOI PPT import (P5-03): upload a .pptx -> preview (staged pictures, duplicates) -> confirm creates DRAFT DOIs.

Nothing is saved to the library until `confirm`. Staged pictures live in data/doi/.import/<token>/ and are removed
after a successful confirm, on cancel, or after a day.
"""
from __future__ import annotations

import json
import re
import shutil
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Depends, Request
from fastapi.responses import FileResponse

from app import pptx_read
from app.repositories import doi as repo
from app.repositories.doi import DoiError
from app.routers.doi import doi_root
from app.routers.tasks import get_conn

router = APIRouter(prefix="/api/doi-import")
_TOKEN = re.compile(r"^[0-9a-f]{32}$")
_KEY = re.compile(r"^[0-9a-f]{20}$")
STALE_SECONDS = 24 * 3600
REPEAT_MIN_SLIDES = 3
FIELDS = ("title", "description", "product", "plan", "step", "defect_type", "tool_condition", "source_dept", "source_author")


def _stage_root(request: Request) -> Path:
    return doi_root(request) / ".import"


def _stage(request: Request, token: str) -> Path:
    if not _TOKEN.match(token or ""):
        raise DoiError("가져오기 작업을 찾을 수 없어요. 파일을 다시 골라 주세요.", 404)
    path = _stage_root(request) / token
    if not (path / "meta.json").is_file():
        raise DoiError("가져오기 작업이 끝났거나 오래돼서 사라졌어요. 파일을 다시 골라 주세요.", 404)
    return path


def _sweep(root: Path) -> None:
    if not root.is_dir():
        return
    for d in root.iterdir():
        try:
            if d.is_dir() and time.time() - d.stat().st_mtime > STALE_SECONDS:
                shutil.rmtree(d, ignore_errors=True)
        except OSError:
            continue


def _known_images(conn: sqlite3.Connection, shas: list[str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for i in range(0, len(shas), 500):
        chunk = shas[i:i + 500]
        rows = conn.execute(
            "SELECT i.sha256, d.id, d.title, d.deleted_at FROM doi_images i JOIN doi d ON d.id = i.doi_id"
            " WHERE i.sha256 IN (%s) ORDER BY d.deleted_at IS NOT NULL, d.id" % ",".join("?" * len(chunk)), chunk)
        for r in rows:
            out.setdefault(r["sha256"], {"doi_id": r["id"], "title": r["title"], "deleted": r["deleted_at"] is not None})
    return out


def _known_refs(conn: sqlite3.Connection, refs: list[str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for r in conn.execute("SELECT id, title, source_ref, deleted_at FROM doi WHERE source_ref != ''"):
        if r["source_ref"] in refs:
            out.setdefault(r["source_ref"], {"doi_id": r["id"], "title": r["title"], "deleted": r["deleted_at"] is not None})
    return out


def source_ref(filename: str, index: int) -> str:
    return f"{filename}#슬라이드 {index}"


@router.post("/pptx")
async def preview(request: Request, name: str = "presentation.pptx", conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    """Body = raw .pptx bytes. Reads it, stages the pictures and returns what would be imported."""
    data = await request.body()
    filename = pptx_read.clean_filename(name)
    if not re.search(r"\.(pptx|pptm|ppsx|potx)$", filename, re.I) and not data[:2] == b"PK":
        raise DoiError("파워포인트 파일(.pptx)만 가져올 수 있어요. 옛 형식(.ppt)은 .pptx로 저장한 뒤 골라 주세요.", 422)
    root = _stage_root(request)
    _sweep(root)
    token = uuid.uuid4().hex
    stage = root / token
    stage.mkdir(parents=True, exist_ok=True)
    try:
        slides, warnings = pptx_read.read_pptx(data, stage)
    except pptx_read.PptxError as exc:
        shutil.rmtree(stage, ignore_errors=True)
        raise DoiError(str(exc), 422) from exc
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise
    del data

    shas = sorted({im.sha256 for s in slides for im in s.images})
    known = _known_images(conn, shas)
    refs = _known_refs(conn, [source_ref(filename, s.index) for s in slides])
    on_slides: dict[str, set[int]] = {}
    for s in slides:
        for im in s.images:
            on_slides.setdefault(im.key, set()).add(s.index)
    out_slides = []
    keys: dict[str, dict[str, Any]] = {}
    for s in slides:
        images = []
        for im in s.images:
            repeated = len(on_slides[im.key]) >= REPEAT_MIN_SLIDES and len(on_slides[im.key]) * 2 >= len(slides)
            images.append({"key": im.key, "ext": im.ext, "size": im.size, "width": im.width, "height": im.height,
                           "caption": im.caption, "cropped": im.cropped, "name": im.name, "sha256": im.sha256,
                           "duplicate": known.get(im.sha256), "repeated": repeated})
            keys[im.key] = {"ext": im.ext, "width": im.width, "height": im.height}
        out_slides.append({"index": s.index, "title": s.title, "body": s.body, "notes": s.notes, "hidden": s.hidden,
                           "images": images, "skipped": [{"name": k.name, "reason": k.reason} for k in s.skipped],
                           "duplicate_slide": refs.get(source_ref(filename, s.index))})
    (stage / "meta.json").write_text(json.dumps({"filename": filename, "images": keys, "slides": [s["index"] for s in out_slides]}), encoding="utf-8")
    return {"token": token, "filename": filename, "slides": out_slides, "warnings": warnings}


@router.get("/{token}/image/{key}")
def staged_image(request: Request, token: str, key: str) -> FileResponse:
    stage = _stage(request, token)
    if not _KEY.match(key):
        raise DoiError("이미지를 찾을 수 없어요.", 404)
    meta = json.loads((stage / "meta.json").read_text(encoding="utf-8"))
    info = meta["images"].get(key)
    path = stage / f"{key}.{info['ext']}" if info else None
    if path is None or not path.is_file():
        raise DoiError("이미지를 찾을 수 없어요.", 404)
    return FileResponse(path, media_type=repo.IMAGE_TYPES[info["ext"]], headers={"X-Content-Type-Options": "nosniff"})


@router.delete("/{token}")
def cancel(request: Request, token: str) -> dict:
    if _TOKEN.match(token or ""):
        shutil.rmtree(_stage_root(request) / token, ignore_errors=True)
    return {"ok": True}


@router.post("/{token}/confirm")
def confirm(request: Request, token: str, body: dict[str, Any] = Body(...), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    """body = {slides: [{index, title, description, ..., tags, images: [key, ...]}]}. Creates DRAFT DOIs, one per slide."""
    stage = _stage(request, token)
    meta = json.loads((stage / "meta.json").read_text(encoding="utf-8"))
    chosen = body.get("slides")
    if not isinstance(chosen, list) or not chosen:
        raise DoiError("가져올 슬라이드를 하나 이상 골라 주세요.", 422)
    if len(chosen) > pptx_read.MAX_SLIDES:
        raise DoiError("한 번에 가져올 수 있는 슬라이드 수를 넘었어요.", 422)
    root = doi_root(request)
    created: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    seen: set[int] = set()
    for entry in chosen:
        index = entry.get("index") if isinstance(entry, dict) else None
        if not isinstance(index, int) or index not in meta["slides"] or index in seen:
            failed.append({"index": index, "message": "알 수 없는 슬라이드예요."})
            continue
        seen.add(index)
        doi_id = None
        try:
            fields = {k: entry.get(k, "") for k in FIELDS if k in entry}
            fields["tags"] = entry.get("tags", [])
            fields["status"] = "draft"
            keys = entry.get("images", [])
            if not isinstance(keys, list) or not all(isinstance(k, str) and k in meta["images"] for k in keys):
                raise DoiError("이미지 목록이 올바르지 않아요.", 422)
            doi = repo.create(conn, fields, source_ref=source_ref(meta["filename"], index))
            doi_id = doi["id"]
            captions = entry.get("captions") if isinstance(entry.get("captions"), dict) else {}
            images = []
            for key in dict.fromkeys(keys):
                info = meta["images"][key]
                file = stage / f"{key}.{info['ext']}"
                img = repo.add_image(conn, root, doi_id, file.read_bytes(), width=info["width"], height=info["height"],
                                     caption=str(captions.get(key, ""))[:200])
                images.append({"key": key, "id": img["id"]})
            created.append({"index": index, "id": doi_id, "title": doi["title"], "images": images})
        except DoiError as exc:
            if doi_id is not None:
                repo.trash(conn, doi_id)  # never leave a half-filled draft in the library
            failed.append({"index": index, "message": str(exc)})
        except OSError:
            if doi_id is not None:
                repo.trash(conn, doi_id)
            failed.append({"index": index, "message": "이미지 파일을 저장하지 못했어요. data 폴더 쓰기 권한과 남은 용량을 확인해 주세요."})
    if not failed:
        shutil.rmtree(stage, ignore_errors=True)
    return {"created": created, "failed": failed}
