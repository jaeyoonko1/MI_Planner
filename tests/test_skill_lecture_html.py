"""P7-07: lecture-html skill helper + offline templates, run against a temp vault with fake data only."""
import importlib.util
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.vault import Vault

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / "skills" / "lecture-html"
EXAMPLE = SKILL / "examples" / "optics_resolution.html"
LECTURE_T = SKILL / "templates" / "lecture.html"
ROADMAP_T = SKILL / "templates" / "roadmap.html"

_spec = importlib.util.spec_from_file_location("lecture_html", SKILL / "scripts" / "lecture_html.py")
lh = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lh)


def run(capsys, *argv: str):
    code = lh.main(list(argv))
    return code, json.loads(capsys.readouterr().out)


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    root = tmp_path / "vault"
    Vault(root).create("", "스터디")
    return root


def test_shipped_files_are_offline_and_well_formed(capsys):
    code, ex = run(capsys, "check", str(EXAMPLE))
    assert code == 0 and ex["ok"] is True and ex["kind"] == "lecture", ex
    assert ex["stats"]["widgets"] == 3 and ex["stats"]["quizzes"] == 3 and ex["stats"]["equations"] > 5
    code, lec = run(capsys, "check", str(LECTURE_T))
    assert lec["errors"] == [] and lec["placeholders"]["count"] > 0  # template: only [확인 필요]/{{X}} left
    code, rm = run(capsys, "check", str(ROADMAP_T))
    assert rm["errors"] == [] and rm["warnings"] == [] and rm["kind"] == "roadmap"
    assert rm["stats"]["modules"] >= 30 and rm["stats"]["tracks"] == 7
    # the shared runtime must be identical in the template and the example (copy, never fork)
    assert lh.RUNTIME_RE.search(EXAMPLE.read_text(encoding="utf-8")).group(0) == \
        lh.RUNTIME_RE.search(LECTURE_T.read_text(encoding="utf-8")).group(0)
    for f in (EXAMPLE, LECTURE_T, ROADMAP_T):
        text = f.read_text(encoding="utf-8")
        assert not re.search(r"https?://(?!www\.w3\.org/2000/svg)", text), f  # only the SVG namespace string
        assert "LOT-" not in text or "LOT-TEST-001" in text


def test_roadmap_curriculum_covers_spec_subjects():
    data = lh.read_roadmap(ROADMAP_T.read_text(encoding="utf-8"))
    names = " ".join(t["name"] for t in data["tracks"])
    for subject in ("광학", "고체물리", "빛-물질", "선형대수", "AI", "영상처리"):
        assert subject in names
    assert lh.validate_roadmap(data) == []
    assert lh.read_roadmap("<script type=\"application/json\" id=\"roadmap-data\">" + lh.dump_roadmap(data) + "</script>") == data


def test_validate_roadmap_detects_problems():
    data = {"tracks": [{"id": "A", "name": "a", "color": "teal"}], "modules": [
        {"id": "A1", "track": "A", "title": "x", "level": "기초", "hours": 1, "prereq": ["A2"]},
        {"id": "A2", "track": "A", "title": "y", "level": "기초", "hours": 1, "prereq": ["A1"]},
        {"id": "A3", "track": "B", "title": "z", "level": "박사", "hours": 0, "prereq": ["NOPE"]},
        {"id": "A3", "track": "A", "title": "dup", "level": "기초", "hours": 1},
    ]}
    errs = "\n".join(lh.validate_roadmap(data))
    for needle in ("color", "순환", "없는 트랙", "level", "hours", "NOPE", "겹칩니다"):
        assert needle in errs, needle


def test_check_flags_sandbox_and_network_problems(tmp_path, capsys):
    head = LECTURE_T.read_text(encoding="utf-8").split("<body>")[0].replace("{{TITLE}}", "t").replace("{{MODULE}}", "X1")
    bad = head + """<body><main class="lx"><section class="lx-goals"><h2>목표</h2></section>
<section class="lx-sec" id="a"><h2>a</h2><img src="files/plot.png"><select><option>1</option></select>
<figure class="lx-widget" data-widget="ghost"></figure>
<div class="lx-quiz" data-id="q1" data-answer="z"><p class="q">?</p><ol><li data-key="a">a</li></ol><div class="lx-why">w</div></div>
</section></main>
<script src="https://cdn.example.invalid/lib.js"></script>
<script>alert("hi"); fetch("data.json"); localStorage.setItem("k", "v");</script></body></html>"""
    f = tmp_path / "bad.html"
    f.write_text(bad, encoding="utf-8")
    code, out = run(capsys, "check", str(f))
    errs, warns = "\n".join(out["errors"]), "\n".join(out["warnings"])
    assert out["ok"] is False
    for needle in ("외부 요청", "script src", "img/video", "alert", "fetch", "ghost", "q1"):
        assert needle in errs, needle
    assert "D-12" in warns and "localStorage" in warns
    # --apply refuses a file with blocking errors
    code, err = run(capsys, "--vault", str(tmp_path / "v"), "new", "--kind", "lecture", "--title", "x",
                    "--from", str(f), "--parent", "", "--apply")
    assert code == 1 and "check 오류" in err["error"]


