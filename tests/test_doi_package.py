"""P5-04: DOI share package export/import (round trip between two instances, integrity and malicious zips, rollback)."""
import hashlib
import io
import json
import stat
import warnings
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import doi_package as pkg
from app.main import create_app
from scripts.seed_doi_sample import png


def make_instance(base: Path, name: str) -> TestClient:
    folder = base / name
    folder.mkdir()
    c = TestClient(create_app(folder / "p.db", folder / "vault"), raise_server_exceptions=False)
    c.__enter__()
    c.root = folder / "doi"
    c.db_path = folder / "p.db"
    return c


@pytest.fixture()
def pair(tmp_path: Path):
    a, b = make_instance(tmp_path, "a"), make_instance(tmp_path, "b")
    yield a, b
    a.__exit__(None, None, None)
    b.__exit__(None, None, None)


def make(c, title="Scratch on LOT-TEST-001", images=2, **kw):
    d = c.post("/api/doi", json={"title": title, "product": "PROD-TEST-A", "plan": "PLAN-A1", "step": "S0010",
                                 "defect_type": "Scratch", "tags": ["scratch"], "source_dept": "MI-A", **kw}).json()
    for n in range(images):
        r = c.post(f"/api/doi/{d['id']}/images", params={"width": 6, "height": 5, "caption": f"cap{n}"}, content=png(6, 5, (200, 60 + n * 40, 80)))
        assert r.status_code == 200, r.text
    return c.get(f"/api/doi/{d['id']}").json()


def export(c, ids, **kw):
    r = c.post("/api/doi-package/export", json={"ids": ids, **kw})
    assert r.status_code == 200, r.text
    return r.content


def preview(c, data: bytes):
    return c.post("/api/doi-package/preview", params={"name": "p.zip"}, content=data)


def apply(c, token, decisions=None):
    return c.post(f"/api/doi-package/{token}/apply", json={"decisions": decisions or {}})


def rebuild(data: bytes, edit) -> bytes:
    """Unpack a package, let `edit(files: dict, manifest: dict)` change it, and zip it again."""
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        files = {n: zf.read(n) for n in zf.namelist()}
    manifest = json.loads(files["manifest.json"])
    edit(files, manifest)
    files["manifest.json"] = json.dumps(manifest).encode()
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as zf:
        for n, b in files.items():
            zf.writestr(n, b)
    return out.getvalue()


def stage_dirs(c) -> list:
    root = c.root / ".package"
    return [p for p in root.iterdir()] if root.is_dir() else []


def library(c) -> list:
    return c.get("/api/doi").json()["items"]


# ---- export ------------------------------------------------------------------------------------------------------

def test_export_package_is_readable_and_skips_drafts_and_trash(pair):
    a, _ = pair
    ok = make(a)
    draft = make(a, "Draft one", images=0, status="draft")
    gone = make(a, "Trashed one", images=0)
    a.delete(f"/api/doi/{gone['id']}")
    data = export(a, [ok["id"], draft["id"], gone["id"]], sender="MI 팀 A", note="분기 DOI")
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        assert zf.testzip() is None
        names = zf.namelist()
        assert "README.txt" in names and "manifest.json" in names
        manifest = json.loads(zf.read("manifest.json"))
        assert manifest["format"] == pkg.FORMAT and manifest["format_version"] == 1 and manifest["sender"] == "MI 팀 A"
        assert [d["title"] for d in manifest["dois"]] == [ok["title"]]
        for im in manifest["dois"][0]["images"]:
            assert im["path"] == f"images/{ok['uid']}/{im['uid']}.png"
            assert hashlib.sha256(zf.read(im["path"])).hexdigest() == im["sha256"]
        assert b"\n  " in zf.read("manifest.json")  # indented, human readable
    r = a.post("/api/doi-package/export", json={"ids": [ok["id"], draft["id"]]})
    assert r.headers["X-Doi-Count"] == "1" and r.headers["X-Doi-Skipped"] == "1"
    assert a.post("/api/doi-package/export", json={"ids": [draft["id"]]}).status_code == 422
    assert a.post("/api/doi-package/export", json={"ids": []}).status_code == 422
    assert a.post("/api/doi-package/export", json={}).status_code == 422


