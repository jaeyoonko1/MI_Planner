from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app import db, journal
from app.routers import settings
from app.vault import Vault

router = APIRouter(prefix="/api/journal")


class DayContent(BaseModel):
    content: str


def _vault(request: Request) -> Vault:
    return request.app.state.vault


@router.get("/{month}")
def get_month(request: Request, month: str) -> dict:
    return journal.get_month(_vault(request), month)


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
    return journal.put_day(_vault(request), month, dd, body.content)
