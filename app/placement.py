"""Optional issue pages and conditional placement (P2B-09, D-28).

An issue is a task row. It gets a vault page only when asked: `expand` links ONE page to the same issue
id (a second call returns the existing page), `create_with_page` makes issue + page together.
Where the page goes: first matching placement rule -> fallback folder, or an explicit override
(under the journal month, or a chosen folder). Already placed pages are never moved by classification
changes; `relocate` is an explicit, undoable action.

Identity of an issue page is `task_id` in its `_page.json`; `tasks.page_path` is the cached location.
Every operation holds one SQLite write transaction while it touches the vault and undoes its own vault
changes when anything fails, so there is never a page without a link or a link without a page.
"""
from __future__ import annotations

import json
import re
import sqlite3
from datetime import date, datetime
from typing import Any

from app import journal
from app.repositories import tasks as repo
from app.repositories import task_fields as tf
from app.repositories.tasks import TaskError
from app.vault import RESERVED_DIRS, Vault, VaultError, _BAD_CHARS

UNSORTED = "미분류"
MAX_DEPTH = 8
MAX_SEGMENT = 80
FALLBACKS: dict[str, tuple[str, str]] = {
    "journal": ("일지 아래", "일지/{연}/{연}-{월}"),
    "type": ("유형별 폴더", "MI 공정업무/{유형}"),
    "inbox": ("할일 폴더", "MI 공정업무/할일"),
}
DEFAULT_FALLBACK = "journal"
_MONTH_FOLDER = re.compile(r"^(일지/\d{4}/(\d{4}-\d{2}))(?:/|$)")
_WIN_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}
_VAR = re.compile(r"\{([^{}]+)\}")


# ---------- settings: fallback folder ----------

def get_fallback(conn: sqlite3.Connection) -> str:
    r = conn.execute("SELECT value FROM settings WHERE key = 'page_fallback'").fetchone()
    try:
        v = json.loads(r["value"]) if r and r["value"] else DEFAULT_FALLBACK
    except ValueError:
        v = DEFAULT_FALLBACK
    return v if v in FALLBACKS else DEFAULT_FALLBACK


def set_fallback(conn: sqlite3.Connection, key: Any) -> str:
    if key not in FALLBACKS:
        raise TaskError(f"기본 위치는 {', '.join(FALLBACKS)} 중 하나여야 합니다.")
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('page_fallback', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (json.dumps(key),))
    conn.commit()
    return key


# ---------- path helpers ----------

def clean_segment(text: Any) -> str:
    """Make a template value usable as a folder name (never raises)."""
    name = _BAD_CHARS.sub("", str(text)).strip().rstrip(". ")[:MAX_SEGMENT].strip()
    if not name or name.startswith(".") or name in RESERVED_DIRS:
        return UNSORTED
    if name.lower() in _WIN_RESERVED:
        name += "_"
    return name


def check_folder(path: Any) -> str:
    """Validate a user-typed folder path (strict: reject instead of rewriting)."""
    if not isinstance(path, str):
        raise TaskError("폴더 경로가 필요합니다.")
    parts = [p.strip() for p in path.replace("\\", "/").split("/") if p.strip()]
    if not parts:
        raise TaskError("폴더 경로가 필요합니다.")
    if len(parts) > MAX_DEPTH:
        raise TaskError(f"폴더는 {MAX_DEPTH}단계까지 만들 수 있어요.")
    for p in parts:
        if (p in (".", "..") or p.startswith(".") or p in RESERVED_DIRS or _BAD_CHARS.search(p)
                or len(p) > MAX_SEGMENT or p.lower() in _WIN_RESERVED):
            raise TaskError(f"폴더 이름을 사용할 수 없어요: {p}")
    return "/".join(parts)


def page_folder_name(title: str, task_id: int | None) -> str:
    name = clean_segment(title)
    return name if name != UNSORTED or title.strip() == UNSORTED else f"이슈 {task_id or ''}".strip()


def _flat_tree(vault: Vault) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    stack = list(vault.tree())
    while stack:
        n = stack.pop(0)
        out.append(n)
        stack = n["children"] + stack
    return out


# ---------- rule evaluation ----------

def _values(task: dict[str, Any], key: str) -> list[Any]:
    v = (task.get("props") or {}).get(key)
    if v is None or v == "" or v == []:
        return []
    return list(v) if isinstance(v, list) else [v]


def _is_under(field: dict[str, Any], value: Any, ancestor: Any) -> bool:
    parents = {o["value"]: o.get("parent") for o in field.get("options", [])}
    cur, hops = parents.get(value), 0
    while cur is not None and hops <= len(parents):
        if cur == ancestor:
            return True
        cur, hops = parents.get(cur), hops + 1
    return False


