"""P5-03: DOI PPT import (stdlib .pptx reader, preview with staged pictures, confirm creates DRAFT DOIs)."""
import os
import time
import zipfile
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import pptx_read
from app.main import create_app
from scripts.make_sample_pptx import build_pptx, sample_slides
from scripts.seed_doi_sample import png


@pytest.fixture()
def client(tmp_path: Path):
    with TestClient(create_app(tmp_path / "p.db", tmp_path / "vault"), raise_server_exceptions=False) as c:
        c.root = tmp_path / "doi"
        yield c


def upload(client, data: bytes, name: str = "deck.pptx"):
    return client.post("/api/doi-import/pptx", params={"name": name}, content=data)


def test_reader_text_groups_tables_notes_and_pictures(tmp_path):
    slides, warnings = pptx_read.read_pptx(build_pptx(sample_slides()), tmp_path)
    assert warnings == [] and [s.index for s in slides] == [1, 2, 3, 4]
    s1, s2, s3, s4 = slides
    assert s1.title == "Scratch near wafer edge" and "LOT-TEST-001" in s1.body and "9" not in s1.body.split()  # slide number skipped
    assert s1.notes == "Seen after CMP.\nCheck with EQ-A02 too."
    assert [i.name for i in s1.images] == ["image1.png", "image9.png"] and s1.images[0].width == 160 and s1.images[0].height == 120
    assert "Wafer | Count" in s2.body and "W01 | 12" in s2.body
    assert {i.name for i in s2.images} == {"image9.png", "image2.png", "image3.png"}  # grouped pictures found
    assert [i.caption for i in s2.images if i.name == "image2.png"] == ["alt text"]
    assert [k.name for k in s3.skipped] == ["image4.emf"] and "EMF" in s3.skipped[0].reason and len(s3.images) == 1
    assert s4.hidden and not s1.hidden
    assert len(list(tmp_path.iterdir())) == 4  # the shared logo is stored once
    assert all(p.suffix == ".png" for p in tmp_path.iterdir())


def test_reader_first_line_becomes_title_without_title_placeholder(tmp_path):
    data = build_pptx([{"body": ["Short heading", "More text"], "pics": []}])
    (s,), _ = pptx_read.read_pptx(data, tmp_path)
    assert s.title == "Short heading" and s.body == "More text"


def test_same_picture_twice_on_a_slide_counts_once(tmp_path):
    p = png(10, 10, (1, 2, 3))
    (s,), _ = pptx_read.read_pptx(build_pptx([{"title": "t", "pics": [("a.png", p, False), ("b.png", p, False)]}]), tmp_path)
    assert len(s.images) == 1


@pytest.mark.parametrize("data,needle", [
    (b"", "비어"),
    (b"not a zip at all", "손상"),
    (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 100, ".pptx로 저장"),
    (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + "EncryptedPackage".encode("utf-16-le"), "암호"),
])
def test_reader_rejects_bad_files(tmp_path, data, needle):
    with pytest.raises(pptx_read.PptxError) as e:
        pptx_read.read_pptx(data, tmp_path)
    assert needle in str(e.value)


def test_reader_rejects_other_zip_and_hostile_xml(tmp_path):
    with pytest.raises(pptx_read.PptxError, match="파워포인트 파일이 아니"):
        pptx_read.read_pptx(zip_with("hello.txt", "x"), tmp_path)
    with pytest.raises(pptx_read.PptxError, match="DTD"):
        pptx_read.read_pptx(zip_with("ppt/presentation.xml", '<!DOCTYPE x [<!ENTITY a "b">]><p:presentation xmlns:p="x"/>'), tmp_path)
    with pytest.raises(pptx_read.PptxError, match="XML"):
        pptx_read.read_pptx(zip_with("ppt/presentation.xml", "<broken"), tmp_path)


def zip_with(name: str, text: str) -> bytes:
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(name, text)
    return buf.getvalue()


def test_reader_limits(tmp_path, monkeypatch):
    big = png(8, 8, (9, 9, 9))
    monkeypatch.setattr(pptx_read, "MAX_IMAGE", len(big) - 1)
    (s,), _ = pptx_read.read_pptx(build_pptx([{"title": "t", "pics": [("a.png", big, False)]}]), tmp_path)
    assert not s.images and "너무 커요" in s.skipped[0].reason
    monkeypatch.setattr(pptx_read, "MAX_BYTES", 10)
    with pytest.raises(pptx_read.PptxError, match="너무 커요"):
        pptx_read.read_pptx(build_pptx([{"title": "t"}]), tmp_path)
    monkeypatch.setattr(pptx_read, "MAX_BYTES", 10**9)
    monkeypatch.setattr(pptx_read, "MAX_SLIDES", 2)
    slides, warnings = pptx_read.read_pptx(build_pptx([{"title": str(i)} for i in range(5)]), tmp_path)
    assert len(slides) == 2 and "앞 2장" in warnings[0]


def test_unknown_picture_formats_are_listed_not_staged(tmp_path):
    slides = [{"title": "t", "pics": [("a.tif", b"II*\x00" + b"\0" * 20, False), ("b.svg", b"<svg xmlns='x'><script/></svg>", False),
                                      ("c.bin", b"zzzz" * 8, False), ("d.png", png(4, 4, (1, 1, 1)), False)]}]
    (s,), _ = pptx_read.read_pptx(build_pptx(slides), tmp_path)
    assert [i.name for i in s.images] == ["d.png"]
    assert len(s.skipped) == 3 and all(k.reason for k in s.skipped)
    assert len(list(tmp_path.iterdir())) == 1


