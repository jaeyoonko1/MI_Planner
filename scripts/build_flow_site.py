"""Build an isolated, public project-flow site for GitHub Pages.

Only project_flow.html is copied. Private vault/DB/config/docs never enter the
published artifact. FLOW completion flags remain the source of truth.
"""

from __future__ import annotations

import argparse
from datetime import datetime
from html import escape
import os
from pathlib import Path
import re
import subprocess
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "project_flow.html"
COMMIT_RE = re.compile(r"^[a-fA-F0-9]{7,40}$")
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


def git_value(*args: str) -> str:
    """Read local commit metadata; source archives can safely omit Git."""
    try:
        return subprocess.check_output(
            ["git", "-C", str(ROOT), *args],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def build_site(source: Path, output: Path, *, sha: str, subject: str, repo: str,
               deployed_at: datetime) -> None:
    html = source.read_text(encoding="utf-8")
    if '<html lang="ko">' not in html or 'const FLOW = {' not in html:
        raise ValueError("Expected the original project_flow.html with FLOW data")

    anchor = '    <div class="sub" id="sub"></div>'
    if html.count(anchor) != 1:
        raise ValueError("Could not find the project-flow header")

    safe_sha = sha if COMMIT_RE.fullmatch(sha) else ""
    safe_repo = repo if REPO_RE.fullmatch(repo) else ""
    ref = (
        f'<a href="https://github.com/{safe_repo}/commit/{safe_sha}" '
        'target="_blank" rel="noopener noreferrer" '
        'style="color:var(--accent);text-decoration:none">커밋 보기 ↗</a>'
        if safe_sha and safe_repo else ""
    )
    version = safe_sha[:7] if safe_sha else "로컬 빌드"
    date_label = deployed_at.astimezone(ZoneInfo("Asia/Seoul")).strftime("%Y-%m-%d %H:%M KST")
    safe_subject = escape(subject[:140]) or "최신 프로젝트 흐름"

    # The published site is a static snapshot. Browser checkboxes still store
    # local overrides; changing them never changes repository FLOW data.
    banner = (
        '<div class="card" aria-label="GitHub Pages 자동 배포 정보" '
        'style="margin-top:12px;padding:10px 14px;display:flex;gap:10px;'
        'align-items:center;flex-wrap:wrap;font-size:12px;color:var(--muted)">'
        '<strong style="color:var(--done)">● GitHub 자동 배포</strong>'
        f'<span>{escape(date_label)} · {escape(version)}</span>'
        f'<span style="flex:1;min-width:160px">{safe_subject}</span>'
        f'{ref}'
        '</div>'
    )
    html = html.replace("  </header>", f"  </header>\n  {banner}", 1)

    output.mkdir(parents=True, exist_ok=True)
    # index is the landing page; both requested and canonical file names work.
    for filename in ("index.html", "project_flow.html", "process_flow.html"):
        (output / filename).write_text(html, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path, default=ROOT / "_site")
    args = parser.parse_args()
    build_site(
        args.source,
        args.output,
        sha=os.getenv("GITHUB_SHA") or git_value("rev-parse", "HEAD"),
        subject=git_value("log", "-1", "--format=%s"),
        repo=os.getenv("GITHUB_REPOSITORY", "jaeyoonko1/MI_Planner"),
        deployed_at=datetime.now(ZoneInfo("Asia/Seoul")),
    )
    print(f"Built GitHub Pages site: {args.output}")


if __name__ == "__main__":
    main()
