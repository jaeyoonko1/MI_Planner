"""User-defined task fields (D-22): definitions, option edits, deletion, rule references."""
from __future__ import annotations

import json
import re
import sqlite3
from datetime import date, datetime
from typing import Any

from app.repositories.tasks import TaskError

TYPES = ("choice", "multi", "text", "person", "date", "number", "check")
OPTION_TYPES = ("choice", "multi")
# Built-in fields mirror the legacy tasks columns of the same name.
BUILTIN_KEYS = ("priority", "requester", "due_date", "planned_date")
RESERVED_KEYS = {
    "id", "title", "status", "parent_task_id", "eval_id", "page_path", "note", "props",
    "created_at", "updated_at",
}
_KEY = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
RULE_OPS = ("is", "not", "set", "empty")
RULE_VARS = {"연", "월", "에픽위치"}
_TEMPLATE_VAR = re.compile(r"\{([^{}]+)\}")


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _row(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["options"] = json.loads(d["options"] or "[]")
    for k in ("show_filter", "show_row", "archived", "builtin"):
        d[k] = bool(d[k])
    return d


def list_fields(conn: sqlite3.Connection, *, include_archived: bool = True) -> list[dict[str, Any]]:
    sql = "SELECT * FROM task_fields"
    if not include_archived:
        sql += " WHERE archived = 0"
    return [_row(r) for r in conn.execute(sql + " ORDER BY sort_order, id")]


def get_field(conn: sqlite3.Connection, key: str) -> dict[str, Any]:
    r = conn.execute("SELECT * FROM task_fields WHERE key = ?", (key,)).fetchone()
    if r is None:
        raise TaskError("항목을 찾을 수 없습니다.", 404)
    return _row(r)


def usage_count(conn: sqlite3.Connection, key: str) -> int:
    return conn.execute(
        "SELECT COUNT(*) FROM tasks WHERE json_type(props, ?) IS NOT NULL", (f'$."{key}"',)
    ).fetchone()[0]


# ---------- value validation (used by tasks repository) ----------

def validate_value(field: dict[str, Any], value: Any) -> Any:
    """Return the cleaned value for a field or raise TaskError."""
    t, label = field["type"], field["label"]
    if t == "text" or t == "person":
        if not isinstance(value, str):
            raise TaskError(f"{label}은(는) 글자여야 합니다.")
        return value.strip()
    if t == "date":
        try:
            date.fromisoformat(str(value))
        except ValueError:
            raise TaskError(f"{label}은(는) YYYY-MM-DD 형식이어야 합니다.") from None
        return str(value)
    if t == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise TaskError(f"{label}은(는) 숫자여야 합니다.")
        return value
    if t == "check":
        if not isinstance(value, bool):
            raise TaskError(f"{label}은(는) 참/거짓이어야 합니다.")
        return value
    allowed = [o["value"] for o in field["options"] if not o.get("archived")]
    if t == "choice":
        if value not in allowed:
            raise TaskError(f"{label}: 없는 선택지입니다.")
        return value
    if not isinstance(value, list) or any(v not in allowed for v in value):  # multi
        raise TaskError(f"{label}: 선택지 목록이어야 합니다.")
    out: list[Any] = []
    for v in value:
        if v not in out:
            out.append(v)
    return out


# ---------- options ----------

def _clean_options(options: Any, *, strict_values: bool = True) -> list[dict[str, Any]]:
    if not isinstance(options, list):
        raise TaskError("선택지는 목록이어야 합니다.")
    out: list[dict[str, Any]] = []
    seen: set[Any] = set()
    for o in options:
        if not isinstance(o, dict) or "value" not in o:
            raise TaskError("선택지에는 value가 필요합니다.")
        value = o["value"]
        if isinstance(value, bool) or not isinstance(value, (str, int)):
            raise TaskError("선택지 value는 글자 또는 정수여야 합니다.")
        if value in seen:
            raise TaskError(f"선택지가 중복되었습니다: {value}")
        seen.add(value)
        label = str(o.get("label", value)).strip()
        if not label:
            raise TaskError("선택지 이름을 입력하세요.")
        item: dict[str, Any] = {"value": value, "label": label}
        if o.get("color"):
            item["color"] = str(o["color"])
        if o.get("parent") is not None:
            item["parent"] = o["parent"]
        if o.get("archived"):
            item["archived"] = True
        out.append(item)
    by_value = {o["value"]: o for o in out}
    for o in out:  # parent must exist and the chain must not loop
        p, hops = o.get("parent"), 0
        while p is not None:
            if p not in by_value:
                raise TaskError(f"상위 선택지가 없습니다: {p}")
            hops += 1
            if hops > len(out):
                raise TaskError("선택지 계층이 순환됩니다.")
            p = by_value[p].get("parent")
    return out


def _unique_value(options: list[dict[str, Any]], label: str) -> str:
    taken = {str(o["value"]) for o in options}
    base, n, value = label, 2, label
    while value in taken:
        value = f"{base}-{n}"
        n += 1
    return value


# ---------- create / update ----------

def create_field(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    key = str(data.get("key") or "").strip()
    if not _KEY.match(key):
        raise TaskError("key는 영문 소문자로 시작하는 영문·숫자·밑줄(32자 이하)이어야 합니다.")
    if key in RESERVED_KEYS:
        raise TaskError(f"예약된 이름입니다: {key}")
    if conn.execute("SELECT 1 FROM task_fields WHERE key = ?", (key,)).fetchone():
        raise TaskError("이미 있는 key입니다.", 409)
    label = str(data.get("label") or "").strip()
    if not label:
        raise TaskError("항목 이름을 입력하세요.")
    ftype = data.get("type")
    if ftype not in TYPES:
        raise TaskError(f"type은 {', '.join(TYPES)} 중 하나여야 합니다.")
    options = _clean_options(data.get("options") or []) if ftype in OPTION_TYPES else []
    if data.get("options") and ftype not in OPTION_TYPES:
        raise TaskError("선택지는 choice·multi 항목에만 둘 수 있습니다.")
    order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM task_fields").fetchone()[0]
    now = _now()
    conn.execute(
        "INSERT INTO task_fields (key, label, type, options, sort_order, show_filter, show_row, "
        "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (key, label, ftype, json.dumps(options, ensure_ascii=False), order,
         int(data.get("show_filter", True)), int(data.get("show_row", True)), now, now),
    )
    conn.commit()
    return get_field(conn, key)


def _apply_moves(
    conn: sqlite3.Connection, key: str, ftype: str, moves: dict[Any, Any]
) -> None:
    """Rewrite task values: moves maps old option value -> new value (None = clear)."""
    path = f'$."{key}"'
    for r in conn.execute("SELECT id, props FROM tasks WHERE json_type(props, ?) IS NOT NULL", (path,)).fetchall():
        props = json.loads(r["props"])
        cur = props.get(key)
        if ftype == "multi":
            new: list[Any] = []
            for v in cur:
                v = moves.get(v, v) if v in moves else v
                if v is not None and v not in new:
                    new.append(v)
            if new:
                props[key] = new
            else:
                props.pop(key)
        elif cur in moves:
            if moves[cur] is None:
                props.pop(key)
            else:
                props[key] = moves[cur]
        else:
            continue
        conn.execute("UPDATE tasks SET props = ? WHERE id = ?", (json.dumps(props, ensure_ascii=False), r["id"]))


def _norm_moves(raw: Any, options: list[dict[str, Any]]) -> dict[Any, Any]:
    """JSON object keys are strings; map them back to the real option values."""
    by_str = {str(o["value"]): o["value"] for o in options}
    out: dict[Any, Any] = {}
    for k, v in (raw or {}).items():
        out[by_str.get(str(k), k)] = by_str.get(str(v), v) if v is not None else None
    return out


def _check_option_removal(
    conn: sqlite3.Connection, field: dict[str, Any], new_opts: list[dict[str, Any]],
    moves: dict[Any, Any],
) -> None:
    key = field["key"]
    old = {o["value"] for o in field["options"]}
    new = {o["value"] for o in new_opts}
    removed = old - new
    if not removed:
        return
    if field["builtin"] and key == "priority":
        raise TaskError("우선순위의 선택지(1~3)는 지울 수 없습니다.")
    refs = rules_referencing_options(conn, key, removed)
    if refs:
        raise TaskError(f"위치 규칙 {', '.join(str(i + 1) for i in refs)}번이 이 선택지를 쓰고 있어 지울 수 없습니다.", 409)
    in_use: dict[Any, int] = {}
    for r in conn.execute("SELECT props FROM tasks WHERE json_type(props, ?) IS NOT NULL", (f'$."{key}"',)):
        cur = json.loads(r["props"]).get(key)
        for v in (cur if isinstance(cur, list) else [cur]):
            if v in removed:
                in_use[v] = in_use.get(v, 0) + 1
    for v, n in in_use.items():
        if v not in moves:
            raise TaskError(f"선택지 '{v}'을(를) 쓰는 할일이 {n}개 있습니다. option_moves로 옮길 값을 정하거나 null로 비우세요.", 409)
        target = moves[v]
        if target is not None and (target not in new or target in removed):
            raise TaskError(f"옮길 값이 올바르지 않습니다: {target}")


def update_field(conn: sqlite3.Connection, key: str, data: dict[str, Any]) -> dict[str, Any]:
    field = get_field(conn, key)
    sets: dict[str, Any] = {}
    if "label" in data:
        label = str(data["label"] or "").strip()
        if not label:
            raise TaskError("항목 이름을 입력하세요.")
        sets["label"] = label
    if "type" in data and data["type"] != field["type"]:
        if data["type"] not in TYPES:
            raise TaskError(f"type은 {', '.join(TYPES)} 중 하나여야 합니다.")
        if field["builtin"] or usage_count(conn, key):
            raise TaskError("값이 있거나 기본 항목은 타입을 바꿀 수 없습니다.", 409)
        sets["type"] = data["type"]
        if data["type"] not in OPTION_TYPES:
            sets["options"] = "[]"
    ftype = sets.get("type", field["type"])
    for f in ("show_filter", "show_row", "archived"):
        if f in data:
            sets[f] = int(bool(data[f]))
    if "sort_order" in data:
        sets["sort_order"] = int(data["sort_order"])
    if "options" in data:
        if ftype not in OPTION_TYPES:
            raise TaskError("선택지는 choice·multi 항목에만 둘 수 있습니다.")
        new_opts = _clean_options(data["options"])
        if field["builtin"] and key == "priority" and {o["value"] for o in new_opts} != {1, 2, 3}:
            raise TaskError("우선순위의 선택지(1~3)는 이름·색만 바꿀 수 있습니다.")
        moves = _norm_moves(data.get("option_moves"), field["options"])
        _check_option_removal(conn, field, new_opts, moves)
        removed = {o["value"] for o in field["options"]} - {o["value"] for o in new_opts}
        if removed:  # children of a removed option move up one level
            by_old = {o["value"]: o for o in field["options"]}
            for o in new_opts:
                while o.get("parent") in removed:
                    up = by_old[o["parent"]].get("parent")
                    if up is None:
                        o.pop("parent")
                    else:
                        o["parent"] = up
            _apply_moves(conn, key, ftype, {v: moves.get(v) for v in removed if v in moves})
        sets["options"] = json.dumps(new_opts, ensure_ascii=False)
    if sets:
        cols = ", ".join(f"{k} = ?" for k in sets)
        conn.execute(f"UPDATE task_fields SET {cols}, updated_at = ? WHERE key = ?", [*sets.values(), _now(), key])
    conn.commit()
    return get_field(conn, key)


def add_option(conn: sqlite3.Connection, key: str, data: dict[str, Any]) -> dict[str, Any]:
    """Inline '+' on a chip: append one option and return the updated field."""
    field = get_field(conn, key)
    if field["type"] not in OPTION_TYPES:
        raise TaskError("선택지를 둘 수 없는 항목입니다.")
    if field["builtin"] and key == "priority":
        raise TaskError("우선순위의 선택지는 늘릴 수 없습니다.")
    label = str(data.get("label") or "").strip()
    if not label:
        raise TaskError("선택지 이름을 입력하세요.")
    if any(o["label"] == label for o in field["options"]):
        raise TaskError("이미 있는 선택지입니다.", 409)
    opt: dict[str, Any] = {"value": _unique_value(field["options"], label), "label": label}
    if data.get("color"):
        opt["color"] = data["color"]
    if data.get("parent") is not None:
        opt["parent"] = data["parent"]
    return update_field(conn, key, {"options": [*field["options"], opt]})


def reorder(conn: sqlite3.Connection, keys: list[str]) -> list[dict[str, Any]]:
    existing = [f["key"] for f in list_fields(conn)]
    if sorted(keys) != sorted(existing):
        raise TaskError("모든 항목 key를 한 번씩 보내야 합니다.")
    for i, k in enumerate(keys, 1):
        conn.execute("UPDATE task_fields SET sort_order = ?, updated_at = ? WHERE key = ?", (i, _now(), k))
    conn.commit()
    return list_fields(conn)


def delete_field(conn: sqlite3.Connection, key: str, *, purge: bool = False) -> dict[str, Any]:
    """Default: archive when values exist (data kept), delete when unused.
    purge=True: remove the definition and its values; rejected while a page rule uses it."""
    field = get_field(conn, key)
    used = usage_count(conn, key)
    if not purge:
        if used or field["builtin"]:
            conn.execute("UPDATE task_fields SET archived = 1, updated_at = ? WHERE key = ?", (_now(), key))
            conn.commit()
            return {"ok": True, "archived": True, "used_by": used}
        return _drop(conn, key, 0)
    refs = rules_referencing_field(conn, key)
    if refs:
        raise TaskError(f"위치 규칙 {', '.join(str(i + 1) for i in refs)}번이 이 항목을 쓰고 있어 지울 수 없습니다.", 409)
    return _drop(conn, key, used)


def _drop(conn: sqlite3.Connection, key: str, used: int) -> dict[str, Any]:
    if used:
        conn.execute("UPDATE tasks SET props = json_remove(props, ?)", (f'$."{key}"',))
    if key in BUILTIN_KEYS:  # keep the legacy mirror column consistent
        reset = "priority = 2" if key == "priority" else f"{key} = NULL"
        conn.execute(f"UPDATE tasks SET {reset}")
    conn.execute("DELETE FROM task_fields WHERE key = ?", (key,))
    conn.commit()
    return {"ok": True, "archived": False, "purged": used}


# ---------- page location rules (settings.page_rules, SPEC 4.2.3 C) ----------

def get_rules(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    r = conn.execute("SELECT value FROM settings WHERE key = 'page_rules'").fetchone()
    try:
        rules = json.loads(r["value"]) if r and r["value"] else []
    except ValueError:
        return []
    return rules if isinstance(rules, list) else []


def _template_fields(path: str, fields: list[dict[str, Any]]) -> tuple[set[str], list[str]]:
    by_name = {f["key"]: f["key"] for f in fields} | {f["label"]: f["key"] for f in fields}
    keys: set[str] = set()
    unknown: list[str] = []
    for var in _TEMPLATE_VAR.findall(path):
        if var in RULE_VARS:
            continue
        if var in by_name:
            keys.add(by_name[var])
        else:
            unknown.append(var)
    return keys, unknown


def validate_rules(conn: sqlite3.Connection, rules: Any) -> list[dict[str, Any]]:
    if not isinstance(rules, list):
        raise TaskError("규칙은 목록이어야 합니다.")
    fields = {f["key"]: f for f in list_fields(conn)}
    out: list[dict[str, Any]] = []
    for n, rule in enumerate(rules, 1):
        if not isinstance(rule, dict) or not str(rule.get("path") or "").strip():
            raise TaskError(f"규칙 {n}: 경로 템플릿이 필요합니다.")
        conds = rule.get("conditions") or []
        if not isinstance(conds, list):
            raise TaskError(f"규칙 {n}: 조건은 목록이어야 합니다.")
        for c in conds:
            if not isinstance(c, dict) or c.get("field") not in fields:
                raise TaskError(f"규칙 {n}: 없는 항목을 조건에 썼습니다.")
            if c.get("op") not in RULE_OPS:
                raise TaskError(f"규칙 {n}: op는 {', '.join(RULE_OPS)} 중 하나여야 합니다.")
            f = fields[c["field"]]
            if c["op"] in ("is", "not"):
                if f["type"] in OPTION_TYPES and c.get("value") not in [o["value"] for o in f["options"]]:
                    raise TaskError(f"규칙 {n}: '{f['label']}'에 없는 선택지입니다.")
                if "value" not in c:
                    raise TaskError(f"규칙 {n}: 값이 필요합니다.")
        _, unknown = _template_fields(rule["path"], list(fields.values()))
        if unknown:
            raise TaskError(f"규칙 {n}: 알 수 없는 변수 {{{unknown[0]}}}")
        out.append({"conditions": conds, "path": rule["path"].strip()})
    return out


def set_rules(conn: sqlite3.Connection, rules: Any) -> list[dict[str, Any]]:
    clean = validate_rules(conn, rules)
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('page_rules', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (json.dumps(clean, ensure_ascii=False),),
    )
    conn.commit()
    return clean


def rules_referencing_field(conn: sqlite3.Connection, key: str) -> list[int]:
    """0-based indexes of rules whose conditions or path template use the field."""
    fields = list_fields(conn)
    hit: list[int] = []
    for i, rule in enumerate(get_rules(conn)):
        if not isinstance(rule, dict):
            continue
        used = {c.get("field") for c in rule.get("conditions") or [] if isinstance(c, dict)}
        used |= _template_fields(str(rule.get("path", "")), fields)[0]
        if key in used:
            hit.append(i)
    return hit


def rules_referencing_options(conn: sqlite3.Connection, key: str, values: set[Any]) -> list[int]:
    hit: list[int] = []
    for i, rule in enumerate(get_rules(conn)):
        if not isinstance(rule, dict):
            continue
        for c in rule.get("conditions") or []:
            if isinstance(c, dict) and c.get("field") == key and c.get("value") in values:
                hit.append(i)
                break
    return hit
