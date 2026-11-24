"""Recipe parser plugin interface (P6-01, D-19 / D-36).

A parser turns one recipe file (bytes) into flat parameter rows {path: value}. Parsers are pure: no network, no file
writes, no globals beyond the registry. Generic XML/INI/TXT parsers arrive in P6-03; vendor differences live in
mapping files (parsers/mapping.py), and a vendor-specific code parser is added only when the generic ones fail.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_PARAMS = 50_000


class ParseError(Exception):
    """The file cannot be read by this parser. Message is shown to the user (Korean)."""


@dataclass(frozen=True)
class Param:
    path: str  # e.g. "Inspection/Optics/Focus", "[Optics] Focus" → "Optics/Focus"
    value: str
    line: int = 0  # 1-based source line when known (for P6-05 byte-level patching), 0 otherwise


@dataclass
class ParseResult:
    params: list[Param] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    encoding: str = ""

    def as_dict(self) -> dict[str, str]:
        return {p.path: p.value for p in self.params}


def decode_text(data: bytes) -> tuple[str, str]:
    """Decode recipe text: UTF-8 (with/without BOM) → CP949 (Korean Windows) → Latin-1 (never fails)."""
    for enc in ("utf-8-sig", "cp949"):
        try:
            return data.decode(enc), enc
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1"), "latin-1"


class RecipeParser(ABC):
    name: str = ""  # registry key, referenced from mapping files ("parser": "xml")
    version: str = "1"  # bump when output changes → snapshots can be re-parsed from cached blobs
    extensions: tuple[str, ...] = ()  # lowercase, with dot
    can_write: bool = False  # P6-05 only: a parser must implement byte-preserving render to be writable

    def sniff(self, file_name: str, head: bytes) -> bool:
        """Cheap guess used when no mapping rule names a parser. Default: extension match."""
        return file_name.lower().endswith(self.extensions) if self.extensions else False

    def parse(self, data: bytes, file_name: str = "") -> ParseResult:
        if len(data) > MAX_FILE_BYTES:
            raise ParseError(f"파일이 너무 커요 ({MAX_FILE_BYTES // (1024 * 1024)}MB 초과).")
        result = self._parse(data, file_name)
        if len(result.params) > MAX_PARAMS:
            raise ParseError(f"파라미터가 너무 많아요 ({MAX_PARAMS}개 초과).")
        seen: set[str] = set()
        for p in result.params:
            if p.path in seen:
                raise ParseError(f"같은 파라미터 경로가 두 번 나와요: {p.path}")
            seen.add(p.path)
        return result

    @abstractmethod
    def _parse(self, data: bytes, file_name: str) -> ParseResult: ...


_REGISTRY: dict[str, RecipeParser] = {}


def register(cls: type[RecipeParser]) -> type[RecipeParser]:
    """Class decorator. Names are unique; re-registering the same class is a no-op."""
    if not cls.name:
        raise ValueError("parser needs a name")
    existing = _REGISTRY.get(cls.name)
    if existing is not None and type(existing) is not cls:
        raise ValueError(f"parser name already registered: {cls.name}")
    _REGISTRY[cls.name] = cls()
    return cls


def get(name: str) -> RecipeParser:
    try:
        return _REGISTRY[name]
    except KeyError:
        raise ParseError(f"등록되지 않은 파서예요: {name}") from None


def names() -> list[str]:
    return sorted(_REGISTRY)


def pick(file_name: str, head: bytes = b"") -> RecipeParser | None:
    """First registered parser (by name) whose sniff accepts the file, or None."""
    for key in sorted(_REGISTRY):
        if _REGISTRY[key].sniff(file_name, head):
            return _REGISTRY[key]
    return None
