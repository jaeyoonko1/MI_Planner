"""Read version-1 Excel table grids and work with their cell values."""
from __future__ import annotations

import json
import math
import re
from collections import Counter
from collections.abc import Callable, Iterator

_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
_EXCEL_INFO = re.compile(r"mi-excel-table[ \t]*")
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")
_NUMBER = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
_EOL = re.compile(r"(\r\n?|\n)")
_SURROGATE = re.compile(r"[\ud800-\udfff]")
_MAX_SOURCE = 4 * 1024 * 1024
_CELL_KEYS = {
    "displayText", "value", "numberFormat", "rowSpan", "colSpan",
    "styles", "richText", "fillPattern", "width", "height", "overflowRight",
}


def _is_id(value: object) -> bool:
    return isinstance(value, str) and _ID.fullmatch(value) is not None


def _valid_value(value: object) -> bool:
    if value is None:
        return True
    if not isinstance(value, dict) or value.keys() != {"type", "raw"}:
        return False
    raw = value["raw"]
    return isinstance(raw, str) and (
        value["type"] == "text"
        or (value["type"] == "number" and _NUMBER.fullmatch(raw) is not None and math.isfinite(float(raw)))
    )


def _valid_cell(cell: object) -> bool:
    # Search consumes the value and grid contract. Rendering validates optional CSS/format metadata.
    return (isinstance(cell, dict) and cell.keys() <= _CELL_KEYS
            and isinstance(cell.get("displayText"), str)
            and ("overflowRight" not in cell or (type(cell["overflowRight"]) in (int, float)
                 and 1 <= cell["overflowRight"] < 60 and cell["overflowRight"] == int(cell["overflowRight"])))
            and "value" in cell and _valid_value(cell["value"]))


def _valid_grid(table: dict) -> bool:
    if (table.keys() - {"id", "version", "columns", "rows", "columnWidths", "numberSeparators"}
            or type(table.get("version")) not in (int, float) or table["version"] != 1):
        return False
    columns, rows = table.get("columns"), table.get("rows")
    if not isinstance(columns, list) or not isinstance(rows, list):
        return False
    width, height = len(columns), len(rows)
    if not 1 <= width <= 60 or not 1 <= height <= 1000 or width * height > 10000:
        return False
    if not all(map(_is_id, columns)) or len(set(columns)) != width:
        return False

    row_ids: set[str] = set()
    occupied = bytearray(width * height)
    for y, row in enumerate(rows):
        if not isinstance(row, dict) or row.keys() - {"id", "cells", "height"}:
            return False
        row_id, cells = row.get("id"), row.get("cells")
        if not _is_id(row_id) or row_id in row_ids or not isinstance(cells, list) or len(cells) != width:
            return False
        row_ids.add(row_id)
        for x, cell in enumerate(cells):
            if cell is None:
                continue
            if not _valid_cell(cell):
                return False
            down, across = cell.get("rowSpan", 1), cell.get("colSpan", 1)
            if not (
                type(down) in (int, float) and 1 <= down <= height - y and down == int(down)
                and type(across) in (int, float) and 1 <= across <= width - x and across == int(across)
            ):
                return False
            for offset in range(y, y + int(down)):
                start = offset * width + x
                end = start + int(across)
                if any(occupied[start:end]):
                    return False
                occupied[start:end] = b"\x01" * int(across)
    return True


def _display_text(table: dict) -> str:
    texts = (
        " ".join(_SURROGATE.sub("\ufffd", cell["displayText"]).split())
        for row in table["rows"] for cell in row["cells"] if cell is not None
    )
    return " ".join(filter(None, texts))


def _reject_constant(token: str) -> None:
    raise ValueError(f"Invalid JSON constant: {token}")


def _table_blocks(parts: list[str]) -> Iterator[tuple[int, int, dict]]:
    """Yield line spans and decoded payloads. Invalid payloads still reserve their source span."""
    lines = parts[::2]
    index = 0
    while index < len(lines):
        line = lines[index]
        if line.lstrip().startswith("<!--"):
            while index < len(lines) and "-->" not in lines[index]:
                index += 1
            index += 1
            continue
        match = _FENCE.fullmatch(line)
        if not match:
            index += 1
            continue
        start = index
        marker, info = match.groups()
        close = re.compile(rf"^ {{0,3}}{marker[0]}{{{len(marker)},}}\s*$")
        index += 1
        while index < len(lines) and not close.fullmatch(lines[index]):
            index += 1
        if line.startswith(marker) and _EXCEL_INFO.fullmatch(info):
            table = {}
            if (start + 1 < index < len(lines)
                    and lines[index].rstrip(" \t") == lines[index].rstrip()):
                source = "".join(parts[2 * start:2 * index + 1])
                if len(source) <= _MAX_SOURCE and len(source.encode("utf-16-le", "surrogatepass")) <= 2 * _MAX_SOURCE:
                    try:
                        payload = json.loads("\n".join(lines[start + 1:index]), parse_constant=_reject_constant)
                        if isinstance(payload, dict):
                            table = payload
                    except (ValueError, RecursionError):
                        pass
            yield 2 * start, 2 * index + 1, table
        index += 1


def _document_blocks(text: str) -> tuple[list[str], list[tuple[int, int, dict]]]:
    parts = _EOL.split(text) if "mi-excel-table" in text else []
    return parts, list(_table_blocks(parts))


def _unique_grids(blocks: list[tuple[int, int, dict]]) -> dict[str, dict]:
    counts = Counter(table["id"] for _, _, table in blocks if _is_id(table.get("id")))
    return {
        table["id"]: table for _, _, table in blocks
        if _is_id(table.get("id")) and counts[table["id"]] == 1 and _valid_grid(table)
    }


