"""Validate skills/*/SKILL.md (stdlib only). Exit code 0 = all good."""
from __future__ import annotations

import re
import sys
from pathlib import Path

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
EXTERNAL_RE = re.compile(r"https?://(?!127\.0\.0\.1|localhost)", re.I)


def parse_frontmatter(text: str) -> tuple[dict[str, str], str] | None:
    lines = text.lstrip("﻿").splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            meta: dict[str, str] = {}
            for ln in lines[1:i]:
                if ":" in ln and not ln.startswith((" ", "\t")):
                    k, v = ln.split(":", 1)
                    meta[k.strip()] = re.sub(r"\s+#.*$", "", v).strip()
            return meta, "\n".join(lines[i + 1:])
    return None


def check_skill(folder: Path) -> list[str]:
    errors: list[str] = []
    f = folder / "SKILL.md"
    if not f.is_file():
        return [f"{folder.name}: SKILL.md 없음"]
    parsed = parse_frontmatter(f.read_text(encoding="utf-8"))
    if parsed is None:
        return [f"{folder.name}: frontmatter(---) 없음"]
    meta, body = parsed
    name = meta.get("name", "")
    if not NAME_RE.match(name):
        errors.append(f"{folder.name}: name 형식 오류 '{name}'")
    elif name != folder.name:
        errors.append(f"{folder.name}: name '{name}'이 폴더 이름과 다름")
    if len(meta.get("description", "")) < 10:
        errors.append(f"{folder.name}: description이 없거나 너무 짧음")
    if not body.strip():
        errors.append(f"{folder.name}: 본문이 비어 있음")
    if EXTERNAL_RE.search(body):
        errors.append(f"{folder.name}: 외부 URL 포함(오프라인 규칙 위반)")
    return errors


def check_all(root: Path) -> list[str]:
    if not root.is_dir():
        return [f"{root} 폴더 없음"]
    folders = sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith("."))
    errors: list[str] = []
    for p in folders:
        errors += check_skill(p)
    return errors


def main(argv: list[str]) -> int:
    root = Path(argv[1]) if len(argv) > 1 else Path(__file__).resolve().parent.parent / "skills"
    errors = check_all(root)
    for e in errors:
        print("ERROR", e)
    if not errors:
        print("OK")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
