"""Test-only parser (P6-01): `key = value` lines in `.fake` files. Not imported by default, so it is never picked
for real recipe files. Real generic parsers: parsers/generic.py."""
from __future__ import annotations

from parsers.base import Param, ParseError, ParseResult, RecipeParser, decode_text, register


@register
class FakeKeyValueParser(RecipeParser):
    name = "fake"
    version = "1"
    extensions = (".fake",)

    def _parse(self, data: bytes, file_name: str, options: dict) -> ParseResult:
        text, enc = decode_text(data)
        result = ParseResult(encoding=enc)
        for no, raw in enumerate(text.splitlines(), start=1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                result.warnings.append(f"{no}번째 줄을 읽지 못했어요.")
                continue
            key, value = (s.strip() for s in line.split("=", 1))
            if not key:
                raise ParseError(f"{no}번째 줄에 이름이 없어요.")
            result.params.append(Param(key, value, no))
        return result
