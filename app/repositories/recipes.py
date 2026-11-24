"""RCP management storage (P6-01, D-36). Read-only toward equipment: nothing here talks to FTP or writes recipes.

Sources, recipes, snapshots (content-hash versions), files and parsed parameter rows. Collection (P6-02) calls
`upsert_recipe` + `add_snapshot`; a snapshot is only created when the content hash differs from the recipe's
current snapshot, so unchanged collections never grow history.
"""
from __future__ import annotations

import fnmatch
import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


class RecipeError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


# Name filter rules (D-36): no regex (ReDoS), case-insensitive, bounded.
RULE_TYPES = {"contains", "prefix", "suffix", "glob"}
MAX_RULES = 30
MAX_RULE_LEN = 120
MAX_GLOBS = 30
_PROFILE = re.compile(r"^[A-Za-z0-9_.-]{0,40}$")
_MAPPING = re.compile(r"^[A-Za-z0-9_-]{0,60}$")


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def validate_filter(rules: Any) -> list[dict[str, Any]]:
    """Return normalized rules [{type, value, exclude}] or raise RecipeError."""
    if not isinstance(rules, list) or len(rules) > MAX_RULES:
        raise RecipeError(f"이름 필터는 규칙 목록이어야 하고 {MAX_RULES}개 이하여야 해요.", 422)
    out: list[dict[str, Any]] = []
    for r in rules:
        if not isinstance(r, dict) or r.get("type") not in RULE_TYPES:
            raise RecipeError("이름 필터 규칙 종류는 contains·prefix·suffix·glob 중 하나예요.", 422)
        value = r.get("value")
        if not isinstance(value, str) or not value.strip() or len(value) > MAX_RULE_LEN:
            raise RecipeError(f"이름 필터 값은 1~{MAX_RULE_LEN}자여야 해요.", 422)
        out.append({"type": r["type"], "value": value.strip(), "exclude": bool(r.get("exclude", False))})
    return out


def _rule_hit(name: str, rule: dict[str, Any]) -> bool:
    n, v = name.casefold(), rule["value"].casefold()
    kind = rule["type"]
    if kind == "contains":
        return v in n
    if kind == "prefix":
        return n.startswith(v)
    if kind == "suffix":
        return n.endswith(v)
    return fnmatch.fnmatchcase(n, v)


def name_matches(name: str, rules: list[dict[str, Any]]) -> bool:
    """Included when (no include rules or any include hits) and no exclude rule hits."""
    includes = [r for r in rules if not r["exclude"]]
    excludes = [r for r in rules if r["exclude"]]
    if includes and not any(_rule_hit(name, r) for r in includes):
        return False
    return not any(_rule_hit(name, r) for r in excludes)


def _validate_globs(globs: Any) -> list[str]:
    if not isinstance(globs, list) or len(globs) > MAX_GLOBS or not all(
            isinstance(g, str) and g.strip() and len(g) <= MAX_RULE_LEN for g in globs):
        raise RecipeError("파일 패턴 목록 형식이 올바르지 않아요.", 422)
    return [g.strip() for g in globs]


