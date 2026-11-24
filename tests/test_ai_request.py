"""P7-03: 'AI에게 요청' — skills listing API and request-text builder (web/test/run_ai_request.mjs)."""
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import skills_index
from app.main import create_app

ROOT = Path(__file__).resolve().parent.parent


def _client(tmp_path: Path, skills_dir: Path) -> TestClient:
    app = create_app(tmp_path / "t.db", tmp_path / "vault")
    app.state.skills_dir = skills_dir
    return TestClient(app)


def test_skills_endpoint_lists_valid_skills_only(tmp_path):
    sd = tmp_path / "skills"
    (sd / "demo-skill").mkdir(parents=True)
    (sd / "demo-skill" / "SKILL.md").write_text("---\nname: demo-skill\ndescription: EQ-A01 데모\n---\n본문\n", encoding="utf-8")
    (sd / "broken").mkdir()
    (sd / "broken" / "SKILL.md").write_text("no frontmatter", encoding="utf-8")
    (sd / "empty").mkdir()
    with _client(tmp_path, sd) as c:
        res = c.get("/api/skills")
    assert res.status_code == 200
    assert res.json() == {"skills": [{"name": "demo-skill", "description": "EQ-A01 데모"}]}


def test_skills_endpoint_missing_dir(tmp_path):
    with _client(tmp_path, tmp_path / "nope") as c:
        assert c.get("/api/skills").json() == {"skills": []}


def test_repo_skills_listed():
    names = [s["name"] for s in skills_index.list_skills()]
    assert "skill-maker" in names


def test_ui_wiring_present():
    html = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    assert 'id="btn-ai"' in html and "ai-request.css" in html
    assert "mountAiRequest" in (ROOT / "web" / "js" / "main.js").read_text(encoding="utf-8")


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_request_builder_cases():
    res = subprocess.run(
        ["node", str(ROOT / "web" / "test" / "run_ai_request.mjs")],
        capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    assert res.returncode == 0, res.stdout + res.stderr
