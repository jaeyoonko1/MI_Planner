"""P2B-10: the issue memo and the issue page body are one text; images follow; diverged old data is merged safely."""
import json
import sqlite3
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import memo
from app.main import create_app

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 16


@pytest.fixture()
def env(tmp_path: Path):
    app = create_app(tmp_path / "t.db", tmp_path / "vault")
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c, tmp_path


def issue(c, title="이슈", **extra) -> dict:
    r = c.post("/api/todos", json={"title": title, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def expand(c, tid: int) -> str:
    r = c.post(f"/api/todos/{tid}/page", json={})
    assert r.status_code == 200, r.text
    return r.json()["path"]


def page_text(vault: Path, rel: str) -> str:
    return (vault / rel / "index.md").read_text(encoding="utf-8")


def meta(vault: Path, rel: str) -> dict:
    return json.loads((vault / rel / "_page.json").read_text(encoding="utf-8"))


# ---- one text -----------------------------------------------------------------------------

def test_memo_edit_in_detail_changes_page_body(env) -> None:
    c, tmp = env
    t = issue(c, note="처음")
    rel = expand(c, t["id"])
    assert page_text(tmp / "vault", rel) == "처음"
    r = c.patch(f"/api/todos/{t['id']}", json={"note": "## 제목\n\n본문 **굵게**\n"})
    assert r.status_code == 200
    assert page_text(tmp / "vault", rel) == "## 제목\n\n본문 **굵게**\n"
    assert c.get(f"/api/todos/{t['id']}").json()["note"] == "## 제목\n\n본문 **굵게**\n"


def test_page_edit_changes_memo(env) -> None:
    c, tmp = env
    t = issue(c, note="처음")
    rel = expand(c, t["id"])
    assert c.put("/api/pages", params={"path": rel}, json={"content": "페이지에서 고침\n"}).status_code == 200
    got = c.get(f"/api/todos/{t['id']}").json()
    assert got["note"] == "페이지에서 고침\n"
    # the mirror used by search / copy is current too
    assert c.get("/api/todos", params={"q": "페이지에서"}).json()["items"][0]["id"] == t["id"]


def test_clearing_memo_clears_body_and_mirror(env) -> None:
    c, tmp = env
    t = issue(c, note="지울 메모")
    rel = expand(c, t["id"])
    c.patch(f"/api/todos/{t['id']}", json={"note": None})
    assert page_text(tmp / "vault", rel) == ""
    assert c.get(f"/api/todos/{t['id']}").json()["note"] is None


def test_issue_without_page_keeps_memo_in_db(env) -> None:
    c, tmp = env
    t = issue(c)
    c.patch(f"/api/todos/{t['id']}", json={"note": "페이지 없음"})
    assert c.get(f"/api/todos/{t['id']}").json()["note"] == "페이지 없음"
    assert not list((tmp / "vault").rglob("_page.json"))


def test_new_page_is_stamped_unified_and_survives_moves(env) -> None:
    c, tmp = env
    t = issue(c, note="x")
    rel = expand(c, t["id"])
    assert meta(tmp / "vault", rel).get(memo.FLAG)
    c.post("/api/pages", json={"title": "다른 곳"})
    moved = c.patch("/api/pages", params={"path": rel}, json={"parent": "다른 곳"}).json()["path"]
    c.patch(f"/api/todos/{t['id']}", json={"note": "이동 후 편집"})
    assert page_text(tmp / "vault", moved) == "이동 후 편집"


def test_externally_edited_file_wins_on_next_read(env) -> None:
    c, tmp = env
    t = issue(c, note="앱")
    rel = expand(c, t["id"])
    (tmp / "vault" / rel / "index.md").write_text("파일을 직접 고침", encoding="utf-8")
    assert c.get(f"/api/todos/{t['id']}").json()["note"] == "파일을 직접 고침"
    assert c.get("/api/todos", params={"q": "직접"}).json()["items"]


def test_stale_page_save_preserves_cli_table_edit(env) -> None:
    c, tmp = env
    rel = c.post("/api/pages", json={"title": "테스트 표"}).json()["path"]
    params = {"path": rel}
    table = "| Lot | 값 |\r\n| --- | --- |\r\n| LOT-TEST-001 | 3 |\r\n"
    c.put("/api/pages", params=params, json={"content": table}).raise_for_status()
    revision = c.get("/api/pages", params=params).json()["content_revision"]
    path = tmp / "vault" / rel / "index.md"
    raw = tmp / "raw.tsv"
    raw.write_text("lot\tvalue\nLOT-TEST-001\t4\n", encoding="utf-8")
    script = Path(__file__).resolve().parents[1] / "skills/fill-table/scripts/fill_table.py"
    applied = subprocess.run([
        sys.executable, str(script), "--vault", str(tmp / "vault"), "md", str(path),
        "--raw", str(raw), "--key", "Lot=lot", "--map", "값=value", "--overwrite", "--apply",
    ], capture_output=True, encoding="utf-8", check=True, cwd=tmp, timeout=10)
    assert json.loads(applied.stdout)["applied"]
    current = table.replace(" | 3 |", " | 4 |")

    result = c.put("/api/pages", params=params, json={"content": table + "초안", "content_revision": revision})
    assert result.status_code == 409 and "error" in result.json()
    assert path.read_bytes() == current.encode("utf-8")

    fresh = c.get("/api/pages", params=params).json()
    result = c.put("/api/pages", params=params, json={
        "content": fresh["content"] + "초안", "content_revision": fresh["content_revision"],
    }).raise_for_status().json()
    assert result["content"] == current + "초안"
    assert result["content_revision"] != fresh["content_revision"]


def test_linked_page_and_memo_cannot_both_save_same_revision(env) -> None:
    c, tmp = env
    tid = issue(c, note="처음")["id"]
    url = f"/api/todos/{tid}"
    rel = expand(c, tid)
    params = {"path": rel}
    revision = c.get("/api/pages", params=params).json()["content_revision"]
    assert c.get(url).json()["note_revision"] == revision

    with ThreadPoolExecutor(max_workers=2) as pool:
        page = pool.submit(c.put, "/api/pages", params=params,
                           json={"content": "페이지 편집", "content_revision": revision})
        memo_edit = pool.submit(c.patch, url, json={"note": "메모 편집", "note_revision": revision})
        page_result, memo_result = page.result(), memo_edit.result()
    assert sorted([page_result.status_code, memo_result.status_code]) == [200, 409]
    expected = "페이지 편집" if page_result.is_success else "메모 편집"
    assert page_text(tmp / "vault", rel) == expected
    with sqlite3.connect(tmp / "t.db") as db:
        assert db.execute("SELECT note FROM tasks WHERE id = ?", (tid,)).fetchone() == (expected,)


def test_standalone_memo_rejects_stale_clear_and_preserves_other_fields(env) -> None:
    c, _ = env
    url = f"/api/todos/{issue(c, note='처음')['id']}"
    initial = c.get(url).json()["note_revision"]
    changed = c.patch(url, json={"note": "새 메모", "note_revision": initial}).raise_for_status().json()
    assert changed["note_revision"] != initial
    stale = c.patch(url, json={"title": "오래된 제목", "note": None, "note_revision": initial})
    assert stale.status_code == 409
    assert c.get(url).json()["note"] == "새 메모"
    assert c.get(url).json()["title"] == "이슈"
    assert c.patch(url, json={"title": "새 제목"}).raise_for_status().json()["title"] == "새 제목"


# ---- diverged old data (P2B-09 era: copied once, then independent) ---------------------------

def legacy(c, tmp: Path, note: str, body: str) -> tuple[int, str]:
    t = issue(c, note=note)
    rel = expand(c, t["id"])
    # emulate P2B-09 data: no unification stamp, body edited on its own
    mp = tmp / "vault" / rel / "_page.json"
    m = json.loads(mp.read_text(encoding="utf-8"))
    m.pop(memo.FLAG)
    mp.write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")
    (tmp / "vault" / rel / "index.md").write_text(body, encoding="utf-8")
    return t["id"], rel


def test_diverged_memo_and_body_merge_without_loss(env) -> None:
    c, tmp = env
    tid, rel = legacy(c, tmp, "옛 메모 내용", "페이지에서만 쓴 내용\n")
    got = c.get(f"/api/todos/{tid}").json()
    assert got["memo_merged"] is True
    assert "페이지에서만 쓴 내용" in got["note"] and "옛 메모 내용" in got["note"]
    assert page_text(tmp / "vault", rel) == got["note"]
    m = meta(tmp / "vault", rel)
    assert m[memo.BACKUP] == "옛 메모 내용" and m[memo.FLAG]
    # second read: stable, no second merge
    again = c.get(f"/api/todos/{tid}").json()
    assert again["memo_merged"] is False and again["note"] == got["note"]


def test_merge_not_needed_when_one_side_empty_or_contained(env) -> None:
    assert memo.merge_texts("본문 전체", "") == ("본문 전체", False)
    assert memo.merge_texts("", "메모") == ("메모", False)
    assert memo.merge_texts("가나다 라마", "라마") == ("가나다 라마", False)
    assert memo.merge_texts("같음\n", "같음") == ("같음\n", False)
    text, merged = memo.merge_texts("A", "B")
    assert merged and text.startswith("A") and "B" in text and memo.MERGE_HEADING in text


def test_legacy_mirror_line_endings_do_not_duplicate_memo(env) -> None:
    c, tmp = env
    body = "# 제목\r\n\r\n본문\r\n"
    tid, rel = legacy(c, tmp, "# 제목\n\n본문\n", "")
    (tmp / "vault" / rel / "index.md").write_bytes(body.encode("utf-8"))
    result = c.get(f"/api/todos/{tid}")
    assert result.json()["note"] == body
    assert not result.json()["memo_merged"]


def test_open_page_of_legacy_pair_unifies_before_editing(env) -> None:
    c, tmp = env
    tid, rel = legacy(c, tmp, "남겨야 할 메모", "본문")
    page = c.get("/api/pages", params={"path": rel}).json()
    assert "남겨야 할 메모" in page["content"]  # the editor loads the merged text, so saving it loses nothing
    c.put("/api/pages", params={"path": rel}, json={"content": page["content"] + "\n추가"})
    assert "남겨야 할 메모" in c.get(f"/api/todos/{tid}").json()["note"]


def test_patch_on_legacy_pair_keeps_old_texts_in_backup(env) -> None:
    c, tmp = env
    tid, rel = legacy(c, tmp, "옛 메모", "옛 본문")
    c.patch(f"/api/todos/{tid}", json={"note": "새 글"})
    assert page_text(tmp / "vault", rel) == "새 글"
    assert meta(tmp / "vault", rel)[memo.BACKUP] == "옛 메모"


def test_startup_sweep_merges_existing_pairs(tmp_path: Path) -> None:
    app = create_app(tmp_path / "t.db", tmp_path / "vault")
    with TestClient(app) as c:
        tid, rel = legacy(c, tmp_path, "m", "b")
    with TestClient(create_app(tmp_path / "t.db", tmp_path / "vault")) as c2:  # restart
        assert meta(tmp_path / "vault", rel).get(memo.FLAG)
        note = c2.get(f"/api/todos/{tid}").json()["note"]
        assert "b" in note and "m" in note


# ---- images -----------------------------------------------------------------------------------

def test_image_for_pageless_issue_moves_into_page_on_expand(env) -> None:
    c, tmp = env
    vault = tmp / "vault"
    t = issue(c)
    r = c.post(f"/api/todos/{t['id']}/files", params={"name": "image.png"}, content=PNG)
    assert r.status_code == 200
    ref = r.json()["file"]
    url = r.json()["url"]
    assert ref.startswith("files/img-") and c.get(url).content == PNG
    c.patch(f"/api/todos/{t['id']}", json={"note": f"![]({ref}){{width=480}}\n"})
    assert (vault / ".issue-files" / str(t["id"]) / ref.split("/")[1]).is_file()
    rel = expand(c, t["id"])
    assert (vault / rel / ref).read_bytes() == PNG  # same ref still valid inside the page
    assert not (vault / ".issue-files" / str(t["id"])).exists()
    assert c.get(url).content == PNG  # the issue URL keeps working after the move
    assert f"![]({ref}){{width=480}}" in page_text(vault, rel)


def test_image_for_issue_with_page_goes_to_page_files(env) -> None:
    c, tmp = env
    t = issue(c)
    rel = expand(c, t["id"])
    ref = c.post(f"/api/todos/{t['id']}/files", params={"name": "a.png"}, content=PNG).json()["file"]
    assert (tmp / "vault" / rel / ref).is_file()
    # and the page's own image API serves the same file
    assert c.get("/api/pages/file", params={"path": rel, "name": ref.split("/")[1]}).content == PNG


def test_image_upload_rejects_bad_input_and_traversal(env) -> None:
    c, _ = env
    t = issue(c)
    assert c.post(f"/api/todos/{t['id']}/files", params={"name": "x.svg"}, content=PNG).status_code == 400
    assert c.post(f"/api/todos/{t['id']}/files", params={"name": "x.png"}, content=b"").status_code == 400
    assert c.get(f"/api/todos/{t['id']}/file", params={"name": "../x.png"}).status_code == 400
    assert c.get(f"/api/todos/{t['id']}/file", params={"name": "nope.png"}).status_code == 404
    assert c.post("/api/todos/9999/files", params={"name": "x.png"}, content=PNG).status_code == 404


def test_images_and_memo_survive_restart(tmp_path: Path) -> None:
    with TestClient(create_app(tmp_path / "t.db", tmp_path / "vault")) as c:
        t = issue(c)
        ref = c.post(f"/api/todos/{t['id']}/files", params={"name": "a.png"}, content=PNG).json()["file"]
        c.patch(f"/api/todos/{t['id']}", json={"note": f"본문\n\n![]({ref}){{size=small}}\n"})
    with TestClient(create_app(tmp_path / "t.db", tmp_path / "vault")) as c:
        got = c.get(f"/api/todos/{t['id']}").json()
        assert f"![]({ref}){{size=small}}" in got["note"]
        assert c.get(f"/api/todos/{t['id']}/file", params={"name": ref.split("/")[1]}).content == PNG


def test_copied_issue_gets_its_own_images(env) -> None:
    c, tmp = env
    t = issue(c)
    ref = c.post(f"/api/todos/{t['id']}/files", params={"name": "a.png"}, content=PNG).json()["file"]
    c.patch(f"/api/todos/{t['id']}", json={"note": f"![]({ref})"})
    res = c.post("/api/structure/copy", json={"kind": "issue", "task_id": t["id"]})
    assert res.status_code == 201, res.text
    new = res.json()["created"][0]
    assert c.get(f"/api/todos/{new}/file", params={"name": ref.split("/")[1]}).content == PNG
    assert c.get(f"/api/todos/{new}").json()["note"] == f"![]({ref})"


# ---- fold state is not in the file ---------------------------------------------------------------

def test_fold_state_is_a_setting_not_file_content(env) -> None:
    c, tmp = env
    t = issue(c, note="## 접을 제목\n\n본문")
    rel = expand(c, t["id"])
    folds = json.dumps({f"t:{t['id']}": ["h2|접을 제목|0"]}, ensure_ascii=False)
    assert c.put("/api/settings/memo_folds", json={"value": folds}).status_code == 200
    assert c.get("/api/settings").json()["settings"]["memo_folds"] == folds
    assert page_text(tmp / "vault", rel) == "## 접을 제목\n\n본문"  # raw text untouched
    assert "fold" not in json.dumps(meta(tmp / "vault", rel))
    assert c.put("/api/settings/memo_folds", json={"value": "[1]"}).status_code == 400
    assert c.put("/api/settings/memo_folds", json={"value": "nope"}).status_code == 400


def test_rejected_patch_leaves_page_issue_and_revision_untouched(env) -> None:
    """A PATCH that fails (unknown level, stale revision) must not change the page body, the memo or the revision."""
    c, tmp = env
    tid = issue(c, note="처음")["id"]
    url = f"/api/todos/{tid}"
    rel = expand(c, tid)
    revision = c.get(url).json()["note_revision"]
    before_task = c.get(url).json()

    bad = c.patch(url, json={"note": "새 본문", "note_revision": revision, "level_id": 999999})
    assert bad.status_code in (400, 404) and "error" in bad.json()
    assert page_text(tmp / "vault", rel) == "처음"
    assert c.get(url).json() == before_task
    with sqlite3.connect(tmp / "t.db") as db:
        assert db.execute("SELECT note FROM tasks WHERE id = ?", (tid,)).fetchone() == ("처음",)

    stale = c.patch(url, json={"note": "충돌", "note_revision": "stale", "title": "바뀜"})
    assert stale.status_code == 409
    assert page_text(tmp / "vault", rel) == "처음"
    assert c.get(url).json() == before_task

    ok = c.patch(url, json={"note": "새 본문", "note_revision": revision, "title": "바뀜"})
    assert ok.status_code == 200 and ok.json()["note"] == "새 본문"
    assert page_text(tmp / "vault", rel) == "새 본문"
    assert ok.json()["note_revision"] != revision
