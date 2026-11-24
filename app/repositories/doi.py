"""DOI library storage (P5-02). Records live in SQLite, image files under data/doi/<doi uid>/ (relative paths only).

Deleting never removes anything: a DOI gets `deleted_at` (restorable) and a removed image file moves to <root>/.trash/.
Imported DOIs (P5-04) are read-only for edits. `uid` values are stable ids for the PPT import and share package.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

TEXT_FIELDS = ("product", "plan", "step", "defect_type", "title", "description", "tool_condition",
               "source_dept", "source_author")
LIMITS = {"title": 200, "description": 4000, "tool_condition": 500}  # everything else: 120
MAX_TAGS = 30
MAX_IMAGE_BYTES = 25 * 1024 * 1024
MAX_THUMB_BYTES = 2 * 1024 * 1024
MAX_IMAGES = 40
IMAGE_TYPES = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp"}


class DoiError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def sniff_image(data: bytes) -> str:
    """Return the extension from the file's magic bytes. SVG is refused on purpose (it can carry scripts)."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[:2] == b"BM":
        return "bmp"
    raise DoiError("이미지 파일(PNG, JPG, GIF, WEBP, BMP)만 올릴 수 있어요.", 422)


def clean_tags(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        raw = raw.split(",")
    if not isinstance(raw, list) or not all(isinstance(t, str) for t in raw):
        raise DoiError("태그 형식이 올바르지 않아요.", 422)
    out: list[str] = []
    seen: set[str] = set()
    for t in raw:
        t = " ".join(t.replace("#", " ").split())
        if not t or t.lower() in seen:
            continue
        if len(t) > 40:
            raise DoiError("태그는 40자까지예요.", 422)
        seen.add(t.lower())
        out.append(t)
    if len(out) > MAX_TAGS:
        raise DoiError(f"태그는 {MAX_TAGS}개까지예요.", 422)
    return out


def clean_input(data: dict[str, Any], partial: bool) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise DoiError("요청 형식이 올바르지 않아요.", 422)
    out: dict[str, Any] = {}
    for key in TEXT_FIELDS:
        if key not in data:
            continue
        value = data[key]
        if value is None:
            value = ""
        if not isinstance(value, str):
            raise DoiError("글자로 된 항목에 글자가 아닌 값이 들어왔어요.", 422)
        value = value.strip()
        if key != "description":
            value = " ".join(value.split())
        if len(value) > LIMITS.get(key, 120):
            raise DoiError(f"항목이 너무 길어요 (최대 {LIMITS.get(key, 120)}자).", 422)
        out[key] = value
    if "tags" in data:
        out["tags"] = clean_tags(data["tags"])
    if "status" in data:
        if data["status"] not in ("ready", "draft"):
            raise DoiError("상태 값이 올바르지 않아요.", 422)
        out["status"] = data["status"]
    if not partial and not out.get("title"):
        raise DoiError("제목을 입력해 주세요.", 422)
    if partial and "title" in out and not out["title"]:
        raise DoiError("제목은 비울 수 없어요.", 422)
    return out


def _image(row: sqlite3.Row) -> dict[str, Any]:
    return {k: row[k] for k in ("id", "uid", "file_path", "thumb_path", "mime", "width", "height", "size",
                                "sha256", "caption", "sort")}


def _doi(row: sqlite3.Row, images: list[dict[str, Any]]) -> dict[str, Any]:
    d = {k: row[k] for k in row.keys()}
    d["tags"] = json.loads(row["tags"] or "[]")
    d["deleted"] = row["deleted_at"] is not None
    d["images"] = images
    return d


def _images_by_doi(conn: sqlite3.Connection, ids: list[int] | None = None) -> dict[int, list[dict[str, Any]]]:
    sql = "SELECT * FROM doi_images"
    params: list[Any] = []
    if ids is not None:
        sql += " WHERE doi_id IN (%s)" % ",".join("?" * len(ids))
        params = ids
    out: dict[int, list[dict[str, Any]]] = {}
    for r in conn.execute(sql + " ORDER BY sort, id", params):
        out.setdefault(r["doi_id"], []).append(_image(r))
    return out


def list_items(conn: sqlite3.Connection, trash: bool = False) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM doi WHERE deleted_at IS %s ORDER BY updated_at DESC, id DESC" % ("NOT NULL" if trash else "NULL")
    ).fetchall()
    images = _images_by_doi(conn)
    return [_doi(r, images.get(r["id"], [])) for r in rows]