def test_export_refuses_when_image_file_is_missing(pair):
    a, _ = pair
    d = make(a, images=1)
    (a.root / d["images"][0]["file_path"]).unlink()
    r = a.post("/api/doi-package/export", json={"ids": [d["id"]]})
    assert r.status_code == 409 and "이미지 파일" in r.json()["error"]


# ---- round trip --------------------------------------------------------------------------------------------------

def test_round_trip_marks_items_imported_and_read_only(pair):
    a, b = pair
    d = make(a)
    r = preview(b, export(a, [d["id"]], sender="MI 팀 A"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["counts"] == {"new": 1, "identical": 0, "conflict": 0}
    assert body["package"]["sender"] == "MI 팀 A" and body["items"][0]["default"] == "import"
    assert library(b) == []  # preview saves nothing
    res = apply(b, body["token"])
    assert res.status_code == 200 and res.json()["imported"] == 1
    got = library(b)[0]
    assert got["uid"] == d["uid"] and got["origin"] == "imported" and got["status"] == "ready"
    assert got["package_id"] == body["package"]["package_id"] and "MI 팀 A" in got["source_ref"]
    assert [i["uid"] for i in got["images"]] == [i["uid"] for i in d["images"]]
    assert [i["caption"] for i in got["images"]] == ["cap0", "cap1"]
    for src, dst in zip(d["images"], got["images"]):
        assert dst["sha256"] == src["sha256"]
        assert b.get(f"/api/doi-images/{dst['id']}/file").content == a.get(f"/api/doi-images/{src['id']}/file").content
        assert (b.root / dst["file_path"]).is_file()
    assert b.patch(f"/api/doi/{got['id']}", json={"title": "x"}).status_code == 409
    assert b.post(f"/api/doi/{got['id']}/images", content=png(3, 3, (1, 2, 3))).status_code == 409
    assert not stage_dirs(b) and not list(b.root.rglob("*.part"))
    # the same package again is "identical" and changes nothing
    again = preview(b, export(a, [d["id"]])).json()
    assert again["counts"]["identical"] == 1 and again["items"][0]["default"] == "skip"
    assert apply(b, again["token"], {d["uid"]: "skip"}).json()["skipped"] == 1
    assert len(library(b)) == 1


def test_thumbnails_travel_with_the_package(pair):
    a, b = pair
    d = make(a, images=1)
    thumb = b"\xff\xd8\xff\xe0" + b"jpegbytes" * 20
    assert a.put(f"/api/doi-images/{d['images'][0]['id']}/thumb", content=thumb).status_code == 200
    body = preview(b, export(a, [d["id"]])).json()
    assert apply(b, body["token"]).status_code == 200
    got = library(b)[0]["images"][0]
    assert got["thumb_path"].endswith(".thumb.jpg")
    assert b.get(f"/api/doi-images/{got['id']}/thumb").content == thumb


def test_new_items_can_be_skipped(pair):
    a, b = pair
    one, two = make(a, "one", images=0), make(a, "two", images=1)
    body = preview(b, export(a, [one["id"], two["id"]])).json()
    res = apply(b, body["token"], {one["uid"]: "skip"}).json()
    assert res["imported"] == 1 and res["skipped"] == 1
    assert [i["title"] for i in library(b)] == ["two"]


# ---- conflicts ---------------------------------------------------------------------------------------------------

def conflict_setup(pair, mine=True):
    a, b = pair
    d = make(a, images=2)
    data = export(a, [d["id"]])
    # instance B holds the same DOI uid but different content (e.g. the user edited their own copy)
    from app import db
    from app.repositories import doi as repo
    conn = db.connect(b.db_path)
    try:
        local = repo.create(conn, {"title": "My own edited version", "product": "PROD-TEST-A"}, uid=d["uid"],
                            origin="mine" if mine else "imported")
        repo.add_image(conn, b.root, local["id"], png(5, 5, (9, 9, 9))) if mine else None
    finally:
        conn.close()
    return d, data


def test_conflict_overwrite_only_own_entry_keeps_a_snapshot(pair):
    a, b = pair
    d, data = conflict_setup(pair)
    body = preview(b, data).json()
    item = body["items"][0]
    assert item["state"] == "conflict" and item["allowed"] == ["skip", "both", "overwrite"] and item["default"] == "skip"
    old_file = [p for p in (b.root / d["uid"]).iterdir()][0]
    assert apply(b, body["token"], {d["uid"]: "overwrite"}).json()["overwritten"] == 1
    got = library(b)
    assert len(got) == 1 and got[0]["title"] == d["title"] and got[0]["origin"] == "imported" and len(got[0]["images"]) == 2
    assert not old_file.exists() and any(p.name.endswith(old_file.name) for p in (b.root / ".trash").iterdir())
    snaps = list((b.root / ".trash").glob("overwritten_*.json"))
    assert len(snaps) == 1 and json.loads(snaps[0].read_text("utf-8"))["title"] == "My own edited version"


def test_conflict_keep_both_and_skip(pair):
    a, b = pair
    d, data = conflict_setup(pair)
    body = preview(b, data).json()
    assert apply(b, body["token"], {d["uid"]: "both"}).json()["both"] == 1
    rows = sorted(library(b), key=lambda r: r["origin"])
    assert [r["origin"] for r in rows] == ["imported", "mine"] and rows[0]["uid"] != d["uid"] and rows[1]["uid"] == d["uid"]
    assert len({i["uid"] for r in rows for i in r["images"]}) == 3  # fresh image ids for the copy
    assert all((b.root / i["file_path"]).is_file() for r in rows for i in r["images"])
    body = preview(b, data).json()  # skip leaves the library as is
    assert apply(b, body["token"], {d["uid"]: "skip"}).json()["skipped"] == 1 and len(library(b)) == 2


def test_overwrite_refused_for_imported_entries_and_disallowed_choices(pair):
    a, b = pair
    d = make(a, images=1)
    first = preview(b, export(a, [d["id"]])).json()
    apply(b, first["token"])
    a.patch(f"/api/doi/{d['id']}", json={"title": "Scratch v2"})
    body = preview(b, export(a, [d["id"]])).json()
    item = body["items"][0]
    assert item["state"] == "conflict" and item["reason"] == "existing_imported" and item["allowed"] == ["skip", "both"]
    r = apply(b, body["token"], {d["uid"]: "overwrite"})
    assert r.status_code == 409 and library(b)[0]["title"] == d["title"]
    assert apply(b, body["token"], {d["uid"]: "nonsense"}).status_code == 422
    assert apply(b, body["token"], {d["uid"]: "import"}).status_code == 409


def test_image_id_clash_with_another_doi_only_allows_keep_both(pair):
    a, b = pair
    d = make(a, images=1)
    from app import db
    from app.repositories import doi as repo
    conn = db.connect(b.db_path)
    try:
        other = repo.create(conn, {"title": "other"})
        conn.execute("INSERT INTO doi_images (uid, doi_id, file_path, mime, sha256) VALUES (?,?,?,?,?)",
                     (d["images"][0]["uid"], other["id"], "x/y.png", "image/png", ""))
        conn.commit()
    finally:
        conn.close()
    item = preview(b, export(a, [d["id"]])).json()["items"][0]
    assert item["state"] == "conflict" and item["reason"] == "image_id_clash" and item["allowed"] == ["skip", "both"]


def test_trashed_identical_entry_is_identical_not_duplicated(pair):
    a, b = pair
    d = make(a, images=1)
    apply(b, preview(b, export(a, [d["id"]])).json()["token"])
    b.delete(f"/api/doi/{library(b)[0]['id']}")
    item = preview(b, export(a, [d["id"]])).json()["items"][0]
    assert item["state"] == "identical" and item["existing"]["deleted"] is True


# ---- rollback ----------------------------------------------------------------------------------------------------

def test_failure_while_applying_rolls_back_files_and_rows(pair, monkeypatch):
    a, b = pair
    d, data = conflict_setup(pair)
    body = preview(b, data).json()
    before = library(b)
    before_files = sorted(p.name for p in b.root.rglob("*") if p.is_file())
    real = pkg._move_to_trash
    calls = {"n": 0}

    def flaky(root, rel, tag, undo):
        calls["n"] += 1
        real(root, rel, tag, undo)
        if calls["n"] >= 1:
            raise OSError("disk full")

    monkeypatch.setattr(pkg, "_move_to_trash", flaky)
    r = apply(b, body["token"], {d["uid"]: "overwrite"})
    assert r.status_code == 500 and "아무것도 가져오지 않았어요" in r.json()["error"]
    assert library(b) == before
    assert sorted(p.name for p in b.root.rglob("*") if p.is_file()) == before_files  # old image back, no .part, no snapshot
    monkeypatch.setattr(pkg, "_move_to_trash", real)
    assert apply(b, body["token"], {d["uid"]: "overwrite"}).status_code == 200  # the staged package is still usable


def test_failure_in_database_rolls_back_every_item(pair, monkeypatch):
    a, b = pair
    one, two = make(a, "one", images=0), make(a, "two", images=1)
    body = preview(b, export(a, [one["id"], two["id"]])).json()
    monkeypatch.setattr(pkg.repo, "IMAGE_TYPES", {})  # the 2nd DOI's image insert blows up after the 1st DOI was written
    r = apply(b, body["token"])
    assert r.status_code == 500
    assert library(b) == [] and not list(b.root.rglob("*.part")) and not list(b.root.glob("*/*.png"))
    monkeypatch.undo()
    assert apply(b, body["token"]).json()["imported"] == 2


# ---- hostile / broken packages -----------------------------------------------------------------------------------

def reject(c, data: bytes, expect: str, status: int = 422):
    r = preview(c, data)
    assert r.status_code == status, r.text
    assert expect in r.json()["error"], r.json()
    assert not stage_dirs(c) and library(c) == []


def good(pair):
    a, b = pair
    return b, export(a, [make(a, images=1)["id"]])


def zip_of(files: dict, **kw) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as zf:
        for n, b in files.items():
            zf.writestr(n, b)
    return out.getvalue()


@pytest.mark.parametrize("evil", ["../evil.txt", "/abs/evil.txt", "C:/evil.txt", "images/../../evil.txt", "a\\..\\evil.txt", "images//x.png"])
def test_zip_slip_member_names_are_rejected(pair, evil):
    b, data = good(pair)
    out = io.BytesIO(data)
    with zipfile.ZipFile(out, "a") as zf:
        zf.writestr(evil, b"boom")
    reject(b, out.getvalue(), "안전하지 않은 경로")
    assert not (b.root.parent / "evil.txt").exists()


def test_symlink_member_is_rejected(pair):
    b, data = good(pair)
    out = io.BytesIO(data)
    with zipfile.ZipFile(out, "a") as zf:
        info = zipfile.ZipInfo("images/link")
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        zf.writestr(info, "/etc/passwd")
    reject(b, out.getvalue(), "심볼릭 링크")


def test_encrypted_member_is_rejected(pair):
    b, data = good(pair)
    out = io.BytesIO(data)
    with zipfile.ZipFile(out, "a") as zf:
        zf.writestr("secret.bin", b"x")
    raw = bytearray(out.getvalue())
    at = raw.rindex(b"PK", 0, raw.rindex(b"secret.bin"))  # that member's central directory header
    raw[at + 8] |= 0x1  # general purpose flag bit 0 = encrypted
    reject(b, bytes(raw), "암호")


def test_duplicate_member_names_are_rejected(pair):
    b, data = good(pair)
    out = io.BytesIO(data)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        with zipfile.ZipFile(out, "a") as zf:
            zf.writestr("README.txt", b"again")
    reject(b, out.getvalue(), "두 번")


@pytest.mark.parametrize("bad_path", ["../../evil.png", "/abs/evil.png", "images/other/evil.png", "images\\x.png"])
def test_manifest_image_paths_must_match_the_strict_layout(pair, bad_path):
    b, data = good(pair)

    def edit(files, m):
        files[bad_path] = files[m["dois"][0]["images"][0]["path"]]
        m["dois"][0]["images"][0]["path"] = bad_path

    reject(b, rebuild(data, edit), "경로" if bad_path != "images\\x.png" else "")


def test_sha256_mismatch_and_size_mismatch_are_rejected(pair):
    b, data = good(pair)

    def tamper(files, m):
        path = m["dois"][0]["images"][0]["path"]
        files[path] = files[path][:-1] + b"X" if False else files[path][:-12] + b"TAMPERED!!!!"

    reject(b, rebuild(data, tamper), "sha256")

    def bad_sha(files, m):
        m["dois"][0]["images"][0]["sha256"] = "0" * 64

    reject(b, rebuild(data, bad_sha), "sha256")

    def bad_size(files, m):
        m["dois"][0]["images"][0]["size"] += 5

    reject(b, rebuild(data, bad_size), "크기")


def test_missing_image_file_and_missing_manifest(pair):
    b, data = good(pair)

    def drop(files, m):
        del files[m["dois"][0]["images"][0]["path"]]

    reject(b, rebuild(data, drop), "빠져")
    reject(b, zip_of({"README.txt": b"hi"}), "manifest.json이 없어요")


def test_disguised_image_content_is_rejected(pair):
    b, data = good(pair)
    svg = b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"

    def swap(files, m):
        im = m["dois"][0]["images"][0]
        files[im["path"]] = svg
        im["sha256"], im["size"] = hashlib.sha256(svg).hexdigest(), len(svg)

    reject(b, rebuild(data, swap), "이미지 형식")


def test_format_version_and_format_name(pair):
    b, data = good(pair)
    reject(b, rebuild(data, lambda f, m: m.update(format_version=2)), "더 새로운 패키지 형식")
    reject(b, rebuild(data, lambda f, m: m.update(format_version=0)), "형식 버전")
    reject(b, rebuild(data, lambda f, m: m.update(format="something-else")), "DOI 공유 패키지가 아니에요")
    reject(b, rebuild(data, lambda f, m: m.update(dois=[])), "DOI가 없어요")


def test_not_a_zip_or_corrupt_zip_or_bad_manifest(pair):
    b, data = good(pair)
    reject(b, b"this is not a zip", "zip 파일이 아니거나")
    reject(b, data[: len(data) // 2], "zip 파일이 아니거나")
    reject(b, zip_of({"manifest.json": b"{ not json"}), "manifest.json을 읽을 수 없어요")
    reject(b, zip_of({"manifest.json": b"[1,2]"}), "DOI 공유 패키지가 아니에요")


def test_limits_are_enforced(pair, monkeypatch):
    b, data = good(pair)
    monkeypatch.setattr(pkg, "MAX_UNPACKED_BYTES", 100)
    reject(b, data, "용량이 너무 커서")
    monkeypatch.setattr(pkg, "MAX_UNPACKED_BYTES", 10**9)
    monkeypatch.setattr(pkg, "MAX_MEMBERS", 2)
    reject(b, data, "파일이 너무 많아요")
    monkeypatch.setattr(pkg, "MAX_MEMBERS", 1000)
    monkeypatch.setattr(pkg, "MAX_PACKAGE_BYTES", 100)
    reject(b, data, "300MB")
    monkeypatch.setattr(pkg, "MAX_PACKAGE_BYTES", 10**9)
    monkeypatch.setattr(pkg.repo, "MAX_IMAGE_BYTES", 10)
    reject(b, data, "너무 커요")


def test_invalid_uids_and_fields_are_rejected(pair):
    b, data = good(pair)
    reject(b, rebuild(data, lambda f, m: m["dois"][0].update(uid="../../x")), "DOI ID가 올바르지 않아요")
    reject(b, rebuild(data, lambda f, m: m["dois"][0].update(title="")), "제목")
    reject(b, rebuild(data, lambda f, m: m["dois"][0].update(title="t" * 500)), "너무 길어요")
    reject(b, rebuild(data, lambda f, m: m["dois"][0]["images"][0].update(uid="zz")), "이미지 ID")
    reject(b, rebuild(data, lambda f, m: m["dois"].append(m["dois"][0])), "두 번")


def test_unknown_token_and_cancel(pair):
    a, b = pair
    assert apply(b, "0" * 32).status_code == 404
    assert apply(b, "zz").status_code == 404
    body = preview(b, export(a, [make(a, images=0)["id"]])).json()
    assert b.delete(f"/api/doi-package/{body['token']}").status_code == 200
    assert apply(b, body["token"]).status_code == 404 and not stage_dirs(b)
