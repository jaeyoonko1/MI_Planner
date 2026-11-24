"""P5-02: DOI library records, images (local files), trash/restore, read-only imported items."""
import struct
import zlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import create_app
from app.repositories import doi as repo


def png(w: int = 4, h: int = 3, rgb=(200, 80, 80)) -> bytes:
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


@pytest.fixture()
def client(tmp_path: Path):
    with TestClient(create_app(tmp_path / "p.db", tmp_path / "vault"), raise_server_exceptions=False) as c:
        c.root = tmp_path / "doi"
        c.db_path = tmp_path / "p.db"
        yield c


def make(client, **kw):
    body = {"title": "Scratch on LOT-TEST-001", "product": "PROD-TEST-A", "plan": "PLAN-A1", "step": "S0010",
            "defect_type": "Scratch", "tags": ["scratch", "edge"], **kw}
    res = client.post("/api/doi", json=body)
    assert res.status_code == 200, res.text
    return res.json()


def test_create_list_get_and_validation(client):
    d = make(client)
    assert len(d["uid"]) == 32 and d["origin"] == "mine" and d["status"] == "ready" and d["images"] == []
    assert d["tags"] == ["scratch", "edge"]
    items = client.get("/api/doi").json()["items"]
    assert [i["id"] for i in items] == [d["id"]]
    assert client.get(f"/api/doi/{d['id']}").json()["title"] == d["title"]
    assert client.post("/api/doi", json={"title": "  "}).status_code == 422
    assert client.post("/api/doi", json={"title": "x", "tags": "a, b ,A, #c"}).json()["tags"] == ["a", "b", "c"]
    assert client.post("/api/doi", json={"title": "x", "product": 3}).status_code == 422
    assert client.post("/api/doi", json={"title": "x" * 201}).status_code == 422
    assert client.post("/api/doi", json={"title": "x", "tags": ["t"] * 2 + [str(i) for i in range(40)]}).status_code == 422
    assert client.get("/api/doi/999").status_code == 404
    assert "error" in client.get("/api/doi/999").json()


def test_patch_partial(client):
    d = make(client)
    res = client.patch(f"/api/doi/{d['id']}", json={"defect_type": "Particle", "tags": ["a"]})
    assert res.status_code == 200
    got = res.json()
    assert got["defect_type"] == "Particle" and got["tags"] == ["a"] and got["title"] == d["title"]
    assert client.patch(f"/api/doi/{d['id']}", json={"title": ""}).status_code == 422
    assert client.patch(f"/api/doi/{d['id']}", json={"status": "bogus"}).status_code == 422


def test_plan_link_resolves_only_when_names_match(client):
    d = make(client)
    assert d["plan_id"] is None
    conn = db.connect(client.db_path)
    conn.execute("INSERT INTO plans (product, name, imported_at) VALUES ('PROD-TEST-A', 'PLAN-A1', 'x')")
    conn.commit()
    pid = conn.execute("SELECT id FROM plans").fetchone()["id"]
    conn.close()
    assert client.get(f"/api/doi/{d['id']}").json()["plan_id"] == pid


def test_image_upload_files_and_thumb(client):
    d = make(client)
    res = client.post(f"/api/doi/{d['id']}/images", params={"width": 4, "height": 3}, content=png())
    assert res.status_code == 200, res.text
    img = res.json()
    assert img["mime"] == "image/png" and img["file_path"] == f"{d['uid']}/{img['uid']}.png" and img["width"] == 4
    assert (client.root / img["file_path"]).is_file()
    assert client.get(f"/api/doi-images/{img['id']}/file").content == png()
    # no thumbnail yet -> falls back to the original
    assert client.get(f"/api/doi-images/{img['id']}/thumb").content == png()
    assert client.put(f"/api/doi-images/{img['id']}/thumb", content=b"junk").status_code == 422
    assert client.put(f"/api/doi-images/{img['id']}/thumb", content=png(2, 2)).status_code == 200
    assert client.get(f"/api/doi-images/{img['id']}/thumb").content == png(2, 2)
    assert client.get(f"/api/doi/{d['id']}").json()["images"][0]["thumb_path"].endswith(".thumb.jpg")


