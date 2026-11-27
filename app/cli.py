"""Agent CLI (P7-01): read/update tasks and evaluations without the web app.

Usage: python -m app.cli [--db PATH] [--vault PATH] <group> <command> [options]
Output is always one JSON document on stdout; errors are {"error": "..."} with exit code 1.
Local files only (data/mi_planner.db, vault/). No recipe-write commands exist by design (D-11).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from app import db, search
from app.repositories import evaluations as ev
from app.repositories import tasks as tk
from app.vault import DEFAULT_VAULT_PATH, Vault, VaultError

_CLEARABLE = ("due_date", "planned_date", "requester", "note", "mark", "eval_id", "page_path", "parent_task_id")
_INT_FIELDS = ("eval_id", "parent_task_id")


class CliError(Exception):
    pass


def _task_fields(args: argparse.Namespace) -> dict[str, Any]:
    raw = {"title": args.title, "status": args.status, "priority": args.priority, "requester": args.requester,
           "due_date": args.due, "planned_date": args.planned, "eval_id": args.eval_id, "note": args.note,
           "page_path": args.page_path, "parent_task_id": args.parent, "mark": args.mark}
    out: dict[str, Any] = {}
    for key, value in raw.items():
        if value is None:
            continue
        if key in _CLEARABLE and isinstance(value, str) and value.lower() in ("none", "null"):
            value = None
        elif key in _INT_FIELDS:
            try:
                value = int(value)
            except ValueError:
                raise CliError(f"{key}는 숫자 또는 none이어야 합니다.") from None
        out[key] = value
    return out


def _add_task_options(p: argparse.ArgumentParser, *, title_required: bool) -> None:
    if title_required:
        p.add_argument("title")
    else:
        p.add_argument("--title")
    p.add_argument("--status", choices=tk.STATUSES)
    p.add_argument("--priority", type=int, choices=(1, 2, 3))
    p.add_argument("--requester")
    p.add_argument("--due", help="YYYY-MM-DD or none")
    p.add_argument("--planned", help="YYYY-MM-DD or none")
    p.add_argument("--eval-id", dest="eval_id", help="evaluation id or none")
    p.add_argument("--page-path", dest="page_path")
    p.add_argument("--parent", help="parent task id or none")
    p.add_argument("--mark", choices=("star", "urgent", "none"))
    p.add_argument("--note")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="MI_Planner agent CLI (JSON output)")
    parser.add_argument("--db", type=Path, default=db.DEFAULT_DB_PATH)
    parser.add_argument("--vault", type=Path, default=DEFAULT_VAULT_PATH)
    groups = parser.add_subparsers(dest="group", required=True)

    task = groups.add_parser("task").add_subparsers(dest="cmd", required=True)
    lst = task.add_parser("list")
    lst.add_argument("--status", action="append", choices=tk.STATUSES)
    lst.add_argument("--open", action="store_true", help="exclude done")
    lst.add_argument("--overdue", action="store_true")
    lst.add_argument("--due-within", type=int, dest="due_within")
    lst.add_argument("--eval-id", type=int, dest="eval_id")
    lst.add_argument("--requester")
    lst.add_argument("--q")
    lst.add_argument("--limit", type=int, default=100)
    show = task.add_parser("show")
    show.add_argument("id", type=int)
    add = task.add_parser("add")
    _add_task_options(add, title_required=True)
    sett = task.add_parser("set")
    sett.add_argument("id", type=int)
    _add_task_options(sett, title_required=False)
    done = task.add_parser("done")
    done.add_argument("id", type=int)

    evg = groups.add_parser("eval").add_subparsers(dest="cmd", required=True)
    evg.add_parser("list")
    es = evg.add_parser("show")
    es.add_argument("id", type=int)
    es.add_argument("--full", action="store_true", help="include every cell")
    st = evg.add_parser("stalled", help="cells over their stage warn_hours (MOS wait)")
    st.add_argument("--limit", type=int, default=20)
    ss = evg.add_parser("set-stage")
    ss.add_argument("id", type=int, help="evaluation id")
    ss.add_argument("--cells", required=True, help="comma separated cell ids")
    ss.add_argument("--stage", required=True, help="stage key")
    ss.add_argument("--at", help="ISO time (e.g. MOS time); default now")
    sc = evg.add_parser("set-cell")
    sc.add_argument("cell", type=int)
    sc.add_argument("--value", action="append", default=[], metavar="KEY=VALUE", help="empty VALUE clears")
    sc.add_argument("--note")
    hs = evg.add_parser("history")
    hs.add_argument("cell", type=int)
    hs.add_argument("--limit", type=int, default=50)

    sr = groups.add_parser("search")
    sr.add_argument("query")
    sr.add_argument("--limit", type=int, default=20)
    return parser


def _board_view(conn, eval_id: int, full: bool) -> dict[str, Any]:
    board = ev.get_board(conn, eval_id)
    names = {e["id"]: e["name"] for e in board["equipment"]}
    wafers = {w["id"]: (lot["lot_no"], w["wafer_no"]) for lot in board["lots"] for w in lot["wafers"]}
    counts: dict[str, int] = {}
    for cell in board["cells"]:
        if not cell["excluded"]:
            counts[cell["stage_key"]] = counts.get(cell["stage_key"], 0) + 1
    evaluation = board["evaluation"]
    out: dict[str, Any] = {
        "evaluation": {k: evaluation[k] for k in ("id", "name", "status", "start_date", "due_date", "page_path")},
        "stages": evaluation["stages"], "fields": evaluation["fields"],
        "equipment": board["equipment"], "lots": board["lots"],
        "stage_counts": counts, "now": board["now"],
        "warned": sum(1 for c in board["cells"] if c["warn"]),
    }
    if full:
        out["cells"] = [{**c, "equipment": names.get(c["equipment_id"], ""),
                         "lot_no": wafers.get(c["wafer_id"], ("", ""))[0],
                         "wafer_no": wafers.get(c["wafer_id"], ("", ""))[1]} for c in board["cells"]]
    return out


def _task(conn, args: argparse.Namespace) -> Any:
    if args.cmd == "list":
        found = tk.list_tasks(conn, status=args.status, requester=args.requester, due_within=args.due_within,
                              overdue=args.overdue, eval_id=args.eval_id, q=args.q, open_only=args.open,
                              search_body=search.task_list_body(Vault(args.vault)) if args.q else None)
        return {"total": len(found), "items": found[:max(0, args.limit)]}
    if args.cmd == "show":
        return tk.get(conn, args.id)
    if args.cmd == "add":
        return tk.create(conn, _task_fields(args))
    if args.cmd == "set":
        fields = _task_fields(args)
        if not fields:
            raise CliError("바꿀 항목을 하나 이상 지정하세요 (--status, --due ...).")
        return tk.update(conn, args.id, fields)
    return tk.update(conn, args.id, {"status": "done"})


def _parse_values(items: list[str]) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for item in items:
        key, sep, raw = item.partition("=")
        if not sep or not key.strip():
            raise CliError(f"--value는 KEY=VALUE 형식이어야 합니다: {item}")
        values[key.strip()] = raw if raw != "" else None
    return values


_TRUE = {"true", "1", "y", "yes", "o", "on", "v", "✓", "체크"}
_FALSE = {"false", "0", "n", "no", "x", "off"}


def _coerce(field: dict[str, Any], raw: str) -> Any:
    """Turn a command-line string into the JSON type the field stores (number/okng/check/text)."""
    kind, label, text = field.get("type"), field.get("label", field.get("key")), raw.strip()
    if kind == "number":
        try:
            number = float(text.replace(",", ""))
        except ValueError:
            raise CliError(f"'{label}'에는 숫자를 입력해 주세요: {raw}") from None
        return int(number) if number.is_integer() and "." not in text and "e" not in text.lower() else number
    if kind == "okng":
        if text.lower() not in ("ok", "ng"):
            raise CliError(f"'{label}'은 ok 또는 ng만 쓸 수 있어요: {raw}")
        return text.lower()
    if kind == "check":
        if text.lower() in _TRUE:
            return True
        if text.lower() in _FALSE:
            return False
        raise CliError(f"'{label}'은 true 또는 false로 써 주세요: {raw}")
    return raw


def _typed_values(conn, cell_id: int, values: dict[str, Any]) -> dict[str, Any]:
    """Accept a field key or its label and convert each value to the field's type."""
    row = conn.execute("SELECT e.fields FROM eval_cells c JOIN evaluations e ON e.id = c.evaluation_id "
                       "WHERE c.id = ?", (cell_id,)).fetchone()
    if row is None:
        return values  # the repository reports the missing cell
    fields = json.loads(row["fields"])
    by_name = {f["key"]: f for f in fields} | {f["label"]: f for f in fields if f.get("label")}
    out: dict[str, Any] = {}
    for name, raw in values.items():
        field = by_name.get(name)
        if field is None:
            out[name] = raw  # unknown key: the repository names it in its error
        else:
            out[field["key"]] = None if raw is None else _coerce(field, raw)
    return out