def condition_matches(task: dict[str, Any], cond: dict[str, Any], fields: dict[str, dict[str, Any]]) -> bool:
    field = fields.get(cond.get("field"))
    if field is None:
        return False
    vals = _values(task, field["key"])
    op = cond.get("op")
    if op == "set":
        return bool(vals)
    if op == "empty":
        return not vals
    target = cond.get("value")
    hit = any(v == target or _is_under(field, v, target) for v in vals)
    return hit if op == "is" else not hit


def _label_path(field: dict[str, Any], value: Any) -> str:
    opts = {o["value"]: o for o in field.get("options", [])}
    chain, cur = [], value
    while cur is not None and cur in opts and len(chain) <= len(opts):
        chain.append(clean_segment(opts[cur]["label"]))
        cur = opts[cur].get("parent")
    return "/".join(reversed(chain)) if chain else clean_segment(value)


def _task_date(task: dict[str, Any]) -> str:
    for k in ("planned_date", "created_at"):
        v = task.get(k)
        if v:
            try:
                date.fromisoformat(str(v)[:10])
                return str(v)[:10]
            except ValueError:
                pass
    return date.today().isoformat()


def fill_template(template: str, task: dict[str, Any], fields: list[dict[str, Any]], vault: Vault | None) -> str:
    by_name = {f["key"]: f for f in fields} | {f["label"]: f for f in fields}
    day = _task_date(task)
    epic_pages: dict[str, str] | None = None

    def sub(m: re.Match) -> str:
        nonlocal epic_pages
        name = m.group(1)
        if name == "연":
            return day[:4]
        if name == "월":
            return day[5:7]
        if name == "에픽위치":
            f = by_name.get("epic")
            vals = _values(task, "epic") if f else []
            if not vals:
                return UNSORTED
            label = next((o["label"] for o in f["options"] if o["value"] == vals[0]), None)
            if label is None or vault is None:
                return UNSORTED
            if epic_pages is None:  # first page titled like the epic wins (depth-first, tree order)
                epic_pages = {}
                for n in _flat_tree(vault):
                    epic_pages.setdefault(n["title"], n["path"])
            return epic_pages.get(label, UNSORTED)
        f = by_name.get(name)
        vals = _values(task, f["key"]) if f else []
        if not vals:
            return UNSORTED
        if f["type"] in tf.OPTION_TYPES:
            return _label_path(f, vals[0])
        return clean_segment(vals[0])

    out: list[str] = []
    for seg in template.split("/"):
        if seg.strip():  # a variable may itself expand to a path (hierarchical option, epic location)
            out.extend(clean_segment(p) for p in _VAR.sub(sub, seg).split("/") if p.strip())
    return "/".join(out)


def draft_task(data: dict[str, Any]) -> dict[str, Any]:
    """A not-yet-created issue (title + values) as the rules see it."""
    props = dict(data.get("props") or {})
    for k in repo.MIRRORED:
        if data.get(k) is not None:
            props[k] = data[k]
    return {"id": None, "title": str(data.get("title") or "").strip(), "props": props,
            "planned_date": props.get("planned_date"), "created_at": datetime.now().isoformat(timespec="seconds"),
            "note": data.get("note")}


def _rules_and_fields(conn: sqlite3.Connection, rules: list[dict[str, Any]] | None):
    fields = tf.list_fields(conn)
    return (tf.get_rules(conn) if rules is None else rules), fields, {f["key"]: f for f in fields}


def resolve_folder(conn: sqlite3.Connection, vault: Vault | None, task: dict[str, Any],
                   override: dict[str, Any] | None = None, *, rules: list[dict[str, Any]] | None = None,
                   fallback: str | None = None) -> dict[str, Any]:
    """Which folder would this issue's page go to, and why."""
    rules, fields, by_key = _rules_and_fields(conn, rules)
    fallback = fallback or get_fallback(conn)
    kind = (override or {}).get("kind") or "auto"
    if kind == "folder":
        return {"folder": check_folder(override.get("path")), "by": "직접 지정", "kind": "folder", "rule": None}
    if kind == "journal":
        tpl = FALLBACKS["journal"][1]
        return {"folder": fill_template(tpl, task, fields, vault), "by": "일지 아래", "kind": "journal", "rule": None}
    if kind != "auto":
        raise TaskError("위치 지정 방식을 알 수 없어요.")
    for i, rule in enumerate(rules):
        conds = rule.get("conditions") or []
        if conds and all(condition_matches(task, c, by_key) for c in conds):
            return {"folder": fill_template(rule["path"], task, fields, vault), "by": f"규칙 {i + 1}",
                    "kind": "rule", "rule": i}
    label, tpl = FALLBACKS[fallback]
    return {"folder": fill_template(tpl, task, fields, vault), "by": f"기본 · {label}", "kind": "default", "rule": None}


