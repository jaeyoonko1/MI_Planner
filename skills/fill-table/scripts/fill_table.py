"""fill-table helper: fill a note table (GFM in vault/**/index.md) or an evaluation board from raw data.

Usage (from the MI_Planner folder):
    python skills/fill-table/scripts/fill_table.py raw  data/tmp/raw.csv
    python skills/fill-table/scripts/fill_table.py tables "vault/<page>/index.md"
    python skills/fill-table/scripts/fill_table.py excel-tables "vault/<page>/index.md"
    python skills/fill-table/scripts/fill_table.py excel-export "vault/<page>/index.md" --table-id TABLE_ID
    python skills/fill-table/scripts/fill_table.py excel-fill "vault/<page>/index.md" --table-id TABLE_ID \
        --values data/tmp/cells.json [--overwrite] [--apply]
    python skills/fill-table/scripts/fill_table.py md "vault/<page>/index.md" --table 1 --raw data/tmp/raw.csv \
        --key Wafer=WF --map "Scan(분)=scan_min" [--overwrite] [--add-missing] [--apply]
    python skills/fill-table/scripts/fill_table.py board 3 --raw data/tmp/raw.csv \
        --match equipment=Tool --match lot=Lot --match wafer=WF --map scan_time=scan_min [--overwrite] [--apply]

Dry run by default: prints the planned changes as JSON. `--apply` writes. md writes keep a copy of the
old file in vault/.backup/fill-table/. Board writes go only through `python -m app.cli eval set-cell`.
Stdlib only, no network.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from app.excel_table_search import plan_value_fill, read_grids  # noqa: E402
from app.vault_content import content_write_lock, replace_content  # noqa: E402

DELIM = re.compile(r"^:?-+:?$")
BOARD_KEYS = ("equipment", "lot", "wafer")


class FillError(Exception):
    pass


# ---------- raw data ----------

def read_text(path: str) -> str:
    if path == "-":
        return sys.stdin.read()
    data = Path(path).read_bytes()
    for enc in ("utf-8-sig", "cp949"):  # Excel on Korean Windows saves CSV as cp949
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    raise FillError(f"글자 인코딩을 읽지 못했습니다(UTF-8/CP949 아님): {path}")


def parse_raw(text: str, no_header: bool = False) -> dict[str, Any]:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        raise FillError("raw data가 비어 있습니다.")
    first = lines[0]
    if "\t" in first:
        delim, rows = "tab", [ln.split("\t") for ln in lines]
    elif "," in first or ";" in first:
        sep = "," if first.count(",") >= first.count(";") else ";"
        delim, rows = sep, list(csv.reader(io.StringIO("\n".join(lines)), delimiter=sep))
    else:
        delim, rows = "space", [re.split(r"\s+", ln.strip()) for ln in lines]
    rows = [[c.strip() for c in r] for r in rows]
    width = max(len(r) for r in rows)
    if no_header:
        header = [str(i + 1) for i in range(width)]
    else:
        header, rows = rows[0] + [str(i + 1) for i in range(len(rows[0]), width)], rows[1:]
    rows = [r + [""] * (width - len(r)) for r in rows]
    return {"delimiter": delim, "header": header, "rows": rows}


# ---------- GFM tables (same rules as web/js/note-table-model.js) ----------

def split_row(line: str) -> tuple[list[str], int]:
    cells, pipes, slashes, trailing = [""], 0, 0, False
    for ch in line.rstrip("\r\n"):
        if ch == "|" and slashes % 2 == 0:
            cells.append("")
            pipes += 1
            trailing = True
        else:
            cells[-1] += ch
            if ch.strip():
                trailing = False
        slashes = slashes + 1 if ch == "\\" else 0
    if line.lstrip().startswith("|"):
        cells.pop(0)
    if trailing:
        cells.pop()
    return [c.strip() for c in cells], pipes


def cell_text(src: str) -> str:
    text = re.sub(r"(\\+)\|", lambda m: "\\" * ((len(m.group(1)) - 1) // 2) + "|" if len(m.group(1)) % 2 else m.group(0), src)
    tokens = {"&#9;": "\t", "&#32;": " ", "&amp;": "&", "&lt;": "<"}
    return re.sub(r"<br\s*/?>|&#9;|&#32;|&amp;|&lt;", lambda m: "\n" if m.group(0).startswith("<") else tokens[m.group(0).lower()],
                  text, flags=re.I)


def cell_source(text: str) -> str:
    src = text.replace("&", "&amp;").replace("<", "&lt;")
    src = re.sub(r"(\\*)\|", lambda m: "\\" * (len(m.group(1)) * 2 + 1) + "|", src)
    src = re.sub(r"\r\n|\r|\n", "<br>", src).replace("\t", "&#9;")
    return re.sub(r"^ +| +$", lambda m: "&#32;" * len(m.group(0)), src)


# Keep these block boundaries in step with web/js/mdblocks.js. Table numbers
# should refer only to tables that the note editor recognizes as editable.
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
OTHER_BLOCK = re.compile(r"^(?: {0,3}>|#{1,3}[ \t]|#{4,}(?:[ \t]|$)|[ \t]*(?:[-*+]|[0-9]+[.)])(?:[ \t]|$))")
TABLE_PIPE = re.compile(r"^\s*\|")
INDENTED = re.compile(r"^(?: {4}|\t)")


def starts_other_block(line: str) -> bool:
    return bool(FENCE.match(line) or OTHER_BLOCK.match(line) or line.lstrip().startswith("<!--"))


def find_tables(lines: list[str]) -> list[dict[str, Any]]:
    rows = [line.rstrip("\r\n") for line in lines]
    tables, i = [], 0
    while i < len(rows):
        line = rows[i]
        mark = FENCE.match(line)
        if mark:
            fence = mark[1]
            i += 1
            while i < len(rows):
                close = FENCE.match(rows[i])
                i += 1
                if close and close[1].startswith(fence) and not close[2].strip():
                    break
            continue
        if line.lstrip().startswith("<!--"):
            while i < len(rows):
                closed = "-->" in rows[i]
                i += 1
                if closed:
                    break
            continue
        if starts_other_block(line):
            i += 1
            continue

        nxt = rows[i + 1] if i + 1 < len(rows) else ""
        header, pipes = split_row(line)
        delim, _ = split_row(nxt)
        valid = (pipes and header and not INDENTED.match(line) and not INDENTED.match(nxt)
                 and len(delim) == len(header) and all(DELIM.fullmatch(c) for c in delim))
        if valid:
            end = i + 2
            body = []
            while end < len(rows) and not starts_other_block(rows[end]):
                cells, row_pipes = split_row(rows[end])
                if not row_pipes:
                    break
                body.append(cells)
                end += 1
            tables.append({"start": i, "end": end, "header": header, "rows": body})
            i = end
            continue

        i += 1
        # A run of leading pipes with a malformed header is one read-only block.
        if TABLE_PIPE.match(line):
            while i < len(rows) and TABLE_PIPE.match(rows[i]):
                i += 1
    return tables


def serialize(cells: list[str], ending: str) -> str:
    return "| " + " | ".join(cells) + " |" + ending


# ---------- matching ----------

def norm(value: str) -> str:
    text = " ".join(str(value).split()).casefold()
    return str(int(text)) if text.isdigit() else text


def pairs(items: list[str], what: str) -> list[tuple[str, str]]:
    out = []
    for item in items:
        left, sep, right = item.partition("=")
        if not left.strip():
            raise FillError(f"{what}는 '대상=raw열' 형식이어야 합니다: {item}")
        out.append((left.strip(), (right if sep else left).strip()))
    return out


def column(header: list[str], name: str, where: str) -> int:
    found = [i for i, h in enumerate(header) if norm(cell_text(h)) == norm(name)]
    if not found:
        raise FillError(f"{where}에 '{name}' 열이 없습니다. 있는 열: {', '.join(cell_text(h) for h in header)}")
    return found[0]


def raw_index(raw: dict[str, Any], key_cols: list[int]) -> tuple[dict[tuple, list[str]], list[str]]:
    """Key -> raw row. A key that appears twice is ambiguous, so it is reported and never used."""
    index: dict[tuple, list[str]] = {}
    dupes: dict[tuple, str] = {}
    for row in raw["rows"]:
        key = tuple(norm(row[c]) for c in key_cols)
        if all(k == "" for k in key):
            continue
        if key in index or key in dupes:
            dupes[key] = " / ".join(row[c] for c in key_cols)
            index.pop(key, None)
        else:
            index[key] = row
    return index, sorted(dupes.values())


def decide(old: str, new: str, overwrite: bool) -> str | None:
    """Return 'fill', 'overwrite', 'conflict' or None (nothing to do)."""
    if new.strip() == "" or norm(old) == norm(new):
        return None
    if old.strip() == "":
        return "fill"
    return "overwrite" if overwrite else "conflict"


def writable_note(opts: argparse.Namespace) -> tuple[Path, Path]:
    page = Path(opts.page).resolve()
    vault = Path(opts.vault).resolve() if opts.vault else ROOT / "vault"
    if vault not in page.parents or page.name != "index.md":
        raise FillError(f"vault 안의 노트 파일(…/index.md)만 채울 수 있습니다: {opts.page}")
    return page, vault


def save_note(page: Path, vault: Path, original: bytes, updated: str) -> Path:
    with content_write_lock(vault):
        if page.read_bytes() != original:
            raise FillError("파일이 그 사이에 바뀌었습니다. 다시 실행하세요.")
        backups = vault / ".backup" / "fill-table"
        backups.mkdir(parents=True, exist_ok=True)
        prefix = f"{datetime.now():%Y%m%d-%H%M%S}_{page.parent.name}_"
        with NamedTemporaryFile(dir=backups, prefix=prefix, suffix="_index.md", delete=False) as handle:
            handle.write(original)
            backup = Path(handle.name)
        replace_content(page, updated.encode("utf-8"))
    return backup


# ---------- md mode ----------

def fill_md(opts: argparse.Namespace) -> dict[str, Any]:
    page, vault = writable_note(opts)
    original_bytes = page.read_bytes()
    original = original_bytes.decode("utf-8")
    lines = io.StringIO(original, newline="").readlines()
    tables = find_tables(lines)
    if not 1 <= opts.table <= len(tables):
        raise FillError(f"표 {opts.table}번이 없습니다(이 페이지의 표 {len(tables)}개).")
    table = tables[opts.table - 1]
    header = table["header"]
    raw = parse_raw(read_text(opts.raw), opts.no_header)
    keys = pairs(opts.key, "--key")
    key_cols = [(column(header, t, "표"), column(raw["header"], r, "raw data")) for t, r in keys]
    maps = pairs(opts.map, "--map") if opts.map else [
        (cell_text(h), cell_text(h)) for h in header
        if norm(cell_text(h)) in {norm(x) for x in raw["header"]} and norm(cell_text(h)) not in {norm(t) for t, _ in keys}]
    if not maps:
        raise FillError("채울 열이 없습니다. --map 표열=raw열 로 지정하세요.")
    map_cols = [(column(header, t, "표"), column(raw["header"], r, "raw data"), t) for t, r in maps]
    index, dupes = raw_index(raw, [rc for _, rc in key_cols])
    width = len(header)
    ending = next((ln[len(ln.rstrip("\r\n")):] for ln in lines[table["start"]:table["end"]]
                   if ln.endswith(("\r", "\n"))), "\n")

    changes, conflicts, used, new_lines = [], [], set(), {}
    for n, cells in enumerate(table["rows"]):
        cells = cells + [""] * (width - len(cells))
        key = tuple(norm(cell_text(cells[tc])) for tc, _ in key_cols)
        row = index.get(key)
        if row is None:
            continue
        used.add(key)
        touched = False
        for tc, rc, name in map_cols:
            old, new = cell_text(cells[tc]), row[rc]
            action = decide(old, new, opts.overwrite)
            item = {"row": " / ".join(cell_text(cells[c]) for c, _ in key_cols), "column": name, "old": old, "new": new}
            if action == "conflict":
                conflicts.append(item)
            elif action:
                changes.append({**item, "action": action})
                cells[tc] = cell_source(new)
                touched = True
        if touched:
            line_index = table["start"] + 2 + n
            previous = lines[line_index]
            new_lines[line_index] = serialize(cells, previous[len(previous.rstrip("\r\n")):])
    missing = [row for key, row in index.items() if key not in used]
    added = []
    if opts.add_missing:
        for row in missing:
            cells = [""] * width
            for tc, rc in key_cols:
                cells[tc] = cell_source(row[rc])
            for tc, rc, _ in map_cols:
                cells[tc] = cell_source(row[rc])
            added.append(serialize(cells, ending))
    result = {"mode": "md", "page": str(page), "table": opts.table, "header": [cell_text(h) for h in header],
              "map": [{"table": t, "raw": r} for t, r in maps], "changes": changes, "conflicts": conflicts,
              "unmatched_raw": [" / ".join(r[rc] for _, rc in key_cols) for r in missing],
              "added_rows": len(added), "duplicate_raw_keys": dupes, "applied": False}
    if opts.apply and (changes or added):
        out = [new_lines.get(i, ln) for i, ln in enumerate(lines)]
        last = table["end"] - 1
        if added and not out[last].endswith(("\n", "\r")):
            out[last] += ending
        out[table["end"]:table["end"]] = added
        backup = save_note(page, vault, original_bytes, "".join(out))
        result.update(applied=True, backup=str(backup))
    return result


# ---------- structured Excel tables ----------

def fill_excel(opts: argparse.Namespace) -> dict[str, Any]:
    page, vault = writable_note(opts)
    original = page.read_bytes()
    payload_bytes = sys.stdin.buffer.read() if opts.values == "-" else Path(opts.values).read_bytes()
    try:
        updated, changes, conflicts = plan_value_fill(
            original.decode("utf-8"), opts.table_id, payload_bytes.decode("utf-8-sig"), overwrite=opts.overwrite,
        )
    except ValueError as exc:
        raise FillError(str(exc)) from exc
    result = {"tableId": opts.table_id, "changes": changes, "conflicts": conflicts, "applied": False}
    if opts.apply and changes and not conflicts:
        backup = save_note(page, vault, original, updated)
        result.update(applied=True, backup=str(backup))
    return result


def excel_tables(opts: argparse.Namespace) -> dict[str, Any]:
    text = Path(opts.page).read_bytes().decode("utf-8")
    grids = read_grids(text)
    if opts.cmd == "excel-tables":
        return {"tables": [
            {"id": table["id"], "row_count": len(table["rows"]), "columns": table["columns"]}
            for table in grids.values()
        ]}
    table = grids.get(opts.table_id)
    if table is None:
        raise FillError(f"조회할 수 있는 Excel 표가 없습니다: {opts.table_id}")

    rows = []
    for row in table["rows"]:
        cells = []
        for cell in row["cells"]:
            if cell is None:
                cells.append(None)
                continue
            cells.append({
                "displayText": cell["displayText"],
                "value": cell["value"],
                "rowSpan": int(cell.get("rowSpan", 1)),
                "colSpan": int(cell.get("colSpan", 1)),
            })
        rows.append({"id": row["id"], "cells": cells})
    return {"table": {"version": 1, "id": table["id"], "columns": table["columns"], "rows": rows}}


# ---------- board mode (CLI only) ----------

def run_cli(opts: argparse.Namespace, *argv: str) -> tuple[int, Any]:
    cmd = [sys.executable, "-m", "app.cli"]
    if opts.db:
        cmd += ["--db", str(opts.db)]
    if opts.vault:
        cmd += ["--vault", str(opts.vault)]
    done = subprocess.run(cmd + list(argv), cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    try:
        return done.returncode, json.loads(done.stdout)
    except json.JSONDecodeError:
        raise FillError(f"CLI 출력이 JSON이 아닙니다: {done.stderr.strip()[-400:]}") from None


def check_value(field: dict[str, Any] | None, value: str) -> str | None:
    """Mirror of the CLI's type rules so a dry run shows bad values before anything is written."""
    kind, text = (field or {}).get("type"), value.strip().lower()
    if kind == "number":
        try:
            float(text.replace(",", ""))
        except ValueError:
            return "숫자가 아님"
    if kind == "okng" and text not in ("ok", "ng"):
        return "ok/ng가 아님"
    if kind == "check" and text not in {"true", "1", "y", "yes", "o", "on", "v", "✓", "체크", "false", "0", "n", "no", "x", "off"}:
        return "true/false가 아님"
    return None


