"""V-002: PowerPoint attachments (upload copy / local link), previews, and the guarded 'open in PowerPoint'."""
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import ppt_attach
from app.main import create_app
from scripts.make_sample_pptx import build_pptx, sample_slides

WIN_ONLY = pytest.mark.skipif(os.name != "nt", reason="link paths are Windows drive/UNC paths")


@pytest.fixture()
def env(tmp_path: Path):
    app = create_app(tmp_path / "p.db", tmp_path / "vault")
    opened: list[str] = []
    app.state.ppt_opener = opened.append  # never start a real PowerPoint in tests
    with TestClient(app, raise_server_exceptions=False, base_url="http://127.0.0.1:8765", client=("127.0.0.1", 50000)) as c:
        c.opened = opened
        c.tmp = tmp_path
        c.app = app
        c.page = c.post("/api/pages", json={"parent": "", "title": "보고"}).json()["path"]
        yield c


def deck(tmp_path: Path, name: str = "ext.pptx") -> Path:
    p = tmp_path / "outside" / name
    p.parent.mkdir(exist_ok=True)
    p.write_bytes(build_pptx(sample_slides()))
    return p


@WIN_ONLY
def test_upload_copies_into_page_files_with_hash_and_sidecar(env):
    data = build_pptx(sample_slides())
    r = env.post("/api/ppt/upload", params={"path": env.page, "name": "../주간 보고.pptx"}, content=data)
    assert r.status_code == 201
    item = r.json()
    assert item["mode"] == "upload" and item["name"] == "주간 보고.pptx" and item["size"] == len(data) and not item["missing"]
    page_dir = env.tmp / "vault" / env.page
    assert (page_dir / "files" / "주간 보고.pptx").read_bytes() == data
    side = json.loads((page_dir / "files" / f"ppt-{item['id']}.json").read_text(encoding="utf-8"))
    assert side["sha256"] == item["sha256"] and side["mode"] == "upload"
    assert env.get("/api/ppt", params={"path": env.page}).json()["items"][0]["id"] == item["id"]


@WIN_ONLY
def test_upload_rejects_bad_extension_empty_and_too_big(env, monkeypatch):
    assert env.post("/api/ppt/upload", params={"path": env.page, "name": "x.exe"}, content=b"abc").status_code == 400
    assert env.post("/api/ppt/upload", params={"path": env.page, "name": "x.pptx"}, content=b"").status_code == 400
    monkeypatch.setattr(ppt_attach, "MAX_BYTES", 10)
    r = env.post("/api/ppt/upload", params={"path": env.page, "name": "x.pptx"}, content=b"x" * 11)
    assert r.status_code == 400 and "링크" in r.json()["error"]
    assert env.post("/api/ppt/upload", params={"path": "nope", "name": "x.pptx"}, content=b"abc").status_code == 404


@WIN_ONLY
def test_link_never_copies_and_validates_path(env):
    p = deck(env.tmp)
    r = env.post("/api/ppt/link", params={"path": env.page}, json={"link": f'"{p}"'})
    assert r.status_code == 201 and r.json()["mode"] == "link" and r.json()["link"] == str(p)
    assert list((env.tmp / "vault" / env.page / "files").glob("*.pptx")) == []  # nothing copied
    for bad, code in [("relative/x.pptx", 400), ("", 400), (str(p.with_suffix(".txt")), 400),
                      (str(p.parent / "nope.pptx"), 404), (str(p.parent / ".." / "outside" / "ext.pptx"), 400), ("C:x.pptx", 400)]:
        assert env.post("/api/ppt/link", params={"path": env.page}, json={"link": bad}).status_code == code, bad
    assert env.post("/api/ppt/check-link", json={"link": str(p)}).json()["ok"] is True