def read_grids(text: str) -> dict[str, dict]:
    """Return unambiguous value grids keyed by stable table ID, in document order."""
    _, blocks = _document_blocks(text)
    return _unique_grids(blocks)


def _unique_members(pairs: list[tuple[str, object]]) -> dict:
    members = dict(pairs)
    if len(members) != len(pairs):
        raise ValueError("JSON에 중복 필드가 있습니다.")
    return members


def _strict_json(text: str) -> object:
    return json.loads(text, object_pairs_hook=_unique_members, parse_constant=_reject_constant)


def plan_value_fill(text: str, table_id: str, payload: str, *, overwrite: bool) -> tuple[str, list[dict], list[dict]]:
    """Plan a value-only fill by stable cell IDs. Conflicts block the whole batch."""
    parts, blocks = _document_blocks(text)
    table = _unique_grids(blocks).get(table_id)
    if table is None:
        raise ValueError(f"채울 수 있는 Excel 표가 없습니다: {table_id}")
    start, end, _ = next(block for block in blocks if block[2] is table)
    try:
        _strict_json("".join(parts[start + 2:end - 2]))
        edits = _strict_json(payload)
    except (ValueError, RecursionError) as exc:
        raise ValueError("표 또는 입력 JSON이 올바르지 않습니다.") from exc
    if not isinstance(edits, list) or not 1 <= len(edits) <= 10000:
        raise ValueError("입력에는 셀 값 변경이 1~10,000개 있어야 합니다.")

    rows = {row["id"]: y for y, row in enumerate(table["rows"])}
    columns = {column: x for x, column in enumerate(table["columns"])}
    covered = set()
    for y, row in enumerate(table["rows"]):
        for x, cell in enumerate(row["cells"]):
            if cell is not None and (cell.get("rowSpan", 1) > 1 or cell.get("colSpan", 1) > 1):
                covered.update(
                    (r, c) for r in range(y, y + int(cell.get("rowSpan", 1)))
                    for c in range(x, x + int(cell.get("colSpan", 1))) if (r, c) != (y, x)
                )

    seen = set()
    changes, conflicts = [], []
    for edit in edits:
        if (not isinstance(edit, dict) or edit.keys() != {"rowId", "columnId", "displayText", "value"}
                or not _is_id(edit["rowId"]) or not _is_id(edit["columnId"])
                or not isinstance(edit["displayText"], str) or not _valid_value(edit["value"])
                or (edit["displayText"] == "" and edit["value"] is None)):
            raise ValueError("셀 ID, 표시 문자열과 원시 값(숫자·텍스트 또는 null)을 확인하세요. 빈 값으로 지울 수 없습니다.")
        row_id, column_id = edit["rowId"], edit["columnId"]
        y, x = rows.get(row_id), columns.get(column_id)
        if y is None or x is None or (y, x) in seen or (y, x) in covered:
            raise ValueError(f"없는 셀, 중복 대상 또는 병합에 덮인 셀입니다: {row_id}/{column_id}")
        seen.add((y, x))
        cells = table["rows"][y]["cells"]
        cell = cells[x] or {"displayText": "", "value": None}
        number_format = cell.get("numberFormat")
        if number_format is not None and not isinstance(number_format, str):
            raise ValueError(f"지원하지 않는 셀 표시 형식입니다: {row_id}/{column_id}")
        old = {key: cell[key] for key in ("displayText", "value")}
        new = {key: edit[key] for key in old}
        if old == new:
            continue
        occupied = old["displayText"] != "" or old["value"] is not None
        item = {"rowId": row_id, "columnId": column_id, "old": old, "new": new,
                "numberFormat": number_format}
        if occupied and not overwrite:
            conflicts.append(item)
            continue
        changes.append({**item, "action": "overwrite" if occupied else "fill"})
        replacement = {**cell, **new}
        if old["displayText"] != new["displayText"]:
            replacement.pop("richText", None)
        cells[x] = replacement

    if not changes or conflicts:
        return text, changes, conflicts
    eol = parts[start + 1]
    try:
        body = json.dumps(table, ensure_ascii=False, allow_nan=False, indent=2)
    except (ValueError, RecursionError) as exc:
        raise ValueError("Excel 표의 기존 서식 값을 저장할 수 없습니다.") from exc
    body = _SURROGATE.sub(lambda match: f"\\u{ord(match[0]):04x}", body).replace("\n", eol)
    block = eol.join((parts[start], body, parts[end - 1]))
    if len(block.encode("utf-16-le")) > 2 * _MAX_SOURCE:
        raise ValueError("편집한 Excel 표가 저장 크기 한도를 넘습니다.")
    return "".join(parts[:start]) + block + "".join(parts[end:]), changes, conflicts


def project(text: str, ordinary: Callable[[str], str] | None = None) -> str:
    """Replace recognized table fences with literal display text. Keep ordinary Markdown searchable."""
    parts, blocks = _document_blocks(text)
    if not blocks:
        return ordinary(text) if ordinary else text
    grids = _unique_grids(blocks)
    pieces: list[str] = []
    pos = 0
    for start, end, table in blocks:
        before = "".join(parts[pos:start])
        table_id = table.get("id")
        pieces.append(ordinary(before) if ordinary else before)
        pieces.append(_display_text(table) if _is_id(table_id) and table_id in grids else "")
        pos = end
    after = "".join(parts[pos:])
    pieces.append(ordinary(after) if ordinary else after)
    return "".join(pieces)
