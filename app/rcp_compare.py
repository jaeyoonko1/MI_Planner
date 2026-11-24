"""Recipe snapshot history, diff and side-by-side comparison (P6-04, D-36/D-37/D-38).

Read-only and local: everything here reads the parameter rows already stored by collection/parsing. Parameters are
identified by (file, parameter path). How two values are compared (`text` or `number` + `tolerance`) is NOT stored in
the DB; it is looked up in the source's mapping file at compare time, so editing a tolerance takes effect at once.
"""
from __future__ import annotations

import fnmatch
import math
import sqlite3
from typing import Any

from app import rcp_parse
from app.repositories import recipes as repo
from app.repositories.recipes import RecipeError
from app.xlsx import STYLE_HEADER, STYLE_NORMAL, STYLE_TITLE, Sheet, build_workbook

MIN_COLUMNS, MAX_COLUMNS = 2, 6
HISTORY_LIMIT = 50
_EPS = 1e-12


# ---- value comparison ---------------------------------------------------------------------------------------------

def to_number(text: str | None) -> float | None:
    """Finite number from a parameter value ('1,200' allowed), else None (nan/inf/blank are text)."""
    if text is None:
        return None
    try:
        n = float(str(text).strip().replace(",", ""))
    except ValueError:
        return None
    return n if math.isfinite(n) else None


def compare_values(a: str, b: str, compare: str = "text", tolerance: float = 0.0) -> tuple[bool, str]:
    """(differs, kind). kind: same | changed | type_changed (exactly one side is numeric).

    `number` compares numerically (|a-b| <= tolerance means equal; the boundary is equal) when both sides are numbers;
    anything else is compared as exact text. `text` never applies a tolerance.
    """
    na, nb = to_number(a), to_number(b)
    if (na is None) != (nb is None):
        return True, "type_changed"
    if compare == "number" and na is not None and nb is not None:
        limit = abs(tolerance) + _EPS * max(1.0, abs(na), abs(nb))
        return abs(na - nb) > limit, "changed" if abs(na - nb) > limit else "same"
    differs = a.strip() != b.strip()  # SPEC 4.6.1: text is compared with surrounding spaces removed
    return differs, ("changed" if differs else "same")


class Rules:
    """compare/tolerance for a parameter path, from one or more mapping files (first rule hit wins)."""

    def __init__(self, mappings: list[dict[str, Any] | None]) -> None:
        self._rules = [r for m in mappings if m for r in m.get("params", [])]
        self._cache: dict[str, tuple[str, float]] = {}

    def get(self, path: str) -> tuple[str, float]:
        hit = self._cache.get(path)
        if hit is None:
            hit = ("text", 0.0)
            for r in self._rules:
                if (r["path"] == path) if "path" in r else fnmatch.fnmatchcase(path, r["path_glob"]):
                    hit = (str(r.get("compare", "text")), float(r.get("tolerance", 0) or 0))
                    break
            self._cache[path] = hit
        return hit


def rules_for_sources(conn: sqlite3.Connection, source_ids: list[int]) -> tuple[Rules, list[dict[str, Any]]]:
    """Rules plus [{source_id, mapping, mapping_version, error}] describing what was used."""
    datas: list[dict[str, Any] | None] = []
    used: list[dict[str, Any]] = []
    for sid in dict.fromkeys(source_ids):
        ctx = rcp_parse.resolve_mapping(repo.get_source(conn, sid))
        datas.append(ctx.data)
        used.append({"source_id": sid, "mapping": ctx.name, "mapping_version": ctx.version, "error": ctx.error})
    return Rules(datas), used


# ---- loading ------------------------------------------------------------------------------------------------------

def load_params(conn: sqlite3.Connection, snapshot_id: int) -> list[dict[str, str]]:
    rows = conn.execute(
        "SELECT f.rel_path AS file, p.path, p.value, p.label, p.unit, p.group_name AS grp FROM recipe_params p"
        " JOIN recipe_files f ON f.id = p.file_id WHERE p.snapshot_id = ? ORDER BY f.rel_path, p.sort, p.id",
        (snapshot_id,))
    return [dict(r) for r in rows]


