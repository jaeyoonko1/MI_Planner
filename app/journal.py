"""Monthly journal: one page per month, one `## YYYY-MM-DD` section per day.

Format (human/LLM readable, see SPEC 4.2):

    ## 2026-11-24
    - [ ] item
"""
from __future__ import annotations

import calendar
import re
from datetime import date

from app.vault import Vault, VaultError

JOURNAL_ROOT = "일지"
_DAY_HEADING = re.compile(r"^## (\d{4}-\d{2}-\d{2})\s*$")
_MONTH = re.compile(r"^(\d{4})-(\d{2})$")


# ---- pure text functions ---------------------------------------------------
def parse(text: str) -> tuple[str, dict[str, str]]:
    """Return (preamble, {iso_date: body}). Only date headings split sections,
    and headings inside code fences are ignored."""
    preamble: list[str] = []
    days: dict[str, list[str]] = {}
    current: list[str] = preamble
    in_fence = False
    for line in text.splitlines():
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
        m = None if in_fence else _DAY_HEADING.match(line)
        if m:
            current = days.setdefault(m.group(1), [])
        else:
            current.append(line)
    return _clean(preamble), {d: _clean(lines) for d, lines in days.items()}


def _clean(lines: list[str]) -> str:
    return "\n".join(lines).strip("\n")


def render(preamble: str, days: dict[str, str]) -> str:
    parts = [preamble] if preamble.strip() else []
    for day in sorted(days):
        body = days[day]
        parts.append(f"## {day}\n{body}" if body else f"## {day}")
    return "\n\n".join(parts) + "\n" if parts else ""


def set_day(text: str, day: str, body: str) -> str:
    """Replace one day's section; an empty body removes the section."""
    preamble, days = parse(text)
    body = body.strip("\n")
    if body.strip():
        days[day] = body
    else:
        days.pop(day, None)
    return render(preamble, days)


# ---- vault-backed operations ----------------------------------------------
def _split_month(month: str) -> tuple[int, int]:
    m = _MONTH.match(month)
    if not m or not 1 <= int(m.group(2)) <= 12:
        raise VaultError("월 형식은 YYYY-MM 이어야 합니다.")
    return int(m.group(1)), int(m.group(2))


def month_path(month: str) -> str:
    year, _ = _split_month(month)
    return f"{JOURNAL_ROOT}/{year}/{month}"


def ensure_month(vault: Vault, month: str) -> str:
    """Create 일지/<year>/<yyyy-mm> (and parents) if missing; return its path."""
    year, mm = _split_month(month)
    root, year_path, path = JOURNAL_ROOT, f"{JOURNAL_ROOT}/{year}", month_path(month)
    if not vault.exists(root):
        vault.create("", JOURNAL_ROOT, "note")
    if not vault.exists(year_path):
        vault.create(root, str(year), "note")
    if not vault.exists(path):
        vault.create(year_path, f"{year}년 {mm}월", "journal", folder_name=month)
    return path


def get_month(vault: Vault, month: str) -> dict:
    path = ensure_month(vault, month)
    _, days = parse(vault.read(path)["content"])
    return {"month": month, "path": path, "days": days}


_CHECKBOX = re.compile(r"^(\s*[-*]\s+\[)([ xX*!])(\]\s?)(.*)$")
LINK_MARK = "→ 할일 #"
_MARK_TAGS = re.compile(r"</?mark>")
_ID_LINK = re.compile(r"→ 할일 #(\d+)\s*$")


def promote_line(vault: Vault, day: str, line_index: int, create_task, find_existing=None) -> dict:
    """Turn a checkbox line of `day` into a task and leave a link on the line.

    `create_task(spec) -> task dict` and `find_existing(title, day) -> task | None` are injected
    so this module stays DB-free. An open task with the same title already planned for that day
    is linked instead of duplicated; if that task already has a line on the day, promotion is refused.
    """
    try:
        d = date.fromisoformat(day)
    except ValueError:
        raise VaultError("날짜 형식은 YYYY-MM-DD 이어야 합니다.") from None
    month = f"{d.year:04d}-{d.month:02d}"
    path = ensure_month(vault, month)
    text = vault.read(path)["content"]
    _, days = parse(text)
    lines = days.get(day, "").split("\n")
    if not 0 <= line_index < len(lines):
        raise VaultError("해당 줄을 찾을 수 없습니다. 화면을 새로고침하세요.", 404)
    m = _CHECKBOX.match(lines[line_index])
    title = _MARK_TAGS.sub("", m.group(4)).strip() if m else ""
    if not m or not title:
        raise VaultError("체크박스 줄(- [ ] 내용)만 할일로 만들 수 있습니다.")
    if LINK_MARK in m.group(4):
        raise VaultError("이미 할일로 만든 줄입니다.")
    mark = m.group(2).lower()
    task = find_existing(title, day) if find_existing else None
    reused = task is not None
    if reused:
        linked = {int(x.group(1)) for ln in lines if (x := _ID_LINK.search(ln))}
        if task["id"] in linked:
            raise VaultError("이 날짜 일지에 같은 할일이 이미 연결되어 있습니다.", 409)
    else:
        task = create_task({
            "title": title, "planned_date": day,
            "status": "done" if mark == "x" else "todo",
            "mark": {"*": "star", "!": "urgent"}.get(mark),
            **({"priority": 1} if mark == "!" else {}),
        })
    symbol = "x" if task["status"] == "done" else m.group(2)
    lines[line_index] = f"{m.group(1)}{symbol}{m.group(3)}{m.group(4).strip()} {LINK_MARK}{task['id']}"
    vault.write(path, set_day(text, day, "\n".join(lines)))
    return {"task": task, "reused": reused, **get_month(vault, month)}


def put_day(vault: Vault, month: str, dd: int, content: str) -> dict:
    year, mm = _split_month(month)
    if not 1 <= dd <= calendar.monthrange(year, mm)[1]:
        raise VaultError("해당 월에 없는 날짜입니다.")
    day = date(year, mm, dd).isoformat()
    path = ensure_month(vault, month)
    text = set_day(vault.read(path)["content"], day, content)
    vault.write(path, text)
    return get_month(vault, month)
