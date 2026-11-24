"""Structure view settings (P2B-07): which classifications group the issue table, in what order,
with which icon/color. Hiding a level only edits this view; field values and definitions stay
untouched. Deleting a definition is a separate action (task_fields) whose impact is reported here."""
from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

from app.repositories import issue_levels
from app.repositories import task_fields as tf
from app.repositories.tasks import TaskError

SETTING = "structure_view"
ICONS = ("layers", "grid", "box", "person", "flag", "ring")
COLORS = ("violet", "mint", "blue", "peach", "pink", "yellow")
LEVEL_TYPES = ("choice", "person")  # single-valued fields can group issues
DEFAULT_LEVELS = ("epic", "type")
DEFAULT_STYLES = {"epic": ("layers", "violet"), "type": ("grid", "mint")}
RESERVED_LABELS = {"이슈"}
MAX_LEVELS = 8
MODES = ("issues", "fields", "free")  # V-011: "issues" = Jira-style issue hierarchy (parent links), the default
_NEW = re.compile(r"^new:([A-Za-z0-9_-]{1,24})$")


def _usable(f: dict[str, Any]) -> bool:
    return f["type"] in LEVEL_TYPES and not f["archived"]


def _stored(conn: sqlite3.Connection) -> dict[str, Any] | None:
    r = conn.execute("SELECT value FROM settings WHERE key = ?", (SETTING,)).fetchone()
    try:
        data = json.loads(r["value"]) if r and r["value"] else None
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _style(key: str, styles: dict[str, Any], slot: int) -> dict[str, str]:
    s = styles.get(key) if isinstance(styles.get(key), dict) else {}
    icon, color = DEFAULT_STYLES.get(key, (ICONS[(slot + 2) % len(ICONS)], COLORS[(slot + 2) % len(COLORS)]))
    return {
        "icon": s.get("icon") if s.get("icon") in ICONS else icon,
        "color": s.get("color") if s.get("color") in COLORS else color,
    }


def get_view(conn: sqlite3.Connection) -> dict[str, Any]:
    """Effective view. A broken rule (a saved level was deleted/archived) falls back to free mode."""
    fields = {f["key"]: f for f in tf.list_fields(conn)}
    stored = _stored(conn)
    mode = "issues"
    reason = None
    if stored is None:
        keys = [k for k in DEFAULT_LEVELS if k in fields]
        styles: dict[str, Any] = {}
    else:
        keys = [k for k in stored.get("levels", []) if isinstance(k, str)]
        styles = stored.get("styles") if isinstance(stored.get("styles"), dict) else {}
        mode = stored.get("mode") if stored.get("mode") in MODES else "fields"
    missing = [k for k in keys if k not in fields or not _usable(fields[k])]
    if mode == "fields" and missing:
        names = ", ".join(f"'{fields[k]['label']}'" if k in fields else f"'{k}'" for k in missing)
        mode, reason = "free", f"분류 {names}이(가) 삭제·보관되어 계층 규칙이 깨졌습니다. 자유 배치로 표시합니다."
    valid = [k for k in keys if k not in missing]
    levels = [{"key": k, "label": fields[k]["label"], **_style(k, styles, i)} for i, k in enumerate(valid)]
    pool = [{"key": k, "label": f["label"], **_style(k, styles, i)}
            for i, (k, f) in enumerate(fields.items()) if _usable(f) and k not in valid]
    return {
        "mode": mode, "levels": levels, "available": pool, "free_reason": reason,
        "saved": stored is not None, "icons": list(ICONS), "colors": list(COLORS),
        "issue_levels": issue_levels.list_levels(conn),
    }


def _free_key(fields: dict[str, Any], taken: set[str]) -> str:
    n = 1
    while f"c{n}" in fields or f"c{n}" in taken:
        n += 1
    return f"c{n}"


def _validate_new(data: dict[str, Any], fields: dict[str, Any]) -> dict[str, str]:
    labels = {f["label"].casefold() for f in fields.values()} | {x.casefold() for x in RESERVED_LABELS}
    new_defs: dict[str, str] = {}
    for item in data.get("new_fields") or []:
        tmp = str(item.get("tmp", "")) if isinstance(item, dict) else ""
        label = str(item.get("label", "")).strip() if isinstance(item, dict) else ""
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,24}", tmp) or tmp in new_defs:
            raise TaskError("새 분류 식별자가 올바르지 않습니다.")
        if not label or len(label) > 50:
            raise TaskError("분류 이름은 1~50자로 입력하세요.")
        if label.casefold() in labels:
            raise TaskError(f"'{label}' 이름은 이미 있습니다.", 409)
        labels.add(label.casefold())
        new_defs[tmp] = label
    return new_defs