def test_new_dry_run_then_apply_creates_html_pages_only(vault, capsys):
    args = ["--vault", str(vault), "new", "--kind", "lecture", "--title", "결상 이론", "--subject", "광학",
            "--module", "OPT5", "--parent", "스터디/광학"]
    code, dry = run(capsys, *args)
    assert code == 0 and dry["applied"] is False and dry["would_create"] == "스터디/광학/결상 이론"
    assert not (vault / "스터디" / "광학").exists()
    code, err = run(capsys, *args, "--apply")
    assert code == 1 and "--make-parent" in err["error"]
    code, first = run(capsys, *args, "--apply", "--make-parent")
    code, second = run(capsys, *args, "--apply")
    assert first["path"] == "스터디/광학/결상 이론" and second["path"] == "스터디/광학/결상 이론 (2)"
    v = Vault(vault)
    page = v.read(first["path"])
    assert page["meta"]["type"] == "html"
    assert page["meta"]["skill"] == "lecture-html" and page["meta"]["module"] == "OPT5"
    assert "<title>결상 이론</title>" in page["content"] and "{{" not in page["content"]
    assert v.read("스터디/광학")["meta"]["type"] == "note"  # --make-parent made a plain note
    code, chk = run(capsys, "check", first["file"])
    assert chk["errors"] == [] and chk["placeholders"]["count"] > 0
    code, rm = run(capsys, "--vault", str(vault), "new", "--kind", "roadmap", "--apply")
    assert code == 0 and rm["path"] == "스터디/스터디 로드맵" and rm["meta"]["doc_kind"] == "roadmap"


def test_sync_links_lectures_into_roadmap_with_backup(vault, capsys):
    run(capsys, "--vault", str(vault), "new", "--kind", "roadmap", "--apply")
    code, lec = run(capsys, "--vault", str(vault), "new", "--kind", "lecture", "--title", "회절 한계와 분해능",
                    "--from", str(EXAMPLE), "--parent", "스터디/광학", "--make-parent", "--apply")
    assert code == 0 and lec["meta"]["module"] == "OPT5"  # read from <meta name="mi-module">
    rm_file = vault / "스터디" / "스터디 로드맵" / "index.html"
    before = rm_file.read_text(encoding="utf-8")
    code, dry = run(capsys, "--vault", str(vault), "sync", str(rm_file))
    assert dry["changed"] == [{"module": "OPT5", "from": "", "to": "스터디/광학/회절 한계와 분해능"}]
    assert rm_file.read_text(encoding="utf-8") == before
    code, done = run(capsys, "--vault", str(vault), "sync", str(rm_file), "--apply")
    after = rm_file.read_text(encoding="utf-8")
    assert done["applied"] and Path(done["backup"]).read_text(encoding="utf-8") == before
    assert lh.DATA_RE.sub("", after) == lh.DATA_RE.sub("", before)  # only the data block changed
    mods = {m["id"]: m for m in lh.read_roadmap(after)["modules"]}
    assert mods["OPT5"]["page"] == "스터디/광학/회절 한계와 분해능"
    code, again = run(capsys, "--vault", str(vault), "sync", str(rm_file))
    assert again["changed"] == []
    lec_dir = vault / "스터디" / "광학" / "회절 한계와 분해능"
    shutil.copytree(lec_dir, vault / "옮긴 강의")  # a moved page is followed ...
    shutil.rmtree(lec_dir)
    code, moved = run(capsys, "--vault", str(vault), "sync", str(rm_file))
    assert moved["changed"][0]["to"] == "옮긴 강의"
    (vault / ".trash").mkdir(exist_ok=True)
    shutil.move(str(vault / "옮긴 강의"), str(vault / ".trash" / "x"))  # ... a trashed one is dropped
    code, gone = run(capsys, "--vault", str(vault), "sync", str(rm_file), "--apply")
    assert gone["missing_pages"][0]["module"] == "OPT5"
    assert {m["id"]: m for m in lh.read_roadmap(rm_file.read_text(encoding="utf-8"))["modules"]}["OPT5"]["page"] == ""
    code, mods_out = run(capsys, "modules")
    assert any(m["id"] == "OPT5" for m in mods_out["modules"])


def test_created_page_is_served_by_app_without_external_refs(vault, tmp_path, capsys):
    run(capsys, "--vault", str(vault), "new", "--kind", "lecture", "--title", "예시", "--from", str(EXAMPLE), "--apply")
    with TestClient(create_app(tmp_path / "t.db", vault)) as c:
        page = c.get("/api/pages", params={"path": "스터디/예시"}).json()
        assert page["meta"]["type"] == "html" and "MI.widget" in page["content"]
        assert c.get("/api/pages/external-refs", params={"path": "스터디/예시"}).json()["external"] == []
        r = c.put("/api/pages/state", params={"path": "스터디/예시"}, json={"state": {"done": {"psf": True}, "quiz": {"q1": "b"}}})
        assert r.status_code == 200


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_inline_scripts_parse(tmp_path):
    for f in (EXAMPLE, LECTURE_T, ROADMAP_T):
        for i, src in enumerate(re.findall(r"<script>(.*?)</script>", f.read_text(encoding="utf-8"), re.S)):
            js = tmp_path / f"{f.stem}-{i}.js"
            js.write_text(src, encoding="utf-8")
            r = subprocess.run(["node", "--check", str(js)], capture_output=True, text=True)
            assert r.returncode == 0, (f.name, i, r.stderr)
