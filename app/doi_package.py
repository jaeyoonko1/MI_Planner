"""DOI share package (P5-04, D-35): export selected DOIs to one .zip and import such a zip on another instance.

Package layout (plain files, readable by people and LLMs):
  manifest.json                       format + version, package id, sender, DOI records (+ per-image sha256/size)
  README.txt                          short human explanation
  images/<doi uid>/<image uid>.<ext>  original pictures (+ optional `.thumb.jpg` previews)

Import is two-step. `stage_package` verifies everything (zip-slip, limits, sha256, image types, format version) and
extracts into a private stage folder; nothing touches the library. `apply_package` then writes files + rows atomically:
new files go to `.part` names first, the DB runs in one transaction, and any failure rolls back both.
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import shutil
import sqlite3
import stat
import uuid
import zipfile
import zlib
from datetime import datetime
from pathlib import Path
from typing import Any

from app.repositories import doi as repo
from app.repositories.doi import DoiError

FORMAT = "mi-planner-doi-package"
FORMAT_VERSION = 1
MAX_PACKAGE_BYTES = 300 * 1024 * 1024
MAX_UNPACKED_BYTES = 800 * 1024 * 1024
MAX_MEMBERS = 12000
MAX_DOIS = 2000
MAX_MANIFEST_BYTES = 20 * 1024 * 1024
MAX_SENDER = 80
MAX_NOTE = 500
ACTIONS = ("import", "skip", "both", "overwrite")

_HEX32 = re.compile(r"^[0-9a-f]{32}$")
_SHA = re.compile(r"^[0-9a-f]{64}$")
_IMG_EXT = "|".join(repo.IMAGE_TYPES)
_ZIP_ERRORS = (zipfile.BadZipFile, zlib.error, NotImplementedError, RuntimeError, EOFError, OSError, ValueError)


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _text(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


# ---- export ----------------------------------------------------------------------------------------------------

README = """MI Planner DOI 공유 패키지
================================
이 zip 파일은 MI Planner의 DOI(Defect of Interest) 라이브러리에서 내보낸 공유 패키지예요.

- manifest.json : DOI 내용(제목·설명·제품·Step·태그 등)과 이미지 목록(sha256, 크기). 메모장으로 열어 볼 수 있어요.
- images/       : 원본 이미지. 경로는 images/<DOI ID>/<이미지 ID>.<확장자> 이에요.