def shown(value: Any) -> str:
    if value is None:
        return ""
    return str(value).lower() if isinstance(value, bool) else str(value)


def fill_board(opts: argparse.Namespace) -> dict[str, Any]:
    code, board = run_cli(opts, "eval", "show", str(opts.eval_id), "--full")
    if code:
        raise FillError(board.get("error", "평가를 읽지 못했습니다."))
    raw = parse_raw(read_text(opts.raw), opts.no_header)
    matches = pairs(opts.match, "--match")
    bad = [k for k, _ in matches if k not in BOARD_KEYS]
    if bad or not matches:
        raise FillError("--match는 equipment=열, lot=열, wafer=열 중 하나 이상이어야 합니다.")
    key_cols = [(k, column(raw["header"], r, "raw data")) for k, r in matches]
    fields = {f["key"]: f for f in board["fields"]} | {f["label"]: f for f in board["fields"]}
    targets = []
    for target, rcol in pairs(opts.map, "--map"):
        if target != "note" and target not in fields:
            raise FillError(f"평가에 '{target}' 값 항목이 없습니다. 있는 항목: "
                            + ", ".join(f"{f['key']}({f['label']})" for f in board["fields"]) + ", note")
        targets.append((target if target == "note" else fields[target]["key"], column(raw["header"], rcol, "raw data")))
    index, dupes = raw_index(raw, [c for _, c in key_cols])
    attr = {"equipment": "equipment", "lot": "lot_no", "wafer": "wafer_no"}
    changes, conflicts, invalid, used, plan = [], [], [], set(), {}
    for cell in board["cells"]:
        if cell["excluded"]:
            continue
        key = tuple(norm(cell[attr[k]]) for k, _ in key_cols)
        row = index.get(key)
        if row is None:
            continue
        used.add(key)
        label = f"{cell['equipment']} {cell['lot_no']}#{cell['wafer_no']}"
        for fkey, rc in targets:
            old = shown(cell.get("note") if fkey == "note" else cell["values"].get(fkey))
            new = row[rc]
            action = decide(old, new, opts.overwrite)
            item = {"cell_id": cell["id"], "cell": label, "field": fkey, "old": old, "new": new}
            problem = None if fkey == "note" else check_value(fields.get(fkey), new)
            if action and problem:
                invalid.append({**item, "problem": problem})
            elif action == "conflict":
                conflicts.append(item)
            elif action:
                changes.append({**item, "action": action})
                plan.setdefault(cell["id"], []).append((fkey, new))
    result = {"mode": "board", "eval_id": opts.eval_id, "changes": changes, "conflicts": conflicts,
              "invalid": invalid, "unmatched_raw": [" / ".join(r[c] for _, c in key_cols) for k, r in index.items()
                                                    if k not in used],
              "duplicate_raw_keys": dupes, "applied": False}
    if opts.apply and plan:
        errors = []
        for cell_id, items in plan.items():
            argv = ["eval", "set-cell", str(cell_id)]
            for fkey, new in items:
                argv += ["--note", new] if fkey == "note" else ["--value", f"{fkey}={new}"]
            code, out = run_cli(opts, *argv)
            if code:
                errors.append({"cell_id": cell_id, "error": out.get("error")})
        result.update(applied=True, errors=errors)
    return result


