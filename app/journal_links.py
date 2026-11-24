"""Keeps journal lines and tasks in step (P2B-05): one ID, one truth.

A journal line linked to a task ends with ` → 할일 #<id>`. Once linked, the task row and the
line mirror each other:

* task changed (title, status, mark, planned_date)  ->  `after_task_change` rewrites, moves
  or creates the linked line in the vault.
* a journal day was saved                            ->  `sync_day` pushes line edits (title, check,
  star/urgent, pasted/removed links) back to the tasks.

Pure line helpers have no I/O; the rest takes the Vault and a DB connection explicitly.
"""
from __future__ import annotations

import re
import sqlite3
from typing import Any

from app import journal
from app.inline_format import strip_inline
from app.repositories import tasks as repo
from app.vault import Vault

LINK_MARK = "→ 할일 #"
_LINE = re.compile(r"^(?P<ind>\s*)(?P<b>[-*])\s+\[(?P<m>[ xX*!])\]\s?(?P<rest>.*)$")
_TAIL = re.compile(r"\s*→ 할일 #(?P<id>\d+)\s*$")
_SYMBOL_TO_MARK = {" ": None, "*": "star", "!": "urgent"}
_MARK_TO_SYMBOL = {None: " ", "star": "*", "urgent": "!"}


# ---- pure helpers ------------------------------------------------------------------
def parse_line(raw: str) -> dict[str, Any] | None:
    """Checkbox line -> {ind, bullet, sym, title, id}; None for any other line."""
    m = _LINE.match(raw)
    if not m:
        return None
    rest = m.group("rest")
    t = _TAIL.search(rest)
    return {
        "ind": m.group("ind"), "bullet": m.group("b"), "sym": m.group("m").lower(),
        "title": rest[: t.start()] if t else rest, "id": int(t.group("id")) if t else None,
    }


def clean_title(text: str) -> str:
    return strip_inline(text).strip()


def _shown_title(line_title: str | None, task_title: str) -> str:
    """Keep a line's inline formatting (V-003) when its plain text still is the task title."""
    return line_title if line_title and clean_title(line_title) == task_title else task_title


def symbol(status: str, mark: str | None) -> str:
    return "x" if status == "done" else _MARK_TO_SYMBOL.get(mark, " ")


def build_line(ind: str, sym: str, title: str, task_id: int, bullet: str = "-") -> str:
    return f"{ind}{bullet} [{sym}] {title} {LINK_MARK}{task_id}"


def unlink(raw: str) -> str:
    return _TAIL.sub("", raw)


def link_ids(text: str) -> list[int]:
    return [int(m.group("id")) for raw in text.split("\n") if (m := _TAIL.search(raw))]


def block_end(lines: list[str], idx: int) -> int:
    """Index after the line at `idx` and its deeper-indented children (a blank line ends it)."""
    base = len(lines[idx]) - len(lines[idx].lstrip(" "))
    end = idx + 1
    while end < len(lines) and lines[end].strip() and len(lines[end]) - len(lines[end].lstrip(" ")) > base:
        end += 1
    return end


# ---- vault access ----------------------------------------------------------------------
class _Docs:
    """Month files read once, edited as day -> lines, written back together."""

    def __init__(self, vault: Vault) -> None:
        self.vault = vault
        self._days: dict[str, list[str]] = {}
        self._loaded: set[str] = set()
        self._dirty: set[str] = set()

    def months(self) -> list[str]:
        if not self.vault.exists(journal.JOURNAL_ROOT):
            return []
        out: list[str] = []
        for year in self.vault.tree(self.vault.root / journal.JOURNAL_ROOT):
            for node in year["children"]:
                leaf = node["path"].rsplit("/", 1)[-1]
                if re.fullmatch(r"\d{4}-\d{2}", leaf):
                    out.append(leaf)
        return sorted(out)

    def _load_month(self, month: str) -> None:
        if month in self._loaded:
            return
        self._loaded.add(month)
        path = journal.month_path(month)
        if self.vault.exists(path):
            _, days = journal.parse(self.vault.read(path)["content"])
            for d, body in days.items():
                self._days[d] = body.split("\n") if body else []

    def lines(self, day: str) -> list[str]:
        self._load_month(day[:7])
        return self._days.setdefault(day, [])

    def put(self, day: str, lines: list[str]) -> None:
        self._load_month(day[:7])
        self._days[day] = lines
        self._dirty.add(day)

    def find(self, task_id: int) -> list[tuple[str, int]]:
        for month in self.months():
            self._load_month(month)
        hits: list[tuple[str, int]] = []
        for day in sorted(self._days):
            for i, raw in enumerate(self._days[day]):
                p = parse_line(raw)
                if p and p["id"] == task_id:
                    hits.append((day, i))
        return hits

    def flush(self) -> dict[str, str]:
        """Write dirty days; returns {day: body} of what changed."""
        out: dict[str, str] = {}
        for month in sorted({d[:7] for d in self._dirty}):
            path = journal.ensure_month(self.vault, month)
            text = self.vault.read(path)["content"]
            for day in sorted(d for d in self._dirty if d[:7] == month):
                body = "\n".join(self._days[day]).strip("\n")
                text = journal.set_day(text, day, body)
                out[day] = body
            self.vault.write(path, text)
        self._dirty.clear()
        return out


