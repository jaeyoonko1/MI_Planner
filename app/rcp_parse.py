"""Recipe parsing glue (P6-03, D-38): mapping selection, per-file parse that never raises, collection hook, re-parse.

Parsers (parsers/) are pure; this module reads cached blobs from `data/recipes/blobs/` and records the outcome in the
local DB. Nothing here touches equipment or writes recipe files (D-11).
"""
from __future__ import annotations

import hashlib
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import parsers
from app.repositories import recipes as repo
from app.repositories.recipes import FileIn
from parsers import mapping
from parsers.base import MAX_FILE_BYTES, ParseError

MAX_WARNINGS = 50
UNEXPECTED = "파일을 읽는 중 예상하지 못한 문제가 생겼어요. 파일 형식을 확인해 주세요."


@dataclass
class MappingCtx:
    name: str = ""
    data: dict[str, Any] | None = None
    error: str = ""
    auto: bool = False  # chosen from the source's vendor/model instead of its `mapping` field

    @property
    def version(self) -> str:
        return str((self.data or {}).get("mapping_version", ""))


def resolve_mapping(source: dict[str, Any]) -> MappingCtx:
    """The source's own mapping, else one whose vendor/model match the source, else none. A broken mapping file is
    reported (`error`) and parsing continues without it, so collection never stops for a bad mapping."""
    name, auto = str(source.get("mapping") or ""), False
    if not name:
        name = mapping.find_for(str(source.get("vendor") or ""), str(source.get("model") or ""))
        auto = bool(name)
    if not name:
        return MappingCtx()
    try:
        return MappingCtx(name, mapping.load(name), "", auto)
    except mapping.MappingError as exc:
        return MappingCtx(name, None, str(exc), auto)


def _read_blob(data_dir: Path, cache_path: str, sha256: str) -> bytes:
    root = (data_dir / "blobs").resolve()
    path = (data_dir / cache_path).resolve()
    if root not in path.parents or not path.is_file():
        raise ParseError("캐시된 원본 파일을 찾을 수 없어요. 다시 수집해 주세요.")
    if path.stat().st_size > MAX_FILE_BYTES:
        raise ParseError(f"파일이 너무 커요 ({MAX_FILE_BYTES // (1024 * 1024)}MB 초과).")
    data = path.read_bytes()
    if sha256 and hashlib.sha256(data).hexdigest() != sha256:
        raise ParseError("캐시된 파일이 수집할 때와 달라요. 다시 수집해 주세요.")
    return data


def parse_one(data: bytes, rel_path: str, ctx: MappingCtx) -> tuple[str, str, list[dict[str, str]], list[str]]:
    """(parser name, error, param rows, warnings). Never raises: every failure becomes a Korean `error`."""
    name = ""
    try:
        rule = mapping.file_rule(ctx.data, rel_path)
        if rule:
            name, options = rule
            parser = parsers.get(name)
        else:
            options = {}
            parser = parsers.pick(rel_path, data[:4096])
            if parser is None:
                return "", "", [], []  # not a parseable file type (e.g. .doc): kept, just not parsed
            name = parser.name
        result = parser.parse(data, rel_path, options)
        rows, warns = mapping.apply(ctx.data, [(p.path, p.value) for p in result.params])
        return name, "", rows, [f"{rel_path}: {w}" for w in result.warnings + warns]
    except ParseError as exc:
        return name, str(exc), [], []
    except Exception:  # noqa: BLE001 - a hostile or odd file must never crash collection
        return name, UNEXPECTED, [], []


def _parser_versions(files: list[FileIn]) -> dict[str, str]:
    out: dict[str, str] = {}
    for f in files:
        if f.parser:
            try:
                out[f.parser] = parsers.get(f.parser).version
            except ParseError:
                out[f.parser] = "?"
    return out