def _source(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["name_filter"] = json.loads(d["name_filter"] or "[]")
    d["file_globs"] = json.loads(d["file_globs"] or "[]")
    d["enabled"] = bool(d["enabled"])
    return d


def create_source(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    name = str(data.get("name") or "").strip()
    if not name or len(name) > 100:
        raise RecipeError("소스 이름은 1~100자여야 해요.", 422)
    profile = str(data.get("ftp_profile") or "")
    if not _PROFILE.match(profile):
        raise RecipeError("FTP 프로필 이름은 영문·숫자·._- 40자 이하예요 (주소·계정은 config/local.json에만).", 422)
    mapping = str(data.get("mapping") or "")
    if not _MAPPING.match(mapping):
        raise RecipeError("매핑 이름은 영문·숫자·_- 60자 이하예요.", 422)
    layout = data.get("layout", "folder")
    if layout not in ("folder", "file"):
        raise RecipeError("레이아웃은 folder 또는 file이에요.", 422)
    rules = validate_filter(data.get("name_filter", []))
    globs = _validate_globs(data.get("file_globs", []))
    now = _now()
    try:
        cur = conn.execute(
            "INSERT INTO recipe_sources (name, vendor, model, equipment, line, ftp_profile, remote_dir, layout,"
            " name_filter, file_globs, mapping, enabled, note, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (name, str(data.get("vendor") or "")[:100], str(data.get("model") or "")[:100],
             str(data.get("equipment") or "")[:100], str(data.get("line") or "")[:100], profile,
             str(data.get("remote_dir") or "")[:500], layout, json.dumps(rules, ensure_ascii=False),
             json.dumps(globs, ensure_ascii=False), mapping, 1 if data.get("enabled", True) else 0,
             str(data.get("note") or "")[:2000], now, now))
    except sqlite3.IntegrityError as exc:
        raise RecipeError("같은 이름의 소스가 이미 있어요.", 409) from exc
    conn.commit()
    return get_source(conn, cur.lastrowid)


def list_sources(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT s.*, (SELECT count(*) FROM recipes r WHERE r.source_id = s.id AND r.missing = 0) AS recipe_count,"
        " (SELECT max(started_at) FROM recipe_runs u WHERE u.source_id = s.id) AS last_run_at "
        "FROM recipe_sources s ORDER BY s.line COLLATE NOCASE, s.equipment COLLATE NOCASE, s.name COLLATE NOCASE")
    return [_source(r) for r in rows]


def get_source(conn: sqlite3.Connection, source_id: int) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM recipe_sources WHERE id = ?", (source_id,)).fetchone()
    if row is None:
        raise RecipeError("레시피 소스를 찾을 수 없어요.", 404)
    return _source(row)


def list_recipes(conn: sqlite3.Connection, source_id: int | None = None, q: str = "",
                 include_missing: bool = False) -> list[dict[str, Any]]:
    sql = ("SELECT r.*, s.name AS source_name, s.equipment, s.line, s.vendor, s.model,"
           " sn.collected_at, sn.content_hash, sn.param_count "
           "FROM recipes r JOIN recipe_sources s ON s.id = r.source_id "
           "LEFT JOIN recipe_snapshots sn ON sn.id = r.current_snapshot_id WHERE 1 = 1")
    args: list[Any] = []
    if source_id is not None:
        sql += " AND r.source_id = ?"
        args.append(source_id)
    if q:
        sql += " AND r.name LIKE ? ESCAPE '\\'"
        args.append("%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
    if not include_missing:
        sql += " AND r.missing = 0"
    sql += " ORDER BY r.name COLLATE NOCASE, s.line COLLATE NOCASE, s.equipment COLLATE NOCASE"
    return [{**dict(r), "missing": bool(r["missing"])} for r in conn.execute(sql, args)]


def get_snapshot(conn: sqlite3.Connection, snapshot_id: int) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM recipe_snapshots WHERE id = ?", (snapshot_id,)).fetchone()
    if row is None:
        raise RecipeError("스냅샷을 찾을 수 없어요.", 404)
    files = [dict(f) for f in conn.execute(
        "SELECT id, rel_path, size, sha256, remote_mtime, parser, error FROM recipe_files"
        " WHERE snapshot_id = ? ORDER BY rel_path", (snapshot_id,))]
    params = [dict(p) for p in conn.execute(
        "SELECT p.path, p.value, p.label, p.unit, p.group_name, f.rel_path AS file FROM recipe_params p"
        " JOIN recipe_files f ON f.id = p.file_id WHERE p.snapshot_id = ? ORDER BY f.rel_path, p.sort, p.id",
        (snapshot_id,))]
    return {"snapshot": {**dict(row), "parser_info": json.loads(row["parser_info"] or "{}")},
            "files": files, "params": params}


def get_recipe(conn: sqlite3.Connection, recipe_id: int) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
    if row is None:
        raise RecipeError("레시피를 찾을 수 없어요.", 404)
    snaps = [dict(s) for s in conn.execute(
        "SELECT id, run_id, collected_at, content_hash, file_count, param_count, parse_status"
        " FROM recipe_snapshots WHERE recipe_id = ? ORDER BY id DESC", (recipe_id,))]
    current = get_snapshot(conn, row["current_snapshot_id"]) if row["current_snapshot_id"] else None
    return {"recipe": {**dict(row), "missing": bool(row["missing"])},
            "source": get_source(conn, row["source_id"]), "snapshots": snaps, "current": current}


def list_runs(conn: sqlite3.Connection, source_id: int | None = None, limit: int = 50) -> list[dict[str, Any]]:
    sql, args = "SELECT * FROM recipe_runs", []
    if source_id is not None:
        sql += " WHERE source_id = ?"
        args.append(source_id)
    sql += " ORDER BY id DESC LIMIT ?"
    args.append(max(1, min(limit, 500)))
    return [{**dict(r), "errors": json.loads(r["errors"] or "[]")} for r in conn.execute(sql, args)]


# --- collection-side helpers (used by P6-02; local DB only, never equipment) ---

@dataclass
class FileIn:
    rel_path: str
    sha256: str
    size: int
    cache_path: str
    remote_mtime: str = ""
    parser: str = ""
    error: str = ""
    params: list[dict[str, Any]] = field(default_factory=list)  # [{path, value, label?, unit?, group?}]


def content_hash(files: list[FileIn]) -> str:
    """Recipe version identity: sha256 over sorted 'rel_path NUL file sha256' lines (order independent)."""
    h = hashlib.sha256()
    for f in sorted(files, key=lambda f: f.rel_path):
        h.update(f"{f.rel_path}\0{f.sha256}\n".encode("utf-8"))
    return h.hexdigest()


def upsert_recipe(conn: sqlite3.Connection, source_id: int, name: str, remote_path: str = "") -> int:
    now = _now()
    conn.execute(
        "INSERT INTO recipes (source_id, name, remote_path, first_seen_at, last_seen_at) VALUES (?,?,?,?,?)"
        " ON CONFLICT(source_id, name) DO UPDATE SET last_seen_at = excluded.last_seen_at,"
        " remote_path = excluded.remote_path, missing = 0", (source_id, name, remote_path, now, now))
    return conn.execute("SELECT id FROM recipes WHERE source_id = ? AND name = ?", (source_id, name)).fetchone()["id"]


def add_snapshot(conn: sqlite3.Connection, recipe_id: int, files: list[FileIn], run_id: int | None = None,
                 parser_info: dict[str, Any] | None = None) -> tuple[int, bool]:
    """Return (snapshot_id, created). Same hash as the current snapshot → (current id, False), nothing written.

    A revert (A → B → A) creates a new snapshot because it differs from the current one (B).
    """
    paths = [f.rel_path for f in files]
    if len(set(paths)) != len(paths):
        raise RecipeError("한 스냅샷에 같은 파일 경로가 두 번 있어요.", 422)
    digest = content_hash(files)
    cur = conn.execute(
        "SELECT s.id, s.content_hash FROM recipes r LEFT JOIN recipe_snapshots s ON s.id = r.current_snapshot_id"
        " WHERE r.id = ?", (recipe_id,)).fetchone()
    if cur is None:
        raise RecipeError("레시피를 찾을 수 없어요.", 404)
    if cur["content_hash"] == digest:
        return cur["id"], False
    errors = sum(1 for f in files if f.error)
    status = "ok" if not errors else ("error" if errors == len(files) else "partial")
    if not any(f.parser for f in files) and not errors:
        status = "unparsed"
    sid = conn.execute(
        "INSERT INTO recipe_snapshots (recipe_id, run_id, collected_at, content_hash, file_count, param_count,"
        " parse_status, parser_info) VALUES (?,?,?,?,?,?,?,?)",
        (recipe_id, run_id, _now(), digest, len(files), sum(len(f.params) for f in files), status,
         json.dumps(parser_info or {}, ensure_ascii=False))).lastrowid
    for f in files:
        fid = conn.execute(
            "INSERT INTO recipe_files (snapshot_id, rel_path, size, sha256, remote_mtime, cache_path, parser, error)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (sid, f.rel_path, f.size, f.sha256, f.remote_mtime, f.cache_path, f.parser, f.error)).lastrowid
        conn.executemany(
            "INSERT INTO recipe_params (snapshot_id, file_id, path, value, label, unit, group_name, sort)"
            " VALUES (?,?,?,?,?,?,?,?)",
            [(sid, fid, p["path"], str(p.get("value", "")), p.get("label", ""), p.get("unit", ""),
              p.get("group", ""), i) for i, p in enumerate(f.params)])
    conn.execute("UPDATE recipes SET current_snapshot_id = ? WHERE id = ?", (sid, recipe_id))
    return sid, True