@WIN_ONLY
def test_missing_and_changed_states_and_refresh(env):
    p = deck(env.tmp)
    item = env.post("/api/ppt/link", params={"path": env.page}, json={"link": str(p)}).json()
    p.write_bytes(build_pptx(sample_slides()[:2]))
    now = env.get("/api/ppt", params={"path": env.page}).json()["items"][0]
    assert now["changed"] and not now["missing"]
    out = env.post(f"/api/ppt/{item['id']}/refresh", params={"path": env.page}).json()
    assert out["refreshed"] is True and out["sha256"] != item["sha256"] and not out["changed"]
    assert env.post(f"/api/ppt/{item['id']}/refresh", params={"path": env.page}).json()["refreshed"] is False
    p.unlink()
    assert env.get("/api/ppt", params={"path": env.page}).json()["items"][0]["missing"] is True
    assert env.post(f"/api/ppt/{item['id']}/refresh", params={"path": env.page}).status_code == 404
    assert env.get(f"/api/ppt/{item['id']}/outline", params={"path": env.page}).status_code == 404


@WIN_ONLY
def test_outline_media_and_cache_follow_the_file_hash(env):
    p = deck(env.tmp)
    item = env.post("/api/ppt/link", params={"path": env.page}, json={"link": str(p)}).json()
    o = env.get(f"/api/ppt/{item['id']}/outline", params={"path": env.page}).json()
    assert [s["index"] for s in o["slides"]] == [1, 2, 3, 4] and o["slides"][0]["title"] == "Scratch near wafer edge"
    pic = o["slides"][0]["images"][0]
    m = env.get(f"/api/ppt/{item['id']}/media/{pic['key']}.{pic['ext']}", params={"path": env.page})
    assert m.status_code == 200 and m.content[:4] == b"\x89PNG"
    assert env.get(f"/api/ppt/{item['id']}/media/..%2f..%2fp.db", params={"path": env.page}).status_code in (400, 404)
    assert env.get(f"/api/ppt/{item['id']}/media/{'0' * 20}.png", params={"path": env.page}).status_code == 404
    # the deck is edited elsewhere: outline silently follows the new content
    p.write_bytes(build_pptx(sample_slides()[:1]))
    assert len(env.get(f"/api/ppt/{item['id']}/outline", params={"path": env.page}).json()["slides"]) == 1


@WIN_ONLY
def test_cover_uses_the_decks_own_thumbnail_or_is_empty(env):
    from io import BytesIO
    from zipfile import ZipFile
    from scripts.seed_doi_sample import png
    p = deck(env.tmp)
    item = env.post("/api/ppt/link", params={"path": env.page}, json={"link": str(p)}).json()
    assert env.get(f"/api/ppt/{item['id']}/cover", params={"path": env.page}).status_code == 204
    buf = BytesIO(p.read_bytes())
    with ZipFile(buf, "a") as z:
        z.writestr("docProps/thumbnail.png", png(32, 18, (10, 20, 30)))
    p.write_bytes(buf.getvalue())
    r = env.get(f"/api/ppt/{item['id']}/cover", params={"path": env.page})
    assert r.status_code == 200 and r.content[1:4] == b"PNG"


@WIN_ONLY
def test_old_ppt_format_has_reason_not_error(env):
    folder = env.tmp / "outside"
    folder.mkdir()
    old = folder / "old.ppt"
    old.write_bytes(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"0" * 50)
    item = env.post("/api/ppt/link", params={"path": env.page}, json={"link": str(old)}).json()
    o = env.get(f"/api/ppt/{item['id']}/outline", params={"path": env.page}).json()
    assert o["slides"] == [] and ".pptx" in o["reason"] and o["readable"] is False


@WIN_ONLY
def test_prerendered_slide_pictures_next_to_a_linked_deck(env):
    p = deck(env.tmp)
    folder = p.with_suffix("")
    folder.mkdir()
    (folder / "Slide2.PNG").write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 20)
    item = env.post("/api/ppt/link", params={"path": env.page}, json={"link": str(p)}).json()
    assert item["rendered"] is True
    o = env.get(f"/api/ppt/{item['id']}/outline", params={"path": env.page}).json()
    assert [s["rendered"] for s in o["slides"]] == [False, True, False, False]
    assert env.get(f"/api/ppt/{item['id']}/slide/2", params={"path": env.page}).status_code == 200
    assert env.get(f"/api/ppt/{item['id']}/slide/1", params={"path": env.page}).status_code == 404