def get(conn: sqlite3.Connection, doi_id: int) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM doi WHERE id = ?", (doi_id,)).fetchone()
    if row is None:
        raise DoiError("DOI를 찾을 수 없어요.", 404)
    d = _doi(row, _images_by_doi(conn, [doi_id]).get(doi_id, []))
    plan = None
    if row["plan"] and row["product"]:
        plan = conn.execute("SELECT id FROM plans WHERE product = ? AND name = ?", (row["product"], row["plan"])).fetchone()
    d["plan_id"] = plan["id"] if plan else None  # soft link to the Plan / Step screen when the names match
    return d


def create(conn: sqlite3.Connection, data: dict[str, Any], *, origin: str = "mine", package_id: str = "",
           source_ref: str = "", uid: str | None = None) -> dict[str, Any]:
    clean = clean_input(data, partial=False)
    if uid and conn.execute("SELECT 1 FROM doi WHERE uid = ?", (uid,)).fetchone():
        raise DoiError("같은 ID의 DOI가 이미 있어요.", 409)
    now = _now()
    cur = conn.execute(
        "INSERT INTO doi (uid, product, plan, step, defect_type, title, description, tool_condition, source_dept,"
        " source_author, origin, package_id, source_ref, status, tags, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (uid or uuid.uuid4().hex, *(clean.get(k, "") for k in TEXT_FIELDS), origin, package_id[:120], source_ref[:300],
         clean.get("status", "ready"), json.dumps(clean.get("tags", []), ensure_ascii=False), now, now))
    conn.commit()
    return get(conn, cur.lastrowid)


def _editable(conn: sqlite3.Connection, doi_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM doi WHERE id = ?", (doi_id,)).fetchone()
    if row is None:
        raise DoiError("DOI를 찾을 수 없어요.", 404)
    if row["origin"] == "imported":
        raise DoiError("가져온 DOI는 읽기 전용이에요. 필요하면 내용을 보고 새 DOI를 만들어 주세요.", 409)
    if row["deleted_at"]:
        raise DoiError("휴지통에 있는 DOI예요. 먼저 되돌려 주세요.", 409)
    return row


def _touch(conn: sqlite3.Connection, doi_id: int) -> None:
    conn.execute("UPDATE doi SET updated_at = ? WHERE id = ?", (_now(), doi_id))


def update(conn: sqlite3.Connection, doi_id: int, data: dict[str, Any]) -> dict[str, Any]:
    _editable(conn, doi_id)
    clean = clean_input(data, partial=True)
    if clean:
        sets = [f"{k} = ?" for k in clean]
        vals = [json.dumps(v, ensure_ascii=False) if k == "tags" else v for k, v in clean.items()]
        conn.execute(f"UPDATE doi SET {', '.join(sets)}, updated_at = ? WHERE id = ?", (*vals, _now(), doi_id))
        conn.commit()
    return get(conn, doi_id)


def trash(conn: sqlite3.Connection, doi_id: int) -> None:
    row = conn.execute("SELECT deleted_at FROM doi WHERE id = ?", (doi_id,)).fetchone()
    if row is None:
        raise DoiError("DOI를 찾을 수 없어요.", 404)
    if row["deleted_at"] is None:
        conn.execute("UPDATE doi SET deleted_at = ? WHERE id = ?", (_now(), doi_id))
        conn.commit()


def restore(conn: sqlite3.Connection, doi_id: int) -> dict[str, Any]:
    if conn.execute("UPDATE doi SET deleted_at = NULL WHERE id = ?", (doi_id,)).rowcount == 0:
        raise DoiError("DOI를 찾을 수 없어요.", 404)
    conn.commit()
    return get(conn, doi_id)


# ---- images --------------------------------------------------------------------------------------------------

def _inside(root: Path, rel: str) -> Path:
    path = (root / rel).resolve()
    if root.resolve() not in path.parents:
        raise DoiError("잘못된 파일 경로예요.", 400)
    return path


def add_image(conn: sqlite3.Connection, root: Path, doi_id: int, data: bytes, *, width: int = 0, height: int = 0,
              caption: str = "") -> dict[str, Any]:
    row = _editable(conn, doi_id)
    if not data:
        raise DoiError("파일이 비어 있어요.", 422)
    if len(data) > MAX_IMAGE_BYTES:
        raise DoiError("이미지는 25MB까지 올릴 수 있어요.", 413)
    ext = sniff_image(data)
    count, top = conn.execute("SELECT count(*), coalesce(max(sort), -1) FROM doi_images WHERE doi_id = ?", (doi_id,)).fetchone()
    if count >= MAX_IMAGES:
        raise DoiError(f"이미지는 DOI 하나에 {MAX_IMAGES}장까지예요.", 422)
    uid = uuid.uuid4().hex
    rel = f"{row['uid']}/{uid}.{ext}"
    target = _inside(root, rel)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    try:
        cur = conn.execute(
            "INSERT INTO doi_images (uid, doi_id, file_path, mime, width, height, size, sha256, caption, sort)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (uid, doi_id, rel, IMAGE_TYPES[ext], max(0, int(width)), max(0, int(height)), len(data),
             hashlib.sha256(data).hexdigest(), caption.strip()[:200], top + 1))
        _touch(conn, doi_id)
        conn.commit()
    except Exception:
        target.unlink(missing_ok=True)
        raise
    return _image(conn.execute("SELECT * FROM doi_images WHERE id = ?", (cur.lastrowid,)).fetchone())


