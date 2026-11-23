from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Request

from app import html_page
from app.vault import Vault, VaultError

router = APIRouter(prefix="/api/pages")


def _html_dir(request: Request, path: str):
    vault: Vault = request.app.state.vault
    page = vault._dir(path)
    if vault._read_meta(page).get("type") != "html":
        raise VaultError("HTML 페이지가 아닙니다.")
    return page


@router.get("/state")
def get_state(request: Request, path: str) -> dict:
    f = _html_dir(request, path) / html_page.STATE_FILE
    if not f.is_file():
        return {"state": {}}
    try:
        return {"state": json.loads(f.read_text(encoding="utf-8"))}
    except json.JSONDecodeError:
        return {"state": {}}


@router.put("/state")
def put_state(request: Request, path: str, body: dict[str, Any]) -> dict:
    state = html_page.validate_state(body.get("state"))
    f = _html_dir(request, path) / html_page.STATE_FILE
    f.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"state": state}


@router.get("/external-refs")
def external_refs(request: Request, path: str) -> dict:
    f = _html_dir(request, path) / "index.html"
    html = f.read_text(encoding="utf-8") if f.is_file() else ""
    return {"external": html_page.find_external_refs(html)}
