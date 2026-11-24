"""Stage wait-time rules (P4-06, D-09).

Wait time is never stored. It is derived on every query from the newest `eval_stage_log` entry
of a cell: wait = now - entered_at (calendar hours, no business-day calendar). Level 1 = past the stage's
`warn_hours`, level 2 = past twice that. All ISO strings are Asia/Seoul; a string without an offset is
read as Asia/Seoul (Korea has no DST, so a fixed +09:00 is exact).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

SEOUL = timezone(timedelta(hours=9), "Asia/Seoul")
MAX_WARN_HOURS = 24 * 365


def parse_at(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        when = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return when if when.tzinfo else when.replace(tzinfo=SEOUL)


def now_seoul() -> datetime:
    return datetime.now(SEOUL)


def wait_hours(entered_at: str | None, now: datetime) -> float | None:
    """Hours since the cell entered its stage; None when unknown. A future time (clock skew) counts as 0."""
    when = parse_at(entered_at)
    if when is None:
        return None
    return max(0.0, (now - when).total_seconds() / 3600)


def warn_level(hours: float | None, warn_hours: float | None) -> int:
    """0 = fine or no threshold, 1 = over warn_hours, 2 = over twice warn_hours."""
    if hours is None or not warn_hours or warn_hours <= 0:
        return 0
    return 2 if hours > warn_hours * 2 else 1 if hours > warn_hours else 0


def cell_wait(
    cell: dict[str, Any], stages: list[dict[str, Any]], entered_at: str | None, entered_stage: str | None, now: datetime,
) -> tuple[float | None, int]:
    """(wait hours, level) for one board cell.

    No wait for excluded or unassigned cells, for the last (finished) stage, or when the newest log
    entry does not match the cell's current stage (inconsistent history is reported as unknown).
    """
    key = cell["stage_key"]
    if cell["excluded"] or not key or not stages or key == stages[-1]["key"]:
        return None, 0
    stage = next((s for s in stages if s["key"] == key), None)
    if stage is None or entered_stage != key:
        return None, 0
    hours = wait_hours(entered_at, now)
    return (None if hours is None else round(hours, 2)), warn_level(hours, stage.get("warn_hours"))
