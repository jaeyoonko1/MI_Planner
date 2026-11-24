"""Read-only FTP access for RCP collection (P6-02, D-11, D-36).

`ReadOnlyFtp` exposes only listing and retrieval. There is deliberately no store/delete/rename/mkdir method, and the
raw `ftplib.FTP` object is private, so no caller can reach a write command through it. Errors are translated into
fixed Korean messages: the exception text itself (which can contain host, user or server banners) is never shown.
"""
from __future__ import annotations

import ftplib
import posixpath
import re
import socket
from dataclasses import dataclass
from typing import Any, Callable

from app.config import FtpProfile


class FtpProblem(Exception):
    """A failure whose message is safe to show and store (no host, account or password)."""


class TooBig(FtpProblem):
    pass


@dataclass
class Entry:
    name: str
    is_dir: bool
    size: int | None = None
    mtime: str = ""


_BAD_NAME = re.compile(r"[\x00-\x1f\x7f/\\]")


def valid_name(name: str) -> bool:
    """A remote entry name that is safe to use as a path component."""
    return bool(name) and name not in (".", "..") and not _BAD_NAME.search(name) and len(name) <= 255


def describe(exc: BaseException, secrets: list[str] | None = None) -> str:
    """Translate an exception to a fixed message. Anything unknown shows only the class name."""
    if isinstance(exc, FtpProblem):
        msg = str(exc)
    elif isinstance(exc, ftplib.error_perm):
        code = str(exc)[:3]
        if code in ("530", "331", "332"):
            msg = "로그인에 실패했어요. FTP 프로필의 계정·비밀번호를 확인해 주세요."
        elif code in ("550", "450"):
            msg = "경로를 찾을 수 없거나 읽을 권한이 없어요."
        else:
            msg = f"서버가 요청을 받아들이지 않았어요 (코드 {code if code.isdigit() else '?'})."
    elif isinstance(exc, (TimeoutError, socket.timeout)):
        msg = "서버 응답 시간이 초과됐어요. 네트워크·서버 상태를 확인해 주세요."
    elif isinstance(exc, ConnectionRefusedError):
        msg = "연결이 거부됐어요. 서버 주소·포트와 FTP 서비스 상태를 확인해 주세요."
    elif isinstance(exc, socket.gaierror):
        msg = "서버 주소를 찾을 수 없어요. FTP 프로필의 주소를 확인해 주세요."
    elif isinstance(exc, UnicodeError):
        msg = "이름을 읽지 못했어요. FTP 프로필의 encoding(utf-8·cp949 등)을 확인해 주세요."
    elif isinstance(exc, (ftplib.error_temp, ftplib.error_reply, ftplib.error_proto, EOFError, OSError)):
        msg = "연결이 끊어졌거나 서버가 일시적으로 응답하지 않아요."
    else:
        msg = f"예상하지 못한 오류가 났어요 ({type(exc).__name__})."
    for s in secrets or []:  # defensive: nothing above embeds these, but never let one through
        if s and len(s) >= 3:
            msg = msg.replace(s, "***")
    return msg


# ---- LIST fallback parsing ----------------------------------------------------------------------------------

_UNIX = re.compile(r"^([\-dlbcps])[rwxsStT\-]{9}[+@.]?\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\w{3}\s+\d{1,2}\s+[\d:]{4,5})\s(.+)$")
_UNIX_NOGROUP = re.compile(r"^([\-dlbcps])[rwxsStT\-]{9}[+@.]?\s+\d+\s+\S+\s+(\d+)\s+(\w{3}\s+\d{1,2}\s+[\d:]{4,5})\s(.+)$")
_DOS = re.compile(r"^(\d{2}-\d{2}-\d{2,4})\s+(\d{1,2}:\d{2}\s*[AP]?M?)\s+(<DIR>|\d+)\s+(.+)$", re.IGNORECASE)


def parse_list_line(line: str) -> Entry | None:
    """Parse one `LIST` line (Unix or DOS/IIS style). Links, devices and unknown lines return None."""
    line = line.rstrip("\r\n")
    m = _UNIX.match(line) or _UNIX_NOGROUP.match(line)
    if m:
        kind, size, mtime, name = m.groups()
        if kind not in ("-", "d"):
            return None
        return Entry(name, kind == "d", None if kind == "d" else int(size), mtime)
    m = _DOS.match(line)
    if m:
        date, clock, size, name = m.groups()
        is_dir = size.upper() == "<DIR>"
        return Entry(name, is_dir, None if is_dir else int(size), f"{date} {clock}")
    return None


