"""Inline formatting of journal lines (V-003): plain text of a formatted line.

The line editor stores the note editor's format inside a line: `**bold**`, `*italic*`, `~~strike~~`, `<u>`,
`<mark>` / `<mark style="background:#hex">`, `<span style="color:#hex;font-size:Npx">`, and `\\*` `\\~` `\\<` escapes.
`strip_inline` removes exactly those markers (an unpaired marker stays as the literal text it is), so a linked
line's task title never carries formatting. Mirrors web/js/lineeditor-format.js.
"""
from __future__ import annotations

import re

_TAG = re.compile(
    r'<(?P<slash>/?)(?P<name>u|mark|span)(?:\s+style="(?P<css>[^"]*)")?\s*>'
)
# presets of web/js/mdconv.js (D-15): anything else is plain text, exactly as the editor reads it
_COLORS = {"#1f2430", "#d93025", "#e8710a", "#188038", "#1a73e8", "#7b1fa2", "#6b7280"}
_SIZES = {11, 13, 15, 18, 22, 28}
_HLS = {"#fff176", "#a5f3a5", "#a5d8ff", "#ffc9de", "#ffd8a8"}
_MARK_CSS = re.compile(r"^background:\s*(#[0-9a-fA-F]{6})\s*;?$")
_COLOR = re.compile(r"(?:^|;)\s*color:\s*(#[0-9a-fA-F]{6})\s*(?=;|$)")
_SIZE = re.compile(r"(?:^|;)\s*font-size:\s*(\d{1,2})px\s*(?=;|$)")
_REST = re.compile(r"(?:^|;)\s*(?:color|font-size):\s*[^;]*")
_ESCAPABLE = "\\*`~<>[]!#-.+_)|"
_KIND = {"u": "u", "mark": "hl", "span": "span"}


def _valid_open(name: str, css: str | None) -> bool:
    if name == "u":
        return css is None
    if name == "mark":
        if css is None:
            return True
        m = _MARK_CSS.match(css)
        return bool(m) and m.group(1).lower() in _HLS
    if css is None:
        return False
    if re.sub(r"[;\s]", "", _REST.sub("", css)):
        return False
    color, size = _COLOR.search(css), _SIZE.search(css)
    return bool((color and color.group(1).lower() in _COLORS) or (size and int(size.group(1)) in _SIZES))


def strip_inline(text: str) -> str:
    """Visible text of a line body: formatting markers removed, escapes resolved."""
    out: list[tuple[str, int, int]] = []  # (kind, a, z): kind "" is a literal char, else a marker
    open_: dict[str, int] = {}  # marker kind -> index in `out`
    n = len(text)

    def toggle(kind: str, a: int, z: int, can_open: bool, can_close: bool) -> None:
        if kind in open_:
            if can_close:
                out.append((kind, a, z))
                del open_[kind]
                return
        elif can_open:
            open_[kind] = len(out)
            out.append((kind, a, z))
            return
        out.extend(("", k, k + 1) for k in range(a, z))

    i = 0
    while i < n:
        ch = text[i]
        if ch == "\\" and i + 1 < n and text[i + 1] in _ESCAPABLE:
            out.append(("", i + 1, i + 2))
            i += 2
            continue
        if ch == "*" or (ch == "~" and text[i + 1 : i + 2] == "~"):
            z = i
            while z < n and text[z] == ch:
                z += 1
            run = z - i
            if ch == "~" and run != 2:
                out.extend(("", k, k + 1) for k in range(i, z))
                i = z
                continue
            prev = text[i - 1] if i > 0 else None
            nxt = text[z] if z < n else None
            can_open = nxt is not None and not nxt.isspace() and (ch != "*" or nxt != "*")
            can_close = prev is not None and not prev.isspace() and (ch != "*" or prev != "*")
            if ch == "~":
                toggle("s", i, z, can_open, can_close)
            else:
                at, left = i, run
                while left > 0:
                    w = 2 if left >= 2 else 1
                    toggle("b" if w == 2 else "i", at, at + w, can_open, can_close)
                    at += w
                    left -= w
            i = z
            continue
        if ch == "<":
            m = _TAG.match(text, i)
            if m:
                kind = _KIND[m.group("name")]
                a, z = m.start(), m.end()
                if m.group("slash"):
                    if kind in open_:
                        out.append((kind, a, z))
                        del open_[kind]
                        i = z
                        continue
                elif _valid_open(m.group("name"), m.group("css")) and kind not in open_:
                    open_[kind] = len(out)
                    out.append((kind, a, z))
                    i = z
                    continue
        out.append(("", i, i + 1))
        i += 1
    for idx in open_.values():  # markers that never closed are plain text
        _, a, z = out[idx]
        out[idx] = ("lits", a, z)
    return "".join(text[a:z] for kind, a, z in out if kind in ("", "lits"))