def test_image_rejects_non_images_and_svg(client):
    d = make(client)
    for body in (b"", b"hello", b"<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>", b"GIF"):
        assert client.post(f"/api/doi/{d['id']}/images", content=body).status_code in (422,)
    assert not (client.root / d["uid"]).exists() or not list((client.root / d["uid"]).iterdir())


def test_image_order_caption_and_trash_on_delete(client):
    d = make(client)
    a = client.post(f"/api/doi/{d['id']}/images", content=png(rgb=(1, 2, 3))).json()
    b = client.post(f"/api/doi/{d['id']}/images", content=png(rgb=(9, 9, 9))).json()
    assert [i["id"] for i in client.get(f"/api/doi/{d['id']}").json()["images"]] == [a["id"], b["id"]]
    assert client.put(f"/api/doi/{d['id']}/images/order", json={"ids": [b["id"], a["id"]]}).status_code == 200
    assert [i["id"] for i in client.get(f"/api/doi/{d['id']}").json()["images"]] == [b["id"], a["id"]]
    assert client.put(f"/api/doi/{d['id']}/images/order", json={"ids": [a["id"]]}).status_code == 409
    assert client.patch(f"/api/doi/{d['id']}/images/{a['id']}", json={"caption": "edge view"}).json()["caption"] == "edge view"
    assert client.delete(f"/api/doi/{d['id']}/images/{a['id']}").status_code == 200
    assert not (client.root / a["file_path"]).exists()
    trashed = list((client.root / ".trash").iterdir())
    assert len(trashed) == 1 and trashed[0].read_bytes() == png(rgb=(1, 2, 3))  # moved, never deleted
    assert client.get(f"/api/doi-images/{a['id']}/file").status_code == 404
    assert client.delete(f"/api/doi/{d['id']}/images/{a['id']}").status_code == 404


def test_trash_and_restore_keeps_files(client):
    d = make(client)
    img = client.post(f"/api/doi/{d['id']}/images", content=png()).json()
    assert client.delete(f"/api/doi/{d['id']}").status_code == 200
    assert client.get("/api/doi").json()["items"] == []
    gone = client.get("/api/doi", params={"trash": "true"}).json()["items"]
    assert [i["id"] for i in gone] == [d["id"]] and gone[0]["deleted"] is True
    assert (client.root / img["file_path"]).is_file()
    # a trashed DOI cannot be edited until restored
    assert client.patch(f"/api/doi/{d['id']}", json={"title": "n"}).status_code == 409
    assert client.post(f"/api/doi/{d['id']}/images", content=png()).status_code == 409
    back = client.post(f"/api/doi/{d['id']}/restore")
    assert back.status_code == 200 and back.json()["deleted"] is False
    assert len(client.get("/api/doi").json()["items"]) == 1
    assert client.delete("/api/doi/999").status_code == 404


def test_imported_is_read_only_but_can_be_trashed(client):
    conn = db.connect(client.db_path)
    try:
        d = repo.create(conn, {"title": "From other dept", "source_dept": "DEPT-TEST"}, origin="imported",
                        package_id="pkg-1", uid="a" * 32)
        assert d["uid"] == "a" * 32
        with pytest.raises(repo.DoiError):
            repo.create(conn, {"title": "dup"}, uid="a" * 32)
    finally:
        conn.close()
    assert client.patch(f"/api/doi/{d['id']}", json={"title": "x"}).status_code == 409
    assert client.post(f"/api/doi/{d['id']}/images", content=png()).status_code == 409
    assert client.get("/api/doi").json()["items"][0]["origin"] == "imported"
    assert client.delete(f"/api/doi/{d['id']}").status_code == 200


def test_image_paths_stay_inside_root(client, tmp_path):
    d = make(client)
    img = client.post(f"/api/doi/{d['id']}/images", content=png()).json()
    conn = db.connect(client.db_path)
    conn.execute("UPDATE doi_images SET file_path = ? WHERE id = ?", ("../../outside.png", img["id"]))
    conn.commit()
    conn.close()
    assert client.get(f"/api/doi-images/{img['id']}/file").status_code == 400
