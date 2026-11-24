"""RCP collection (P6-02, D-36): list -> name filter -> download to a content-addressed cache -> snapshots.

Read-only toward the equipment (only `ReadOnlyFtp`). Writes go to `data/recipes/` and the local DB. Run messages and
errors use `rcp_ftp.describe`, so host, account and password never reach the DB, logs or API.
"""
from __future__ import annotations

import fnmatch
import hashlib
import json
import os
import shutil
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from app import db
from app.repositories import recipes as repo
from app.repositories.recipes import FileIn
from app.rcp_ftp import Entry, FtpProblem, ReadOnlyFtp, TooBig, describe, valid_name

MB = 1024 * 1024
MAX_ERRORS = 100  # errors kept in the run row (the count keeps going)


@dataclass
class Limits:
    max_files: int = 2000
    max_file_bytes: int = 20 * MB
    max_total_bytes: int = 500 * MB
    max_seconds: int = 900
    max_depth: int = 4
    max_listed: int = 20000

    @classmethod
    def from_config(cls, raw: dict[str, int]) -> "Limits":
        known = {k: v for k, v in raw.items() if k in cls.__dataclass_fields__}
        return cls(**known)


def blob_rel(sha: str) -> str:
    return f"blobs/{sha[:2]}/{sha}"


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def glob_hit(rel_path: str, globs: list[str]) -> bool:
    """Case-insensitive; a pattern without `/` is matched against the file name only. No patterns = everything."""
    if not globs:
        return True
    rel, base = rel_path.lower(), rel_path.rsplit("/", 1)[-1].lower()
    return any(fnmatch.fnmatchcase(rel if "/" in g else base, g.lower()) for g in globs)


# ---- runs ---------------------------------------------------------------------------------------------------

def create_run(conn, source_id: int | None, status: str = "running") -> int:
    cur = conn.execute("INSERT INTO recipe_runs (source_id, started_at, status) VALUES (?,?,?)",
                       (source_id, _now(), status))
    conn.commit()
    return cur.lastrowid


def reap_stale(conn) -> int:
    """Runs left `running` by an app restart can never finish: close them so the UI is not stuck."""
    cur = conn.execute("UPDATE recipe_runs SET status='error', finished_at=?, message=? WHERE status='running'",
                       (_now(), "앱이 종료되어 수집이 중단됐어요."))
    conn.commit()
    return cur.rowcount


class _Run:
    def __init__(self, conn, run_id: int) -> None:
        self.conn, self.run_id = conn, run_id
        self.listed = self.matched = self.downloaded = self.unchanged = self.new_snapshots = 0
        self.errors: list[dict[str, str]] = []
        self.error_count = 0
        self.recipes_ok = 0

    def error(self, recipe: str, file: str, message: str) -> None:
        self.error_count += 1
        if len(self.errors) < MAX_ERRORS:
            self.errors.append({"recipe": recipe, "file": file, "message": message})

    def save(self, status: str | None = None, message: str | None = None) -> None:
        sets = ["listed=?", "matched=?", "downloaded=?", "unchanged=?", "new_snapshots=?", "errors=?"]
        args: list[Any] = [self.listed, self.matched, self.downloaded, self.unchanged, self.new_snapshots,
                           json.dumps(self.errors, ensure_ascii=False)]
        if status:
            sets += ["status=?", "finished_at=?"]
            args += [status, _now()]
        if message is not None:
            sets.append("message=?")
            args.append(message)
        self.conn.execute(f"UPDATE recipe_runs SET {', '.join(sets)} WHERE id=?", (*args, self.run_id))
        self.conn.commit()


class _Stop(Exception):
    """Run-level stop (cancel, time, size or count limit). `.status` is the final run status."""

    def __init__(self, status: str, message: str) -> None:
        super().__init__(message)
        self.status = status


# ---- listing ------------------------------------------------------------------------------------------------

def list_candidates(ftp: ReadOnlyFtp, remote_dir: str, layout: str, limits: Limits) -> tuple[list[Entry], list[str]]:
    """Recipe candidates of a source (folders for `folder`, files for `file`) and the names rejected as unsafe."""
    entries = ftp.list_dir(remote_dir)
    if len(entries) > limits.max_listed:
        raise FtpProblem(f"목록이 너무 많아요({limits.max_listed:,}개 초과). 경로를 더 좁혀 주세요.")
    want_dir = layout == "folder"
    good: list[Entry] = []
    rejected: list[str] = []
    for e in entries:
        if e.is_dir != want_dir:
            continue
        if valid_name(e.name):
            good.append(e)
        else:
            rejected.append(e.name)
    return good, rejected