def _file_hashes(conn: sqlite3.Connection, snapshot_id: int) -> dict[str, str]:
    return {r["rel_path"]: r["sha256"] for r in conn.execute(
        "SELECT rel_path, sha256 FROM recipe_files WHERE snapshot_id = ?", (snapshot_id,))}


def _snapshot_meta(conn: sqlite3.Connection, snapshot_id: int) -> dict[str, Any]:
    row = conn.execute(
        "SELECT id, recipe_id, collected_at, content_hash, file_count, param_count, parse_status"
        " FROM recipe_snapshots WHERE id = ?", (snapshot_id,)).fetchone()
    if row is None:
        raise RecipeError("스냅샷을 찾을 수 없어요.", 404)
    return dict(row)


# ---- diff between two parameter sets ------------------------------------------------------------------------------

def diff_params(a: list[dict[str, str]], b: list[dict[str, str]], rules: Rules) -> list[dict[str, Any]]:
    """Rows in b's order (then rows only in a). status: added | removed | changed | same.

    `same` rows may carry `within_tolerance` (text differs but numeric tolerance accepts it) and `delta`.
    """
    old = {(r["file"], r["path"]): r for r in a}
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for r in b:
        key = (r["file"], r["path"])
        seen.add(key)
        prev = old.get(key)
        compare, tol = rules.get(r["path"])
        row = {"file": r["file"], "path": r["path"], "label": r["label"], "unit": r["unit"], "group": r["grp"],
               "compare": compare, "tolerance": tol, "old": None, "new": r["value"], "delta": None,
               "within_tolerance": False}
        if prev is None:
            row["status"] = "added"
        else:
            row["old"] = prev["value"]
            row["label"] = r["label"] or prev["label"]
            differs, kind = compare_values(prev["value"], r["value"], compare, tol)
            na, nb = to_number(prev["value"]), to_number(r["value"])
            if na is not None and nb is not None:
                row["delta"] = nb - na
            if differs:
                row["status"] = "changed"
                row["type_changed"] = kind == "type_changed"
            else:
                row["status"] = "same"
                row["within_tolerance"] = prev["value"] != r["value"]
        out.append(row)
    for r in a:
        key = (r["file"], r["path"])
        if key not in seen:
            compare, tol = rules.get(r["path"])
            out.append({"file": r["file"], "path": r["path"], "label": r["label"], "unit": r["unit"],
                        "group": r["grp"], "compare": compare, "tolerance": tol, "old": r["value"], "new": None,
                        "delta": None, "within_tolerance": False, "status": "removed"})
    return out


def summarize(rows: list[dict[str, Any]]) -> dict[str, int]:
    s = {"added": 0, "removed": 0, "changed": 0, "type_changed": 0, "within_tolerance": 0, "same": 0}
    for r in rows:
        s[r["status"]] += 1
        if r.get("type_changed"):
            s["type_changed"] += 1
        if r["within_tolerance"]:
            s["within_tolerance"] += 1
    s["total_changes"] = s["added"] + s["removed"] + s["changed"]
    return s


def _file_changes(old: dict[str, str], new: dict[str, str]) -> dict[str, int]:
    return {"files_added": len(new.keys() - old.keys()), "files_removed": len(old.keys() - new.keys()),
            "files_changed": sum(1 for k in new.keys() & old.keys() if new[k] != old[k])}


def snapshot_diff(conn: sqlite3.Connection, a_id: int, b_id: int, only_changes: bool = True) -> dict[str, Any]:
    """Diff of two snapshots of ONE recipe (a = older/base, b = newer). Direction is whatever the caller passes."""
    a, b = _snapshot_meta(conn, a_id), _snapshot_meta(conn, b_id)
    if a["recipe_id"] != b["recipe_id"]:
        raise RecipeError("같은 레시피의 두 버전만 비교할 수 있어요.", 422)
    recipe = repo.get_recipe(conn, a["recipe_id"])
    rules, used = rules_for_sources(conn, [recipe["recipe"]["source_id"]])
    rows = diff_params(load_params(conn, a_id), load_params(conn, b_id), rules)
    summary = {**summarize(rows), **_file_changes(_file_hashes(conn, a_id), _file_hashes(conn, b_id))}
    if only_changes:
        rows = [r for r in rows if r["status"] != "same"]
    return {"recipe": {"id": recipe["recipe"]["id"], "name": recipe["recipe"]["name"]}, "a": a, "b": b,
            "summary": summary, "rows": rows, "mapping": used[0]}