@WIN_ONLY
def test_open_needs_confirm_whitelist_and_local_client(env):
    p = deck(env.tmp)
    item = env.post("/api/ppt/link", params={"path": env.page}, json={"link": str(p)}).json()
    url = f"/api/ppt/{item['id']}/open"
    assert env.post(url, params={"path": env.page}, json={}).status_code == 400 and env.opened == []
    ok = env.post(url, params={"path": env.page}, json={"confirm": True})
    assert ok.status_code == 200 and env.opened == [str(p)]
    # remote client / foreign Host / foreign Origin are refused
    remote = TestClient(env.app, client=("192.168.0.9", 1), base_url="http://127.0.0.1:8765")
    assert remote.post(url, params={"path": env.page}, json={"confirm": True}).status_code == 403
    assert env.post(url, params={"path": env.page}, json={"confirm": True}, headers={"host": "evil.example"}).status_code == 403
    assert env.post(url, params={"path": env.page}, json={"confirm": True}, headers={"origin": "http://evil.example"}).status_code == 403
    assert len(env.opened) == 1
    # a hand-edited sidecar cannot point the opener at another kind of file or a non-absolute path
    side = env.tmp / "vault" / env.page / "files" / f"ppt-{item['id']}.json"
    rec = json.loads(side.read_text(encoding="utf-8"))
    for bad in (str(p.with_suffix(".exe")), "calc.pptx", "C:\\Windows\\System32\\cmd.exe"):
        rec["link"] = bad
        side.write_text(json.dumps(rec), encoding="utf-8")
        assert env.post(url, params={"path": env.page}, json={"confirm": True}).status_code in (400, 403, 404)
    assert len(env.opened) == 1


@WIN_ONLY
def test_upload_open_stays_inside_vault(env):
    item = env.post("/api/ppt/upload", params={"path": env.page, "name": "a.pptx"}, content=build_pptx(sample_slides())).json()
    side = env.tmp / "vault" / env.page / "files" / f"ppt-{item['id']}.json"
    rec = json.loads(side.read_text(encoding="utf-8"))
    rec["file"] = "../../../p.db"
    side.write_text(json.dumps(rec), encoding="utf-8")
    r = env.post(f"/api/ppt/{item['id']}/open", params={"path": env.page}, json={"confirm": True})
    assert r.status_code in (400, 403) and env.opened == []


@WIN_ONLY
def test_remove_trashes_upload_but_never_the_linked_file(env):
    p = deck(env.tmp)
    link = env.post("/api/ppt/link", params={"path": env.page}, json={"link": str(p)}).json()
    up = env.post("/api/ppt/upload", params={"path": env.page, "name": "a.pptx"}, content=build_pptx(sample_slides())).json()
    assert env.delete(f"/api/ppt/{link['id']}", params={"path": env.page}).status_code == 200
    assert p.is_file()
    assert env.delete(f"/api/ppt/{up['id']}", params={"path": env.page}).status_code == 200
    page_dir = env.tmp / "vault" / env.page
    assert not (page_dir / "files" / "a.pptx").exists()
    assert list((env.tmp / "vault" / ".trash").glob("*_ppt-*/a.pptx"))
    assert env.get("/api/ppt", params={"path": env.page}).json()["items"] == []


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_ppt_model_cases():
    """Pure UI logic: link/upload validation, state chips, slide navigation (web/test/run_ppt.mjs)."""
    root = Path(__file__).resolve().parent.parent
    res = subprocess.run(["node", str(root / "web" / "test" / "run_ppt.mjs")],
                         capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, res.stdout + res.stderr