def _walk(ftp: ReadOnlyFtp, base: str, rel: str, depth: int, limits: Limits, out: list[tuple[str, str, Entry]],
          problems: list[str]) -> None:
    for e in ftp.list_dir(base):
        if not valid_name(e.name):
            problems.append(f"안전하지 않은 이름을 건너뛰었어요 ({e.name[:40]!r})")
            continue
        r = f"{rel}/{e.name}" if rel else e.name
        p = f"{base.rstrip('/')}/{e.name}"
        if e.is_dir:
            if depth < limits.max_depth:
                _walk(ftp, p, r, depth + 1, limits, out, problems)
            else:
                problems.append(f"폴더가 너무 깊어서 {r} 아래는 건너뛰었어요.")
        else:
            out.append((r, p, e))


# ---- collection ---------------------------------------------------------------------------------------------

def run_collection(db_path: Path, data_dir: Path, source_id: int, run_id: int, ftp_open: Callable[[], Any],
                   secrets: list[str], limits: Limits, cancel: threading.Event) -> None:
    """Whole run (meant for a worker thread). Always finishes the run row, whatever happens."""
    conn = db.connect(db_path)
    run = _Run(conn, run_id)
    tmp = data_dir / ".tmp" / str(run_id)
    ftp: ReadOnlyFtp | None = None
    deadline = time.monotonic() + limits.max_seconds
    status, message = "error", ""
    try:
        source = repo.get_source(conn, source_id)
        rules, globs = source["name_filter"], source["file_globs"]
        tmp.mkdir(parents=True, exist_ok=True)
        ftp = ReadOnlyFtp(ftp_open)
        candidates, rejected = list_candidates(ftp, source["remote_dir"], source["layout"], limits)
        for name in rejected:
            run.error(str(name)[:60], "", "안전하지 않은 이름이라 건너뛰었어요.")
        run.listed = len(candidates)
        picked = [c for c in candidates if repo.name_matches(c.name, rules)]
        run.matched = len(picked)
        run.save()
        total = {"bytes": 0, "files": 0}
        for entry in picked:
            if cancel.is_set():
                raise _Stop("cancelled", "사용자가 수집을 취소했어요.")
            if time.monotonic() > deadline:
                raise _Stop("partial", f"실행 시간 한도({limits.max_seconds}초)에 닿아 중단했어요.")
            _collect_recipe(conn, ftp, run, source, entry, globs, limits, tmp, data_dir, total, secrets, cancel)
            run.save()
        complete = run.error_count == 0
        if complete and run.listed > 0:
            seen = [c.name for c in picked]
            _mark_missing(conn, source_id, seen)
        status = "ok" if complete else ("partial" if run.recipes_ok else "error")
        message = (f"레시피 {run.matched}개 확인 · 새 버전 {run.new_snapshots}개 · 변화 없음 {run.unchanged}개"
                   + ("" if complete else f" · 문제 {run.error_count}건"))
        if complete and run.listed == 0:
            message += " · 목록이 비어 있어 누락 표시는 하지 않았어요."
        if ftp.used_list_fallback:
            message += " (MLSD 미지원 서버: LIST로 읽음)"
    except _Stop as stop:
        status, message = stop.status, str(stop)
    except Exception as exc:  # noqa: BLE001 - the run must always be closed with a safe message
        status, message = "error", describe(exc, secrets)
    finally:
        try:
            if ftp:
                ftp.close()
            shutil.rmtree(tmp, ignore_errors=True)
            run.save(status, message)
        finally:
            conn.close()


def _mark_missing(conn, source_id: int, seen: list[str]) -> None:
    """Only after a fully successful run: recipes not seen this time are flagged, never deleted."""
    names = {n for n in seen}
    for row in conn.execute("SELECT id, name FROM recipes WHERE source_id = ? AND missing = 0", (source_id,)).fetchall():
        if row["name"] not in names:
            conn.execute("UPDATE recipes SET missing = 1 WHERE id = ?", (row["id"],))
    conn.commit()


