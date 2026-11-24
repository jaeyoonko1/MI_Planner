"""Vendor mapping files (P6-01 format + validation, D-19 / D-36; selection + application P6-03, D-38).

Search order: config/recipe_mappings/<name>.json (git excluded — real company mappings, D-17) overrides
parsers/mappings/<name>.json (committed — fake examples only).
"""
from __future__ import annotations

import fnmatch
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
            elif not isinstance(f.get("options", {}), dict):
                errs.append(f"files[{i}].options는 JSON 객체예요.")
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


def load(name: str, dirs: tuple[Path, ...] | None = None) -> dict[str, Any]:
    dirs = dirs or SEARCH_DIRS  # resolved at call time so tests can point it at a temp folder
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


# ---- selection ----------------------------------------------------------------------------------------------------

def available(dirs: tuple[Path, ...] | None = None) -> list[dict[str, Any]]:
    """Every mapping file found ([{name, vendor, models, mapping_version, description, error}]); the first dir wins."""
    dirs = dirs or SEARCH_DIRS
    out: dict[str, dict[str, Any]] = {}
    for d in dirs:
        if not d.is_dir():
            continue
        for path in sorted(d.glob("*.json")):
            name = path.stem
            if name in out or not _NAME.match(name):
                continue
            try:
                data = load(name, dirs)
                out[name] = {"name": name, "vendor": data["vendor"], "models": list(data.get("models", [])),
                             "mapping_version": data["mapping_version"], "description": data.get("description", ""),
                             "error": ""}
            except MappingError as exc:
                out[name] = {"name": name, "vendor": "", "models": [], "mapping_version": "", "description": "",
                             "error": str(exc)}
    return [out[k] for k in sorted(out)]


def find_for(vendor: str, model: str, dirs: tuple[Path, ...] | None = None) -> str:
    """Mapping name for a source that names none: same vendor (case-insensitive) and the model listed (or no models
    listed). Needs a vendor on the source; returns "" when nothing or no vendor."""
    if not vendor.strip():
        return ""
    for m in available(dirs or SEARCH_DIRS):
        if m["error"] or m["vendor"].casefold() != vendor.strip().casefold():
            continue
        if not m["models"] or model.strip().casefold() in {x.casefold() for x in m["models"]}:
            return m["name"]
    return ""


def _glob(rel_path: str, pattern: str) -> bool:
    """Case-insensitive; a pattern without `/` matches the file name only (so `*.xml` also hits `sub/a.xml`)."""
    rel = rel_path.lower()
    target = rel if "/" in pattern else rel.rsplit("/", 1)[-1]
    return fnmatch.fnmatchcase(target, pattern.lower())


def file_rule(data: dict[str, Any] | None, rel_path: str) -> tuple[str, dict[str, Any]] | None:
    """(parser name, options) of the first `files` rule that matches, else None (caller falls back to `pick`)."""
    for rule in (data or {}).get("files", []):
        if _glob(rel_path, rule["match"]):
            return rule["parser"], dict(rule.get("options", {}))
    return None


def apply(data: dict[str, Any] | None, params: list[tuple[str, str]]) -> tuple[list[dict[str, str]], list[str]]:
    """Mapping on parsed (path, value) pairs → rows [{path, value, label, unit, group}] in display order, plus warnings.

    `ignore` globs drop rows. Mapped rows come first in the mapping's `params` order, then unmapped rows in file
    order unless `show_unmapped` is false. Without a mapping every row passes through unchanged.
    """
    if not data:
        return [{"path": p, "value": v, "label": "", "unit": "", "group": ""} for p, v in params], []
    ignore = [str(g) for g in data.get("ignore", []) if isinstance(g, str)]
    rules = data.get("params", [])
    mapped: dict[int, list[dict[str, str]]] = {}
    rest: list[dict[str, str]] = []
    warnings: list[str] = []
    for path, value in params:
        if any(fnmatch.fnmatchcase(path.lower(), g.lower()) for g in ignore):
            continue
        for i, rule in enumerate(rules):
            hit = rule["path"] == path if "path" in rule else fnmatch.fnmatchcase(path, rule["path_glob"])
            if hit:
                if rule.get("compare") == "number" and not _is_number(value):
                    warnings.append(f"{path}: 숫자로 비교하는 항목인데 값이 숫자가 아니에요 ({value[:20]}).")
                mapped.setdefault(i, []).append({"path": path, "value": value, "label": str(rule.get("label", "")),
                                                 "unit": str(rule.get("unit", "")), "group": str(rule.get("group", ""))})
                break
        else:
            rest.append({"path": path, "value": value, "label": "", "unit": "", "group": ""})
    rows = [row for i in sorted(mapped) for row in mapped[i]]
    if data.get("show_unmapped", True):
        rows += rest
    return rows, warnings


def _is_number(text: str) -> bool:
    try:
        float(text.strip().replace(",", ""))
        return True
    except ValueError:
        return False