def _drop_or_unlink(docs: _Docs, day: str, idx: int) -> None:
    """Remove a linked line that has no children; otherwise keep its text and cut the link."""
    lines = list(docs.lines(day))
    if block_end(lines, idx) == idx + 1:
        del lines[idx]
    else:
        lines[idx] = unlink(lines[idx])
    docs.put(day, lines)


def _append_block(docs: _Docs, day: str, block: list[str]) -> None:
    lines = list(docs.lines(day))
    while lines and not lines[-1].strip():
        lines.pop()
    docs.put(day, lines + block)


def after_task_change(vault: Vault, before: dict | None, after: dict | None) -> dict[str, str]:
    """Reflect a task create/update/delete into the journal. Returns {day: new body}."""
    docs = _Docs(vault)
    if after is None:
        assert before is not None
        for day, idx in reversed(docs.find(before["id"])):
            lines = list(docs.lines(day))
            lines[idx] = unlink(lines[idx])
            docs.put(day, lines)
        return docs.flush()
    watched = ("title", "status", "mark", "planned_date")
    if before is not None and all(before.get(k) == after.get(k) for k in watched):
        return {}
    tid, planned = after["id"], after.get("planned_date")
    sym = symbol(after["status"], after.get("mark"))
    found = docs.find(tid) if (before is not None or planned) else []
    if not found:
        if planned:
            _append_block(docs, planned, [build_line("", sym, after["title"], tid)])
        return docs.flush()
    if not planned:
        for day, idx in reversed(found):
            _drop_or_unlink(docs, day, idx)
        return docs.flush()
    primary = next((h for h in found if h[0] == planned), found[0])
    for day, idx in reversed([h for h in found if h != primary]):
        _drop_or_unlink(docs, day, idx)
    day, idx = primary
    lines = list(docs.lines(day))
    p = parse_line(lines[idx]) or {"ind": "", "bullet": "-"}
    fresh = build_line(p["ind"], sym, _shown_title(p.get("title"), after["title"]), tid, p["bullet"])
    if day == planned:
        lines[idx] = fresh
        docs.put(day, lines)
    else:  # move the line with its children; the moved parent starts at depth 0
        end = block_end(lines, idx)
        cut = len(p["ind"])
        block = [fresh[cut:]] + [l[cut:] if l[:cut].strip() == "" else l.lstrip() for l in lines[idx + 1:end]]
        del lines[idx:end]
        docs.put(day, lines)
        _append_block(docs, planned, block)
    return docs.flush()


def sync_day(
    vault: Vault, conn: sqlite3.Connection, day: str, old_body: str, new_body: str
) -> tuple[str, list[dict], dict[str, str]]:
    """A day's text was saved: push linked-line edits to the tasks.

    Returns (normalized body to store, updated tasks, other days rewritten)."""
    out: list[str] = []
    seen: set[int] = set()
    updated: dict[int, dict] = {}
    moved_here: list[int] = []
    for raw in new_body.split("\n") if new_body else []:
        p = parse_line(raw)
        if not p or p["id"] is None:
            out.append(raw)
            continue
        tid = p["id"]
        try:
            task = repo.get(conn, tid)
        except repo.TaskError:  # link to a deleted task
            out.append(unlink(raw))
            continue
        if tid in seen:  # a copied line must not duplicate the issue
            out.append(unlink(raw))
            continue
        seen.add(tid)
        patch: dict[str, Any] = {}
        title = clean_title(p["title"])
        if title and title != task["title"]:
            patch["title"] = title
        sym = p["sym"]
        if sym == "x":
            if task["status"] != "done":
                patch["status"] = "done"
        else:
            if task["status"] == "done":
                patch["status"] = "todo"
                if sym == " " and task["mark"]:  # un-checking a starred task restores its star
                    sym = _MARK_TO_SYMBOL[task["mark"]]
            if _SYMBOL_TO_MARK[sym] != task["mark"]:
                patch["mark"] = _SYMBOL_TO_MARK[sym]
        if task["planned_date"] != day:
            patch["planned_date"] = day
            moved_here.append(tid)
        if patch:
            updated[tid] = repo.update(conn, tid, patch)
        cur = updated.get(tid, task)
        shown = p["title"] if clean_title(p["title"]) else cur["title"]
        out.append(build_line(p["ind"], symbol(cur["status"], cur["mark"]), shown, tid, p["bullet"]))
    # links that disappeared from this day: the plan on this day is gone, the task stays
    for tid in set(link_ids(old_body)) - seen:
        try:
            task = repo.get(conn, tid)
        except repo.TaskError:
            continue
        if task["planned_date"] == day:
            updated[tid] = repo.update(conn, tid, {"planned_date": None})
    others: dict[str, str] = {}
    if moved_here:
        docs = _Docs(vault)
        for tid in moved_here:
            for d, idx in reversed([h for h in docs.find(tid) if h[0] != day]):
                _drop_or_unlink(docs, d, idx)
        others = docs.flush()
    return "\n".join(out), list(updated.values()), others


def task_map(conn: sqlite3.Connection, bodies: list[str]) -> dict[str, dict]:
    """{id: task} for every task linked from the given journal bodies."""
    ids = sorted({i for b in bodies for i in link_ids(b)})
    if not ids:
        return {}
    return {str(t["id"]): t for t in repo.list_tasks(conn, ids=ids)}