def _prefixes(folder: str) -> list[str]:
    parts = folder.split("/")
    return ["/".join(parts[:i]) for i in range(1, len(parts) + 1)]


def plan(conn: sqlite3.Connection, vault: Vault, task: dict[str, Any], override: dict[str, Any] | None = None,
         *, rules: list[dict[str, Any]] | None = None, fallback: str | None = None) -> dict[str, Any]:
    res = resolve_folder(conn, vault, task, override, rules=rules, fallback=fallback)
    folder = res["folder"]
    if folder.count("/") + 1 > MAX_DEPTH:
        raise TaskError(f"경로가 {MAX_DEPTH}단계를 넘어요: {folder}")
    name = page_folder_name(task.get("title") or "", task.get("id"))
    new_folders = [p for p in _prefixes(folder) if not vault.exists(p)]
    return {**res, "title": task.get("title") or "", "new_folders": new_folders,
            "page_path": f"{folder}/{vault.unique_name(folder, name)}",
            "journal": bool(_MONTH_FOLDER.match(folder))}


# ---------- creating folders / pages with rollback ----------

def _ensure_folders(vault: Vault, folder: str) -> list[str]:
    """Create missing folders as 'auto' pages (journal months as real month pages). Returns what was created."""
    missing = [p for p in _prefixes(folder) if not vault.exists(p)]
    try:
        m = _MONTH_FOLDER.match(folder)
        if m and not vault.exists(m.group(1)):
            journal.ensure_month(vault, m.group(2))
        for p in _prefixes(folder):
            if not vault.exists(p):
                parent, _, name = p.rpartition("/")
                vault.create(parent, name, "note", folder_name=name, extra_meta={"auto": True})
    except BaseException:
        vault.discard_created(missing)
        raise
    return missing


def _begin(conn: sqlite3.Connection) -> None:
    if conn.in_transaction:
        conn.commit()
    conn.execute("BEGIN IMMEDIATE")  # serialises concurrent expansions of the same issue


def _link(conn: sqlite3.Connection, task_id: int, path: str | None) -> None:
    """Hook point for the single DB write of an expansion (tests inject failures here)."""
    conn.execute("UPDATE tasks SET page_path = ?, updated_at = ? WHERE id = ?",
                 (path, datetime.now().isoformat(timespec="seconds"), task_id))


def existing_page(vault: Vault, task: dict[str, Any]) -> str | None:
    """The live page of an issue: the cached path if it still belongs to it, else found by task_id."""
    path = task.get("page_path")
    if path and vault.exists(path):
        try:
            owner = vault.read(path)["meta"].get("task_id")
        except VaultError:
            owner = None
        if owner in (None, task["id"]):  # legacy links without task_id are kept
            return path
    return vault.find_by_task(task["id"])


def expand(conn: sqlite3.Connection, vault: Vault, task_id: int, override: dict[str, Any] | None = None) -> dict[str, Any]:
    """Give an issue its page (once). A second call returns the existing page unchanged."""
    _begin(conn)
    created: list[str] = []
    try:
        task = repo.get(conn, task_id)
        found = existing_page(vault, task)
        if found:
            if task.get("page_path") != found:  # repair a stale cache
                _link(conn, task_id, found)
            conn.commit()
            return {"created": False, "path": found, "page": vault.read(found), "task": repo.get(conn, task_id)}
        p = plan(conn, vault, task, override)
        created = _ensure_folders(vault, p["folder"])
        page = vault.create(p["folder"], task["title"], "note", folder_name=page_folder_name(task["title"], task_id),
                            extra_meta={"task_id": task_id})
        created.append(page["path"])
        if task.get("note"):
            page = vault.write(page["path"], task["note"])
        vault.set_meta(page["path"], memo_unified=datetime.now().astimezone().isoformat(timespec="seconds"))
        _link(conn, task_id, page["path"])
        conn.commit()
        try:  # the memo's images follow it into the page folder (nothing is deleted if this fails)
            vault.adopt_issue_files(task_id, page["path"])
        except OSError:
            pass
        return {"created": True, "path": page["path"], "page": page, "placement": p, "task": repo.get(conn, task_id)}
    except BaseException:
        conn.rollback()
        vault.discard_created(created)
        raise


def create_with_page(conn: sqlite3.Connection, vault: Vault, data: dict[str, Any],
                     override: dict[str, Any] | None = None) -> dict[str, Any]:
    """'할일 페이지 추가': issue + page together. If the page cannot be made, the issue is not left behind."""
    task = repo.create(conn, data)
    try:
        res = expand(conn, vault, task["id"], override)
    except BaseException:
        try:
            repo.delete(conn, task["id"])
        except Exception:  # noqa: BLE001 - the original error matters more
            pass
        raise
    return res