def _image_row(conn: sqlite3.Connection, image_id: int, doi_id: int | None = None) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM doi_images WHERE id = ?", (image_id,)).fetchone()
    if row is None or (doi_id is not None and row["doi_id"] != doi_id):
        raise DoiError("이미지를 찾을 수 없어요.", 404)
    return row


def set_thumb(conn: sqlite3.Connection, root: Path, image_id: int, data: bytes) -> None:
    row = _image_row(conn, image_id)
    _editable(conn, row["doi_id"])
    if not data or len(data) > MAX_THUMB_BYTES:
        raise DoiError("미리보기 이미지가 올바르지 않아요.", 422)
    if sniff_image(data) not in ("jpg", "png", "webp"):
        raise DoiError("미리보기는 JPG·PNG·WEBP만 가능해요.", 422)
    rel = row["file_path"].rsplit(".", 1)[0] + ".thumb.jpg"
    _inside(root, rel).write_bytes(data)
    conn.execute("UPDATE doi_images SET thumb_path = ? WHERE id = ?", (rel, image_id))
    conn.commit()


def image_file(conn: sqlite3.Connection, root: Path, image_id: int, thumb: bool = False) -> tuple[Path, str]:
    row = _image_row(conn, image_id)
    if thumb and row["thumb_path"]:
        path = _inside(root, row["thumb_path"])
        if path.is_file():
            return path, "image/jpeg"
    path = _inside(root, row["file_path"])
    if not path.is_file():
        raise DoiError("이미지 파일이 없어요. (폴더에서 옮기거나 지웠을 수 있어요.)", 404)
    return path, row["mime"]


def _to_trash(root: Path, rel: str) -> None:
    src = _inside(root, rel)
    if not src.is_file():
        return
    dest_dir = root / ".trash"
    dest_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = dest_dir / f"{stamp}_{src.name}"
    n = 1
    while dest.exists():
        dest = dest_dir / f"{stamp}_{n}_{src.name}"
        n += 1
    shutil.move(str(src), str(dest))


def delete_image(conn: sqlite3.Connection, root: Path, doi_id: int, image_id: int) -> None:
    _editable(conn, doi_id)
    row = _image_row(conn, image_id, doi_id)
    conn.execute("DELETE FROM doi_images WHERE id = ?", (image_id,))
    _touch(conn, doi_id)
    conn.commit()
    _to_trash(root, row["file_path"])
    if row["thumb_path"]:
        _to_trash(root, row["thumb_path"])


def update_image(conn: sqlite3.Connection, doi_id: int, image_id: int, caption: Any) -> dict[str, Any]:
    _editable(conn, doi_id)
    _image_row(conn, image_id, doi_id)
    if not isinstance(caption, str) or len(caption) > 200:
        raise DoiError("설명은 200자까지예요.", 422)
    conn.execute("UPDATE doi_images SET caption = ? WHERE id = ?", (caption.strip(), image_id))
    _touch(conn, doi_id)
    conn.commit()
    return _image(_image_row(conn, image_id))


def reorder_images(conn: sqlite3.Connection, doi_id: int, ids: Any) -> list[dict[str, Any]]:
    _editable(conn, doi_id)
    have = [r["id"] for r in conn.execute("SELECT id FROM doi_images WHERE doi_id = ? ORDER BY sort, id", (doi_id,))]
    if not isinstance(ids, list) or sorted(ids) != sorted(have):
        raise DoiError("이미지 목록이 서버와 달라요. 새로고침한 뒤 다시 시도해 주세요.", 409)
    for pos, image_id in enumerate(ids):
        conn.execute("UPDATE doi_images SET sort = ? WHERE id = ?", (pos, image_id))
    _touch(conn, doi_id)
    conn.commit()
    return get(conn, doi_id)["images"]