받는 사람은 MI Planner의 DOI 라이브러리에서 `패키지 가져오기`로 이 파일을 골라 주세요.
가져온 DOI는 출처가 표시되고 읽기 전용으로 들어가요. 이 파일을 수정하면 무결성 검사(sha256)에서 거부돼요.
"""


def export_package(conn: sqlite3.Connection, root: Path, ids: Any, sender: Any = "", note: Any = "") -> tuple[bytes, dict[str, Any]]:
    """Return (zip bytes, stats). Drafts and trashed DOIs are skipped (and counted)."""
    if not isinstance(ids, list) or not ids or not all(isinstance(i, int) and not isinstance(i, bool) for i in ids):
        raise DoiError("내보낼 DOI를 하나 이상 골라 주세요.", 422)
    ids = list(dict.fromkeys(ids))
    if len(ids) > MAX_DOIS:
        raise DoiError(f"한 번에 {MAX_DOIS}개까지 내보낼 수 있어요. 나눠서 내보내 주세요.", 422)
    records: list[dict[str, Any]] = []
    skipped = {"draft": 0, "trash": 0, "missing": 0}
    for doi_id in ids:
        try:
            d = repo.get(conn, doi_id)
        except DoiError:
            skipped["missing"] += 1
            continue
        if d["deleted"]:
            skipped["trash"] += 1
        elif d["status"] == "draft":
            skipped["draft"] += 1
        else:
            records.append(d)
    if not records:
        raise DoiError("내보낼 수 있는 DOI가 없어요. 초안과 휴지통의 DOI는 내보내지 않아요.", 422)

    files: list[tuple[str, Path]] = []
    out_records = []
    for d in records:
        images = []
        for im in d["images"]:
            path = repo._inside(root, im["file_path"])
            if not path.is_file():
                raise DoiError(f"‘{d['title']}’의 이미지 파일을 찾을 수 없어 내보낼 수 없어요. 폴더에서 옮기거나 지웠는지 확인해 주세요.", 409)
            ext = im["file_path"].rsplit(".", 1)[-1]
            entry: dict[str, Any] = {
                "uid": im["uid"], "path": f"images/{d['uid']}/{im['uid']}.{ext}", "mime": im["mime"], "width": im["width"],
                "height": im["height"], "size": im["size"], "sha256": im["sha256"], "caption": im["caption"], "sort": im["sort"],
            }
            if not entry["sha256"] or entry["size"] != path.stat().st_size:
                data = path.read_bytes()
                entry["sha256"], entry["size"] = hashlib.sha256(data).hexdigest(), len(data)
            files.append((entry["path"], path))
            if im["thumb_path"]:
                thumb = repo._inside(root, im["thumb_path"])
                if thumb.is_file():
                    tdata = thumb.read_bytes()
                    entry["thumb_path"] = f"images/{d['uid']}/{im['uid']}.thumb.jpg"
                    entry["thumb_sha256"] = hashlib.sha256(tdata).hexdigest()
                    entry["thumb_size"] = len(tdata)
                    files.append((entry["thumb_path"], thumb))
            images.append(entry)
        out_records.append({
            "uid": d["uid"], **{k: d[k] for k in repo.TEXT_FIELDS}, "tags": d["tags"], "created_at": d["created_at"],
            "updated_at": d["updated_at"], "images": images,
        })
    manifest = {
        "format": FORMAT, "format_version": FORMAT_VERSION, "package_id": uuid.uuid4().hex, "created_at": _now(),
        "app": "MI_Planner", "sender": _text(sender, MAX_SENDER), "note": _text(note, MAX_NOTE),
        "counts": {"dois": len(out_records), "images": len(files)}, "dois": out_records,
    }
    buf = io.BytesIO()
    total = 0
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2), compress_type=zipfile.ZIP_DEFLATED)
        zf.writestr("README.txt", README, compress_type=zipfile.ZIP_DEFLATED)
        for name, path in files:
            total += path.stat().st_size
            if total > MAX_UNPACKED_BYTES:
                raise DoiError("패키지가 너무 커요. DOI를 나눠서 내보내 주세요.", 413)
            zf.write(path, name, compress_type=zipfile.ZIP_STORED)
    data = buf.getvalue()
    if len(data) > MAX_PACKAGE_BYTES:
        raise DoiError("패키지가 300MB를 넘어요. DOI를 나눠서 내보내 주세요.", 413)
    return data, {"count": len(out_records), "images": len(files), "skipped": skipped, "package_id": manifest["package_id"]}


# ---- verify + stage --------------------------------------------------------------------------------------------

def _bad_name(name: str) -> bool:
    if not name or "\\" in name or "\x00" in name or name.startswith("/") or re.match(r"^[A-Za-z]:", name):
        return True
    return any(p in ("", ".", "..") for p in name.rstrip("/").split("/"))


def _need(cond: bool, message: str) -> None:
    if not cond:
        raise DoiError(message, 422)


def _check_members(zf: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    infos = zf.infolist()
    _need(len(infos) <= MAX_MEMBERS, "패키지 안의 파일이 너무 많아요.")
    members: dict[str, zipfile.ZipInfo] = {}
    total = 0
    for info in infos:
        name = info.filename
        _need(not _bad_name(name), "패키지에 안전하지 않은 경로가 들어 있어 가져오지 않았어요. (상위 폴더·절대 경로 등)")
        _need(not info.flag_bits & 0x1, "암호가 걸린 패키지는 가져올 수 없어요.")
        _need(not stat.S_ISLNK(info.external_attr >> 16), "패키지에 바로가기(심볼릭 링크)가 들어 있어 가져오지 않았어요.")
        _need(name not in members, "패키지에 같은 이름의 파일이 두 번 들어 있어요. 파일이 손상됐거나 변조됐을 수 있어요.")
        total += info.file_size
        _need(total <= MAX_UNPACKED_BYTES, "패키지를 풀면 용량이 너무 커서(800MB 초과) 가져오지 않았어요.")
        members[name] = info
    return members


def _read(zf: zipfile.ZipFile, info: zipfile.ZipInfo, limit: int, what: str) -> bytes:
    _need(info.file_size <= limit, f"{what}이(가) 너무 커요.")
    try:
        with zf.open(info) as f:
            data = f.read(limit + 1)
    except _ZIP_ERRORS as exc:
        raise DoiError(f"{what}을(를) 읽지 못했어요. 패키지가 손상됐을 수 있어요.", 422) from exc
    _need(len(data) <= limit, f"{what}이(가) 너무 커요.")
    return data


def _int(value: Any, what: str) -> int:
    _need(isinstance(value, int) and not isinstance(value, bool) and value >= 0, f"{what} 값이 올바르지 않아요.")
    return value


def _parse_manifest(raw: bytes) -> dict[str, Any]:
    try:
        manifest = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DoiError("manifest.json을 읽을 수 없어요. DOI 공유 패키지가 아니거나 손상됐어요.", 422) from exc
    _need(isinstance(manifest, dict) and manifest.get("format") == FORMAT, "MI Planner DOI 공유 패키지가 아니에요.")
    version = manifest.get("format_version")
    _need(isinstance(version, int) and not isinstance(version, bool) and version >= 1, "패키지 형식 버전이 올바르지 않아요.")
    if version > FORMAT_VERSION:
        raise DoiError(f"더 새로운 패키지 형식(버전 {version})이에요. 이 앱은 버전 {FORMAT_VERSION}까지 읽을 수 있어요. 앱을 업데이트한 뒤 다시 시도해 주세요.", 422)
    _need(isinstance(manifest.get("package_id"), str) and _HEX32.match(manifest["package_id"]), "패키지 ID가 올바르지 않아요.")
    dois = manifest.get("dois")
    _need(isinstance(dois, list) and dois, "패키지에 DOI가 없어요.")
    _need(len(dois) <= MAX_DOIS, f"패키지에 DOI가 너무 많아요 (최대 {MAX_DOIS}개).")
    return manifest


def _normalize(rec: Any, seen_doi: set[str], seen_img: set[str]) -> dict[str, Any]:
    _need(isinstance(rec, dict), "패키지의 DOI 항목 형식이 올바르지 않아요.")
    uid = rec.get("uid")
    _need(isinstance(uid, str) and _HEX32.match(uid), "패키지의 DOI ID가 올바르지 않아요.")
    _need(uid not in seen_doi, "패키지에 같은 DOI가 두 번 들어 있어요.")
    seen_doi.add(uid)
    try:
        clean = repo.clean_input({k: rec.get(k, "") for k in repo.TEXT_FIELDS} | {"tags": rec.get("tags", [])}, partial=False)
    except DoiError as exc:
        raise DoiError(f"‘{_text(rec.get('title'), 40)}’: {exc}", 422) from exc
    raw_images = rec.get("images", [])
    _need(isinstance(raw_images, list) and len(raw_images) <= repo.MAX_IMAGES, f"‘{clean['title']}’의 이미지 목록이 올바르지 않아요.")
    images = []
    for n, im in enumerate(raw_images):
        _need(isinstance(im, dict), "패키지의 이미지 항목 형식이 올바르지 않아요.")
        iuid, path = im.get("uid"), im.get("path")
        _need(isinstance(iuid, str) and _HEX32.match(iuid) and iuid not in seen_img, "패키지의 이미지 ID가 올바르지 않거나 중복돼요.")
        seen_img.add(iuid)
        m = re.match(rf"^images/{uid}/{iuid}\.({_IMG_EXT})$", path if isinstance(path, str) else "")
        _need(m is not None, "패키지의 이미지 경로가 올바르지 않아요. 경로는 images/<DOI ID>/<이미지 ID>.<확장자> 형식이어야 해요.")
        ext = m.group(1)
        _need(isinstance(im.get("sha256"), str) and _SHA.match(im["sha256"]), "패키지의 이미지 sha256 값이 올바르지 않아요.")
        entry: dict[str, Any] = {
            "uid": iuid, "path": path, "ext": ext, "sha256": im["sha256"], "size": _int(im.get("size"), "이미지 크기"),
            "width": _int(im.get("width", 0), "이미지 너비"), "height": _int(im.get("height", 0), "이미지 높이"),
            "caption": _text(im.get("caption", ""), 200), "sort": n, "thumb_path": "", "thumb_sha256": "", "thumb_size": 0,
        }
        if im.get("thumb_path"):
            _need(im["thumb_path"] == f"images/{uid}/{iuid}.thumb.jpg", "패키지의 미리보기 경로가 올바르지 않아요.")
            _need(isinstance(im.get("thumb_sha256"), str) and _SHA.match(im["thumb_sha256"]), "패키지의 미리보기 sha256 값이 올바르지 않아요.")
            entry.update(thumb_path=im["thumb_path"], thumb_sha256=im["thumb_sha256"], thumb_size=_int(im.get("thumb_size"), "미리보기 크기"))
        images.append(entry)
    created = rec.get("created_at")
    return {"uid": uid, **{k: clean.get(k, "") for k in repo.TEXT_FIELDS}, "tags": clean.get("tags", []), "images": images,
            "created_at": created if isinstance(created, str) and len(created) <= 40 else ""}


def stage_package(data: bytes, stage: Path) -> dict[str, Any]:
    """Verify the zip completely and extract the files the manifest lists into `stage`. Returns the normalized manifest."""
    _need(len(data) <= MAX_PACKAGE_BYTES, "패키지 파일이 300MB를 넘어 가져올 수 없어요.")
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except _ZIP_ERRORS as exc:
        raise DoiError("zip 파일이 아니거나 손상됐어요. 내보낸 DOI 공유 패키지(.zip)를 골라 주세요.", 422) from exc
    with zf:
        members = _check_members(zf)
        manifest_info = members.get("manifest.json")
        _need(manifest_info is not None, "manifest.json이 없어요. DOI 공유 패키지가 아니에요.")
        manifest = _parse_manifest(_read(zf, manifest_info, MAX_MANIFEST_BYTES, "manifest.json"))
        seen_doi: set[str] = set()
        seen_img: set[str] = set()
        items = [_normalize(r, seen_doi, seen_img) for r in manifest["dois"]]
        for item in items:
            for im in item["images"]:
                _stage_file(zf, members, stage, im["path"], im["sha256"], im["size"], repo.MAX_IMAGE_BYTES, im["ext"], False)
                if im["thumb_path"]:
                    _stage_file(zf, members, stage, im["thumb_path"], im["thumb_sha256"], im["thumb_size"], repo.MAX_THUMB_BYTES, "jpg", True)
    return {"package_id": manifest["package_id"], "created_at": str(manifest.get("created_at", ""))[:40],
            "sender": _text(manifest.get("sender"), MAX_SENDER), "note": _text(manifest.get("note"), MAX_NOTE),
            "format_version": manifest["format_version"], "items": items}


def _stage_file(zf: zipfile.ZipFile, members: dict[str, zipfile.ZipInfo], stage: Path, path: str, sha: str, size: int,
                limit: int, ext: str, thumb: bool) -> None:
    info = members.get(path)
    _need(info is not None, f"패키지에 이미지 파일이 빠져 있어요: {path}")
    blob = _read(zf, info, limit, f"이미지 {path}")
    _need(len(blob) == size, f"이미지 크기가 manifest와 달라요(변조 또는 손상): {path}")
    _need(hashlib.sha256(blob).hexdigest() == sha, f"이미지 무결성 검사(sha256)에 실패했어요(변조 또는 손상): {path}")
    try:
        kind = repo.sniff_image(blob)
    except DoiError as exc:
        raise DoiError(f"이미지 형식이 올바르지 않아요: {path}", 422) from exc
    _need(kind in ("jpg", "png", "webp") if thumb else kind == ext, f"이미지 내용이 확장자와 달라요: {path}")
    target = repo._inside(stage, path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(blob)


# ---- classify (preview) ----------------------------------------------------------------------------------------

def _existing_sig(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    images = conn.execute("SELECT sha256, caption FROM doi_images WHERE doi_id = ? ORDER BY sort, id", (row["id"],)).fetchall()
    return {"fields": [row[k] for k in repo.TEXT_FIELDS], "tags": json.loads(row["tags"] or "[]"),
            "images": [[i["sha256"], i["caption"]] for i in images]}


def _incoming_sig(item: dict[str, Any]) -> dict[str, Any]:
    return {"fields": [item[k] for k in repo.TEXT_FIELDS], "tags": item["tags"],
            "images": [[i["sha256"], i["caption"]] for i in item["images"]]}


def classify(conn: sqlite3.Connection, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per DOI: state new / identical / conflict, the existing row, and which actions are allowed."""
    out = []
    for item in items:
        row = conn.execute("SELECT * FROM doi WHERE uid = ?", (item["uid"],)).fetchone()
        clash = []
        for i in range(0, len(item["images"]), 500):
            chunk = [im["uid"] for im in item["images"][i:i + 500]]
            clash += conn.execute(
                "SELECT i.uid FROM doi_images i JOIN doi d ON d.id = i.doi_id WHERE d.uid != ? AND i.uid IN (%s)" % ",".join("?" * len(chunk)),
                (item["uid"], *chunk)).fetchall()
        existing = None
        reason = ""
        if row is None and not clash:
            state, allowed = "new", ["import", "skip"]
        elif row is None:
            state, allowed, reason = "conflict", ["skip", "both"], "image_id_clash"
        else:
            existing = {"id": row["id"], "title": row["title"], "origin": row["origin"], "updated_at": row["updated_at"],
                        "deleted": row["deleted_at"] is not None, "product": row["product"], "step": row["step"]}
            if _existing_sig(conn, row) == _incoming_sig(item) and not clash:
                state, allowed = "identical", ["skip"]
            elif clash:
                state, allowed, reason = "conflict", ["skip", "both"], "image_id_clash"
            elif row["origin"] == "imported":
                state, allowed, reason = "conflict", ["skip", "both"], "existing_imported"
            else:
                state, allowed, reason = "conflict", ["skip", "both", "overwrite"], "differs"
        default = "import" if state == "new" else "skip"
        out.append({"uid": item["uid"], "state": state, "reason": reason, "allowed": allowed, "default": default, "existing": existing})
    return out


