"""Helpers for html-type pages: external-request scan and per-page state file."""
from __future__ import annotations

import json
import re
from typing import Any

STATE_FILE = "_state.json"
MAX_STATE_BYTES = 1_000_000

# src/href/action/poster/data attributes, CSS url()/@import, fetch/XHR/WebSocket/import().
_EXTERNAL_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("attr", re.compile(r"""\b(?:src|href|action|poster|data|srcset)\s*=\s*["']?\s*((?:https?:)?//[^\s"'>]+)""", re.I)),
    ("css", re.compile(r"""url\(\s*["']?\s*((?:https?:)?//[^\s"')]+)""", re.I)),
    ("import", re.compile(r"""@import\s+["']((?:https?:)?//[^"']+)""", re.I)),
    ("js", re.compile(r"""\b(?:fetch|open|WebSocket|EventSource|import|sendBeacon)\s*\(\s*(?:[^,'"()]*,\s*)?["'`]\s*((?:https?|wss?):\/\/[^\s"'`)]+)""", re.I)),
]


def find_external_refs(html: str) -> list[str]:
    """Return unique external URLs referenced by the HTML (order of first appearance)."""
    found: list[str] = []
    for _, pat in _EXTERNAL_PATTERNS:
        for m in pat.finditer(html):
            url = m.group(1).rstrip(".,;")
            if url not in found:
                found.append(url)
    return found


def validate_state(state: Any) -> dict[str, Any]:
    from app.vault import VaultError

    if not isinstance(state, dict):
        raise VaultError("상태는 JSON 객체여야 합니다.")
    if len(json.dumps(state, ensure_ascii=False).encode("utf-8")) > MAX_STATE_BYTES:
        raise VaultError("상태 크기가 너무 큽니다 (최대 1MB).", 413)
    return state