def build_info(ctx: MappingCtx, files: list[FileIn], warnings: list[str]) -> dict[str, Any]:
    info: dict[str, Any] = {
        "mapping": ctx.name, "mapping_version": ctx.version, "mapping_auto": ctx.auto,
        "parsers": _parser_versions(files), "warnings": warnings[:MAX_WARNINGS],
        "warning_count": len(warnings), "parsed_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    if ctx.error:
        info["mapping_error"] = ctx.error
    return info


def parse_files(files: list[FileIn], data_dir: Path, ctx: MappingCtx) -> dict[str, Any]:
    """Fill `parser`, `error` and `params` of each FileIn from its cached blob. Returns the snapshot's `parser_info`."""
    warnings: list[str] = []
    for f in files:
        try:
            data = _read_blob(data_dir, f.cache_path, f.sha256)
        except ParseError as exc:
            f.parser, f.error, f.params = "", str(exc), []
            continue
        f.parser, f.error, f.params, warns = parse_one(data, f.rel_path, ctx)
        warnings += warns
    return build_info(ctx, files, warnings)


# ---- re-parse (after a mapping or parser change) ------------------------------------------------------------------

def reparse_snapshot(conn: sqlite3.Connection, data_dir: Path, snapshot_id: int) -> dict[str, Any]:
    """Rebuild one snapshot's parameter rows from its cached blobs and the *current* mapping. Same snapshot id and
    content hash, so no duplicate version is ever created; only parser flags, params and parser_info change."""
    row = conn.execute(
        "SELECT sn.id, r.source_id FROM recipe_snapshots sn JOIN recipes r ON r.id = sn.recipe_id WHERE sn.id = ?",
        (snapshot_id,)).fetchone()
    if row is None:
        raise repo.RecipeError("스냅샷을 찾을 수 없어요.", 404)
    ctx = resolve_mapping(repo.get_source(conn, row["source_id"]))
    ids: dict[int, FileIn] = {}
    for f in conn.execute("SELECT id, rel_path, size, sha256, cache_path FROM recipe_files WHERE snapshot_id = ?"
                          " ORDER BY rel_path", (snapshot_id,)):
        ids[f["id"]] = FileIn(f["rel_path"], f["sha256"], f["size"], f["cache_path"])
    info = parse_files(list(ids.values()), data_dir, ctx)
    try:
        repo.replace_parse(conn, snapshot_id, ids, info)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return repo.get_snapshot(conn, snapshot_id)


def reparse_source(conn: sqlite3.Connection, data_dir: Path, source_id: int) -> dict[str, int]:
    """Re-parse the current snapshot of every recipe of a source."""
    repo.get_source(conn, source_id)
    done = failed = 0
    for r in conn.execute("SELECT current_snapshot_id AS sid FROM recipes WHERE source_id = ?"
                          " AND current_snapshot_id IS NOT NULL", (source_id,)).fetchall():
        snap = reparse_snapshot(conn, data_dir, r["sid"])["snapshot"]
        done += 1
        failed += snap["parse_status"] in ("error", "partial")
    return {"snapshots": done, "with_problems": failed}


def parse_state(conn: sqlite3.Connection, snapshot: dict[str, Any]) -> dict[str, Any]:
    """What the screen needs to say whether this snapshot was parsed with today's mapping and parsers."""
    row = conn.execute("SELECT r.source_id FROM recipes r WHERE r.id = ?", (snapshot["recipe_id"],)).fetchone()
    if row is None:
        return {"stale": False}
    ctx = resolve_mapping(repo.get_source(conn, row["source_id"]))
    info = snapshot.get("parser_info") or {}
    stale = bool(info) and (info.get("mapping") != ctx.name or info.get("mapping_version") != ctx.version or any(
        _version(name) != ver for name, ver in (info.get("parsers") or {}).items()))
    if not info and snapshot["parse_status"] == "unparsed":
        stale = True  # collected before parsers existed
    return {"stale": stale, "mapping": ctx.name, "mapping_version": ctx.version, "mapping_error": ctx.error,
            "mapping_auto": ctx.auto}


def _version(name: str) -> str:
    try:
        return parsers.get(name).version
    except ParseError:
        return "?"


__all__ = ["MappingCtx", "resolve_mapping", "parse_one", "parse_files", "build_info", "reparse_snapshot",
           "reparse_source", "parse_state"]