def public_item(item: dict[str, Any], cls: dict[str, Any]) -> dict[str, Any]:
    return {
        "uid": item["uid"], "title": item["title"], "product": item["product"], "plan": item["plan"], "step": item["step"],
        "defect_type": item["defect_type"], "tags": item["tags"],
        "images": [{"uid": i["uid"], "sha256": i["sha256"], "size": i["size"], "caption": i["caption"]} for i in item["images"]],
        **{k: cls[k] for k in ("state", "reason", "allowed", "default", "existing")},
    }


# ---- apply -----------------------------------------------------------------------------------------------------

def _source_ref(package: dict[str, Any], stamp: str) -> str:
    who = f" · {package['sender']}" if package["sender"] else ""
    return f"공유 패키지{who} · {stamp[:10]} 가져옴"[:300]


def apply_package(conn: sqlite3.Connection, root: Path, stage: Path, package: dict[str, Any], decisions: dict[str, str]) -> dict[str, Any]:
    items = package["items"]
    classes = {c["uid"]: c for c in classify(conn, items)}
    chosen: list[tuple[dict[str, Any], str]] = []
    for item in items:
        cls = classes[item["uid"]]
        action = decisions.get(item["uid"], cls["default"])
        _need(action in ACTIONS, "알 수 없는 선택이에요.")
        if action not in cls["allowed"]:
            if cls["state"] == "conflict" and action == "overwrite":
                raise DoiError(f"‘{item['title']}’은(는) 덮어쓸 수 없어요. 내가 만든 DOI만 덮어쓸 수 있어요.", 409)
            raise DoiError(f"‘{item['title']}’에는 그 선택을 쓸 수 없어요. 미리보기를 다시 열어 확인해 주세요.", 409)
        if action != "skip":
            chosen.append((item, action))
    stats = {"imported": 0, "both": 0, "overwritten": 0, "skipped": len(items) - len(chosen)}
    if not chosen:
        return stats

    stamp = _now()
    tag = datetime.now().strftime("%Y%m%d-%H%M%S")
    parts: list[Path] = []
    undo: list[Any] = []
    try:
        # A. copy every new file next to its final name as *.part (nothing visible yet)
        plan = []
        for item, action in chosen:
            new_doi = uuid.uuid4().hex if action == "both" else item["uid"]
            imgs = []
            for im in item["images"]:
                iuid = uuid.uuid4().hex if action == "both" else im["uid"]
                rel = f"{new_doi}/{iuid}.{im['ext']}"
                thumb_rel = f"{new_doi}/{iuid}.thumb.jpg" if im["thumb_path"] else ""
                for src_rel, dst_rel, sha in ((im["path"], rel, im["sha256"]), (im["thumb_path"], thumb_rel, im["thumb_sha256"])):
                    if not src_rel:
                        continue
                    final = repo._inside(root, dst_rel)
                    part = final.with_name(final.name + ".part")
                    final.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(repo._inside(stage, src_rel), part)
                    parts.append(part)
                    if hashlib.sha256(part.read_bytes()).hexdigest() != sha:
                        raise DoiError("준비해 둔 이미지가 바뀌었어요. 패키지를 다시 열어 주세요.", 409)
                imgs.append((im, iuid, rel, thumb_rel))
            plan.append((item, action, new_doi, imgs))

        # B. DB writes in one transaction (no commit yet)
        trash_files: list[str] = []
        for item, action, new_doi, imgs in plan:
            tags = json.dumps(item["tags"], ensure_ascii=False)
            created = item["created_at"] or stamp
            values = [item[k] for k in repo.TEXT_FIELDS]
            if action == "overwrite":
                row = conn.execute("SELECT * FROM doi WHERE uid = ?", (item["uid"],)).fetchone()
                if row is None or row["origin"] == "imported":
                    raise DoiError(f"‘{item['title']}’은(는) 덮어쓸 수 없어요. 미리보기를 다시 열어 확인해 주세요.", 409)
                old_images = conn.execute("SELECT * FROM doi_images WHERE doi_id = ? ORDER BY sort, id", (row["id"],)).fetchall()
                _write_snapshot(root, tag, row, old_images, undo)
                for o in old_images:
                    trash_files += [p for p in (o["file_path"], o["thumb_path"]) if p]
                conn.execute("DELETE FROM doi_images WHERE doi_id = ?", (row["id"],))
                conn.execute(
                    "UPDATE doi SET " + ", ".join(f"{k} = ?" for k in repo.TEXT_FIELDS) + ", origin = 'imported', package_id = ?,"
                    " source_ref = ?, status = 'ready', tags = ?, updated_at = ?, deleted_at = NULL WHERE id = ?",
                    (*values, package["package_id"], _source_ref(package, stamp), tags, stamp, row["id"]))
                doi_id = row["id"]
            else:
                cur = conn.execute(
                    "INSERT INTO doi (uid, " + ", ".join(repo.TEXT_FIELDS) + ", origin, package_id, source_ref, status, tags, created_at,"
                    " updated_at) VALUES (?," + ",".join("?" * len(values)) + ",'imported',?,?,'ready',?,?,?)",
                    (new_doi, *values, package["package_id"], _source_ref(package, stamp), tags, created, stamp))
                doi_id = cur.lastrowid
            for n, (im, iuid, rel, thumb_rel) in enumerate(imgs):
                conn.execute(
                    "INSERT INTO doi_images (uid, doi_id, file_path, thumb_path, mime, width, height, size, sha256, caption, sort)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (iuid, doi_id, rel, thumb_rel, repo.IMAGE_TYPES[im["ext"]], im["width"], im["height"], im["size"], im["sha256"],
                     im["caption"], n))
            stats[{"import": "imported", "both": "both", "overwrite": "overwritten"}[action]] += 1

        # C. move replaced files to .trash, then rename *.part -> final; undo everything if any step fails
        for rel in dict.fromkeys(trash_files):
            _move_to_trash(root, rel, tag, undo)
        for part in parts:
            final = part.with_name(part.name[:-5])
            part.replace(final)
            undo.append(lambda f=final: f.unlink(missing_ok=True))
        conn.commit()
    except Exception:
        conn.rollback()
        for fn in reversed(undo):
            try:
                fn()
            except OSError:
                pass
        for part in parts:
            part.unlink(missing_ok=True)
        raise
    return stats


def _write_snapshot(root: Path, tag: str, row: sqlite3.Row, images: list[sqlite3.Row], undo: list[Any]) -> None:
    trash = root / ".trash"
    trash.mkdir(parents=True, exist_ok=True)
    snap = trash / f"overwritten_{tag}_{row['uid']}.json"
    body = {k: row[k] for k in row.keys()} | {"images": [{k: i[k] for k in i.keys()} for i in images]}
    snap.write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8")
    undo.append(lambda: snap.unlink(missing_ok=True))


def _move_to_trash(root: Path, rel: str, tag: str, undo: list[Any]) -> None:
    src = repo._inside(root, rel)
    if not src.is_file():
        return
    dest_dir = root / ".trash"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{tag}_replaced_{src.name}"
    n = 1
    while dest.exists():
        dest = dest_dir / f"{tag}_replaced_{n}_{src.name}"
        n += 1
    shutil.move(str(src), str(dest))
    undo.append(lambda: shutil.move(str(dest), str(src)))