def _mlsd_mtime(value: str) -> str:
    v = value.split(".")[0]
    if len(v) == 14 and v.isdigit():  # YYYYMMDDHHMMSS (UTC per RFC 3659); shown as ISO without zone math
        return f"{v[:4]}-{v[4:6]}-{v[6:8]}T{v[8:10]}:{v[10:12]}:{v[12:14]}Z"
    return value


class ReadOnlyFtp:
    """Listing + download only. `opener` returns a connected, logged-in `ftplib.FTP`-like object."""

    def __init__(self, opener: Callable[[], Any]) -> None:
        self._opener = opener
        self._ftp: Any = None
        self._home = "/"
        self.used_list_fallback = False
        self.reconnect()

    # -- connection ------------------------------------------------------------------------------------------
    def reconnect(self) -> None:
        self.close()
        self._ftp = self._opener()
        try:
            self._home = self._ftp.pwd() or "/"
        except ftplib.all_errors:
            self._home = "/"

    def close(self) -> None:
        ftp, self._ftp = self._ftp, None
        if ftp is None:
            return
        try:
            ftp.quit()
        except Exception:
            try:
                ftp.close()
            except Exception:
                pass

    def abs_path(self, path: str) -> str:
        path = (path or "").replace("\\", "/")
        if not path.startswith("/"):
            path = posixpath.join(self._home, path)
        return posixpath.normpath(path) if path else "/"

    # -- listing ---------------------------------------------------------------------------------------------
    def list_dir(self, path: str) -> list[Entry]:
        """Entries of a directory: MLSD when the server has it, else parsed `LIST` output."""
        full = self.abs_path(path)
        self._ftp.cwd(full)
        try:
            entries = self._mlsd()
        except ftplib.error_perm as exc:
            if str(exc)[:3] not in ("500", "501", "502", "504"):  # not "MLSD unsupported"
                raise
            entries = self._list()
            self.used_list_fallback = True
        return entries

    def _mlsd(self) -> list[Entry]:
        out: list[Entry] = []
        for name, facts in self._ftp.mlsd(facts=["type", "size", "modify"]):
            kind = str(facts.get("type", "")).lower()
            if kind in ("cdir", "pdir") or name in (".", ".."):
                continue
            if kind not in ("file", "dir"):
                continue  # symlinks and special entries are not followed
            size = facts.get("size")
            out.append(Entry(name, kind == "dir", int(size) if kind == "file" and str(size).isdigit() else None,
                             _mlsd_mtime(facts.get("modify", ""))))
        return out

    def _list(self) -> list[Entry]:
        lines: list[str] = []
        self._ftp.retrlines("LIST", lines.append)
        out = []
        for line in lines:
            e = parse_list_line(line)
            if e and e.name not in (".", ".."):
                out.append(e)
        return out

    # -- download --------------------------------------------------------------------------------------------
    def retrieve(self, path: str, sink: Callable[[bytes], None], max_bytes: int) -> int:
        """Download one file through `sink`. Raises TooBig past `max_bytes` (the connection is then reopened)."""
        seen = 0

        def chunk(data: bytes) -> None:
            nonlocal seen
            seen += len(data)
            if seen > max_bytes:
                raise TooBig(f"파일이 한도({max_bytes // (1024 * 1024)}MB)보다 커서 건너뛰었어요.")
            sink(data)

        try:
            self._ftp.retrbinary("RETR " + self.abs_path(path), chunk)
        except TooBig:
            self.reconnect()  # the aborted transfer leaves the control channel out of sync
            raise
        return seen


def make_opener(profile: FtpProfile, factory: Callable[[], Any] | None = None) -> Callable[[], Any]:
    """Opener for `ReadOnlyFtp`. `factory` is a test seam (defaults to `ftplib.FTP`)."""
    def open_() -> Any:
        ftp = (factory or ftplib.FTP)()
        ftp.encoding = profile.encoding
        try:
            ftp.connect(profile.host, profile.port, timeout=profile.timeout)
            ftp.login(profile.user, profile.password)
            ftp.set_pasv(profile.passive)
        except BaseException:
            try:
                ftp.close()
            except Exception:
                pass
            raise
        return ftp
    return open_