def test_preview_saves_nothing_and_flags_repeated_logo(client):
    res = upload(client, build_pptx(sample_slides()))
    assert res.status_code == 200, res.text
    data = res.json()
    assert len(data["token"]) == 32 and data["filename"] == "deck.pptx" and len(data["slides"]) == 4
    assert client.get("/api/doi").json()["items"] == []
    s1 = data["slides"][0]
    assert s1["images"][0]["repeated"] is False and s1["images"][1]["repeated"] is True
    assert data["slides"][2]["skipped"][0]["name"] == "image4.emf"
    key = s1["images"][0]["key"]
    got = client.get(f"/api/doi-import/{data['token']}/image/{key}")
    assert got.status_code == 200 and got.headers["content-type"] == "image/png" and got.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert client.get(f"/api/doi-import/{data['token']}/image/{'0' * 20}").status_code == 404
    assert client.get(f"/api/doi-import/{data['token']}/image/..%2f..%2fx").status_code == 404
    assert client.get(f"/api/doi-import/{'f' * 32}/image/{key}").status_code == 404


def test_preview_errors_are_korean_json(client):
    for body, name in ((b"hello", "x.pptx"), (b"", "x.pptx"), (b"hello", "notes.txt")):
        res = upload(client, body, name)
        assert res.status_code == 422 and res.json()["error"]
    stage = client.root / ".import"
    assert not stage.exists() or not list(stage.iterdir())  # failed uploads leave no staging


def test_confirm_creates_drafts_with_images_and_marks_duplicates_next_time(client):
    pre = upload(client, build_pptx(sample_slides())).json()
    s1, s2 = pre["slides"][0], pre["slides"][1]
    body = {"slides": [
        {"index": 1, "title": "Scratch near wafer edge", "description": "from deck", "product": "PROD-TEST-A", "plan": "PLAN-A1",
         "step": "S0010", "defect_type": "Scratch", "tags": ["edge"], "images": [s1["images"][0]["key"]]},
        {"index": 2, "title": "Particle cluster", "images": [i["key"] for i in s2["images"] if not i["repeated"]]},
    ]}
    res = client.post(f"/api/doi-import/{pre['token']}/confirm", json=body)
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["failed"] == [] and [c["index"] for c in out["created"]] == [1, 2] and len(out["created"][1]["images"]) == 2
    items = {i["title"]: i for i in client.get("/api/doi").json()["items"]}
    d = items["Scratch near wafer edge"]
    assert d["status"] == "draft" and d["origin"] == "mine" and d["source_ref"] == "deck.pptx#슬라이드 1"
    assert d["product"] == "PROD-TEST-A" and d["tags"] == ["edge"] and len(d["images"]) == 1
    assert d["images"][0]["width"] == 160 and len(d["images"][0]["sha256"]) == 64
    assert (client.root / d["images"][0]["file_path"]).is_file()
    assert len(items["Particle cluster"]["images"]) == 2
    assert not (client.root / ".import" / pre["token"]).exists()  # staging is cleaned after success
    assert client.post(f"/api/doi-import/{pre['token']}/confirm", json=body).status_code == 404

    again = upload(client, build_pptx(sample_slides())).json()
    assert again["slides"][0]["duplicate_slide"]["title"] == "Scratch near wafer edge"
    assert again["slides"][0]["images"][0]["duplicate"]["doi_id"] == d["id"]
    assert again["slides"][3]["duplicate_slide"] is None
    other = upload(client, build_pptx(sample_slides()), "other.pptx").json()
    assert other["slides"][0]["duplicate_slide"] is None and other["slides"][0]["images"][0]["duplicate"]


def test_confirm_validation_and_partial_failure(client):
    pre = upload(client, build_pptx(sample_slides())).json()
    t = pre["token"]
    assert client.post(f"/api/doi-import/{t}/confirm", json={"slides": []}).status_code == 422
    res = client.post(f"/api/doi-import/{t}/confirm", json={"slides": [
        {"index": 1, "title": "ok", "images": []},
        {"index": 1, "title": "dup index", "images": []},
        {"index": 2, "title": "", "images": []},
        {"index": 3, "title": "x", "images": ["../../etc/passwd"]},
        {"index": 99, "title": "nope", "images": []},
    ]})
    assert res.status_code == 200
    out = res.json()
    assert [c["index"] for c in out["created"]] == [1] and sorted(f["index"] for f in out["failed"]) == [1, 2, 3, 99]
    titles = [i["title"] for i in client.get("/api/doi").json()["items"]]
    assert titles == ["ok"]  # failed slides leave nothing behind
    assert (client.root / ".import" / t).exists()  # kept so the user can retry the failed ones
    assert client.delete(f"/api/doi-import/{t}").status_code == 200
    assert not (client.root / ".import" / t).exists()
    assert client.delete("/api/doi-import/not-a-token").status_code == 200


def test_stale_staging_is_swept(client):
    old = client.root / ".import" / ("a" * 32)
    old.mkdir(parents=True)
    (old / "meta.json").write_text("{}")
    past = time.time() - 3 * 86400
    os.utime(old, (past, past))
    upload(client, build_pptx([{"title": "t"}]))
    assert not old.exists()