# ---------- entry ----------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="fill-table: fill a note table or evaluation board from raw data")
    p.add_argument("--db")
    p.add_argument("--vault")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("raw", help="show how the raw data is read")
    r.add_argument("file")
    r.add_argument("--no-header", action="store_true")
    t = sub.add_parser("tables", help="list GFM tables in a note")
    t.add_argument("page")
    t = sub.add_parser("excel-tables", help="list structured Excel tables in a note by ID")
    t.add_argument("page")
    x = sub.add_parser("excel-export", help="print a structured Excel table's value grid as JSON")
    x.add_argument("page")
    x.add_argument("--table-id", required=True)
    f = sub.add_parser("excel-fill", help="fill structured Excel cells using explicit JSON values and IDs")
    f.add_argument("page")
    f.add_argument("--table-id", required=True)
    f.add_argument("--values", required=True, help="UTF-8 JSON file or - for stdin")
    f.add_argument("--overwrite", action="store_true", help="replace occupied cells too")
    f.add_argument("--apply", action="store_true", help="write (default is a dry run)")
    for name in ("md", "board"):
        s = sub.add_parser(name)
        if name == "md":
            s.add_argument("page", help="vault/<page>/index.md")
            s.add_argument("--table", type=int, default=1, help="1-based table number from `tables`")
            s.add_argument("--key", action="append", required=True, metavar="TABLE_COL[=RAW_COL]")
            s.add_argument("--add-missing", action="store_true", help="append raw rows with no matching table row")
        else:
            s.add_argument("eval_id", type=int)
            s.add_argument("--match", action="append", default=[], metavar="equipment|lot|wafer=RAW_COL")
        s.add_argument("--raw", required=True, help="raw data file (csv/tsv/space) or - for stdin")
        s.add_argument("--map", action="append", default=[], metavar="TARGET=RAW_COL")
        s.add_argument("--overwrite", action="store_true", help="replace non-empty values too")
        s.add_argument("--no-header", action="store_true", help="raw has no header row; columns are 1,2,3...")
        s.add_argument("--apply", action="store_true", help="write (default is a dry run)")
    return p


