"""PowerPoint attachments of a page (V-002, D-37). Two modes, chosen by the user, never mixed up silently:

* ``upload`` - the file is copied into ``<page>/files/`` (size limit, sha256).
* ``link``   - only the absolute local/UNC path is remembered; the file is never copied.

Each attachment is a small, human-readable sidecar ``<page>/files/ppt-<id>.json``. Everything derived (slide
pictures, outline) lives in ``<data>/ppt_cache/<sha256>/`` and can be deleted at any time.
Opening in PowerPoint is only allowed for files that are inside the vault (upload) or at the validated link path,
only with a whitelisted extension, and never goes through a shell.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
from dataclasses import asdict
from datetime import datetime
from pathlib import Path, PureWindowsPath
from typing import Any

from app import pptx_read
from app.vault import Vault, VaultError

EXTS = {".ppt", ".pptx", ".pptm"}          # what may be attached / opened (PowerPoint documents, no shows/templates)
READABLE = {".pptx", ".pptm"}               # what pptx_read can parse (.ppt is the old binary format)
MAX_BYTES = pptx_read.MAX_BYTES
IMG_EXTS = (".png", ".jpg", ".jpeg")
_ID = re.compile(r"^[0-9a-f]{8}$")
_KEY = re.compile(r"^[0-9a-f]{20}$")
_CHUNK = 1024 * 1024
OUTLINE = "outline.json"


class PptError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


# ---- link validation ----------------------------------------------------------------------------------------------

def check_link(raw: str) -> tuple[str, Path]:
    """Validate a user-typed path. Returns (normalised text, Path). Only absolute drive / UNC paths to an existing
    file with a PowerPoint extension are accepted. Nothing is opened or copied here."""
    text = (raw or "").strip().strip('"').strip()
    if not text or "\x00" in text or "\n" in text:
        raise PptError("파일 경로를 입력하세요.")
    win = PureWindowsPath(text)
    if not (win.drive and win.root):
        raise PptError("전체 경로를 입력하세요. 예: D:\\보고\\주간.pptx 또는 \\\\서버\\공유\\주간.pptx")
    if ".." in win.parts:
        raise PptError("경로에 ‘..’ 는 쓸 수 없어요.")
    if win.suffix.lower() not in EXTS:
        raise PptError("PowerPoint 파일(.pptx · .pptm · .ppt)만 연결할 수 있어요.")
    path = Path(text)
    try:
        ok = path.is_file()
    except OSError:
        ok = False
    if not ok:
        raise PptError("그 경로에서 파일을 찾지 못했어요. 이동했거나 공유 폴더에 연결되지 않았을 수 있어요.", 404)
    return text, path


def _hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(_CHUNK):
            h.update(chunk)
    return h.hexdigest()


# ---- sidecars -----------------------------------------------------------------------------------------------------

class PptStore:
    def __init__(self, vault: Vault, cache_root: Path) -> None:
        self.vault = vault
        self.cache_root = cache_root

    # -- locations
    def _files(self, page: str) -> Path:
        try:
            return self.vault._dir(page) / "files"
        except VaultError as exc:
            raise PptError(str(exc), exc.status) from exc

    def _sidecar(self, page: str, pid: str) -> Path:
        if not _ID.match(pid or ""):
            raise PptError("잘못된 첨부 번호예요.")
        return self._files(page) / f"ppt-{pid}.json"

    def _load(self, page: str, pid: str) -> dict[str, Any]:
        side = self._sidecar(page, pid)
        try:
            return json.loads(side.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise PptError("첨부를 찾을 수 없어요.", 404) from exc

    def _save(self, page: str, rec: dict[str, Any]) -> None:
        side = self._sidecar(page, rec["id"])
        side.parent.mkdir(exist_ok=True)
        side.write_text(json.dumps(rec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def target(self, page: str, rec: dict[str, Any]) -> Path:
        """Where the file really is. Upload: inside this page's files/ only. Link: the validated absolute path."""
        if rec["mode"] == "upload":
            name = rec.get("file") or ""
            if not name or name != Path(name).name or name.startswith("."):
                raise PptError("잘못된 파일 이름이에요.")
            path = self._files(page) / name
            root = self.vault.root.resolve()
            try:
                path.resolve().relative_to(root)
            except ValueError as exc:
                raise PptError("보관함 밖의 파일은 열 수 없어요.", 403) from exc
            return path
        return Path(rec["link"])

    # -- public view of a record
    def describe(self, page: str, rec: dict[str, Any]) -> dict[str, Any]:
        path = self.target(page, rec)
        try:
            st = path.stat() if path.is_file() else None
        except OSError:
            st = None
        suffix = path.suffix.lower()
        out = {
            "id": rec["id"], "mode": rec["mode"], "name": rec["name"], "ext": suffix,
            "size": rec.get("size", 0), "sha256": rec.get("sha256", ""), "added": rec.get("added", ""),
            "link": rec.get("link", "") if rec["mode"] == "link" else "",
            "readable": suffix in READABLE,
            "missing": st is None,
            # the file on disk is no longer the one we last read -> the previews are stale until 새로고침
            "changed": bool(st and (st.st_size != rec.get("size") or int(st.st_mtime) != int(rec.get("mtime", 0)))),
            "rendered": bool(self._render_dir(path)) if rec["mode"] == "link" else False,
        }
        return out

    def list(self, page: str) -> list[dict[str, Any]]:
        folder = self._files(page)
        recs = []
        if folder.is_dir():
            for side in sorted(folder.glob("ppt-*.json")):
                try:
                    rec = json.loads(side.read_text(encoding="utf-8"))
                    if _ID.match(str(rec.get("id"))) and rec.get("mode") in ("upload", "link"):
                        recs.append(rec)
                except (OSError, ValueError):
                    continue
        recs.sort(key=lambda r: r.get("added", ""))
        return [self.describe(page, r) for r in recs]

    # -- create
    def _new_id(self, page: str) -> str:
        while True:
            pid = secrets.token_hex(4)
            if not self._sidecar(page, pid).exists():
                return pid

    def add_upload(self, page: str, name: str, data: bytes) -> dict[str, Any]:
        clean = pptx_read.clean_filename(name or "presentation.pptx")
        if Path(clean).suffix.lower() not in EXTS:
            raise PptError("PowerPoint 파일(.pptx · .pptm · .ppt)만 올릴 수 있어요.")
        if not data:
            raise PptError("빈 파일이에요.")
        if len(data) > MAX_BYTES:
            raise PptError(f"파일이 너무 커요 ({MAX_BYTES // 1024 // 1024}MB까지). 크면 ‘링크만’으로 연결하세요.")
        folder = self._files(page)
        folder.mkdir(exist_ok=True)
        stem, suffix = Path(clean).stem, Path(clean).suffix
        target, n = folder / clean, 2
        while target.exists():
            target = folder / f"{stem} ({n}){suffix}"
            n += 1
        target.write_bytes(data)
        pid = self._new_id(page)
        rec = {"id": pid, "mode": "upload", "name": clean, "file": target.name, "size": len(data),
               "mtime": int(target.stat().st_mtime), "sha256": hashlib.sha256(data).hexdigest(), "added": _now()}
        self._save(page, rec)
        return self.describe(page, rec)

    def add_link(self, page: str, raw: str) -> dict[str, Any]:
        text, path = check_link(raw)
        st = path.stat()
        pid = self._new_id(page)
        rec = {"id": pid, "mode": "link", "name": PureWindowsPath(text).name, "link": text, "size": st.st_size,
               "mtime": int(st.st_mtime), "sha256": _hash_file(path), "added": _now()}
        self._save(page, rec)
        return self.describe(page, rec)

    # -- refresh / remove
    def refresh(self, page: str, pid: str) -> dict[str, Any]:
        """Re-read the file's identity (size, mtime, sha256). A changed hash drops the cached previews."""
        rec = self._load(page, pid)
        path = self.target(page, rec)
        if not path.is_file():
            raise PptError("파일을 찾을 수 없어요. 경로나 연결을 확인하세요.", 404)
        digest = _hash_file(path)
        st = path.stat()
        changed = digest != rec.get("sha256")
        rec.update(sha256=digest, size=st.st_size, mtime=int(st.st_mtime))
        if rec["mode"] == "link":
            rec["name"] = path.name
        self._save(page, rec)
        return {**self.describe(page, rec), "refreshed": changed}

    def remove(self, page: str, pid: str) -> dict[str, Any]:
        """Sidecar (and the uploaded copy) go to vault/.trash. A linked file is never touched."""
        rec = self._load(page, pid)
        trash = self.vault.trash
        trash.mkdir(exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        dest = trash / f"{stamp}_ppt-{pid}"
        dest.mkdir(exist_ok=True)
        shutil.move(str(self._sidecar(page, pid)), str(dest / f"ppt-{pid}.json"))
        if rec["mode"] == "upload":
            path = self.target(page, rec)
            if path.is_file():
                shutil.move(str(path), str(dest / path.name))
        return {"trashed": dest.relative_to(self.vault.root).as_posix()}

    # -- previews ------------------------------------------------------------------------------------------------
    def _cache(self, sha: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{64}", sha or ""):
            raise PptError("미리보기를 만들 수 없어요.")
        return self.cache_root / sha[:32]

    def outline(self, page: str, pid: str) -> dict[str, Any]:
        rec = self._load(page, pid)
        path = self.target(page, rec)
        base = self.describe(page, rec)
        if base["missing"]:
            raise PptError("파일을 찾을 수 없어요. 경로나 연결을 확인하세요.", 404)
        if not base["readable"]:
            return {**base, "slides": [], "warnings": [], "reason": "옛 형식(.ppt)은 미리보기를 만들 수 없어요. PowerPoint에서 열거나 .pptx로 저장해 다시 올려 주세요."}
        if base["changed"]:
            self.refresh(page, pid)  # the file moved on: previews follow it
            rec = self._load(page, pid)
            base = self.describe(page, rec)
        cache = self._cache(rec["sha256"])
        cached = cache / OUTLINE
        if cached.is_file():
            try:
                data = json.loads(cached.read_text(encoding="utf-8"))
                return {**base, **self._decorate(page, pid, rec, data)}
            except (OSError, ValueError):
                pass
        size = path.stat().st_size
        if size > MAX_BYTES:
            return {**base, "slides": [], "warnings": [], "reason": f"파일이 {MAX_BYTES // 1024 // 1024}MB를 넘어 미리보기를 만들지 않아요. PowerPoint에서 열어 주세요."}
        try:
            cache.mkdir(parents=True, exist_ok=True)
            slides, warnings = pptx_read.read_pptx(path.read_bytes(), cache)
        except pptx_read.PptxError as exc:
            return {**base, "slides": [], "warnings": [], "reason": str(exc)}
        except OSError as exc:
            raise PptError("파일을 읽지 못했어요. 다른 프로그램이 쓰는 중일 수 있어요.", 423) from exc
        data = {"warnings": warnings, "slides": [_slide_dict(s) for s in slides]}
        cache.mkdir(parents=True, exist_ok=True)
        (cache / OUTLINE).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return {**base, **self._decorate(page, pid, rec, data)}

    def _decorate(self, page: str, pid: str, rec: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
        """Add what depends on the current disk state (pre-rendered slide pictures) to the cached outline."""
        path = self.target(page, rec)
        folder = self._render_dir(path) if rec["mode"] == "link" else None
        slides = []
        for s in data["slides"]:
            has = bool(folder and self._render_file(folder, s["index"]))
            slides.append({**s, "rendered": has})
        return {"warnings": data["warnings"], "slides": slides, "reason": "", "rendered": bool(folder)}

    # pre-rendered slide pictures (optional): the folder PowerPoint's "다른 이름으로 저장 > PNG" writes next to the deck
    @staticmethod
    def _render_dir(path: Path) -> Path | None:
        for cand in (path.with_suffix(""), path.with_name(path.stem + ".slides"), path.with_name(path.stem + "_slides")):
            try:
                if cand.is_dir():
                    return cand
            except OSError:
                continue
        return None

    @staticmethod
    def _render_file(folder: Path, n: int) -> Path | None:
        for stem in (f"Slide{n}", f"슬라이드{n}", f"slide{n}", f"Slide{n:02d}", f"{n}"):
            for ext in IMG_EXTS + tuple(e.upper() for e in IMG_EXTS):
                cand = folder / f"{stem}{ext}"
                try:
                    if cand.is_file() and cand.stat().st_size <= pptx_read.MAX_IMAGE:
                        return cand
                except OSError:
                    continue
        return None

    def rendered_slide(self, page: str, pid: str, n: int) -> Path:
        rec = self._load(page, pid)
        if rec["mode"] != "link":
            raise PptError("슬라이드 그림이 없어요.", 404)
        folder = self._render_dir(self.target(page, rec))
        found = self._render_file(folder, int(n)) if folder else None
        if not found:
            raise PptError("슬라이드 그림이 없어요.", 404)
        return found

    def media(self, page: str, pid: str, key: str, ext: str) -> Path:
        rec = self._load(page, pid)
        if not _KEY.match(key or "") or ext not in {"png", "jpg", "gif", "webp", "bmp"}:
            raise PptError("잘못된 그림이에요.")
        path = self._cache(rec["sha256"]) / f"{key}.{ext}"
        if not path.is_file():
            raise PptError("그림을 찾을 수 없어요.", 404)
        return path

    def cover(self, page: str, pid: str) -> tuple[bytes, str]:
        """docProps/thumbnail of the deck (PowerPoint stores the first slide there)."""
        from zipfile import BadZipFile, ZipFile
        rec = self._load(page, pid)
        path = self.target(page, rec)
        if path.suffix.lower() not in READABLE or not path.is_file():
            raise PptError("표지 그림이 없어요.", 404)
        try:
            with ZipFile(path) as zf:
                for name in zf.namelist():
                    if name.lower().startswith("docprops/thumbnail."):
                        info = zf.getinfo(name)
                        if info.file_size <= pptx_read.MAX_IMAGE:
                            data = zf.read(info)
                            ext, why = pptx_read._sniff(data)
                            if not why:
                                return data, "image/jpeg" if ext == "jpg" else f"image/{ext}"
        except (BadZipFile, OSError, RuntimeError):
            pass
        raise PptError("표지 그림이 없어요.", 404)

    # -- open in PowerPoint --------------------------------------------------------------------------------------
    def open_in_powerpoint(self, page: str, pid: str, opener=None) -> dict[str, Any]:
        rec = self._load(page, pid)
        path = self.target(page, rec)
        if path.suffix.lower() not in EXTS:
            raise PptError("PowerPoint 파일만 열 수 있어요.", 403)
        if rec["mode"] == "link":
            _, path = check_link(rec["link"])  # re-validated at the moment of opening
        elif not path.is_file():
            raise PptError("파일을 찾을 수 없어요.", 404)
        launch = opener or getattr(os, "startfile", None)
        if launch is None:
            raise PptError("이 컴퓨터(Windows가 아님)에서는 PowerPoint를 바로 열 수 없어요. 파일을 직접 열어 주세요.", 501)
        try:
            launch(str(path))  # os.startfile: ShellExecute 'open' on a document path, no shell string is built
        except OSError as exc:
            raise PptError("PowerPoint를 열지 못했어요. PowerPoint가 설치돼 있는지 확인하세요.", 500) from exc
        return {"opened": True, "name": path.name}


def _slide_dict(s: pptx_read.SlideInfo) -> dict[str, Any]:
    return {
        "index": s.index, "title": s.title, "body": s.body[:4000], "notes": s.notes[:4000], "hidden": s.hidden,
        "images": [{"key": p.key, "ext": p.ext, "w": p.width, "h": p.height, "caption": p.caption} for p in s.images],
        "skipped": len(s.skipped),
    }
