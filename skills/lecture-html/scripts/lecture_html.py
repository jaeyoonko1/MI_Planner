"""lecture-html helper: create offline interactive lecture / study-roadmap pages, lint them, link them.

Usage (from the MI_Planner folder):
    python skills/lecture-html/scripts/lecture_html.py new --kind lecture --title "제목" [--subject 광학] \
        [--module OPT5] [--level 대학원] [--parent 스터디] [--from FILE] [--make-parent] [--apply]
    python skills/lecture-html/scripts/lecture_html.py new --kind roadmap [--title "스터디 로드맵"] [--parent 스터디] [--apply]
    python skills/lecture-html/scripts/lecture_html.py check "vault/스터디/<페이지>/index.html"
    python skills/lecture-html/scripts/lecture_html.py sync "vault/스터디/스터디 로드맵/index.html" [--apply]
    python skills/lecture-html/scripts/lecture_html.py modules [ROADMAP_FILE]   # roadmap module list (id, title, prereq, page)

`new` is a dry run unless `--apply`; with `--apply` it creates a NEW html page (never overwrites) and refuses
when `check` finds blocking errors (external requests, file references, blocked dialogs).
`sync` fills each roadmap module's `page` from lecture pages whose _page.json has `module`; `--apply` backs the
old file up to vault/.backup/lecture-html/ first and rewrites only the roadmap data block.
Stdlib only (+ app.vault / app.html_page), no network.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
SKILL = Path(__file__).resolve().parents[1]
TEMPLATES = {"lecture": SKILL / "templates" / "lecture.html", "roadmap": SKILL / "templates" / "roadmap.html"}
DEFAULT_TITLE = {"roadmap": "스터디 로드맵"}
RUNTIME_RE = re.compile(r"<!-- mi-lecture-runtime:start v(\d+).*?<!-- mi-lecture-runtime:end -->", re.S)
DATA_RE = re.compile(r'(<script type="application/json" id="roadmap-data">)(.*?)(</script>)', re.S)
KIND_RE = re.compile(r'<meta\s+name="mi-kind"\s+content="(\w+)"', re.I)
PLACEHOLDER_RE = re.compile(r"\[확인 필요[^\]]*\]|\{\{[A-Z]+\}\}")
LEVELS = ["기초", "중급", "대학원"]
COLORS = {"blue", "cyan", "violet", "green", "yellow", "orange", "pink", "red"}
MAX_BYTES = 3_000_000

sys.path.insert(0, str(ROOT))
from app.html_page import find_external_refs  # noqa: E402


class LHError(Exception):
    pass


# ---------- roadmap data ----------

def dump_roadmap(data: dict[str, Any]) -> str:
    """Canonical, diff-friendly JSON: one track / one module per line, `</` escaped for <script>."""
    def one(obj: Any) -> str:
        return json.dumps(obj, ensure_ascii=False, separators=(", ", ": "))

    parts = ["{", f'  "version": {one(data.get("version", 1))},', '  "tracks": [']
    parts += [f"    {one(t)}{',' if i < len(data['tracks']) - 1 else ''}" for i, t in enumerate(data["tracks"])]
    parts += ["  ],", '  "modules": [']
    parts += [f"    {one(m)}{',' if i < len(data['modules']) - 1 else ''}" for i, m in enumerate(data["modules"])]
    parts += ["  ]", "}"]
    return "\n" + "\n".join(parts).replace("</", "<\\/") + "\n"


def read_roadmap(text: str) -> dict[str, Any]:
    m = DATA_RE.search(text)
    if not m:
        raise LHError('로드맵 데이터 블록(<script type="application/json" id="roadmap-data">)이 없습니다.')
    try:
        data = json.loads(m.group(2))
    except ValueError as exc:
        raise LHError(f"로드맵 데이터 JSON 오류: {exc}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("tracks"), list) or not isinstance(data.get("modules"), list):
        raise LHError("로드맵 데이터에는 tracks·modules 배열이 있어야 합니다.")
    return data


def validate_roadmap(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    track_ids = [t.get("id") for t in data["tracks"]]
    if len(set(track_ids)) != len(track_ids):
        errors.append("트랙 id가 겹칩니다.")
    for t in data["tracks"]:
        if not t.get("id") or not t.get("name"):
            errors.append(f"트랙에 id·name이 필요합니다: {t}")
        if t.get("color") and t["color"] not in COLORS:
            errors.append(f"트랙 {t.get('id')}: color는 {sorted(COLORS)} 중 하나")
    mods = {m.get("id"): m for m in data["modules"]}
    if len(mods) != len(data["modules"]):
        errors.append("모듈 id가 겹칩니다.")
    for m in data["modules"]:
        mid = m.get("id")
        if not mid or not m.get("title"):
            errors.append(f"모듈에 id·title이 필요합니다: {m}")
            continue
        if m.get("track") not in track_ids:
            errors.append(f"{mid}: 없는 트랙 '{m.get('track')}'")
        if m.get("level") not in LEVELS:
            errors.append(f"{mid}: level은 {LEVELS} 중 하나")
        if not isinstance(m.get("hours"), (int, float)) or m["hours"] <= 0:
            errors.append(f"{mid}: hours는 양수")
        for p in m.get("prereq", []):
            if p == mid or p not in mods:
                errors.append(f"{mid}: 선수 모듈 '{p}'이(가) 없거나 자기 자신입니다")
    state: dict[str, int] = {}

    def visit(mid: str, path: list[str]) -> None:
        if state.get(mid) == 2 or mid not in mods:
            return
        if state.get(mid) == 1:
            errors.append("선수 관계에 순환이 있습니다: " + " → ".join(path + [mid]))
            return
        state[mid] = 1
        for p in mods[mid].get("prereq", []):
            visit(p, path + [mid])
        state[mid] = 2

    for mid in mods:
        visit(mid, [])
    return errors


# ---------- check ----------

_FILE_REF_RES = [
    ("script src", re.compile(r"<script\b[^>]*\bsrc\s*=", re.I)),
    ("stylesheet link", re.compile(r"<link\b[^>]*rel\s*=\s*[\"']?stylesheet", re.I)),
    ("img/video/audio/source/iframe src (data: 아님)",
     re.compile(r"<(?:img|video|audio|source|iframe|embed)\b[^>]*\bsrc\s*=\s*[\"'](?!data:|blob:)", re.I)),
    ("CSS url() (data: 아님)", re.compile(r"url\(\s*[\"']?(?!data:|#|blob:)[^)\s\"']", re.I)),
    ("@import", re.compile(r"@import\b", re.I)),
]
_BLOCKED_RES = [
    ("alert/confirm/prompt (샌드박스에서 막힘 — 화면 안 안내로)", re.compile(r"(?<![\w.$])(?:window\.)?(?:alert|confirm|prompt)\s*\(")),
    ("fetch/XMLHttpRequest/WebSocket (네트워크 금지)", re.compile(r"\b(?:fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon)")),
]
_WARN_RES = [
    ("새 창 열기(window.open·target=_blank)는 샌드박스에서 막힘", re.compile(r"window\.open\s*\(|target\s*=\s*[\"']_blank", re.I)),
    ("<form> 제출은 샌드박스에서 막힘", re.compile(r"<form\b", re.I)),
    ("<select> 드롭다운 대신 토글 칩(ui.chips) 사용 (D-12)", re.compile(r"<select\b", re.I)),
    ("localStorage·sessionStorage·indexedDB 직접 사용 — 앱 안에서는 예외가 남, MI.state 사용",
     re.compile(r"\b(?:localStorage|sessionStorage|indexedDB)\b")),
]


def _line_of(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def check_html(text: str, kind: str | None = None) -> dict[str, Any]:
    kind = kind or ((m := KIND_RE.search(text)) and m.group(1)) or None
    errors: list[str] = []
    warnings: list[str] = []
    runtime = RUNTIME_RE.search(text)
    outside = RUNTIME_RE.sub("", text)  # authored part only
    for url in find_external_refs(text):
        errors.append(f"외부 요청: {url}")
    for label, rx in _FILE_REF_RES + _BLOCKED_RES:
        for m in rx.finditer(outside):
            errors.append(f"{label} — {_line_of(outside, m.start())}행 근처(런타임 블록 제외 기준)")
            break
    for label, rx in _WARN_RES:
        if rx.search(outside):
            warnings.append(label)
    if not re.search(r"<meta\s+charset\s*=\s*[\"']?utf-8", text, re.I):
        errors.append('<meta charset="utf-8">이 없습니다.')
    if not re.search(r"<title>[^<]+</title>", text):
        errors.append("<title>이 없습니다.")
    size = len(text.encode("utf-8"))
    if size > MAX_BYTES:
        warnings.append(f"파일이 큽니다({size // 1000} KB) — 그림은 SVG·canvas로 그리고 큰 data: 이미지는 줄이세요")
    stats: dict[str, Any] = {"bytes": size}
    if kind == "lecture":
        if not runtime:
            errors.append("공용 런타임 블록(mi-lecture-runtime)이 없습니다 — templates/lecture.html에서 시작하세요.")
        used = re.findall(r'data-widget\s*=\s*"([^"]+)"', text)
        defined = set(re.findall(r"MI\.widget\(\s*[\"']([^\"']+)[\"']", outside))
        for name in sorted(set(used) - defined):
            errors.append(f"위젯 '{name}'이(가) MI.widget(...)으로 등록되지 않았습니다.")
        quiz_ids = re.findall(r'class="lx-quiz"[^>]*data-id="([^"]+)"', text)
        if len(set(quiz_ids)) != len(quiz_ids):
            errors.append("확인 문제 data-id가 겹칩니다.")
        for qid, ans, body in re.findall(r'class="lx-quiz"[^>]*data-id="([^"]+)"[^>]*data-answer="([^"]+)"[^>]*>(.*?)</div>\s*</div>',
                                         text, re.S):
            if f'data-key="{ans}"' not in body:
                errors.append(f"확인 문제 {qid}: 정답 '{ans}'인 보기가 없습니다.")
        stats.update({
            "sections": len(re.findall(r'<section class="lx-sec', text)),
            "widgets": len(used), "quizzes": len(quiz_ids),
            "equations": len(re.findall(r"<math\b", text)),
            "has_goals": 'class="lx-goals"' in text, "has_refs": 'class="lx-refs"' in text,
        })
        if not stats["has_goals"]:
            errors.append("학습 목표(section.lx-goals)가 없습니다.")
        if stats["widgets"] == 0:
            warnings.append("interactive 위젯이 하나도 없습니다(figure.lx-widget).")
        if stats["quizzes"] == 0:
            warnings.append("확인 문제(.lx-quiz)가 없습니다.")
        if not stats["has_refs"]:
            warnings.append("참고 자료(section.lx-refs)가 없습니다.")
    elif kind == "roadmap":
        try:
            data = read_roadmap(text)
            errors += validate_roadmap(data)
            stats.update({"tracks": len(data["tracks"]), "modules": len(data["modules"]),
                          "hours": sum(m.get("hours", 0) for m in data["modules"]),
                          "linked_pages": sum(1 for m in data["modules"] if m.get("page"))})
        except LHError as exc:
            errors.append(str(exc))
    else:
        warnings.append('종류를 알 수 없습니다(<meta name="mi-kind" content="lecture|roadmap">).')
    placeholders = [_line_of(text, m.start()) for m in PLACEHOLDER_RE.finditer(text)]
    return {"kind": kind, "ok": not errors and not placeholders, "errors": errors, "warnings": warnings,
            "placeholders": {"count": len(placeholders), "lines": placeholders[:30]}, "stats": stats}


# ---------- new ----------

def render_template(kind: str, title: str, subject: str, module: str, level: str) -> str:
    text = TEMPLATES[kind].read_text(encoding="utf-8")
    values = {"TITLE": title, "SUBJECT": subject or "[확인 필요: 과목]", "MODULE": module or "[확인 필요: 모듈 ID]",
              "LEVEL": level or "대학원", "DATE": datetime.now().strftime("%Y-%m-%d")}
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", value.replace("&", "&amp;").replace("<", "&lt;"))
    return text


def _vault(vault_root: Path):
    from app.vault import Vault  # noqa: E402

    return Vault(vault_root)


def ensure_parent(vault, parent: str) -> None:
    from app.vault import VaultError  # noqa: E402

    path = ""
    for part in [p for p in parent.split("/") if p]:
        nxt = f"{path}/{part}" if path else part
        if not vault.exists(nxt):
            try:
                vault.create(path, part, "note", folder_name=part)
            except VaultError as exc:
                raise LHError(f"상위 페이지를 만들지 못했습니다: {nxt} ({exc})") from exc
        path = nxt


def new_page(opts: argparse.Namespace, vault_root: Path) -> dict[str, Any]:
    kind = opts.kind
    title = (opts.title or DEFAULT_TITLE.get(kind, "")).strip()
    if not title:
        raise LHError("--title이 필요합니다.")
    if opts.source:
        content = Path(opts.source).read_text(encoding="utf-8-sig")
    else:
        content = render_template(kind, title, opts.subject or "", opts.module or "", opts.level or "")
    report = check_html(content, kind)
    vault = _vault(vault_root)
    result: dict[str, Any] = {"kind": kind, "title": title, "parent": opts.parent,
                              "would_create": f"{opts.parent}/{vault.unique_name(opts.parent, title)}".lstrip("/"),
                              "check": report}
    if not opts.apply:
        return {"applied": False, **result}
    if report["errors"]:
        raise LHError("check 오류가 있어 페이지를 만들지 않았습니다: " + "; ".join(report["errors"][:5]))
    from app.vault import VaultError  # noqa: E402

    if opts.make_parent:
        ensure_parent(vault, opts.parent)
    meta: dict[str, Any] = {"skill": "lecture-html", "doc_kind": kind}
    module = opts.module or ((m := re.search(r'<meta\s+name="mi-module"\s+content="([A-Za-z0-9_-]+)"', content)) and m.group(1))
    if kind == "lecture" and module:
        meta["module"] = module
    try:
        page = vault.create(opts.parent, title, "html", extra_meta=meta)
        vault.write(page["path"], content)
    except VaultError as exc:
        raise LHError(f"{exc} (parent: '{opts.parent}' — 없으면 --make-parent)") from exc
    return {"applied": True, **result, "path": page["path"],
            "file": (vault_root / page["path"] / "index.html").as_posix(), "meta": meta}


# ---------- sync ----------

def lecture_pages(vault_root: Path) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for meta_file in sorted(vault_root.rglob("_page.json")):
        rel = meta_file.parent.relative_to(vault_root)
        if any(p.startswith(".") for p in rel.parts):
            continue
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if meta.get("skill") == "lecture-html" and meta.get("doc_kind") == "lecture" and meta.get("module"):
            found.setdefault(meta["module"], []).append(rel.as_posix())
    return found


def sync_roadmap(path: Path, vault_root: Path, apply: bool) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    data = read_roadmap(text)
    pages = lecture_pages(vault_root)
    ids = {m["id"] for m in data["modules"]}
    changed, missing, duplicates = [], [], []
    for m in data["modules"]:
        cands = pages.get(m["id"], [])
        if len(cands) > 1:
            duplicates.append({"module": m["id"], "pages": cands})
        new = m.get("page", "")
        if cands and new not in cands:
            new = cands[0]
        if new and not (vault_root / new / "_page.json").is_file():
            missing.append({"module": m["id"], "page": new})
            new = ""
        if new != m.get("page", ""):
            changed.append({"module": m["id"], "from": m.get("page", ""), "to": new})
            m["page"] = new
    result: dict[str, Any] = {"file": path.as_posix(), "changed": changed, "missing_pages": missing,
                              "duplicate_pages": duplicates,
                              "unknown_modules": sorted({k: v for k, v in pages.items() if k not in ids}.items()),
                              "applied": False}
    if apply and changed:
        backup = vault_root / ".backup" / "lecture-html" / f"{datetime.now():%Y%m%d-%H%M%S}-{path.parent.name}.html"
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, backup)
        m = DATA_RE.search(text)
        assert m is not None
        path.write_text(text[: m.start(2)] + dump_roadmap(data) + text[m.end(2):], encoding="utf-8", newline="")
        result.update({"applied": True, "backup": backup.as_posix()})
    return result


# ---------- entry ----------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="lecture-html: offline interactive lecture / roadmap pages")
    p.add_argument("--vault")
    sub = p.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("new", help="new html page from a template (dry run unless --apply)")
    n.add_argument("--kind", required=True, choices=sorted(TEMPLATES))
    n.add_argument("--title")
    n.add_argument("--subject")
    n.add_argument("--module", help="roadmap module id, e.g. OPT5")
    n.add_argument("--level", choices=LEVELS)
    n.add_argument("--parent", default="스터디")
    n.add_argument("--from", dest="source", help="use this html file instead of the template")
    n.add_argument("--make-parent", action="store_true", help="create missing parent note pages")
    n.add_argument("--apply", action="store_true")
    c = sub.add_parser("check", help="offline / structure lint")
    c.add_argument("file")
    c.add_argument("--kind", choices=sorted(TEMPLATES))
    s = sub.add_parser("sync", help="link roadmap modules to lecture pages")
    s.add_argument("file")
    s.add_argument("--apply", action="store_true")
    m = sub.add_parser("modules", help="list roadmap modules")
    m.add_argument("file", nargs="?", default=str(TEMPLATES["roadmap"]))
    return p


def run(opts: argparse.Namespace) -> dict[str, Any]:
    vault_root = Path(opts.vault) if opts.vault else ROOT / "vault"
    if opts.cmd == "new":
        return new_page(opts, vault_root)
    path = Path(opts.file)
    if not path.is_file():
        raise LHError(f"파일을 찾을 수 없습니다: {opts.file}")
    if opts.cmd == "check":
        return {"file": path.as_posix(), **check_html(path.read_text(encoding="utf-8-sig"), opts.kind)}
    if opts.cmd == "sync":
        return sync_roadmap(path, vault_root, opts.apply)
    data = read_roadmap(path.read_text(encoding="utf-8"))
    return {"tracks": [{"id": t["id"], "name": t["name"]} for t in data["tracks"]],
            "modules": [{k: m.get(k) for k in ("id", "track", "title", "level", "prereq", "page")} for m in data["modules"]]}


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    try:
        result = run(build_parser().parse_args(argv))
    except (LHError, OSError, ValueError, KeyError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