def history(conn: sqlite3.Connection, recipe_id: int, limit: int = HISTORY_LIMIT) -> dict[str, Any]:
    """Snapshot timeline, newest first, each with its change summary against the previous snapshot."""
    got = repo.get_recipe(conn, recipe_id)
    snaps = list(reversed(got["snapshots"]))  # oldest → newest
    limit = max(1, min(limit, 500))
    window = snaps[-(limit + 1):]
    rules, used = rules_for_sources(conn, [got["recipe"]["source_id"]])
    current = got["recipe"]["current_snapshot_id"]
    items: list[dict[str, Any]] = []
    prev_rows: list[dict[str, str]] | None = None
    prev_files: dict[str, str] | None = None
    prev_id: int | None = None
    for i, s in enumerate(window):
        rows, files = load_params(conn, s["id"]), _file_hashes(conn, s["id"])
        item = {**s, "is_current": s["id"] == current, "previous_id": prev_id, "summary": None}
        if prev_rows is not None and prev_files is not None:
            item["summary"] = {**summarize(diff_params(prev_rows, rows, rules)), **_file_changes(prev_files, files)}
        if i > 0 or len(window) <= limit:  # the extra oldest entry only serves as a base
            items.append(item)
        prev_rows, prev_files, prev_id = rows, files, s["id"]
    items.reverse()
    return {"recipe": {"id": recipe_id, "name": got["recipe"]["name"]}, "items": items, "mapping": used[0],
            "truncated": len(snaps) > len(items)}


# ---- comparison of several recipes --------------------------------------------------------------------------------

def parse_specs(text: str) -> list[tuple[int, int | None]]:
    """'3,5:12' → [(3, None), (5, 12)] (recipe id, optional pinned snapshot id)."""
    specs: list[tuple[int, int | None]] = []
    for part in str(text or "").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            rid, _, sid = part.partition(":")
            specs.append((int(rid), int(sid) if sid else None))
        except ValueError as exc:
            raise RecipeError("비교할 레시피 목록 형식이 올바르지 않아요.", 422) from exc
    if not MIN_COLUMNS <= len(specs) <= MAX_COLUMNS:
        raise RecipeError(f"레시피는 {MIN_COLUMNS}~{MAX_COLUMNS}개를 골라 주세요.", 422)
    if len({s[0] for s in specs}) != len(specs):
        raise RecipeError("같은 레시피를 두 번 고를 수 없어요. (같은 레시피의 버전 비교는 이력에서)", 422)
    return specs