def _collect_recipe(conn, ftp: ReadOnlyFtp, run: _Run, source: dict[str, Any], entry: Entry, globs: list[str],
                    limits: Limits, tmp: Path, data_dir: Path, total: dict[str, int], secrets: list[str],
                    cancel: threading.Event) -> None:
    name = entry.name
    base = source["remote_dir"].rstrip("/") + "/" + name if source["remote_dir"] else name
    problems: list[str] = []
    found: list[tuple[str, str, Entry]] = []
    try:
        if source["layout"] == "folder":
            _walk(ftp, base, "", 1, limits, found, problems)
            found = [f for f in found if glob_hit(f[0], globs)]
        elif glob_hit(name, globs):
            found = [(name, base, entry)]
    except Exception as exc:  # noqa: BLE001
        run.error(name, "", describe(exc, secrets))
        _recover(ftp)
        return
    for p in problems:
        run.error(name, "", p)
    if not found:
        run.error(name, "", "파일 패턴에 맞는 파일이 없어요.")
        return
    if total["files"] + len(found) > limits.max_files:
        raise _Stop("partial", f"실행당 파일 {limits.max_files:,}개 한도에 닿아 중단했어요.")
    files: list[FileIn] = []
    for i, (rel, path, e) in enumerate(sorted(found, key=lambda f: f[0])):
        if cancel.is_set():
            raise _Stop("cancelled", "사용자가 수집을 취소했어요.")
        part = tmp / f"{len(files)}_{hashlib.sha1(rel.encode('utf-8', 'replace')).hexdigest()[:10]}.part"
        try:
            sha, size = _download(ftp, path, part, limits, total)
        except _Stop:
            raise
        except Exception as exc:  # noqa: BLE001
            run.error(name, rel, describe(exc, secrets))
            part.unlink(missing_ok=True)
            if not isinstance(exc, TooBig):
                _recover(ftp)
            return  # the recipe keeps its previous snapshot; nothing half-collected is stored
        _store_blob(part, data_dir, sha)
        files.append(FileIn(rel, sha, size, blob_rel(sha), remote_mtime=e.mtime))
        run.downloaded += 1
        total["files"] += 1
    rid = repo.upsert_recipe(conn, source["id"], name, base)
    _, created = repo.add_snapshot(conn, rid, files, run.run_id)
    conn.commit()
    run.recipes_ok += 1
    if created:
        run.new_snapshots += 1
    else:
        run.unchanged += 1


def _recover(ftp: ReadOnlyFtp) -> None:
    try:
        ftp.reconnect()
    except Exception as exc:  # noqa: BLE001
        raise _Stop("error", "서버와의 연결이 끊겨 다시 연결하지 못했어요.") from exc


def _download(ftp: ReadOnlyFtp, path: str, part: Path, limits: Limits, total: dict[str, int]) -> tuple[str, int]:
    h = hashlib.sha256()
    size = 0
    with open(part, "wb") as out:
        def sink(data: bytes) -> None:
            nonlocal size
            h.update(data)
            out.write(data)
            size += len(data)
            if total["bytes"] + size > limits.max_total_bytes:
                raise _Stop("partial", f"실행당 합계 {limits.max_total_bytes // MB}MB 한도에 닿아 중단했어요.")
        ftp.retrieve(path, sink, limits.max_file_bytes)
    total["bytes"] += size
    return h.hexdigest(), size


def _store_blob(part: Path, data_dir: Path, sha: str) -> None:
    """Atomic: the final blob name only ever appears with complete, hash-verified content."""
    dest = data_dir / blob_rel(sha)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        part.unlink(missing_ok=True)  # same content already cached (content addressed, immutable)
    else:
        os.replace(part, dest)


# ---- runner (one run at a time, one FTP connection) -----------------------------------------------------------

class Runner:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cancel: threading.Event | None = None
        self._run_id: int | None = None

    def busy(self) -> bool:
        return self._lock.locked()

    def acquire(self) -> bool:
        return self._lock.acquire(blocking=False)

    def release(self) -> None:
        if self._lock.locked():
            self._lock.release()

    def start(self, *, db_path: Path, data_dir: Path, source_id: int, run_id: int, ftp_open: Callable[[], Any],
              secrets: list[str], limits: Limits) -> None:
        """Caller must hold the lock (`acquire`); it is released when the worker thread ends."""
        self._cancel = threading.Event()
        self._run_id = run_id

        def work() -> None:
            try:
                run_collection(db_path, data_dir, source_id, run_id, ftp_open, secrets, limits, self._cancel)
            finally:
                self._run_id = None
                self.release()

        threading.Thread(target=work, name=f"rcp-run-{run_id}", daemon=True).start()

    def cancel(self, run_id: int) -> bool:
        if self._run_id == run_id and self._cancel is not None:
            self._cancel.set()
            return True
        return False
