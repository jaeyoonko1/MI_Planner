"""Generic recipe parsers (P6-03, D-19 / D-38): `xml`, `ini`, `txt`. Pure functions of bytes, standard library only.

Path notation (flat keys that mapping files refer to):
  xml  `A/B/C` (root element name omitted), attribute `A/B@attr`, repeated sibling `A/B`, `A/B[2]`, `A/B[3]` ...
  ini  `Section/Key` (keys before any section: `Key`)
  txt  `Key` (kv mode), `RowKey/Column` (table mode), `Name` (fixed mode); repeated keys get `[2]`, `[3]`.
Options (from the mapping file rule's `options`) are validated here, never trusted.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Any

from parsers.base import MAX_PARAMS, Param, ParseError, ParseResult, RecipeParser, decode_text, register

MAX_DEPTH = 64
MAX_LINE_CHARS = 100_000
_DTD = re.compile(r"<!\s*(DOCTYPE|ENTITY)", re.IGNORECASE)
_XML_DECL = re.compile(r"^\s*<\?xml[^>]*\?>", re.IGNORECASE)
_COMMENT_PREFIXES = ("#", ";", "//")


def decode_any(data: bytes) -> tuple[str, str]:
    """UTF-16 (BOM) → UTF-8(-BOM) → CP949 → Latin-1. NUL bytes without a UTF-16 BOM mean the file is binary."""
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        try:
            return data.decode("utf-16"), "utf-16"
        except UnicodeDecodeError:
            raise ParseError("UTF-16 파일을 읽지 못했어요 (깨진 파일일 수 있어요).") from None
    if b"\x00" in data[:8192]:
        raise ParseError("텍스트 파일이 아니에요 (바이너리 내용이 들어 있어요).")
    return decode_text(data)


def _opt_str(options: dict[str, Any], key: str, default: str) -> str:
    value = options.get(key, default)
    if not isinstance(value, str) or len(value) > 40:
        raise ParseError(f"파서 옵션 {key}은(는) 짧은 문자열이어야 해요.")
    return value


def _dedupe(path: str, seen: dict[str, int]) -> str:
    n = seen.get(path, 0) + 1
    seen[path] = n
    return path if n == 1 else f"{path}[{n}]"


def _clean(value: str) -> str:
    return value.replace("\r", "").strip()


# ---- xml ----------------------------------------------------------------------------------------------------------

def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


@register
class XmlParser(RecipeParser):
    """Leaf elements → value = text, attributes → `path@attr`. DTD/entities are refused (XML bombs, XXE)."""
    name = "xml"
    version = "1"
    extensions = (".xml",)

    def sniff(self, file_name: str, head: bytes) -> bool:
        return file_name.lower().endswith(self.extensions)

    def _parse(self, data: bytes, file_name: str, options: dict[str, Any]) -> ParseResult:
        key_attr = _opt_str(options, "key_attr", "")  # e.g. <Param Name="Focus">1.0</Param> → path segment "Focus"
        text, enc = decode_any(data)
        if _DTD.search(text):
            raise ParseError("DOCTYPE·ENTITY가 들어 있는 XML은 안전을 위해 읽지 않아요.")
        text = _XML_DECL.sub("", text, count=1)  # we already decoded; a stale encoding= would break expat
        try:
            root = ET.fromstring(text)
        except ET.ParseError as exc:
            line = exc.position[0] if getattr(exc, "position", None) else 0
            raise ParseError(f"XML 형식이 올바르지 않아요{f' ({line}번째 줄 부근)' if line else ''}.") from None
        except (RecursionError, MemoryError):
            raise ParseError("XML이 너무 복잡해서 읽지 못했어요.") from None
        result = ParseResult(encoding=enc)
        self._walk(root, "", 0, key_attr, result)
        return result

    def _walk(self, root: ET.Element, prefix: str, depth: int, key_attr: str, result: ParseResult) -> None:
        stack: list[tuple[ET.Element, str, int]] = [(root, prefix, 0)]
        count = 0
        while stack:
            node, path, depth = stack.pop()
            count += 1
            if count > MAX_PARAMS * 2:
                raise ParseError(f"XML 요소가 너무 많아요 ({MAX_PARAMS * 2:,}개 초과).")
            if depth > MAX_DEPTH:
                raise ParseError(f"XML이 너무 깊어요 ({MAX_DEPTH}단계 초과).")
            for attr, value in node.attrib.items():
                if key_attr and attr == key_attr:
                    continue
                result.params.append(Param(f"{path}@{_local(attr)}" if path else f"@{_local(attr)}", _clean(value)))
            children = [c for c in node if isinstance(c.tag, str)]  # comments / processing instructions skipped
            if not children:
                if path:
                    result.params.append(Param(path, _clean(node.text or "")))
                continue
            if _clean(node.text or "") and path:
                result.warnings.append(f"{path}: 하위 요소가 있어 본문 글자는 건너뛰었어요.")
            seen: dict[str, int] = {}
            frames: list[tuple[ET.Element, str, int]] = []
            for child in children:
                seg = _clean(child.get(key_attr, "")) if key_attr else ""
                seg = (seg or _local(child.tag)).replace("/", "_")
                frames.append((child, _dedupe(f"{path}/{seg}" if path else seg, seen), depth + 1))
            stack.extend(reversed(frames))  # keep document order
        # params were appended in pre-order because the stack pops children first-to-last


# ---- ini ----------------------------------------------------------------------------------------------------------

@register
class IniParser(RecipeParser):
    """`[Section]` + `key = value` / `key: value`. Own line reader (not configparser) to keep line numbers and to
    tolerate the duplicate keys, bare keys and odd comments that equipment files have."""
    name = "ini"
    version = "1"
    extensions = (".ini", ".cfg", ".conf")

    def _parse(self, data: bytes, file_name: str, options: dict[str, Any]) -> ParseResult:
        text, enc = decode_any(data)
        result = ParseResult(encoding=enc)
        section = ""
        seen: dict[str, int] = {}
        for no, raw in enumerate(text.splitlines(), start=1):
            if len(raw) > MAX_LINE_CHARS:
                raise ParseError(f"{no}번째 줄이 너무 길어요.")
            line = raw.strip()
            if not line or line.startswith(_COMMENT_PREFIXES):
                continue
            if line.startswith("["):
                end = line.find("]")
                if end < 1:
                    result.warnings.append(f"{no}번째 줄: 섹션 표기가 닫히지 않았어요.")
                    continue
                section = line[1:end].strip().replace("/", "_")
                continue
            m = re.match(r"^([^=:]+?)\s*[=:]\s*(.*)$", line)
            if not m:
                result.warnings.append(f"{no}번째 줄을 읽지 못했어요.")
                continue
            key = m.group(1).strip().replace("/", "_")
            path = _dedupe(f"{section}/{key}" if section else key, seen)
            result.params.append(Param(path, _clean(m.group(2)), no))
        if not result.params and not result.warnings:
            result.warnings.append("읽을 수 있는 항목이 없어요.")
        return result


# ---- txt ----------------------------------------------------------------------------------------------------------

_KV = re.compile(r"^(\S[^=:\t]*?)\s*(?:=|:|\t+)\s*(.*)$")


@register
class TxtParser(RecipeParser):
    """Plain text. mode `kv` (default): `key = value` / `key: value` / `key<TAB>value`.
    mode `table`: header row + rows (`RowKey/Column`), options delimiter (`,` `;` `|` `tab`, default whitespace).
    mode `fixed`: fixed-width `name_cols` / `value_cols` = [start, end) character columns (0-based)."""
    name = "txt"
    version = "1"
    extensions = (".txt", ".prm", ".par")

    def _parse(self, data: bytes, file_name: str, options: dict[str, Any]) -> ParseResult:
        text, enc = decode_any(data)
        result = ParseResult(encoding=enc)
        mode = _opt_str(options, "mode", "kv")
        lines = text.splitlines()
        for no, raw in enumerate(lines, start=1):
            if len(raw) > MAX_LINE_CHARS:
                raise ParseError(f"{no}번째 줄이 너무 길어요.")
        if mode == "kv":
            self._kv(lines, result)
        elif mode == "table":
            self._table(lines, options, result)
        elif mode == "fixed":
            self._fixed(lines, options, result)
        else:
            raise ParseError("파서 옵션 mode는 kv·table·fixed 중 하나예요.")
        if not result.params and not result.warnings:
            result.warnings.append("읽을 수 있는 항목이 없어요.")
        return result

    def _kv(self, lines: list[str], result: ParseResult) -> None:
        seen: dict[str, int] = {}
        for no, raw in enumerate(lines, start=1):
            line = raw.strip()
            if not line or line.startswith(_COMMENT_PREFIXES):
                continue
            m = _KV.match(line)
            if not m:
                result.warnings.append(f"{no}번째 줄을 읽지 못했어요.")
                continue
            result.params.append(Param(_dedupe(m.group(1).strip().replace("/", "_"), seen), _clean(m.group(2)), no))

    def _table(self, lines: list[str], options: dict[str, Any], result: ParseResult) -> None:
        delim = _opt_str(options, "delimiter", "")
        delim = "\t" if delim == "tab" else delim
        split = (lambda s: [c.strip() for c in s.split(delim)]) if delim else (lambda s: s.split())
        header: list[str] | None = None
        seen: dict[str, int] = {}
        for no, raw in enumerate(lines, start=1):
            if not raw.strip() or raw.strip().startswith(_COMMENT_PREFIXES):
                continue
            cells = split(raw.strip())
            if header is None:
                header = [c.replace("/", "_") or f"col{i + 1}" for i, c in enumerate(cells)]
                continue
            if len(cells) < 2:
                result.warnings.append(f"{no}번째 줄의 칸이 모자라요.")
                continue
            row = _dedupe(cells[0].replace("/", "_"), seen)
            for i, cell in enumerate(cells[1:], start=1):
                col = header[i] if i < len(header) else f"col{i + 1}"
                result.params.append(Param(f"{row}/{col}", cell, no))

    def _fixed(self, lines: list[str], options: dict[str, Any], result: ParseResult) -> None:
        def cols(key: str) -> tuple[int, int]:
            v = options.get(key)
            ok = (isinstance(v, list) and len(v) == 2 and all(isinstance(n, int) and not isinstance(n, bool) for n in v)
                  and 0 <= v[0] < v[1] <= MAX_LINE_CHARS)
            if not ok:
                raise ParseError(f"파서 옵션 {key}는 [시작, 끝] 숫자 두 개여야 해요.")
            return v[0], v[1]
        (a, b), (c, d) = cols("name_cols"), cols("value_cols")
        seen: dict[str, int] = {}
        for no, raw in enumerate(lines, start=1):
            if not raw.strip() or raw.strip().startswith(_COMMENT_PREFIXES):
                continue
            name = raw[a:b].strip().replace("/", "_")
            if not name:
                result.warnings.append(f"{no}번째 줄에 이름이 없어요.")
                continue
            result.params.append(Param(_dedupe(name, seen), _clean(raw[c:d]), no))
