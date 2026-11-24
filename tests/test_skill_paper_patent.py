"""P7-06: paper-patent skill helper runs against a temp vault with fake data only."""
import importlib.util
import json
from pathlib import Path

import pytest

from app.vault import Vault

ROOT = Path(__file__).resolve().parent.parent
EXAMPLES = ROOT / "skills" / "paper-patent" / "examples" / "refs"

_spec = importlib.util.spec_from_file_location("paper_patent", ROOT / "skills/paper-patent/scripts/paper_patent.py")
pp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pp)


def run(capsys, *argv: str):
    code = pp.main(list(argv))
    return code, json.loads(capsys.readouterr().out)


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    root = tmp_path / "vault"
    v = Vault(root)
    v.create("", "성과")
    page = v.create("", "연구 메모")
    v.write(page["path"], "# 연구 메모\n\n- 참고 링크 https://example.invalid/doc\n- 스캔 25분 [R9]\n")
    return root


def test_refs_reads_local_files_and_never_fetches_links(vault, tmp_path, capsys):
    (tmp_path / "paper.pdf").write_bytes(b"%PDF-1.4")
    (tmp_path / "cp.txt").write_bytes("EQ-A01 측정 12.5 nm".encode("cp949"))
    out_file = tmp_path / "tmp" / "refs.json"
    code, out = run(capsys, "refs", str(EXAMPLES), str(vault / "연구 메모"), str(tmp_path / "paper.pdf"),
                    str(tmp_path / "cp.txt"), "https://example.invalid/x", "--out", str(out_file))
    assert code == 0
    assert [r["id"] for r in out["refs"]] == ["R1", "R2", "R3", "R4"]
    by_title = {r["title"]: r for r in out["refs"]}
    assert by_title["scan_data"]["data"] == {"columns": ["wafer", "method", "scan_min", "refocus", "defects"],
                                             "row_count": 6}
    assert by_title["연구 메모"]["links"] == ["https://example.invalid/doc"]  # listed, not fetched
    assert any("12.5 nm" in ln for ln in by_title["cp"]["numeric_lines"])
    assert out["links"][0]["url"] == "https://example.invalid/x"
    assert out["skipped"][0]["path"].endswith("paper.pdf")
    assert json.loads(out_file.read_text(encoding="utf-8"))["refs"][0]["id"] == "R1"
    code, out = run(capsys, "refs", str(tmp_path / "missing.md"))
    assert code == 1 and "찾을 수 없습니다" in out["error"]


@pytest.mark.parametrize("kind", ["paper", "patent", "asset"])
def test_outline_dry_run_then_apply_creates_new_page_only(vault, tmp_path, capsys, kind):
    code, refs = run(capsys, "refs", str(EXAMPLES), "--out", str(tmp_path / "refs.json"))
    args = ["--vault", str(vault), "outline", "--kind", kind, "--title", "이중 초점 스캔", "--refs",
            str(tmp_path / "refs.json")]
    code, out = run(capsys, *args)
    assert code == 0 and out["applied"] is False and "[R2]" in out["content"]
    assert not (vault / "성과" / "이중 초점 스캔").exists()
    for section in pp.SECTIONS[kind]:
        assert f"## {section}" in out["content"]
    code, first = run(capsys, *args, "--apply")
    code, second = run(capsys, *args, "--apply")
    assert first["path"] == "성과/이중 초점 스캔" and second["path"] == "성과/이중 초점 스캔 (2)"
    page = Vault(vault).read(first["path"])
    assert page["meta"]["doc_kind"] == kind and page["meta"]["skill"] == "paper-patent"
    assert page["content"] == out["content"]
    code, chk = run(capsys, "check", first["file"])  # kind comes from _page.json
    assert code == 0 and chk["kind"] == kind and chk["missing_sections"] == []
    assert chk["placeholders"]["count"] > 0 and chk["ok"] is False
    code, err = run(capsys, "--vault", str(vault), "outline", "--kind", kind, "--title", "x",
                    "--parent", "없는 폴더", "--apply")
    assert code == 1 and "error" in err


PATENT = """# 이중 초점 스캔 방법

## 과제의 해결 수단
스캔 시간이 25분으로 줄었다 [R1].
재초점 횟수는 18회였다.

## 청구범위
**청구항 1** 웨이퍼의 휨 지도를 생성하는 단계; 및 상기 휨 지도에 따라 초점 면을 전환하는 단계를 포함하는 검사 방법.

**청구항 2** 제1항에 있어서, 상기 초점 면은 두 개이고 상기 스테이지 속도를 유지하는 검사 방법.

**청구항 3** 제4항에 있어서, 상기 웨이퍼는 300 mm인 검사 방법.

## 참고문헌
- [R1] 스캔 메모
- [R2] 안 쓴 자료
"""


def test_check_flags_citations_numbers_and_claims(tmp_path, capsys):
    page = tmp_path / "index.md"
    page.write_text(PATENT + "\n외부 https://example.invalid/p 그리고 [R7]\n", encoding="utf-8")
    code, out = run(capsys, "check", str(page), "--kind", "patent")
    assert code == 0 and out["ok"] is False
    assert "배경기술" in out["missing_sections"]
    assert out["unused_refs"] == ["R2"]
    assert [u["line"] for u in out["unsourced_numbers"]] == [5]  # "18회" has no source; claims are skipped
    claims = out["claims"]
    assert claims["count"] == 3 and claims["independent"] == [1] and claims["dependent"] == [2, 3]
    assert any("제4항" in i for i in claims["issues"])
    assert any("상기 스테이지" in a for a in claims["antecedent"])
    assert not any("휨 지도" in a or "초점 면" in a for a in claims["antecedent"])
    # [R7] sits after the reference list, so it is not counted as a body citation
    assert out["undefined_citations"] == [] and out["external_links"] == ["https://example.invalid/p"]


def test_check_undefined_citation(tmp_path, capsys):
    page = tmp_path / "index.md"
    page.write_text("# t\n\n## 결과\n값은 3배 [R3]\n\n## 참고문헌\n- [R1] a\n", encoding="utf-8")
    code, out = run(capsys, "check", str(page))
    assert out["undefined_citations"] == ["R3"] and out["unused_refs"] == ["R1"] and "claims" not in out
