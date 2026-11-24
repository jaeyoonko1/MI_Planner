"""Vendor mapping files (P6-01 format + validation, D-19 / D-36). Applying a mapping to params is P6-03.

Search order: config/recipe_mappings/<name>.json (git excluded — real company mappings, D-17) overrides
parsers/mappings/<name>.json (committed — fake examples only).
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SEARCH_DIRS = (ROOT / "config" / "recipe_mappings", ROOT / "parsers" / "mappings")
FORMAT = "mi-planner-recipe-mapping"
FORMAT_VERSION = 1
_NAME = re.compile(r"^[A-Za-z0-9_-]{1,60}$")
COMPARE = {"text", "number"}


class MappingError(Exception):
    pass


def validate(data: Any) -> list[str]:
    """Return a list of Korean problems (empty = valid)."""
    if not isinstance(data, dict):
        return ["매핑 파일은 JSON 객체여야 해요."]
    errs: list[str] = []
    if data.get("format") != FORMAT:
        errs.append(f"format은 '{FORMAT}'이어야 해요.")
    ver = data.get("format_version")
    if not isinstance(ver, int) or isinstance(ver, bool):
        errs.append("format_version(숫자)이 필요해요.")
    elif ver > FORMAT_VERSION:
        errs.append("더 새로운 매핑 형식이에요. 앱을 업데이트하세요.")
    for key in ("vendor", "mapping_version"):
        if not isinstance(data.get(key), str) or not data[key].strip():
            errs.append(f"{key}(문자열)가 필요해요.")
    files = data.get("files")
    if not isinstance(files, list) or not files:
        errs.append("files 규칙이 1개 이상 필요해요.")
    else:
        for i, f in enumerate(files):
            if not (isinstance(f, dict) and isinstance(f.get("match"), str) and isinstance(f.get("parser"), str)):
                errs.append(f"files[{i}]에는 match와 parser가 필요해요.")
    for i, p in enumerate(data.get("params", [])):
        if not isinstance(p, dict) or not (isinstance(p.get("path"), str) or isinstance(p.get("path_glob"), str)):
            errs.append(f"params[{i}]에는 path 또는 path_glob이 필요해요.")
        elif p.get("compare", "text") not in COMPARE:
            errs.append(f"params[{i}].compare는 text 또는 number예요.")
        elif "tolerance" in p and not isinstance(p["tolerance"], (int, float)):
            errs.append(f"params[{i}].tolerance는 숫자예요.")
    if not isinstance(data.get("ignore", []), list):
        errs.append("ignore는 목록이어야 해요.")
    return errs


def load(name: str, dirs: tuple[Path, ...] = SEARCH_DIRS) -> dict[str, Any]:
    if not _NAME.match(name):
        raise MappingError("매핑 이름은 영문·숫자·_- 60자 이하예요.")
    for d in dirs:
        path = d / f"{name}.json"
        if path.is_file():
            try:
                data = json.loads(path.read_text(encoding="utf-8-sig"))
            except ValueError as exc:
                raise MappingError(f"{path.name}: JSON 형식 오류 ({exc})") from exc
            errs = validate(data)
            if errs:
                raise MappingError(f"{path.name}: " + " / ".join(errs))
            return data
    raise MappingError(f"매핑 파일을 찾을 수 없어요: {name}")
