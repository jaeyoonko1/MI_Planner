"""Minimal .xlsx writer on the standard library (zipfile + XML); no third-party dependency (P4-07).

Supports what the evaluation export needs: several sheets, text/number cells, a bold header style,
wrapped text, column widths, a frozen header row and an auto filter. Strings are stored inline.
"""
from __future__ import annotations

import re
from io import BytesIO
from typing import Any
from xml.sax.saxutils import escape, quoteattr
from zipfile import ZIP_DEFLATED, ZipFile

_ILLEGAL = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]")
_BAD_SHEET = re.compile(r"[\[\]:*?/\\]")
STYLE_NORMAL, STYLE_HEADER, STYLE_WRAP, STYLE_TITLE = 0, 1, 2, 3
NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'


class Sheet:
    def __init__(self, name: str, widths: list[float] | None = None, freeze_header: bool = False,
                 autofilter: bool = False) -> None:
        self.name = name
        self.rows: list[list[tuple[Any, int]]] = []
        self.widths = widths or []
        self.freeze_header = freeze_header
        self.autofilter = autofilter

    def add(self, values: list[Any], style: int = STYLE_NORMAL) -> None:
        self.rows.append([(v, style) for v in values])

    def add_styled(self, cells: list[tuple[Any, int]]) -> None:
        self.rows.append(list(cells))


def sheet_name(raw: str, taken: set[str]) -> str:
    base = _BAD_SHEET.sub(" ", raw).strip().strip("'")[:31] or "시트"
    name, n = base, 2
    while name.lower() in taken:
        suffix = f" ({n})"
        name, n = base[: 31 - len(suffix)] + suffix, n + 1
    taken.add(name.lower())
    return name


def column_letter(index: int) -> str:
    out = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        out = chr(65 + rem) + out
    return out


def _cell(ref: str, value: Any, style: int) -> str:
    s = f' s="{style}"' if style else ""
    if value is None or value == "":
        return f'<c r="{ref}"{s}/>' if style else ""
    if isinstance(value, bool):
        value = "예" if value else "아니오"
    if isinstance(value, (int, float)) and value == value and abs(value) != float("inf"):
        return f'<c r="{ref}"{s}><v>{value!r}</v></c>'
    text = escape(_ILLEGAL.sub("", str(value)))
    return f'<c r="{ref}"{s} t="inlineStr"><is><t xml:space="preserve">{text}</t></is></c>'


def _sheet_xml(sheet: Sheet) -> str:
    width = max((len(r) for r in sheet.rows), default=1)
    parts = [XML_HEAD, f'<worksheet xmlns="{NS_MAIN}">']
    parts.append(f'<dimension ref="A1:{column_letter(width - 1)}{max(len(sheet.rows), 1)}"/>')
    if sheet.freeze_header:
        parts.append('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" '
                     'activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>')
    if sheet.widths:
        parts.append("<cols>" + "".join(
            f'<col min="{i}" max="{i}" width="{w}" customWidth="1"/>' for i, w in enumerate(sheet.widths, 1)) + "</cols>")
    parts.append("<sheetData>")
    for r, row in enumerate(sheet.rows, 1):
        cells = "".join(_cell(f"{column_letter(c)}{r}", v, s) for c, (v, s) in enumerate(row))
        parts.append(f'<row r="{r}">{cells}</row>')
    parts.append("</sheetData>")
    if sheet.autofilter and sheet.rows:
        parts.append(f'<autoFilter ref="A1:{column_letter(width - 1)}{len(sheet.rows)}"/>')
    parts.append("</worksheet>")
    return "".join(parts)


_STYLES = (
    XML_HEAD + f'<styleSheet xmlns="{NS_MAIN}">'
    '<fonts count="3"><font><sz val="11"/><name val="Malgun Gothic"/></font>'
    '<font><b/><sz val="11"/><name val="Malgun Gothic"/></font>'
    '<font><b/><sz val="14"/><name val="Malgun Gothic"/></font></fonts>'
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
    '<fill><patternFill patternType="solid"><fgColor rgb="FFDCE6FB"/><bgColor indexed="64"/></patternFill></fill></fills>'
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FF8A99B8"/></bottom><diagonal/></border></borders>'
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    '<cellXfs count="4">'
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">'
    '<alignment vertical="center" wrapText="1"/></xf>'
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
)

_CT = "application/vnd.openxmlformats-officedocument.spreadsheetml"
_RT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def build_workbook(sheets: list[Sheet]) -> bytes:
    n = len(sheets)
    content = (XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
               '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
               '<Default Extension="xml" ContentType="application/xml"/>'
               f'<Override PartName="/xl/workbook.xml" ContentType="{_CT}.sheet.main+xml"/>'
               f'<Override PartName="/xl/styles.xml" ContentType="{_CT}.styles+xml"/>'
               + "".join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="{_CT}.worksheet+xml"/>'
                         for i in range(1, n + 1)) + "</Types>")
    root_rels = (XML_HEAD + f'<Relationships xmlns="{NS_PKG_REL}">'
                 f'<Relationship Id="rId1" Type="{_RT}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    workbook = (XML_HEAD + f'<workbook xmlns="{NS_MAIN}" xmlns:r="{NS_REL}"><sheets>'
                + "".join(f"<sheet name={quoteattr(s.name)} sheetId=\"{i}\" r:id=\"rId{i}\"/>"
                          for i, s in enumerate(sheets, 1)) + "</sheets></workbook>")
    wb_rels = (XML_HEAD + f'<Relationships xmlns="{NS_PKG_REL}">'
               + "".join(f'<Relationship Id="rId{i}" Type="{_RT}/worksheet" Target="worksheets/sheet{i}.xml"/>'
                         for i in range(1, n + 1))
               + f'<Relationship Id="rId{n + 1}" Type="{_RT}/styles" Target="styles.xml"/></Relationships>')
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content)
        zf.writestr("_rels/.rels", root_rels)
        zf.writestr("xl/workbook.xml", workbook)
        zf.writestr("xl/_rels/workbook.xml.rels", wb_rels)
        zf.writestr("xl/styles.xml", _STYLES)
        for i, sheet in enumerate(sheets, 1):
            zf.writestr(f"xl/worksheets/sheet{i}.xml", _sheet_xml(sheet))
    return buffer.getvalue()
