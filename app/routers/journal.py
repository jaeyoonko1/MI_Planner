from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app import journal
from app.vault import Vault

router = APIRouter(prefix="/api/journal")


class DayContent(BaseModel):
    content: str


def _vault(request: Request) -> Vault:
    return request.app.state.vault


@router.get("/{month}")
def get_month(request: Request, month: str) -> dict:
    return journal.get_month(_vault(request), month)


@router.put("/{month}/{dd}")
def put_day(request: Request, month: str, dd: int, body: DayContent) -> dict:
    return journal.put_day(_vault(request), month, dd, body.content)
