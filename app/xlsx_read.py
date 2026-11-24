"""Minimal .xlsx reader on the standard library (zipfile + ElementTree); no third-party dependency (P5-01).

Reads every sheet into a grid of text. Handles shared/inline strings, numbers (no stray ".0"),
booleans, errors and date-formatted numbers (ISO text). Formulas are read as their cached value.
Defensive against hostile files: size caps, no DTD/entities, bounded rows/columns.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from io import BytesIO
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile

MAX_BYTES = 25 * 1024 * 1024
MAX_UNPACKED = 200 * 1024 * 1024
MAX_ROWS = 50_000
MAX_COLS = 200
M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PR = "{http://schemas.openxmlformats.org/package/2006/relationships}"
_BUILTIN_DATE_IDS = set(range(14, 23)) | {27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58}
_DATE_TOKENS = re.compile(r"[ymdhs]", re.I)
_QUOTED = re.compile(r'"[^"]*"|\[[^\]]*\]|\\.')


class XlsxError(ValueError):
    """The file cannot be read as a workbook (message is shown to the user, in Korean)."""


@dataclass
class SheetData:
    name: str
    rows: list[list[str]] = field(default_factory=list)  # row index 0 = sheet row 1; hidden rows are empty lists


def _parse(zf: ZipFile, name: str) -> ET.Element:
    try:
        raw = zf.read(name)
    except KeyError as exc:
        raise XlsxError(f"엑셀 파일 구조가 올바르지 않아요 ({name} 없음).") from exc
    if b"<!DOCTYPE" in raw[:4096].upper() or b"<!ENTITY" in raw[:4096].upper():
        raise XlsxError("지원하지 않는 엑셀 구조예요 (DTD).")
    try:
        return ET.fromstring(raw)
    except ET.ParseError as exc:
        raise XlsxError("엑셀 파일을 해석하지 못했어요 (XML 오류).") from exc


def col_index(ref: str) -> int:
    n = 0
    for ch in ref:
        if not ch.isalpha():
            break
        n = n * 26 + ord(ch.upper()) - 64
    return n - 1


def _text(node: ET.Element | None) -> str:
    """Concatenate <t> runs of a shared/inline string (skips phonetic <rPh> runs)."""
    if node is None:
        return ""
    out = []
    for child in node:
        if child.tag == M + "t":
            out.append(child.text or "")
        elif child.tag == M + "r":
            out.append("".join(t.text or "" for t in child.findall(M + "t")))
    return "".join(out)


def _shared_strings(zf: ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = _parse(zf, "xl/sharedStrings.xml")
    return [_text(si) for si in root.findall(M + "si")]


def _date_style_ids(zf: ZipFile) -> set[int]:
    if "xl/styles.xml" not in zf.namelist():
        return set()
    root = _parse(zf, "xl/styles.xml")
    custom: dict[int, str] = {}
    fmts = root.find(M + "numFmts")
    if fmts is not None:
        for f in fmts:
            try:
                custom[int(f.get("numFmtId", ""))] = f.get("formatCode", "")
            except ValueError:
                continue
    out: set[int] = set()
    xfs = root.find(M + "cellXfs")
    for i, xf in enumerate(xfs if xfs is not None else []):
        try:
            fid = int(xf.get("numFmtId", "0"))
        except ValueError:
            continue
        if fid in custom:
            if _DATE_TOKENS.search(_QUOTED.sub("", custom[fid])):
                out.add(i)
        elif fid in _BUILTIN_DATE_IDS:
            out.add(i)
    return out


def _number(raw: str) -> str:
    try:
        value = float(raw)
    except ValueError:
        return raw
    if value == int(value) and abs(value) < 1e15:
        return str(int(value))
    return repr(value)


def _date(raw: str) -> str:
    try:
        serial = float(raw)
        stamp = datetime(1899, 12, 30) + timedelta(days=serial)
    except (ValueError, OverflowError):
        return raw
    return stamp.strftime("%Y-%m-%d") if serial == int(serial) else stamp.strftime("%Y-%m-%d %H:%M")


def _cell_value(c: ET.Element, strings: list[str], dates: set[int]) -> str:
    kind = c.get("t", "n")
    if kind == "inlineStr":
        return _text(c.find(M + "is")).strip()
    v = c.find(M + "v")
    raw = (v.text or "") if v is not None else ""
    if kind == "s":
        try:
            return strings[int(raw)].strip()
        except (ValueError, IndexError):
            return ""
    if kind == "b":
        return "TRUE" if raw == "1" else "FALSE"
    if kind in ("str", "e", "d"):
        return raw.strip()
    if not raw:
        return ""
    if int(c.get("s", "0") or 0) in dates:
        return _date(raw)
    return _number(raw)


def _sheet_rows(zf: ZipFile, path: str, strings: list[str], dates: set[int]) -> list[list[str]]:
    root = _parse(zf, path)
    data = root.find(M + "sheetData")
    rows: list[list[str]] = []
    if data is None:
        return rows
    next_row = 0
    for row in data.findall(M + "row"):
        try:
            idx = int(row.get("r", "")) - 1
        except ValueError:
            idx = next_row
        if idx >= MAX_ROWS:
            break
        while len(rows) < idx:
            rows.append([])
        next_row = idx + 1
        if row.get("hidden") in ("1", "true"):
            rows.append([])
            continue
        cells: list[str] = []
        pos = 0
        for c in row.findall(M + "c"):
            ref = c.get("r")
            at = col_index(ref) if ref else pos
            if at >= MAX_COLS:
                continue
            while len(cells) < at:
                cells.append("")
            cells.append(_cell_value(c, strings, dates))
            pos = at + 1
        rows.append(cells)
    return rows


def read_workbook(data: bytes) -> list[SheetData]:
    """Return every visible worksheet. Raises XlsxError with a user-facing message."""
    if len(data) > MAX_BYTES:
        raise XlsxError("파일이 너무 커요 (25MB 이하만 가져올 수 있어요).")
    if data[:2] != b"PK":
        raise XlsxError(".xlsx 파일이 아니에요. (.xls는 엑셀에서 .xlsx로 저장한 뒤 가져와 주세요.)")
    try:
        zf = ZipFile(BytesIO(data))
    except BadZipFile as exc:
        raise XlsxError("엑셀 파일이 손상됐거나 암호가 걸려 있어요.") from exc
    with zf:
        if sum(i.file_size for i in zf.infolist()) > MAX_UNPACKED:
            raise XlsxError("파일 압축을 풀면 너무 커요.")
        if "xl/workbook.xml" not in zf.namelist():
            raise XlsxError("엑셀 통합 문서가 아니에요 (xl/workbook.xml 없음).")
        wb = _parse(zf, "xl/workbook.xml")
        rels = {r.get("Id"): r.get("Target", "") for r in _parse(zf, "xl/_rels/workbook.xml.rels").iter(PR + "Relationship")}
        strings, dates = _shared_strings(zf), _date_style_ids(zf)
        sheets: list[SheetData] = []
        container = wb.find(M + "sheets")
        for sh in container if container is not None else []:
            if sh.get("state") in ("hidden", "veryHidden"):
                continue
            target = rels.get(sh.get(R + "id", ""), "")
            path = target.lstrip("/") if target.startswith("/") else "xl/" + target
            if path not in zf.namelist():
                continue  # chartsheet or missing part
            sheets.append(SheetData(sh.get("name", "Sheet"), _sheet_rows(zf, path, strings, dates)))
        return sheets
