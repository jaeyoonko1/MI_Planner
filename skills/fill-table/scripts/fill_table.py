"""fill-table helper: fill a note table (GFM in vault/**/index.md) or an evaluation board from raw data.

Usage (from the MI_Planner folder):
    python skills/fill-table/scripts/fill_table.py raw  data/tmp/raw.csv
    python skills/fill-table/scripts/fill_table.py tables "vault/<page>/index.md"
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
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
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


def find_tables(lines: list[str]) -> list[dict[str, Any]]:
    tables, fence, i = [], None, 0
    while i < len(lines):
        stripped = lines[i].strip()
        mark = re.match(r"^(`{3,}|~{3,})", stripped)
        if mark:
            fence = None if fence and stripped.startswith(fence) else (fence or mark.group(1))
            i += 1
            continue
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        indented = re.match(r"^( {4}|\t)", lines[i]) or re.match(r"^( {4}|\t)", nxt)
        header, pipes = split_row(lines[i])
        delim, _ = split_row(nxt)
        if fence is None and not indented and pipes and len(delim) == len(header) and all(DELIM.match(c) for c in delim):
            end = i + 2
            while end < len(lines) and lines[end].strip() and split_row(lines[end])[1]:
                end += 1
            tables.append({"start": i, "end": end, "header": header,
                           "rows": [split_row(lines[j])[0] for j in range(i + 2, end)]})
            i = end
            continue
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


# ---------- md mode ----------

def fill_md(opts: argparse.Namespace) -> dict[str, Any]:
    page = Path(opts.page).resolve()
    vault = Path(opts.vault).resolve() if opts.vault else ROOT / "vault"
    if vault not in page.parents or page.name != "index.md":
        raise FillError(f"vault 안의 노트 파일(…/index.md)만 채울 수 있습니다: {opts.page}")
    original = page.read_text(encoding="utf-8")
    lines = original.splitlines(keepends=True)
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
    ending = next((ln[len(ln.rstrip("\r\n")):] for ln in lines[table["start"]:table["end"]] if ln.endswith("\n")), "\n")

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
            new_lines[table["start"] + 2 + n] = serialize(cells, ending)
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
        if page.read_text(encoding="utf-8") != original:
            raise FillError("파일이 그 사이에 바뀌었습니다. 다시 실행하세요.")
        out = [new_lines.get(i, ln) for i, ln in enumerate(lines)]
        last = table["end"] - 1
        if added and not out[last].endswith(("\n", "\r")):
            out[last] += ending
        out[table["end"]:table["end"]] = added
        backup = vault / ".backup" / "fill-table" / f"{datetime.now():%Y%m%d-%H%M%S}_{page.parent.name}_index.md"
        backup.parent.mkdir(parents=True, exist_ok=True)
        backup.write_text(original, encoding="utf-8", newline="")
        page.write_text("".join(out), encoding="utf-8", newline="")
        result.update(applied=True, backup=str(backup))
    return result


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
        lines = Path(opts.page).read_text(encoding="utf-8").splitlines(keepends=True)
        return {"tables": [{"table": n + 1, "line": t["start"] + 1, "header": [cell_text(h) for h in t["header"]],
                            "row_count": len(t["rows"]), "preview": [[cell_text(c) for c in r] for r in t["rows"][:3]]}
                           for n, t in enumerate(find_tables(lines))]}
    return fill_md(opts) if opts.cmd == "md" else fill_board(opts)


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    try:
        result = run(build_parser().parse_args(argv))
    except (FillError, OSError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
