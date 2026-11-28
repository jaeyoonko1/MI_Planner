"""File replacement shared by the app and the offline table writer."""
from __future__ import annotations

import os
import stat
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from tempfile import NamedTemporaryFile

if os.name == "nt":
    import msvcrt
else:
    import fcntl


_held = threading.local()


@contextmanager
def content_write_lock(vault: Path) -> Iterator[None]:
    """Cross-process lock for page bodies. Re-entrant per thread: a caller that holds it for a whole
    read-modify-write (snapshot, page write, DB write, rollback) can still call code that takes it again;
    other threads and processes keep waiting on the OS lock."""
    key = os.path.normcase(vault.resolve())
    paths = getattr(_held, "paths", None)
    if paths is None:
        paths = _held.paths = set()
    if key in paths:
        yield
        return
    with _os_lock(vault):
        paths.add(key)
        try:
            yield
        finally:
            paths.remove(key)


@contextmanager
def _os_lock(vault: Path) -> Iterator[None]:
    # Keep the lock file in place so every process locks the same file, even across page moves.
    with (vault / ".content-write.lock").open("a+b") as lock:
        lock.seek(0)
        if os.name == "nt":
            msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        else:
            fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == "nt":
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock, fcntl.LOCK_UN)


def replace_content(path: Path, content: bytes) -> None:
    path = path.resolve()
    mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else None
    handle = NamedTemporaryFile(dir=path.parent, prefix=".content-", delete=False)
    pending = Path(handle.name)
    try:
        with handle:
            handle.write(content)
        if mode is not None:
            pending.chmod(mode)
        pending.replace(path)
    finally:
        if pending.exists():
            pending.chmod(stat.S_IREAD | stat.S_IWRITE)
            pending.unlink()
