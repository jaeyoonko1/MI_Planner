"""List skills/<name>/SKILL.md for the UI (P7-03). Reuses the checker's frontmatter parser."""
from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = ROOT / "skills"


def _parser():
    spec = importlib.util.spec_from_file_location("check_skills", ROOT / "scripts" / "check_skills.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.parse_frontmatter


def list_skills(skills_dir: Path = SKILLS_DIR) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    if not skills_dir.is_dir():
        return out
    parse = _parser()
    for folder in sorted(p for p in skills_dir.iterdir() if p.is_dir()):
        f = folder / "SKILL.md"
        if not f.is_file():
            continue
        try:
            parsed = parse(f.read_text(encoding="utf-8"))
        except OSError:
            continue
        if parsed is None:
            continue
        out.append({"name": folder.name, "description": parsed[0].get("description", "")})
    return out