def compare_recipes(conn: sqlite3.Connection, specs: list[tuple[int, int | None]]) -> dict[str, Any]:
    """Side-by-side table. Column 0 is the reference: a cell is `d` when it differs from the first present value
    (numeric tolerance respected), `m` when the recipe lacks the parameter. A row differs when any cell is not ''."""
    columns: list[dict[str, Any]] = []
    param_sets: list[list[dict[str, str]]] = []
    for rid, sid in specs:
        got = repo.get_recipe(conn, rid)
        r = got["recipe"]
        use = sid or r["current_snapshot_id"]
        if not use:
            raise RecipeError(f"‘{r['name']}’은 아직 수집된 버전이 없어요.", 422)
        meta = _snapshot_meta(conn, use)
        if meta["recipe_id"] != rid:
            raise RecipeError("레시피와 스냅샷이 맞지 않아요.", 422)
        src = got["source"]
        columns.append({"recipe_id": rid, "name": r["name"], "source": src["name"], "equipment": src["equipment"],
                        "line": src["line"], "snapshot_id": use, "collected_at": meta["collected_at"],
                        "content_hash": meta["content_hash"], "param_count": meta["param_count"],
                        "parse_status": meta["parse_status"], "source_id": r["source_id"]})
        param_sets.append(load_params(conn, use))
    rules, used = rules_for_sources(conn, [c["source_id"] for c in columns])
    index: dict[tuple[str, str], dict[str, Any]] = {}
    for col, params in enumerate(param_sets):
        for p in params:
            key = (p["file"], p["path"])
            row = index.get(key)
            if row is None:
                compare, tol = rules.get(p["path"])
                row = index[key] = {"file": p["file"], "path": p["path"], "label": "", "unit": "", "group": "",
                                    "compare": compare, "tolerance": tol, "values": [None] * len(specs)}
            row["values"][col] = p["value"]
            for f_row, f_p in (("label", "label"), ("unit", "unit"), ("group", "grp")):
                if not row[f_row] and p[f_p]:
                    row[f_row] = p[f_p]
    rows = list(index.values())
    for row in rows:
        vals = row["values"]
        ref = next((v for v in vals if v is not None), None)
        marks: list[str] = []
        for v in vals:
            if v is None:
                marks.append("m")
            else:
                marks.append("d" if compare_values(ref, v, row["compare"], row["tolerance"])[0] else "")
        row["marks"] = marks
        row["diff"] = any(marks)
    groups: dict[str, int] = {}
    for row in rows:
        groups[row["group"]] = groups.get(row["group"], 0) + 1
    return {"columns": columns, "rows": rows, "mapping": used,
            "groups": [{"name": g, "count": n} for g, n in groups.items() if g] + (
                [{"name": "", "count": groups[""]}] if "" in groups else []),
            "summary": {"total": len(rows), "differing": sum(1 for r in rows if r["diff"]),
                        "missing": sum(1 for r in rows if "m" in r["marks"])}}


def filter_rows(rows: list[dict[str, Any]], only_diff: bool = False, group: str | None = None,
                q: str = "") -> list[dict[str, Any]]:
    """Same filter the screen applies (used by the export so the file matches what the user sees)."""
    needle = q.strip().lower()
    out = []
    for r in rows:
        if only_diff and not r["diff"]:
            continue
        if group is not None and r["group"] != group:
            continue
        if needle and not any(needle in str(t).lower() for t in
                              [r["path"], r["label"], r["file"], r["group"], *[v for v in r["values"] if v is not None]]):
            continue
        out.append(r)
    return out


def build_compare_xlsx(result: dict[str, Any], rows: list[dict[str, Any]]) -> bytes:
    """xlsx of the comparison: every value is written as text (so '001' stays '001'); the 판정 column and 차이 열
    column carry the difference marks, not cell colors."""
    cols = result["columns"]
    names = [c["name"] + (f" ({c['equipment']})" if c["equipment"] else "") for c in cols]
    sheet = Sheet("비교", [16, 22, 24, 34, 8, 10, 12, 18] + [20] * len(cols), freeze_header=True, autofilter=True)
    sheet.add(["그룹", "파일", "이름", "경로", "단위", "허용오차", "판정", "다른 열"] + names, STYLE_HEADER)
    for r in rows:
        diff_cols = [str(i + 1) for i, m in enumerate(r["marks"]) if m]
        verdict = "다름 ≠" if r["diff"] else "같음"
        tol = r["tolerance"] if r["compare"] == "number" and r["tolerance"] else ""
        sheet.add([r["group"], r["file"], r["label"], r["path"], r["unit"], tol, verdict, ", ".join(diff_cols)]
                  + ["(없음)" if v is None else str(v) for v in r["values"]])
    info = Sheet("정보", [10, 28, 18, 18, 20, 12])
    info.add(["레시피 비교"], STYLE_TITLE)
    info.add(["열", "레시피", "소스", "설비", "수집 시각", "버전"], STYLE_HEADER)
    for i, c in enumerate(cols, 1):
        info.add([i, c["name"], c["source"], c["equipment"], c["collected_at"][:16].replace("T", " "),
                  c["content_hash"][:8]], STYLE_NORMAL)
    info.add([])
    info.add(["기준은 1열이에요. 숫자 항목은 매핑 파일의 허용오차 이내면 같은 값으로 봐요. 설비의 레시피는 바뀌지 않아요."])
    return build_workbook([sheet, info])

