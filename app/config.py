"""Local machine config (`config/local.json`, git excluded, D-36). Holds FTP profiles; never copied into the DB or logs."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "local.json"


class ConfigError(Exception):
    def __init__(self, message: str, status: int = 422) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class FtpProfile:
    name: str
    host: str
    port: int
    user: str
    password: str
    encoding: str
    passive: bool
    timeout: float

    def secrets(self) -> list[str]:
        """Strings that must never appear in logs, run messages or API errors."""
        return [s for s in (self.host, self.user, self.password) if s]


def load_config(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise ConfigError("config/local.json을 읽을 수 없어요. JSON 형식을 확인해 주세요.") from exc
    return data if isinstance(data, dict) else {}


def _ftp_section(path: Path) -> dict[str, Any]:
    section = load_config(path).get("recipe_ftp")
    return section if isinstance(section, dict) else {}


def profile_names(path: Path) -> list[dict[str, Any]]:
    """Public view for the UI: names and non-secret options only (no host, user or password)."""
    profiles = _ftp_section(path).get("profiles")
    out: list[dict[str, Any]] = []
    if isinstance(profiles, dict):
        for name, p in profiles.items():
            if isinstance(p, dict):
                out.append({"name": str(name), "encoding": str(p.get("encoding") or "utf-8"),
                            "passive": bool(p.get("passive", True)), "ready": bool(p.get("host"))})
    return out


def get_profile(path: Path, name: str) -> FtpProfile:
    profiles = _ftp_section(path).get("profiles")
    p = profiles.get(name) if isinstance(profiles, dict) else None
    if not isinstance(p, dict) or not p.get("host"):
        raise ConfigError(f"FTP 프로필 ‘{name}’이(가) config/local.json에 없어요. recipe_ftp.profiles에 추가해 주세요.")
    env = str(p.get("password_env") or "")
    password = os.environ.get(env, "") if env else ""
    if not password:
        password = str(p.get("password") or "")
    try:
        port = int(p.get("port", 21))
        timeout = float(p.get("timeout", 20))
    except (TypeError, ValueError) as exc:
        raise ConfigError(f"FTP 프로필 ‘{name}’의 port·timeout이 숫자가 아니에요.") from exc
    return FtpProfile(name=name, host=str(p["host"]), port=port, user=str(p.get("user") or "anonymous"),
                      password=password, encoding=str(p.get("encoding") or "utf-8"),
                      passive=bool(p.get("passive", True)), timeout=min(120.0, max(2.0, timeout)))


def get_limits(path: Path) -> dict[str, int]:
    raw = _ftp_section(path).get("limits")
    return {k: int(v) for k, v in raw.items() if isinstance(v, (int, float)) and v > 0} if isinstance(raw, dict) else {}