def run(opts: argparse.Namespace) -> dict[str, Any]:
    if opts.cmd == "raw":
        raw = parse_raw(read_text(opts.file), opts.no_header)
        return {"delimiter": raw["delimiter"], "header": raw["header"], "row_count": len(raw["rows"]),
                "preview": raw["rows"][:5]}
    if opts.cmd == "tables":
        with Path(opts.page).open(encoding="utf-8", newline="") as page:
            lines = page.readlines()
        return {"tables": [{"table": n + 1, "line": t["start"] + 1, "header": [cell_text(h) for h in t["header"]],
                            "row_count": len(t["rows"]), "preview": [[cell_text(c) for c in r] for r in t["rows"][:3]]}
                           for n, t in enumerate(find_tables(lines))]}
    if opts.cmd in ("excel-tables", "excel-export"):
        return excel_tables(opts)
    if opts.cmd == "excel-fill":
        return fill_excel(opts)
    return fill_md(opts) if opts.cmd == "md" else fill_board(opts)


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    try:
        opts = build_parser().parse_args(argv)
        result = run(opts)
    except (FillError, OSError, UnicodeDecodeError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        return 1
    # JSON-escape all characters in grid values, including isolated UTF-16 surrogates.
    print(json.dumps(result, ensure_ascii=opts.cmd in ("excel-export", "excel-fill"), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
