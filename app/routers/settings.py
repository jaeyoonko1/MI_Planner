from __future__ import annotations

import json

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app import db
from app.repositories.tasks import TaskError

router = APIRouter(prefix="/api/settings")

# Whitelisted keys with defaults (SPEC section 5 settings table).
DEFAULTS: dict[str, str] = {"journal_auto_show": "on", "theme": "system", "density": "normal",
            "memo_folds": "{}", "mos_mapping": "", "plan_mapping": ""}
# Keys with a closed set of values (D-23 theme, density). Other keys accept any string.
CHOICES: dict[str, set[str]] = {
    "theme": {"system", "light", "dark"},
    "density": {"compact", "normal", "cozy"},
}


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
    if key in CHOICES and body.value not in CHOICES[key]:
        raise TaskError("허용되지 않는 설정 값입니다.", 400)
    if key == "mos_mapping":
        try:
            data = json.loads(body.value) if body.value else {}
            ok = isinstance(data, dict) and len(body.value) < 20_000 and all(
                isinstance(v, (str, dict)) for v in data.values())
        except ValueError:
            ok = False
        if not ok:
            raise TaskError("MOS 열 매핑 형식이 올바르지 않습니다.", 400)
    if key == "plan_mapping":
        try:
            data = json.loads(body.value) if body.value else {}
            ok = isinstance(data, dict) and len(body.value) < 20_000 and all(isinstance(v, str) for v in data.values())
        except ValueError:
            ok = False
        if not ok:
            raise TaskError("Plan 열 지정 형식이 올바르지 않습니다.", 400)
    if key == "memo_folds":
        try:
            ok = isinstance(json.loads(body.value), dict) and len(body.value) < 200_000
        except ValueError:
            ok = False
        if not ok:
            raise TaskError("접힘 상태 형식이 올바르지 않습니다.", 400)
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
