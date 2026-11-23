from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app import db
from app.repositories.tasks import TaskError

router = APIRouter(prefix="/api/settings")

# Whitelisted keys with defaults (SPEC section 5 settings table).
DEFAULTS: dict[str, str] = {"journal_auto_show": "on"}


class SettingIn(BaseModel):
    value: str


def read_all(db_path) -> dict[str, str]:
    conn = db.connect(db_path)
    try:
        stored = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")}
    finally:
        conn.close()
    return {**DEFAULTS, **{k: v for k, v in stored.items() if k in DEFAULTS}}


@router.get("")
def get_settings(request: Request) -> dict:
    return {"settings": read_all(request.app.state.db_path)}


@router.put("/{key}")
def put_setting(request: Request, key: str, body: SettingIn) -> dict:
    if key not in DEFAULTS:
        raise TaskError("알 수 없는 설정입니다.", 404)
    conn = db.connect(request.app.state.db_path)
    try:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, body.value),
        )
        conn.commit()
    finally:
        conn.close()
    return {"settings": read_all(request.app.state.db_path)}
