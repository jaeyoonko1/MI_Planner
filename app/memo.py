"""Issue memo <-> page body unification (P2B-10, D-29).

Single source of truth: when an issue has a page (_page.json.task_id), the page's index.md IS the memo.
`tasks.note` is only a mirror (search, copy, list previews) that is refreshed on every read/write below.
Issues without a page keep the memo in `tasks.note` (markdown text, same format as a note page).

Older data may have a page body and a memo that drifted apart (P2B-09 copied the memo once, then they were
independent). The first time such a pair is touched it is merged WITHOUT losing either side and the page is
stamped `memo_unified`, after which the two never diverge again.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any

from app import placement
from app.repositories import tasks as repo
from app.vault import Vault, VaultError

FLAG = "memo_unified"
BACKUP = "memo_before_merge"
MERGE_HEADING = "## 통합 전 이슈 메모"


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def merge_texts(body: str, note: str) -> tuple[str, bool]:
    """Combine a page body and an old memo. Returns (text, merged) - merged is True only when both had
    different content, in which case the memo is appended under a heading so nothing is dropped."""
    b, n = (body or "").strip(), (note or "").strip()
    body_key = b.replace("\r\n", "\n").replace("\r", "\n")
    note_key = n.replace("\r\n", "\n").replace("\r", "\n")
    if not n or note_key == body_key:
        return body or "", False
    if not b:
        return note, False
    if note_key in body_key:  # the memo text is already part of the body
        return body, False
    return f"{body.rstrip()}\n\n{MERGE_HEADING}\n\n{n}\n", True


def _mirror(conn: sqlite3.Connection, task_id: int, text: str) -> None:
    value = text if text.strip() else None
    conn.execute("UPDATE tasks SET note = ? WHERE id = ? AND note IS NOT ?", (value, task_id, value))
    conn.commit()


def adopt(conn: sqlite3.Connection, vault: Vault, task: dict[str, Any], page_rel: str) -> bool:
    """Make page body and memo one text (once). Returns True when a real merge of differing texts happened."""
    page = vault.read(page_rel)
    if page["meta"].get(FLAG):
        return False
    text, merged = merge_texts(page["content"], task.get("note") or "")
    extra: dict[str, Any] = {FLAG: _now()}
    if merged:
        extra[BACKUP] = task.get("note")  # the old memo, verbatim, in the human-readable meta file
    if text != page["content"]:
        vault.write(page_rel, text)
    vault.set_meta(page_rel, **extra)
    _mirror(conn, task["id"], text)
    return merged


def read(conn: sqlite3.Connection, vault: Vault, task_id: int) -> dict[str, Any]:
    """The task with its memo taken from the page when it has one. `memo_merged` tells the UI to say so."""
    task = repo.get(conn, task_id)
    rel = placement.existing_page(vault, task)
    if not rel:
        return task
    merged = adopt(conn, vault, task, rel)
    content = vault.read(rel)["content"]
    if (task.get("note") or "") != content and (content.strip() or task.get("note")):
        _mirror(conn, task_id, content)  # a file edited outside the app wins
    if rel != task.get("page_path"):
        conn.execute("UPDATE tasks SET page_path = ? WHERE id = ?", (rel, task_id))
        conn.commit()
    task = repo.get(conn, task_id)
    return {**task, "note": content if content.strip() else None, "memo_merged": merged}


def write_note(conn: sqlite3.Connection, vault: Vault, before: dict[str, Any], note: str | None) -> None:
    """A PATCH of `note` (call BEFORE repo.update, with the task as it was): the text goes into the page body
    when the issue has a page. An un-unified pair is merged first so the old texts survive in the meta backup."""
    rel = placement.existing_page(vault, before)
    if not rel:
        return
    adopt(conn, vault, before, rel)
    vault.write(rel, note or "")


def before_page_write(conn: sqlite3.Connection, vault: Vault, rel: str) -> int | None:
    """A page body is about to be replaced. If it belongs to an issue, adopt first. Returns the task id."""
    tid = vault.read(rel)["meta"].get("task_id")
    if tid is None:
        return None
    try:
        task = repo.get(conn, int(tid))
    except repo.TaskError:
        return None  # orphaned page: behaves like any note
    adopt(conn, vault, task, rel)
    return int(tid)


def after_page_write(conn: sqlite3.Connection, task_id: int, content: str) -> None:
    _mirror(conn, task_id, content)


def sweep(conn: sqlite3.Connection, vault: Vault) -> int:
    """Startup pass: unify every issue that already has a page. Returns how many were merged (differing)."""
    merged = 0
    for t in repo.list_tasks(conn):
        if not t.get("page_path"):
            continue
        try:
            rel = placement.existing_page(vault, t)
            if rel and adopt(conn, vault, t, rel):
                merged += 1
        except Exception:  # noqa: BLE001 - one broken page must not block startup
            continue
    return merged


# ---- attachments of an issue ------------------------------------------------------------------

def save_file(conn: sqlite3.Connection, vault: Vault, task_id: int, name: str, data: bytes) -> str:
    task = repo.get(conn, task_id)
    rel = placement.existing_page(vault, task)
    return vault.save_file(rel, name, data) if rel else vault.save_issue_file(task_id, name, data)


def file_path(conn: sqlite3.Connection, vault: Vault, task_id: int, name: str):
    task = repo.get(conn, task_id)
    rel = placement.existing_page(vault, task)
    if rel:
        try:
            return vault.file_path(rel, name)
        except VaultError:
            pass  # not in the page folder: it may still sit in the issue's own folder
    return vault.issue_file_path(task_id, name)


def copy_files(conn: sqlite3.Connection, vault: Vault, src_id: int, dst_id: int) -> None:
    """A copied issue gets its own copy of every image its memo uses (never shared with the original)."""
    try:
        task = repo.get(conn, src_id)
        rel = placement.existing_page(vault, task)
        vault.copy_issue_files(rel, src_id, dst_id)
    except Exception:  # noqa: BLE001 - images are secondary to the copy itself
        pass