def relocate(conn: sqlite3.Connection, vault: Vault, task_id: int, override: dict[str, Any] | None = None) -> dict[str, Any]:
    """Explicitly move an existing issue page to where the rules (or the override) say. Undone on failure."""
    _begin(conn)
    created: list[str] = []
    moved: tuple[str, str, dict[str, Any]] | None = None
    try:
        task = repo.get(conn, task_id)
        old = existing_page(vault, task)
        if not old:
            raise TaskError("이 이슈에는 아직 페이지가 없어요.", 409)
        p = plan(conn, vault, task, override)
        parent = old.rpartition("/")[0]
        if parent == p["folder"]:
            conn.commit()
            return {"moved": False, "path": old, "placement": p, "task": task}
        if p["folder"] == old or p["folder"].startswith(old + "/"):
            raise TaskError("페이지를 자기 하위로 옮길 수 없어요.")
        snapshot = vault.read(old)["meta"]
        created = _ensure_folders(vault, p["folder"])
        siblings = [n["order"] for n in (vault.tree(vault._dir(p["folder"])) if vault.exists(p["folder"]) else [])]
        page = vault.update(old, parent=p["folder"], order=max(siblings, default=-1) + 1)
        moved = (page["path"], old, snapshot)
        repoint(conn, old, page["path"])
        _link(conn, task_id, page["path"])
        conn.commit()
        return {"moved": True, "path": page["path"], "from": old, "placement": p, "task": repo.get(conn, task_id)}
    except BaseException:
        conn.rollback()
        if moved:
            vault.rollback_move(*moved)
        vault.discard_created(created)
        raise


# ---------- keeping links right when pages move / disappear through the page tree ----------

def repoint(conn: sqlite3.Connection, old: str, new: str) -> None:
    """Update cached page paths for issues and evaluations in the moved subtree. No commit."""
    n = len(old)
    for table in ("tasks", "evaluations"):
        conn.execute(
            f"UPDATE {table} SET page_path = ? || substr(page_path, ?) "
            "WHERE page_path = ? OR substr(page_path, 1, ?) = ?",
            (new, n + 1, old, n + 1, old + "/"),
        )


def unlink(conn: sqlite3.Connection, old: str) -> None:
    """Clear cached page paths after the page subtree moves to trash. No commit."""
    n = len(old)
    for table in ("tasks", "evaluations"):
        conn.execute(
            f"UPDATE {table} SET page_path = NULL WHERE page_path = ? OR substr(page_path, 1, ?) = ?",
            (old, n + 1, old + "/"),
        )


# ---------- overview for the rule editor ----------

def overview(conn: sqlite3.Connection, vault: Vault, rules: list[dict[str, Any]] | None = None,
             fallback: str | None = None) -> dict[str, Any]:
    """Per-rule match counts with an example, and where every existing issue page sits vs. what rules say now."""
    rules_now, fields, by_key = _rules_and_fields(conn, rules)
    if rules is not None:
        rules_now = tf.validate_rules(conn, rules)
    fallback = fallback or get_fallback(conn)
    if fallback not in FALLBACKS:
        raise TaskError("알 수 없는 기본 위치예요.")
    tasks = repo.list_tasks(conn)
    out_rules = []
    first_hit: dict[int, list[dict[str, Any]]] = {}
    for t in tasks:
        res = resolve_folder(conn, vault, t, None, rules=rules_now, fallback=fallback)
        if res["rule"] is not None:
            first_hit.setdefault(res["rule"], []).append(t)
    for i, r in enumerate(rules_now):
        hits = first_hit.get(i, [])
        ex = hits[0] if hits else None
        out_rules.append({
            "index": i, "matches": len(hits),
            "example": {"id": ex["id"], "title": ex["title"], "folder": fill_template(r["path"], ex, fields, vault)} if ex else None,
        })
    pages = []
    for t in tasks:
        if not t.get("page_path"):
            continue
        cur = existing_page(vault, t)
        if not cur:
            continue
        now = resolve_folder(conn, vault, t, None, rules=rules_now, fallback=fallback)
        folder = cur.rpartition("/")[0]
        pages.append({"task_id": t["id"], "title": t["title"], "path": cur, "folder": folder,
                      "rule_folder": now["folder"], "by": now["by"], "differs": folder != now["folder"]})
    return {"rules": out_rules, "pages": pages, "fallback": fallback,
            "fallbacks": [{"key": k, "label": v[0], "template": v[1]} for k, v in FALLBACKS.items()]}
