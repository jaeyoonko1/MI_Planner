"""DOI share package API (P5-04): export selected DOIs to a .zip, import one in two steps (preview -> apply)."""
from __future__ import annotations

import json
import re
import shutil
import sqlite3
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Depends, Request
from fastapi.responses import Response

from app import doi_package as pkg
from app.repositories.doi import DoiError
from app.routers.doi import doi_root
from app.routers.tasks import get_conn

router = APIRouter(prefix="/api/doi-package")
_TOKEN = re.compile(r"^[0-9a-f]{32}$")
STALE_SECONDS = 24 * 3600


def _stage_root(request: Request) -> Path:
    return doi_root(request) / ".package"


def _stage(request: Request, token: str) -> Path:
    if not _TOKEN.match(token or ""):
        raise DoiError("가져오기 작업을 찾을 수 없어요. 파일을 다시 골라 주세요.", 404)
    path = _stage_root(request) / token
    if not (path / "package.json").is_file():
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


@router.post("/export")
def export(request: Request, body: dict[str, Any] = Body(...), conn: sqlite3.Connection = Depends(get_conn)) -> Response:
    data, stats = pkg.export_package(conn, doi_root(request), body.get("ids"), body.get("sender", ""), body.get("note", ""))
    name = f"doi-package-{datetime.now().strftime('%Y%m%d-%H%M')}.zip"
    return Response(data, media_type="application/zip", headers={
        "Content-Disposition": f'attachment; filename="{name}"', "X-Doi-Count": str(stats["count"]),
        "X-Doi-Skipped": str(sum(stats["skipped"].values())), "Cache-Control": "no-store"})


@router.post("/preview")
async def preview(request: Request, name: str = "package.zip", conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    """Body = raw .zip bytes. Verifies and stages it; saves nothing to the library."""
    data = await request.body()
    root = _stage_root(request)
    _sweep(root)
    token = uuid.uuid4().hex
    stage = root / token
    stage.mkdir(parents=True, exist_ok=True)
    try:
        package = pkg.stage_package(data, stage)
        (stage / "package.json").write_text(json.dumps(package, ensure_ascii=False), encoding="utf-8")
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise
    del data
    classes = {c["uid"]: c for c in pkg.classify(conn, package["items"])}
    items = [pkg.public_item(i, classes[i["uid"]]) for i in package["items"]]
    counts = {s: sum(1 for i in items if i["state"] == s) for s in ("new", "identical", "conflict")}
    return {"token": token, "filename": name[:200], "package": {k: package[k] for k in ("package_id", "created_at", "sender", "note", "format_version")},
            "items": items, "counts": counts}


@router.delete("/{token}")
def cancel(request: Request, token: str) -> dict:
    if _TOKEN.match(token or ""):
        shutil.rmtree(_stage_root(request) / token, ignore_errors=True)
    return {"ok": True}


@router.post("/{token}/apply")
def apply(request: Request, token: str, body: dict[str, Any] = Body(...), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    """body = {decisions: {<doi uid>: import|skip|both|overwrite}}. All-or-nothing: any failure leaves the library untouched."""
    stage = _stage(request, token)
    decisions = body.get("decisions", {})
    if not isinstance(decisions, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in decisions.items()):
        raise DoiError("선택 형식이 올바르지 않아요.", 422)
    package = json.loads((stage / "package.json").read_text(encoding="utf-8"))
    try:
        stats = pkg.apply_package(conn, doi_root(request), stage, package, decisions)
    except DoiError:
        raise
    except OSError as exc:
        raise DoiError("파일을 저장하지 못해 아무것도 가져오지 않았어요. data 폴더 쓰기 권한과 남은 용량을 확인해 주세요.", 500) from exc
    shutil.rmtree(stage, ignore_errors=True)
    return stats
