"""paper-patent helper: gather local references, scaffold a draft page, and lint the draft.

Usage (from the MI_Planner folder):
    python skills/paper-patent/scripts/paper_patent.py refs SRC [SRC ...] [--out data/tmp/pp-refs.json]
    python skills/paper-patent/scripts/paper_patent.py outline --kind paper|patent|asset --title "제목" \
        [--refs data/tmp/pp-refs.json] [--parent 성과] [--apply]
    python skills/paper-patent/scripts/paper_patent.py check "vault/<page>/index.md" [--kind patent]

SRC = a local file (.md .txt .html .htm .csv .tsv .json), a vault page folder, or a folder of such files.
Web links are NOT fetched (offline rule); they are listed under `links` so the user can paste the text.
`outline` is a dry run unless `--apply`; with `--apply` it creates a NEW note page (never overwrites).
Stdlib only (+ app.vault for page creation), no network.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
TEXT_EXTS = {".md", ".txt", ".csv", ".tsv", ".json", ".log"}
HTML_EXTS = {".html", ".htm"}
BINARY_HINT = {".pdf": "PDF", ".docx": "Word", ".pptx": "PowerPoint", ".xlsx": "Excel", ".hwp": "한글"}
MAX_CHARS = 200_000
URL_RE = re.compile(r"https?://[^\s)>\]]+", re.I)
LOCAL_URL_RE = re.compile(r"https?://(127\.0\.0\.1|localhost)(:\d+)?(/|$)", re.I)
UNIT_RE = re.compile(
    r"\d(?:[\d,]*\d)?(?:\.\d+)?\s?(?:nm|µm|um|mm|cm|mrad|deg|°|%|ppm|ms|us|µs|sec|s\b|초|분|시간|장|ea|wph|"
    r"WPH|ea/h|nA|mA|V|kV|W|Hz|kHz|MHz|배|회)"
)
CITE_RE = re.compile(r"\[R(\d+)\]")
PLACEHOLDER_RE = re.compile(r"\[확인 필요[^\]]*\]|\bTODO\b|\?\?")
DEF_RE = re.compile(r"^\s*[-*]?\s*\[R(\d+)\]")
CLAIM_RE = re.compile(r"^\s*(?:\*\*)?(?:【)?청구항\s*(\d+)(?:】)?(?:\*\*)?")
DEP_RE = re.compile(r"제\s*(\d+)\s*항")
ANTE_RE = re.compile(r"상기\s+([^\s,.;:()]+)")
PARTICLE_RE = re.compile(r"(으로부터|에서의|으로서|로서|으로|에서|에게|까지|부터|와의|과의|의|은|는|이|가|을|를|에|로|와|과|도|만)$")

AXES = ["이론", "시뮬레이션", "실험", "데이터", "시각화", "논리"]

SECTIONS: dict[str, list[str]] = {
    "paper": ["초록", "서론", "이론", "방법", "결과", "논의", "결론", "참고문헌"],
    "patent": ["발명의 명칭", "기술분야", "배경기술", "해결하려는 과제", "과제의 해결 수단", "발명의 효과",
               "도면의 간단한 설명", "발명을 실시하기 위한 구체적인 내용", "청구범위", "요약", "참고문헌"],
    "asset": ["개요", "배경과 문제", "기술 내용", "검증 결과", "재현 절차", "적용 범위와 한계", "참고문헌"],
}
KIND_LABEL = {"paper": "사내 논문", "patent": "특허(직무발명) 초안", "asset": "기술자산화 문서"}


class PPError(Exception):
    pass


# ---------- refs ----------

def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "cp949"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    raise PPError("글자 인코딩을 읽지 못했습니다(UTF-8/CP949 아님)")


def _html_text(src: str) -> tuple[str, str]:
    m = re.search(r"<title[^>]*>(.*?)</title>", src, re.I | re.S)
    title = html.unescape(m.group(1)).strip() if m else ""
    body = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", src, flags=re.I | re.S)
    body = re.sub(r"<br\s*/?>|</(p|div|h\d|li|tr)>", "\n", body, flags=re.I)
    body = html.unescape(re.sub(r"<[^>]+>", " ", body))
    return title, "\n".join(re.sub(r"[ \t]+", " ", ln).strip() for ln in body.splitlines() if ln.strip())


def _page_title(folder: Path) -> str:
    try:
        return json.loads((folder / "_page.json").read_text(encoding="utf-8")).get("title", "")
    except (OSError, ValueError):
        return ""


def _expand(src: str) -> list[Path] | str:
    if URL_RE.match(src):
        return src
    p = Path(src)
    if not p.exists():
        raise PPError(f"파일을 찾을 수 없습니다: {src}")
    if p.is_file():
        return [p]
    if (p / "_page.json").is_file():
        return [f for f in (p / "index.md", p / "index.html") if f.is_file()]
    files = [f for f in sorted(p.rglob("*")) if f.is_file() and not any(x.startswith(".") for x in f.parts)
             and (f.suffix.lower() in TEXT_EXTS | HTML_EXTS | set(BINARY_HINT))]
    return files


def read_source(path: Path) -> dict[str, Any]:
    ext = path.suffix.lower()
    if ext in BINARY_HINT:
        return {"path": path.as_posix(), "skipped": f"{BINARY_HINT[ext]} 파일은 읽지 않습니다. 본문을 복사해 .txt/.md로 저장해 주세요."}
    if ext not in TEXT_EXTS | HTML_EXTS:
        return {"path": path.as_posix(), "skipped": "지원하지 않는 형식입니다(.md .txt .html .csv .tsv .json)."}
    text = _decode(path.read_bytes()[: MAX_CHARS * 4])[:MAX_CHARS]
    title = ""
    if ext in HTML_EXTS:
        title, text = _html_text(text)
    if path.name in ("index.md", "index.html"):
        title = _page_title(path.parent) or title
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    headings = [ln.lstrip("#").strip() for ln in lines if ln.startswith("#")][:12]
    if not title:
        title = headings[0] if headings else path.stem
    numeric = [ln[:200] for ln in lines if UNIT_RE.search(ln) and not ln.startswith("|---")][:15]
    item = {"path": path.as_posix(), "title": title, "chars": len(text), "headings": headings,
            "excerpt": " ".join(lines)[:400], "numeric_lines": numeric,
            "links": sorted(set(URL_RE.findall(text)))[:20]}
    if ext in (".csv", ".tsv") and lines:
        sep = "\t" if "\t" in lines[0] else ","
        item["data"] = {"columns": [c.strip() for c in lines[0].split(sep)], "row_count": len(lines) - 1}
    return item


def gather_refs(sources: list[str]) -> dict[str, Any]:
    refs, links, skipped = [], [], []
    seen: set[str] = set()
    for src in sources:
        got = _expand(src)
        if isinstance(got, str):
            links.append({"url": got, "note": "링크는 가져오지 않습니다(오프라인 규칙). 본문을 붙여넣거나 파일로 저장해 주세요."})
            continue
        if not got:
            skipped.append({"path": src, "skipped": "읽을 수 있는 파일이 없습니다."})
        for f in got:
            key = str(f.resolve())
            if key in seen:
                continue
            seen.add(key)
            item = read_source(f)
            if "skipped" in item:
                skipped.append(item)
            else:
                item["id"] = f"R{len(refs) + 1}"
                refs.append(item)
    return {"refs": refs, "links": links, "skipped": skipped}


# ---------- outline ----------

def _ref_lines(refs: list[dict[str, Any]]) -> list[str]:
    if not refs:
        return ["- [R1] [확인 필요: 참고 자료 — 저자, 제목, 문서번호/경로, 날짜]"]
    return [f"- [{r['id']}] {r['title']} — `{r['path']}`" for r in refs]


def _axis_table() -> list[str]:
    rows = ["| 주장 | 근거 축 | 근거(출처) | 상태 |", "|---|---|---|---|"]
    rows.append("| [확인 필요: 핵심 주장 1문장] | 실험·데이터 | [R1] | 초안 |")
    return rows


def build_outline(kind: str, title: str, refs: list[dict[str, Any]]) -> str:
    if kind not in SECTIONS:
        raise PPError("kind는 paper, patent, asset 중 하나입니다.")
    out = [f"# {title}", "",
           f"> {KIND_LABEL[kind]} 초안 · paper-patent 스킬 · 보안 등급 [확인 필요] · 사외 공개 전 검토 필수", "",
           "## 논리 뼈대 (주장 → 근거)", "",
           "축: " + " / ".join(AXES) + ". 모든 주장은 근거가 하나 이상 있어야 한다.", "", *_axis_table(), ""]
    body = {
        "paper": {
            "초록": ["[확인 필요: 문제 → 방법 → 핵심 정량 결과 → 의의, 5문장 이내]"],
            "서론": ["- 배경과 문제: [확인 필요]", "- 기존 방법의 한계 [R1]: [확인 필요]", "- 이 글의 기여(1~3개): [확인 필요]"],
            "이론": ["- 원리·모델과 가정: [확인 필요]", "- 식: `[확인 필요: 기호 정의 포함]`"],
            "방법": ["### 시뮬레이션", "| 항목 | 값 |", "|---|---|", "| 모델·도구 | [확인 필요] |", "| 주요 파라미터 | [확인 필요] |", "",
                    "### 실험", "| 항목 | 값 |", "|---|---|", "| 설비 | EQ-A01 [확인 필요] |", "| 시료 | LOT-TEST-001 [확인 필요] |", "| 조건·반복 수 | [확인 필요] |"],
            "결과": ["### 데이터", "| 조건 | n | 평균 | σ | 출처 |", "|---|---|---|---|---|", "| [확인 필요] | | | | |", "",
                    "### 시각화 (그림 계획)", "| 그림 | 보여줄 주장 | x / y | 데이터 출처 |", "|---|---|---|---|", "| 그림 1 | [확인 필요] | | |"],
            "논의": ["- 결과 해석과 이론의 일치/불일치: [확인 필요]", "- 한계와 반례: [확인 필요]"],
            "결론": ["[확인 필요: 기여와 정량 효과를 2~3문장으로]"],
        },
        "patent": {
            "발명의 명칭": [f"{title}"],
            "기술분야": ["본 발명은 [확인 필요: 반도체 검사·계측 중 어떤 분야]에 관한 것이다."],
            "배경기술": ["- 선행기술 [R1]: [확인 필요: 구성 요약]", "- 선행기술의 문제점: [확인 필요]"],
            "해결하려는 과제": ["[확인 필요: 선행기술의 문제를 과제로 1~3개]"],
            "과제의 해결 수단": ["[확인 필요: 핵심 구성요소와 그 결합 — 청구항 1과 같은 말로]"],
            "발명의 효과": ["- [확인 필요: 정량 효과와 근거(실험·시뮬레이션)]"],
            "도면의 간단한 설명": ["- 도 1은 [확인 필요]를 나타낸 구성도이다."],
            "발명을 실시하기 위한 구체적인 내용": ["### 실시예 1", "[확인 필요: 도면 부호와 함께 구성·동작 설명]", "",
                                       "### 실험예", "| 조건 | 비교예 | 실시예 | 출처 |", "|---|---|---|---|", "| [확인 필요] | | | |"],
            "청구범위": ["**청구항 1** [확인 필요: 독립항 — 필수 구성요소만, 하나의 문장]", "",
                     "**청구항 2** 제1항에 있어서, [확인 필요: 종속항 — 상기 구성의 구체화]"],
            "요약": ["[확인 필요: 400자 이내]"],
        },
        "asset": {
            "개요": ["- 한 줄 요약: [확인 필요]", "- 대상 공정·설비: EQ-A01 [확인 필요]", "- 담당·작성일: [확인 필요]"],
            "배경과 문제": ["[확인 필요: 어떤 문제가 얼마나 자주, 어떤 손실로]"],
            "기술 내용": ["- 원리(이론): [확인 필요]", "- 시뮬레이션·계산: [확인 필요]", "- 핵심 노하우(조건·판단 기준): [확인 필요]"],
            "검증 결과": ["| 지표 | 적용 전 | 적용 후 | n | 출처 |", "|---|---|---|---|---|", "| [확인 필요] | | | | |", "",
                      "그림 계획: [확인 필요: 그림마다 보여줄 주장·축·데이터 출처]"],
            "재현 절차": ["1. [확인 필요]"],
            "적용 범위와 한계": ["- [확인 필요]"],
        },
    }[kind]
    for sec in SECTIONS[kind]:
        out += [f"## {sec}", ""]
        out += _ref_lines(refs) if sec == "참고문헌" else body[sec]
        out.append("")
    return "\n".join(out).rstrip() + "\n"


def create_page(vault_root: Path, parent: str, title: str, kind: str, content: str) -> dict[str, Any]:
    sys.path.insert(0, str(ROOT))
    from app.vault import Vault, VaultError  # noqa: E402 - only needed for --apply

    vault = Vault(vault_root)
    try:
        page = vault.create(parent, title, "note", extra_meta={"skill": "paper-patent", "doc_kind": kind})
        vault.write(page["path"], content)
    except VaultError as exc:
        raise PPError(f"{exc} (parent: '{parent}')") from exc
    return {"path": page["path"], "file": (vault_root / page["path"] / "index.md").as_posix()}


# ---------- check ----------

def _sections(lines: list[str]) -> list[tuple[str, int, int]]:
    heads = [(i, ln.lstrip("#").strip()) for i, ln in enumerate(lines) if re.match(r"^#{2,3}\s", ln)]
    return [(t, i, heads[n + 1][0] if n + 1 < len(heads) else len(lines)) for n, (i, t) in enumerate(heads)]


def _stem(word: str) -> str:
    prev = None
    while prev != word and len(word) > 1:
        prev, word = word, PARTICLE_RE.sub("", word)
    return word


def check_claims(lines: list[str]) -> dict[str, Any]:
    claims: dict[int, str] = {}
    order: list[int] = []
    cur = None
    for ln in lines:
        m = CLAIM_RE.match(ln)
        if m:
            cur = int(m.group(1))
            order.append(cur)
            claims[cur] = ln[m.end():].strip()
        elif cur is not None and ln.strip() and not ln.startswith("#"):
            claims[cur] += " " + ln.strip()
    issues: list[str] = []
    if order != list(range(1, len(order) + 1)):
        issues.append(f"청구항 번호가 1부터 차례대로가 아닙니다: {order}")
    independent, dependent = [], []
    for n in order:
        refs = [int(x) for x in DEP_RE.findall(claims[n])]
        (dependent if refs else independent).append(n)
        for r in refs:
            if r >= n or r not in claims:
                issues.append(f"청구항 {n}: 제{r}항을 인용할 수 없습니다(없거나 뒤 번호)")
    antecedent = []
    for n in order:
        chain, seen_text = [n], ""
        while True:  # follow the first dependency back to the independent claim
            deps = [int(x) for x in DEP_RE.findall(claims[chain[-1]]) if int(x) in claims and int(x) < chain[-1]]
            if not deps or deps[0] in chain:
                break
            chain.append(deps[0])
        for c in reversed(chain[1:]):
            seen_text += " " + claims[c]
        text = claims[n]
        for m in ANTE_RE.finditer(text):
            stem = _stem(m.group(1))
            before = ANTE_RE.sub(" ", seen_text + " " + text[: m.start()])
            if len(stem) >= 2 and stem not in before:
                antecedent.append(f"청구항 {n}: '상기 {m.group(1)}' — 앞에서 '{stem}'을(를) 먼저 도입하지 않았습니다")
    return {"count": len(order), "independent": independent, "dependent": dependent,
            "issues": issues, "antecedent": antecedent}


def check_draft(path: Path, kind: str | None) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    if not kind:
        try:
            kind = json.loads((path.parent / "_page.json").read_text(encoding="utf-8")).get("doc_kind")
        except (OSError, ValueError):
            kind = None
    secs = _sections(lines)
    titles = [t for t, _, _ in secs]
    missing = [s for s in SECTIONS.get(kind or "", []) if not any(t.startswith(s) for t in titles)]
    ref_start = next((i for t, i, _ in secs if t.startswith("참고문헌")), len(lines))
    defined = {int(m.group(1)) for ln in lines[ref_start:] if (m := DEF_RE.match(ln))}
    used: dict[int, int] = {}
    unsourced, placeholders, in_code = [], [], False
    for i, ln in enumerate(lines[:ref_start]):
        if ln.strip().startswith("```"):
            in_code = not in_code
            continue
        for m in CITE_RE.finditer(ln):
            used.setdefault(int(m.group(1)), i + 1)
        if PLACEHOLDER_RE.search(ln):
            placeholders.append(i + 1)
        elif (not in_code and UNIT_RE.search(ln) and not CITE_RE.search(ln) and not ln.startswith(("#", ">"))
                and not re.search(r"\(출처:|\[데이터:|\[실험|\[시뮬", ln) and not CLAIM_RE.match(ln)):
            unsourced.append({"line": i + 1, "text": ln.strip()[:120]})
    external = sorted({u for u in URL_RE.findall(text) if not LOCAL_URL_RE.match(u)})
    result: dict[str, Any] = {
        "file": path.as_posix(), "kind": kind, "missing_sections": missing,
        "undefined_citations": sorted(f"R{n}" for n in used if n not in defined),
        "unused_refs": sorted(f"R{n}" for n in defined if n not in used),
        "placeholders": {"count": len(placeholders), "lines": placeholders[:30]},
        "unsourced_numbers": unsourced[:30], "external_links": external,
    }
    if kind == "patent" or any(CLAIM_RE.match(ln) for ln in lines):
        result["claims"] = check_claims(lines)
    claims = result.get("claims", {})
    result["ok"] = not (missing or result["undefined_citations"] or placeholders or unsourced
                        or claims.get("issues") or claims.get("antecedent"))
    return result


# ---------- entry ----------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="paper-patent: references -> draft page -> lint")
    p.add_argument("--vault")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("refs", help="read local reference files into R1, R2, ...")
    r.add_argument("sources", nargs="+")
    r.add_argument("--out", help="also save the JSON here (e.g. data/tmp/pp-refs.json)")
    o = sub.add_parser("outline", help="draft skeleton (dry run unless --apply)")
    o.add_argument("--kind", required=True, choices=sorted(SECTIONS))
    o.add_argument("--title", required=True)
    o.add_argument("--refs", help="JSON from `refs --out`")
    o.add_argument("--parent", default="성과", help="vault page path for the new page ('' = top level)")
    o.add_argument("--apply", action="store_true", help="create the new note page")
    c = sub.add_parser("check", help="lint a draft")
    c.add_argument("page", help="vault/<page>/index.md")
    c.add_argument("--kind", choices=sorted(SECTIONS))
    return p


def run(opts: argparse.Namespace) -> dict[str, Any]:
    vault_root = Path(opts.vault) if opts.vault else ROOT / "vault"
    if opts.cmd == "refs":
        result = gather_refs(opts.sources)
        if opts.out:
            Path(opts.out).parent.mkdir(parents=True, exist_ok=True)
            Path(opts.out).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            result["saved"] = opts.out
        return result
    if opts.cmd == "outline":
        refs = json.loads(Path(opts.refs).read_text(encoding="utf-8"))["refs"] if opts.refs else []
        content = build_outline(opts.kind, opts.title.strip(), refs)
        if not opts.apply:
            return {"applied": False, "parent": opts.parent, "title": opts.title, "content": content}
        return {"applied": True, **create_page(vault_root, opts.parent, opts.title, opts.kind, content)}
    return check_draft(Path(opts.page), opts.kind)


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    try:
        result = run(build_parser().parse_args(argv))
    except (PPError, OSError, ValueError, KeyError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