def _eval(conn, args: argparse.Namespace) -> Any:
    if args.cmd == "list":
        keys = ("id", "name", "status", "start_date", "due_date", "page_path",
                "equipment_count", "lot_count", "wafer_count", "cell_count")
        return {"items": [{k: e[k] for k in keys} for e in ev.list_evaluations(conn)]}
    if args.cmd == "show":
        return _board_view(conn, args.id, args.full)
    if args.cmd == "stalled":
        return ev.stalled_cells(conn, limit=args.limit)
    if args.cmd == "set-stage":
        try:
            ids = [int(x) for x in args.cells.split(",") if x.strip()]
        except ValueError:
            raise CliError("--cells는 쉼표로 구분한 숫자여야 합니다.") from None
        moves = [(i, args.stage, args.at) if args.at else (i, args.stage) for i in ids]
        return ev.apply_stage_moves(conn, args.id, moves)
    if args.cmd == "set-cell":
        values = _typed_values(conn, args.cell, _parse_values(args.value))
        if not values and args.note is None:
            raise CliError("--value 또는 --note를 지정하세요.")
        return ev.update_cell(conn, args.cell, values or None, args.note, args.note is not None)
    return {"items": ev.cell_history(conn, args.cell, args.limit)}


def run(argv: list[str]) -> Any:
    args = build_parser().parse_args(argv)
    db.init_db(args.db)
    conn = db.connect(args.db)
    try:
        if args.group == "task":
            return _task(conn, args)
        if args.group == "eval":
            return _eval(conn, args)
        return search.search(Vault(args.vault), conn, args.query, args.limit)
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    try:
        result = run(sys.argv[1:] if argv is None else argv)
    except (tk.TaskError, ev.EvaluationError, VaultError, CliError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
