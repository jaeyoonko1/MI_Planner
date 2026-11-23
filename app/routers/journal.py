from __future__ import annotations

import calendar
from datetime import date

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app import db, journal, journal_links
from app.routers import settings
from app.vault import Vault

router = APIRouter(prefix="/api/journal")


class DayContent(BaseModel):
    content: str


def _vault(request: Request) -> Vault:
    return request.app.state.vault


@router.get("/{month}")
def get_month(request: Request, month: str) -> dict:
    data = journal.get_month(_vault(request), month)
    conn = db.connect(request.app.state.db_path)
    try:
        data["tasks"] = journal_links.task_map(conn, list(data["days"].values()))
    finally:
        conn.close()
    return data


@router.get("/{month}/auto")
def get_auto(request: Request, month: str) -> dict:
    """Read-only extras for the grid: open tasks due per day (never written to the file)."""
    journal.month_path(month)  # validates the format
    enabled = settings.read_all(request.app.state.db_path)["journal_auto_show"] == "on"
    days: dict[str, list[dict]] = {}
    if enabled:
        conn = db.connect(request.app.state.db_path)
        try:
            rows = conn.execute(
                "SELECT id, title, status, priority, due_date FROM tasks "
                "WHERE due_date LIKE ? AND status != 'done' ORDER BY priority, id",
                (f"{month}-%",),
            )
            for r in rows:
                days.setdefault(r["due_date"], []).append(dict(r))
        finally:
            conn.close()
    return {"month": month, "enabled": enabled, "days": days}


@router.put("/{month}/{dd}")
def put_day(request: Request, month: str, dd: int, body: DayContent) -> dict:
    """Save one day. Linked lines (`→ 할일 #id`) are synced to their tasks first (P2B-05);
    `content` is the stored (normalized) body, `changed` the tasks updated by this save."""
    vault = _vault(request)
    year, mm = journal._split_month(month)
    if not 1 <= dd <= calendar.monthrange(year, mm)[1]:
        raise journal.VaultError("해당 월에 없는 날짜입니다.")
    day = date(year, mm, dd).isoformat()
    old = journal.get_month(vault, month)["days"].get(day, "")
    conn = db.connect(request.app.state.db_path)
    try:
        content, changed, others = journal_links.sync_day(vault, conn, day, old, body.content.strip(chr(10)))
        data = journal.put_day(vault, month, dd, content)
        data["tasks"] = journal_links.task_map(conn, list(data["days"].values()))
    finally:
        conn.close()
    return {**data, "content": content, "changed": [t["id"] for t in changed], "other_days": others}
