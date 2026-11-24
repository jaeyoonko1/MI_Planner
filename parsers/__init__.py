"""Recipe parser plugins (P6). See parsers/base.py for the interface and docs/SPEC.md 4.6 for the design."""
from parsers.base import MAX_FILE_BYTES, Param, ParseError, ParseResult, RecipeParser, get, names, pick, register

__all__ = ["MAX_FILE_BYTES", "Param", "ParseError", "ParseResult", "RecipeParser", "get", "names", "pick", "register"]

from parsers import generic as _generic  # noqa: E402,F401  (registers xml / ini / txt)
