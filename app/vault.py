from __future__ import annotations

import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_VAULT_PATH = ROOT / "vault"
PAGE_TYPES = {"note", "html", "journal", "board", "table"}
META = "_page.json"
ISSUE_FILES = ".issue-files"  # images of issues that have no page yet: <vault>/.issue-files/<task id>/
RESERVED_DIRS = {"files"}  # attachments live here, never pages
IMAGE_EXTS = {".png", ".jpg", ".gif", ".webp", ".bmp"}  # no svg: it can carry script
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
_BAD_CHARS = re.compile(r'[\/:*?"<>|\x00-\x1f]')


class VaultError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _safe_name(title: str) -> str:
    name = _BAD_CHARS.sub("", title).strip().rstrip(". ")
    if not name or name.startswith(".") or name in RESERVED_DIRS:
        raise VaultError("제목을 사용할 수 없습니다.")
    return name


def _content_file(page_type: str) -> str:
    return "index.html" if page_type == "html" else "index.md"


class Vault:
    def __init__(self, root: Path = DEFAULT_VAULT_PATH) -> None:
        self.root = root
        self.trash = root / ".trash"
        root.mkdir(parents=True, exist_ok=True)

    # ---- path handling -------------------------------------------------
    def _dir(self, rel: str, *, must_exist: bool = True) -> Path:
        rel = rel.strip("/").replace("\\", "/")
        parts = [p for p in rel.split("/") if p]
        if any(p in (".", "..") or p.startswith(".") or p in RESERVED_DIRS for p in parts):
            raise VaultError("잘못된 경로입니다.")
        path = self.root.joinpath(*parts)
        if must_exist and parts and not (path / META).is_file():
            raise VaultError("페이지를 찾을 수 없습니다.", 404)
        return path

    def _rel(self, path: Path) -> str:
        return path.relative_to(self.root).as_posix()

    @staticmethod
    def _read_meta(page_dir: Path) -> dict[str, Any]:
        return json.loads((page_dir / META).read_text(encoding="utf-8"))

    @staticmethod
    def _write_meta(page_dir: Path, meta: dict[str, Any]) -> None:
        meta["updated"] = _now()
        (page_dir / META).write_text(
            json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    def _children(self, parent: Path) -> list[Path]:
        kids = [
            d for d in parent.iterdir()
            if d.is_dir() and not d.name.startswith(".") and d.name not in RESERVED_DIRS
            and (d / META).is_file()
        ]
        return sorted(kids, key=lambda d: (self._read_meta(d).get("order", 0), d.name))

    # ---- operations ----------------------------------------------------
    def tree(self, parent: Path | None = None) -> list[dict[str, Any]]:
        parent = parent or self.root
        out = []
        for d in self._children(parent):
            meta = self._read_meta(d)
            out.append({
                "path": self._rel(d),
                "title": meta.get("title", d.name),
                "type": meta.get("type", "note"),
                "order": meta.get("order", 0),
                "icon": meta.get("icon"),
                "task_id": meta.get("task_id"),
                "auto": bool(meta.get("auto")),
                "children": self.tree(d),
            })
        return out

    def exists(self, rel: str) -> bool:
        try:
            self._dir(rel)
        except VaultError:
            return False
        return True

    def create(self, parent: str, title: str, page_type: str = "note",
               folder_name: str | None = None, extra_meta: dict[str, Any] | None = None) -> dict[str, Any]:
        """Create a page. folder_name pins the folder (used for stable journal paths);
        extra_meta adds keys (e.g. task_id for an issue page) to the very first _page.json write."""
        if page_type not in PAGE_TYPES:
            raise VaultError("알 수 없는 페이지 종류입니다.")
        parent_dir = self._dir(parent)
        folder = self._unique_dir(parent_dir, _safe_name(folder_name or title))
        folder.mkdir()
        siblings = [self._read_meta(d).get("order", 0) for d in self._children(parent_dir) if d != folder]
        now = _now()
        meta = {"type": page_type, "title": title.strip(), "order": max(siblings, default=-1) + 1,
                "created": now, **(extra_meta or {})}
        self._write_meta(folder, meta)
        (folder / _content_file(page_type)).write_text("", encoding="utf-8")
        return self.read(self._rel(folder))

    # ---- issue pages / placement support (P2B-09) ---------------------------
    def unique_name(self, parent: str, name: str) -> str:
        """The folder name a new page called `name` would get under `parent` (parent may not exist yet)."""
        base = self.root.joinpath(*[p for p in parent.split("/") if p])
        if not base.exists():
            return name
        return self._unique_dir(base, name).name

    def find_by_task(self, task_id: int) -> str | None:
        """Path of the page whose _page.json says it belongs to this issue (the stable identity)."""
        stack = [self.root]
        while stack:
            for d in self._children(stack.pop()):
                try:
                    if self._read_meta(d).get("task_id") == task_id:
                        return self._rel(d)
                except (OSError, ValueError):
                    continue
                stack.append(d)
        return None

    def discard_created(self, rels: list[str]) -> None:
        """Roll back pages this very operation created (deepest first). A folder that has meanwhile
        gained child pages is kept. User data is never touched: callers pass only their own creations."""
        for rel in sorted(rels, key=lambda r: r.count("/"), reverse=True):
            try:
                page = self._dir(rel)
            except VaultError:
                continue
            if page == self.root or self._children(page):
                continue
            shutil.rmtree(page, ignore_errors=True)

    def rollback_move(self, moved_rel: str, original_rel: str, meta: dict[str, Any]) -> None:
        """Undo Vault.update(parent=...): put the folder back exactly where it was, with its old meta."""
        src = self._dir(moved_rel)
        dest = self.root.joinpath(*original_rel.split("/"))
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dest))
        (dest / META).write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    @staticmethod
    def _unique_dir(parent: Path, name: str) -> Path:
        candidate, n = parent / name, 2
        while candidate.exists():
            candidate = parent / f"{name} ({n})"
            n += 1
        return candidate

    def read(self, rel: str) -> dict[str, Any]:
        page = self._dir(rel)
        meta = self._read_meta(page)
        content_file = page / _content_file(meta.get("type", "note"))
        content = content_file.read_text(encoding="utf-8") if content_file.is_file() else ""
        return {"path": self._rel(page), "meta": meta, "content": content}

    def write(self, rel: str, content: str) -> dict[str, Any]:
        page = self._dir(rel)
        meta = self._read_meta(page)
        (page / _content_file(meta.get("type", "note"))).write_text(content, encoding="utf-8")
        self._write_meta(page, meta)
        return self.read(rel)

    # ---- attachments (pasted images) -------------------------------------
    @staticmethod
    def _store(folder: Path, name: str, data: bytes) -> str:
        ext = Path(name or "").suffix.lower()
        if ext == ".jpeg":
            ext = ".jpg"
        if ext not in IMAGE_EXTS:
            raise VaultError("지원하지 않는 이미지 형식입니다.")
        if not data:
            raise VaultError("빈 파일입니다.")
        if len(data) > MAX_UPLOAD_BYTES:
            raise VaultError("이미지가 너무 큽니다 (최대 20MB).")
        folder.mkdir(parents=True, exist_ok=True)
        stem = f"img-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        target, n = folder / f"{stem}{ext}", 2
        while target.exists():
            target = folder / f"{stem}-{n}{ext}"
            n += 1
        target.write_bytes(data)
        return f"files/{target.name}"

    @staticmethod
    def _image(folder: Path, name: str) -> Path:
        if not name or name != Path(name).name or name.startswith("."):
            raise VaultError("잘못된 파일 이름입니다.")
        target = folder / name
        if target.suffix.lower() not in IMAGE_EXTS or not target.is_file():
            raise VaultError("파일을 찾을 수 없습니다.", 404)
        return target

    def save_file(self, rel: str, name: str, data: bytes) -> str:
        """Store an image under <page>/files/ and return its page-relative path."""
        return self._store(self._dir(rel) / "files", name, data)

    def file_path(self, rel: str, name: str) -> Path:
        return self._image(self._dir(rel) / "files", name)

    # ---- images of an issue that has no page (moved into the page when it is created) ------------
    def _issue_dir(self, task_id: int) -> Path:
        return self.root / ISSUE_FILES / str(int(task_id))

    def save_issue_file(self, task_id: int, name: str, data: bytes) -> str:
        return self._store(self._issue_dir(task_id), name, data)

    def issue_file_path(self, task_id: int, name: str) -> Path:
        return self._image(self._issue_dir(task_id), name)

    def adopt_issue_files(self, task_id: int, page_rel: str) -> None:
        """The issue got a page: its images move into <page>/files/ (markdown refs `files/x` stay valid)."""
        src = self._issue_dir(task_id)
        if not src.is_dir():
            return
        dest = self._dir(page_rel) / "files"
        dest.mkdir(exist_ok=True)
        for f in src.iterdir():
            if f.is_file() and not (dest / f.name).exists():
                shutil.move(str(f), str(dest / f.name))
        try:
            src.rmdir()
        except OSError:
            pass  # something is left behind: keep it (nothing is deleted)

    def copy_issue_files(self, page_rel: str | None, src_task_id: int, dst_task_id: int) -> None:
        """Copy every image of the source issue (page folder or issue folder) into the new issue's folder."""
        sources = [self._issue_dir(src_task_id)]
        if page_rel:
            sources.insert(0, self._dir(page_rel) / "files")
        dest = self._issue_dir(dst_task_id)
        for folder in sources:
            if not folder.is_dir():
                continue
            for f in folder.iterdir():
                if f.is_file() and f.suffix.lower() in IMAGE_EXTS and not (dest / f.name).exists():
                    dest.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(f, dest / f.name)

    def set_meta(self, rel: str, **values: Any) -> None:
        """Add/replace keys in _page.json (used for the memo-unification stamp)."""
        page = self._dir(rel)
        meta = self._read_meta(page)
        meta.update(values)
        self._write_meta(page, meta)

    def update(self, rel: str, *, title: str | None = None, parent: str | None = None,
               order: int | None = None) -> dict[str, Any]:
        page = self._dir(rel)
        if page == self.root:
            raise VaultError("루트는 바꿀 수 없습니다.")
        meta = self._read_meta(page)
        target_parent = page.parent
        if parent is not None:
            target_parent = self._dir(parent)
            if target_parent == page or page in target_parent.parents:
                raise VaultError("자기 하위로 옮길 수 없습니다.")
        name = page.name
        if title is not None:
            name = _safe_name(title)
            meta["title"] = title.strip()
        if order is not None:
            meta["order"] = order
        dest = page
        if target_parent != page.parent or name != page.name:
            dest = self._unique_dir(target_parent, name)
            shutil.move(str(page), str(dest))
        self._write_meta(dest, meta)
        return self.read(self._rel(dest))

    def delete(self, rel: str) -> str:
        page = self._dir(rel)
        if page == self.root:
            raise VaultError("루트는 삭제할 수 없습니다.")
        self.trash.mkdir(exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        dest = self._unique_dir(self.trash, f"{stamp}_{page.name}")
        shutil.move(str(page), str(dest))
        return dest.relative_to(self.root).as_posix()
