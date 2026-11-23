"""Create a sample vault with FAKE data only (AGENTS.md rule: no real company data).

Usage:  python scripts/seed_sample.py [--vault PATH]
Existing pages are left untouched, so it is safe to run repeatedly.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.vault import DEFAULT_VAULT_PATH, Vault, VaultError  # noqa: E402

# (title, type, body, children)
SAMPLE = [
    ("일지", "note", "월간 일지 모음입니다.", [
        ("2026-11", "journal", "", []),
    ]),
    ("MI 공정업무", "note", "", [
        ("RCP 개발", "note", "신규 레시피 개발 메모.", []),
        ("RCP 관리", "table", "", []),
        ("설비사 평가", "note", "", [
            ("2026 샘플 평가", "board", "# 목적\n샘플 평가입니다. (가짜 데이터)\n\n- 대상: EQ-A01, EQ-B01\n- Lot: LOT-TEST-001", []),
        ]),
        ("각종 정보", "note", "", []),
        ("DOI List", "table", "", []),
    ]),
    ("연구 개발", "note", "", []),
    ("성과", "note", "", []),
    ("업무 매뉴얼", "note", "# 매뉴얼\n\n1. 샘플 항목", []),
    ("스터디", "note", "", [
        ("광학", "html", "<!doctype html>\n<meta charset=\"utf-8\">\n<h1>광학 샘플</h1>\n<p>interactive HTML 페이지 예시.</p>\n", []),
    ]),
]


def seed(vault: Vault, items=SAMPLE, parent: str = "") -> int:
    """Create missing pages; return how many were created."""
    created = 0
    existing = {n["title"]: n["path"] for n in _children(vault, parent)}
    for title, page_type, body, children in items:
        if title in existing:
            path = existing[title]
        else:
            try:
                path = vault.create(parent, title, page_type)["path"]
            except VaultError:
                continue
            created += 1
            if body:
                vault.write(path, body)
        created += seed(vault, children, path)
    return created


def _children(vault: Vault, parent: str) -> list[dict]:
    nodes = vault.tree()
    for part in [p for p in parent.split("/") if p]:
        nodes = next(n for n in nodes if n["path"].split("/")[-1] == part)["children"]
    return nodes


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--vault", type=Path, default=DEFAULT_VAULT_PATH)
    args = ap.parse_args()
    print(f"created {seed(Vault(args.vault))} pages in {args.vault}")


if __name__ == "__main__":
    main()
