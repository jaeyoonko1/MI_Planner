from __future__ import annotations

import re
import sqlite3
import unicodedata
from html.parser import HTMLParser
from typing import Callable, Iterator

from app import excel_table_search
from app.inline_format import strip_inline
from app.repositories import tasks
from app.vault import Vault, VaultError

_TOKEN = re.compile(r"<!--|\\.|(?P<ticks>\x60+)(?!\x60).*?(?<!\x60)(?P=ticks)(?!\x60)|\[\[([^\[\]\r\n]+)\]\]")
_FENCE = re.compile(r"^ {0,3}(\x60{3,}|~{3,})(.*)$")



def _key(value: str) -> str:
    return unicodedata.normalize("NFC", value.strip()).lower()


def _pages(nodes: list[dict]) -> Iterator[dict]:
    for node in nodes:
        yield node
        yield from _pages(node["children"])


def _body(vault: Vault, path: str) -> str:
    try:
        return vault.read(path)["content"]
    except (VaultError, FileNotFoundError, UnicodeError):
        return ""


class _HtmlText(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.hidden: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self.hidden = tag

    def handle_endtag(self, tag: str) -> None:
        if tag == self.hidden:
            self.hidden = None

    def handle_data(self, data: str) -> None:
        if self.hidden is None:
            self.parts.append(data)


_FORMAT_HINT = re.compile(r"[*~<\\]")


def _markdown_plain(text: str) -> str:
    # Inline formatting (V-003) must not split a word the user searches for.
    return "\n".join(strip_inline(line) if _FORMAT_HINT.search(line) else line for line in text.split("\n"))


def _plain(text: str, kind: str) -> str:
    if kind != "html":
        return excel_table_search.project(text, _markdown_plain)
    parser = _HtmlText()
    parser.feed(text)
    parser.close()
    return " ".join(parser.parts)


def task_list_body(vault: Vault) -> Callable[[int, str], str]:
    """Read linked pages on demand. Opening the filtered list does not refresh the DB mirror."""
    linked = {
        page["task_id"]: (page["path"], page["type"])
        for page in _pages(vault.tree()) if page["task_id"] is not None
    }

    def body(task_id: int, note: str) -> str:
        if task_id in linked:
            path, kind = linked[task_id]
            note = _body(vault, path)
            if kind == "html":
                return _plain(note, kind)
        return excel_table_search.project(note)

    return body


def _match(title: str, detail: str, body: str, query: str) -> tuple[int, str] | None:
    title_key = _key(title)
    if title_key == query:
        return 0, ""
    if title_key.startswith(query):
        return 1, ""
    if query in title_key:
        return 2, ""
    if query in _key(detail):
        return 3, ""
    text = unicodedata.normalize("NFC", " ".join(body.split()))
    index = text.lower().find(query)
    if index < 0:
        return None
    start = max(index - 36, 0)
    end = min(index + len(query) + 66, len(text))
    return 4, ("…" if start else "") + text[start:end] + ("…" if end < len(text) else "")


def _results(found: list[tuple[int, dict]], limit: int) -> list[dict]:
    found.sort(key=lambda entry: (entry[0], _key(entry[1]["title"]), entry[1].get("path") or ""))
    return [item for _, item in found[:limit]]


def search(vault: Vault, conn: sqlite3.Connection, query: str, limit: int) -> dict:
    query = _key(query)
    if not query:
        return {"pages": [], "tasks": []}

    page_hits: list[tuple[int, dict]] = []
    linked: dict[int, tuple[str, str]] = {}
    for page in _pages(vault.tree()):
        path, title, kind = page["path"], page["title"], page["type"]
        body = _plain(_body(vault, path), kind)
        if page["task_id"] is not None:
            linked[page["task_id"]] = (path, body)
        match = _match(title, path, body, query)
        if match:
            score, snippet = match
            page_hits.append((score, {"title": title, "path": path, "type": kind, "snippet": snippet}))

    task_hits: list[tuple[int, dict]] = []
    for task in tasks.list_tasks(conn):
        tid, title = task["id"], task["title"]
        if tid in linked:
            path, body = linked[tid]
        else:
            path, body = None, excel_table_search.project(task.get("note") or "")
        match = _match(title, f"#{tid} {path or ''}", body, query)
        if match:
            score, snippet = match
            task_hits.append((score, {"id": tid, "title": title, "path": path, "snippet": snippet}))
    return {"pages": _results(page_hits, limit), "tasks": _results(task_hits, limit)}


def _wiki_targets(text: str) -> Iterator[str]:
    fence: str | None = None
    comment = False
    for line in text.splitlines():
        start = _FENCE.match(line) if not comment else None
        if fence is not None:
            if start and start[1][0] == fence[0] and len(start[1]) >= len(fence) and not start[2].strip():
                fence = None
            continue
        if start:
            fence = start[1]
            continue
        offset = 0
        while offset < len(line):
            if comment:
                end = line.find("-->", offset)
                if end < 0:
                    break
                offset = end + 3
                comment = False
            match = _TOKEN.search(line, offset)
            if not match:
                break
            offset = match.end()
            if match[0] == "<!--":
                comment = True
            elif match[2] and match[2].strip():
                yield _key(match[2])


def backlinks(vault: Vault, path: str) -> list[dict]:
    target = vault.read(path)
    pages = list(_pages(vault.tree()))
    by_path = {_key(page["path"]): page["path"] for page in pages}
    by_title: dict[str, list[str]] = {}
    for page in pages:
        by_title.setdefault(_key(page["title"]), []).append(page["path"])

    def resolve(token: str) -> str | None:
        if token in by_path:
            return by_path[token]
        matches = by_title.get(token, [])
        return matches[0] if len(matches) == 1 else None

    linked = []
    for page in pages:
        if page["path"] == target["path"] or page["type"] == "html":
            continue
        if any(resolve(token) == target["path"] for token in _wiki_targets(_body(vault, page["path"]))):
            linked.append({"title": page["title"], "path": page["path"]})
    return sorted(linked, key=lambda page: (_key(page["title"]), _key(page["path"])))