def save_view(conn: sqlite3.Connection, data: Any) -> dict[str, Any]:
    """Validate everything first, then create new classifications and write the view in one step.
    Cancel never reaches the server, so the saved view only changes here (apply = atomic)."""
    if not isinstance(data, dict):
        raise TaskError("요청 형식이 올바르지 않습니다.")
    mode = data.get("mode", "fields")
    if mode not in MODES:
        raise TaskError("mode는 issues, fields, free 중 하나여야 합니다.")
    levels = data.get("levels", [])
    if not isinstance(levels, list) or len(levels) > MAX_LEVELS:
        raise TaskError(f"계층은 {MAX_LEVELS}단계까지 둘 수 있습니다.")
    fields = {f["key"]: f for f in tf.list_fields(conn)}
    new_defs = _validate_new(data, fields)
    seen: set[str] = set()
    for k in levels:
        m = _NEW.match(k) if isinstance(k, str) else None
        ok_new = bool(m and m.group(1) in new_defs)
        if not ok_new and not (isinstance(k, str) and k in fields and _usable(fields[k])):
            raise TaskError("계층에 쓸 수 없는 분류가 있습니다.")
        if k in seen:
            raise TaskError("같은 분류를 두 번 넣을 수 없습니다.")
        seen.add(k)
    styles_in = data.get("styles") or {}
    if not isinstance(styles_in, dict):
        raise TaskError("styles 형식이 올바르지 않습니다.")
    for k, s in styles_in.items():
        if not isinstance(s, dict) or s.get("icon") not in ICONS or s.get("color") not in COLORS:
            raise TaskError("아이콘 또는 색이 올바르지 않습니다.")
        m = _NEW.match(k)
        if k not in fields and not (m and m.group(1) in new_defs):
            raise TaskError("없는 분류의 스타일입니다.")
    created: list[str] = []
    try:
        mapped: dict[str, str] = {}
        for tmp, label in new_defs.items():
            key = _free_key(fields, set(created))
            tf.create_field(conn, {"key": key, "label": label, "type": "choice"})
            created.append(key)
            mapped[f"new:{tmp}"] = key
        value = {
            "mode": mode,
            "levels": [mapped.get(k, k) for k in levels],
            "styles": {mapped.get(k, k): {"icon": s["icon"], "color": s["color"]} for k, s in styles_in.items()},
        }
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (SETTING, json.dumps(value, ensure_ascii=False)),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        for key in created:  # compensate: do not leave half-created definitions behind
            conn.execute("DELETE FROM task_fields WHERE key = ?", (key,))
        conn.commit()
        raise
    return get_view(conn)


def _value_counts(conn: sqlite3.Connection, field: dict[str, Any]) -> dict[Any, int]:
    path = f'$."{field["key"]}"'
    if field["type"] == "multi":
        rows = conn.execute(
            "SELECT j.value v, COUNT(*) n FROM tasks, json_each(tasks.props, ?) j "
            "WHERE json_type(tasks.props, ?) = 'array' GROUP BY j.value", (path, path)).fetchall()
    else:
        rows = conn.execute(
            "SELECT json_extract(props, ?) v, COUNT(*) n FROM tasks WHERE json_type(props, ?) IS NOT NULL GROUP BY v",
            (path, path)).fetchall()
    return {r["v"]: r["n"] for r in rows}


def _in_view(conn: sqlite3.Connection, key: str) -> bool:
    saved = _stored(conn)
    if saved is None:
        return False  # the default view is the issue hierarchy, which groups by no classification
    return saved.get("mode") == "fields" and key in saved.get("levels", [])


def impact(conn: sqlite3.Connection, key: str) -> dict[str, Any]:
    """What deleting/archiving this classification would touch: issue count, per-option counts,
    page-location rules that reference it, and whether the structure view groups by it."""
    field = tf.get_field(conn, key)
    counts = _value_counts(conn, field)
    options = []
    for o in field["options"]:
        refs = tf.rules_referencing_options(conn, key, {o["value"]})
        options.append({"value": o["value"], "label": o["label"], "count": counts.get(o["value"], 0),
                        "rules": [i + 1 for i in refs]})
    return {
        "key": key, "label": field["label"], "type": field["type"], "builtin": field["builtin"],
        "archived": field["archived"], "used_by": tf.usage_count(conn, key), "options": options,
        "rules": [i + 1 for i in tf.rules_referencing_field(conn, key)], "in_view": _in_view(conn, key),
        "total_tasks": conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0],
    }


def overview(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """One row per classification for the management screen."""
    view = get_view(conn)
    view_keys = {lv["key"] for lv in view["levels"]} if view["mode"] == "fields" else set()
    return [{
        "key": f["key"], "label": f["label"], "type": f["type"], "builtin": f["builtin"],
        "archived": f["archived"], "options": len(f["options"]), "used_by": tf.usage_count(conn, f["key"]),
        "rules": [i + 1 for i in tf.rules_referencing_field(conn, f["key"])],
        "in_view": f["key"] in view_keys, "groupable": _usable(f),
    } for f in tf.list_fields(conn)]
