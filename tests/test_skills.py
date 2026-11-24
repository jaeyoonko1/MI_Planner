import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("check_skills", ROOT / "scripts" / "check_skills.py")
cs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cs)


def _mk(root: Path, name: str, text: str) -> None:
    (root / name).mkdir(parents=True)
    (root / name / "SKILL.md").write_text(text, encoding="utf-8")


def test_repo_skills_pass():
    assert cs.check_all(ROOT / "skills") == []
    assert (ROOT / "skills" / "skill-maker" / "SKILL.md").is_file()


def test_valid_skill(tmp_path):
    _mk(tmp_path, "demo-skill", "---\nname: demo-skill\ndescription: EQ-A01 데모 스킬입니다\n---\n# 본문\n")
    assert cs.check_all(tmp_path) == []


def test_detects_problems(tmp_path):
    _mk(tmp_path, "a", "no frontmatter")
    _mk(tmp_path, "b", "---\nname: other\ndescription: 충분히 긴 설명입니다\n---\n본문\n")
    _mk(tmp_path, "c", "---\nname: c\ndescription: 충분히 긴 설명입니다\n---\nsee https://example.com\n")
    _mk(tmp_path, "d", "---\nname: d\ndescription: x\n---\n본문\n")
    (tmp_path / "e").mkdir()
    errs = "\n".join(cs.check_all(tmp_path))
    for n in "abcde":
        assert f"{n}:" in errs
