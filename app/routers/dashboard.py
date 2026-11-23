from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Request

from app import db, journal, journal_links
from app.repositories import tasks as repo

router = APIRouter(prefix="/api/dashboard")

DUE_SOON_DAYS = 3


@router.get("/today")
def today(request: Request) -> dict:
    day = date.today()
    month = f"{day.year:04d}-{day.month:02d}"
    journal_body = journal.get_month(request.app.state.vault, month)["days"].get(day.isoformat(), "")
    conn = db.connect(request.app.state.db_path)
    try:
        planned = repo.list_tasks(conn, planned_date=day.isoformat())
        due_soon = repo.list_tasks(conn, due_within=DUE_SOON_DAYS)
        overdue = repo.list_tasks(conn, overdue=True)
        marked = repo.list_tasks(conn, marked=True, open_only=True)
        planned_all = repo.list_tasks(conn, planned_date=day.isoformat())
        tasks = journal_links.task_map(conn, [journal_body])
        requesters = repo.requesters(conn)
    finally:
        conn.close()
    return {
        "date": day.isoformat(),
        "month": month,
        "journal": journal_body,
        "planned": [t for t in planned if t["status"] != "done"],
        "due_soon": due_soon,
        "overdue": overdue,
        "requesters": requesters,
        "marked": marked,
        "planned_all": planned_all,
        "tasks": tasks,
        "evaluations": [],  # filled in by P4-08
    }
