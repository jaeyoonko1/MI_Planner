"""Minimal .pptx reader on the standard library (zipfile + ElementTree); no third-party dependency (P5-03, D-34).

Per slide (in presentation order): title, body text (text boxes, tables, grouped shapes), speaker notes and the
embedded pictures. Pictures are written to a staging folder as they are read, so a big deck never sits in memory.
Defensive against hostile or broken files: size caps, no DTD/entities, bounded slide/image counts.
Formats the browser cannot show (EMF, WMF, TIFF, SVG ...) are listed with a reason and not staged.
"""
from __future__ import annotations

import hashlib
import posixpath
import re
import struct
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile

MAX_BYTES = 300 * 1024 * 1024        # the uploaded file
MAX_XML = 8 * 1024 * 1024            # one slide / rels part
MAX_IMAGE = 25 * 1024 * 1024         # same cap as DOI images
MAX_STAGED = 1024 * 1024 * 1024      # all staged pictures together
MAX_SLIDES = 500
MAX_IMAGES_PER_SLIDE = 40
P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PR = "{http://schemas.openxmlformats.org/package/2006/relationships}"
MC = "{http://schemas.openxmlformats.org/markup-compatibility/2006}"
TITLE_TYPES = {"title", "ctrTitle"}
SKIP_TYPES = {"sldNum", "dt", "ftr", "hdr"}
EXT_MIME = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp"}
_OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_ENCRYPTED = "EncryptedPackage".encode("utf-16-le")


class PptxError(ValueError):
    """The file cannot be read as a presentation (message is shown to the user, in Korean)."""


@dataclass
class PicInfo:
    key: str = ""            # staged file stem (sha256 prefix); empty when skipped
    ext: str = ""
    size: int = 0
    sha256: str = ""
    width: int = 0
    height: int = 0
    caption: str = ""
    cropped: bool = False
    name: str = ""           # media part name, e.g. image3.png
    reason: str = ""         # why it was skipped (empty = usable)


@dataclass
class SlideInfo:
    index: int
    title: str = ""
    body: str = ""
    notes: str = ""
    hidden: bool = False
    images: list[PicInfo] = field(default_factory=list)   # usable pictures, in slide order
    skipped: list[PicInfo] = field(default_factory=list)  # pictures that cannot be imported, with reasons


def _parse(raw: bytes, label: str) -> ET.Element:
    head = raw[:4096].upper()
    if b"<!DOCTYPE" in head or b"<!ENTITY" in head:
        raise PptxError("지원하지 않는 파워포인트 구조예요 (DTD).")
    try:
        return ET.fromstring(raw)
    except ET.ParseError as exc:
        raise PptxError(f"파워포인트 파일을 해석하지 못했어요 ({label}의 XML 오류).") from exc


def _read(zf: ZipFile, name: str, limit: int = MAX_XML) -> bytes | None:
    try:
        info = zf.getinfo(name)
    except KeyError:
        return None
    if info.file_size > limit:
        raise PptxError(f"파일 안의 {posixpath.basename(name)}이(가) 너무 커요.")
    return zf.read(info)


def _rels(zf: ZipFile, part: str) -> dict[str, tuple[str, str, bool]]:
    """rel id -> (target part name, relationship type, is_external)."""
    folder, base = posixpath.split(part)
    raw = _read(zf, posixpath.join(folder, "_rels", base + ".rels"))
    out: dict[str, tuple[str, str, bool]] = {}
    if raw is None:
        return out
    for rel in _parse(raw, "관계 파일").iter(f"{PR}Relationship"):
        target = rel.get("Target") or ""
        external = rel.get("TargetMode") == "External"
        if not external:
            target = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(folder, target))
        out[rel.get("Id") or ""] = (target, (rel.get("Type") or "").rsplit("/", 1)[-1], external)
    return out


# ---- text ----------------------------------------------------------------------------------------------------

def _paragraphs(txbody: ET.Element) -> list[str]:
    lines: list[str] = []
    for p in txbody.findall(f"{A}p"):
        parts: list[str] = []
        for node in p:
            if node.tag in (f"{A}r", f"{A}fld"):
                t = node.find(f"{A}t")
                if t is not None and t.text:
                    parts.append(t.text)
            elif node.tag == f"{A}br":
                parts.append("\n")
        line = "".join(parts).replace("\x0b", "\n").strip()
        if line:
            lines.append(line)
    return lines


def _table_lines(tbl: ET.Element) -> list[str]:
    lines = []
    for tr in tbl.iter(f"{A}tr"):
        cells = []
        for tc in tr.findall(f"{A}tc"):
            body = tc.find(f"{A}txBody")
            cells.append(" ".join(_paragraphs(body)) if body is not None else "")
        if any(cells):
            lines.append(" | ".join(cells))
    return lines


def _placeholder(shape: ET.Element) -> str:
    ph = shape.find(f"{P}nvSpPr/{P}nvPr/{P}ph")
    return "" if ph is None else (ph.get("type") or "body")


# ---- slide walk ----------------------------------------------------------------------------------------------

@dataclass
class _Walk:
    title: list[str] = field(default_factory=list)
    texts: list[str] = field(default_factory=list)
    pics: list[tuple[str, str, bool]] = field(default_factory=list)  # (rel id, alt text, cropped)


def _walk(node: ET.Element, out: _Walk) -> None:
    for child in node:
        tag = child.tag
        if tag == f"{P}sp":
            kind = _placeholder(child)
            blip = child.find(f"{P}spPr/{A}blipFill/{A}blip")  # picture used as a shape fill
            if blip is not None and blip.get(f"{R}embed"):
                out.pics.append((blip.get(f"{R}embed") or "", "", False))
            body = child.find(f"{P}txBody")
            if body is None or kind in SKIP_TYPES:
                continue
            lines = _paragraphs(body)
            if not lines:
                continue
            if kind in TITLE_TYPES and not out.title:
                out.title = lines
            else:
                out.texts.extend(lines)
        elif tag == f"{P}pic":
            blip = child.find(f"{P}blipFill/{A}blip")
            if blip is not None and blip.get(f"{R}embed"):
                src = child.find(f"{P}blipFill/{A}srcRect")
                cropped = src is not None and any(int(src.get(k) or 0) > 0 for k in ("l", "t", "r", "b") if (src.get(k) or "").lstrip("-").isdigit())
                nv = child.find(f"{P}nvPicPr/{P}cNvPr")
                out.pics.append((blip.get(f"{R}embed") or "", (nv.get("descr") or "") if nv is not None else "", cropped))
        elif tag == f"{P}grpSp":
            _walk(child, out)
        elif tag == f"{P}graphicFrame":
            tbl = child.find(f".//{A}tbl")
            if tbl is not None:
                out.texts.extend(_table_lines(tbl))
        elif tag == f"{MC}AlternateContent":
            branch = child.find(f"{MC}Choice")
            _walk(branch if branch is not None else (child.find(f"{MC}Fallback") if child.find(f"{MC}Fallback") is not None else child), out)


def _notes_text(zf: ZipFile, slide_part: str, rels: dict[str, tuple[str, str, bool]]) -> str:
    for target, kind, external in rels.values():
        if kind != "notesSlide" or external:
            continue
        raw = _read(zf, target)
        if raw is None:
            return ""
        tree = _parse(raw, "슬라이드 노트")
        lines: list[str] = []
        for sp in tree.iter(f"{P}sp"):
            if _placeholder(sp) == "body":
                body = sp.find(f"{P}txBody")
                if body is not None:
                    lines.extend(_paragraphs(body))
        return "\n".join(lines)
    return ""


# ---- pictures ------------------------------------------------------------------------------------------------

def image_size(data: bytes, ext: str) -> tuple[int, int]:
    """Pixel size from the file header (0, 0 when unknown). Never raises."""
    try:
        if ext == "png" and len(data) >= 24:
            return struct.unpack(">II", data[16:24])
        if ext == "gif" and len(data) >= 10:
            return struct.unpack("<HH", data[6:10])
        if ext == "bmp" and len(data) >= 26:
            w, h = struct.unpack("<ii", data[18:26])
            return abs(w), abs(h)
        if ext == "jpg":
            i = 2
            while i + 9 < len(data):
                if data[i] != 0xFF:
                    i += 1
                    continue
                marker = data[i + 1]
                if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                    i += 2
                    continue
                if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                    h, w = struct.unpack(">HH", data[i + 5:i + 9])
                    return w, h
                i += 2 + struct.unpack(">H", data[i + 2:i + 4])[0]
        if ext == "webp" and data[12:16] == b"VP8X" and len(data) >= 30:
            return int.from_bytes(data[24:27], "little") + 1, int.from_bytes(data[27:30], "little") + 1
    except (struct.error, IndexError):
        pass
    return 0, 0


def _sniff(data: bytes) -> tuple[str, str]:
    """(ext, '') for importable images, ('', reason) otherwise."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png", ""
    if data[:3] == b"\xff\xd8\xff":
        return "jpg", ""
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif", ""
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", ""
    if data[:2] == b"BM":
        return "bmp", ""
    if data[:4] == b"\x01\x00\x00\x00" and data[40:44] == b" EMF":
        return "", "EMF 형식은 브라우저에서 볼 수 없어요. 파워포인트에서 그림을 PNG로 저장해 DOI에 직접 추가해 주세요."
    if data[:4] == b"\xd7\xcd\xc6\x9a":
        return "", "WMF 형식은 브라우저에서 볼 수 없어요. 파워포인트에서 그림을 PNG로 저장해 DOI에 직접 추가해 주세요."
    if data[:4] in (b"II*\x00", b"MM\x00*"):
        return "", "TIFF 형식은 지원하지 않아요. PNG나 JPG로 저장해 DOI에 직접 추가해 주세요."
    if data[:5] == b"<?xml" or b"<svg" in data[:512]:
        return "", "SVG는 스크립트를 담을 수 있어 가져오지 않아요. PNG로 저장해 DOI에 직접 추가해 주세요."
    return "", "알 수 없는 이미지 형식이에요 (PNG·JPG·GIF·WEBP·BMP만 가져와요)."


def _picture(zf: ZipFile, part: str, stage: Path | None, state: dict) -> PicInfo:
    name = posixpath.basename(part)
    cache: dict[str, PicInfo] = state["cache"]
    if part in cache:
        return PicInfo(**cache[part].__dict__)
    pic = PicInfo(name=name)
    try:
        info = zf.getinfo(part)
    except KeyError:
        pic.reason = "파일 안에서 이미지를 찾지 못했어요."
        cache[part] = pic
        return pic
    if info.file_size > MAX_IMAGE:
        pic.reason = f"이미지가 너무 커요 (장당 {MAX_IMAGE // 1024 // 1024}MB까지)."
    elif state["staged"] + info.file_size > MAX_STAGED:
        pic.reason = "한 번에 가져올 수 있는 이미지 총량(1GB)을 넘었어요. 파일을 나눠서 가져와 주세요."
    else:
        data = zf.read(info)
        ext, why = _sniff(data)
        if why:
            pic.reason = why
        else:
            pic.ext, pic.size = ext, len(data)
            pic.sha256 = hashlib.sha256(data).hexdigest()
            pic.key = pic.sha256[:20]
            pic.width, pic.height = image_size(data, ext)
            state["staged"] += len(data)
            if stage is not None:
                target = stage / f"{pic.key}.{ext}"
                if not target.exists():
                    target.write_bytes(data)
    cache[part] = pic
    return PicInfo(**pic.__dict__)


# ---- entry point ---------------------------------------------------------------------------------------------

def read_pptx(data: bytes, stage: Path | None = None) -> tuple[list[SlideInfo], list[str]]:
    """Return (slides, warnings). Pictures are staged under `stage` as <sha256[:20]>.<ext> when given."""
    if not data:
        raise PptxError("파일이 비어 있어요.")
    if len(data) > MAX_BYTES:
        raise PptxError(f"파일이 너무 커요 ({MAX_BYTES // 1024 // 1024}MB까지). 슬라이드를 나눠서 저장해 주세요.")
    if data[:8] == _OLE:
        if _ENCRYPTED in data[:1 << 20]:
            raise PptxError("암호가 걸린 파일이에요. 파워포인트에서 암호를 해제하고 저장한 뒤 다시 골라 주세요.")
        raise PptxError("옛 형식(.ppt)은 읽을 수 없어요. 파워포인트에서 .pptx로 저장한 뒤 다시 골라 주세요.")
    try:
        zf = ZipFile(BytesIO(data))
    except BadZipFile as exc:
        raise PptxError("파워포인트(.pptx) 파일이 아니거나 파일이 손상됐어요.") from exc
    with zf:
        try:
            return _read_all(zf, stage)
        except BadZipFile as exc:
            raise PptxError("파일이 손상돼서 일부를 읽지 못했어요.") from exc
        except (RuntimeError, NotImplementedError) as exc:
            raise PptxError("지원하지 않는 압축 또는 암호가 걸린 파일이에요.") from exc


def _read_all(zf: ZipFile, stage: Path | None) -> tuple[list[SlideInfo], list[str]]:
    raw = _read(zf, "ppt/presentation.xml")
    if raw is None:
        raise PptxError("파워포인트 파일이 아니에요 (ppt/presentation.xml 없음).")
    if sum(i.file_size for i in zf.infolist()) > 8 * MAX_BYTES:
        raise PptxError("압축을 풀면 너무 큰 파일이에요.")
    pres = _parse(raw, "presentation")
    pres_rels = _rels(zf, "ppt/presentation.xml")
    order: list[tuple[str, bool]] = []
    for sld in pres.iter(f"{P}sldId"):
        rel = pres_rels.get(sld.get(f"{R}id") or "")
        if rel and not rel[2]:
            order.append((rel[0], False))
    warnings: list[str] = []
    if not order:
        raise PptxError("슬라이드가 하나도 없어요.")
    if len(order) > MAX_SLIDES:
        warnings.append(f"슬라이드가 {len(order)}장이라 앞 {MAX_SLIDES}장만 읽었어요. 나머지는 파일을 나눠서 가져와 주세요.")
        order = order[:MAX_SLIDES]
    state = {"cache": {}, "staged": 0}
    slides: list[SlideInfo] = []
    for n, (part, _) in enumerate(order, 1):
        slide = SlideInfo(index=n)
        slides.append(slide)
        xml = _read(zf, part)
        if xml is None:
            warnings.append(f"슬라이드 {n}을(를) 파일에서 찾지 못했어요.")
            continue
        tree = _parse(xml, f"슬라이드 {n}")
        slide.hidden = tree.get("show") == "0"
        rels = _rels(zf, part)
        walk = _Walk()
        tree_root = tree.find(f"{P}cSld/{P}spTree")
        if tree_root is not None:
            _walk(tree_root, walk)
        title = " ".join(walk.title)
        if not title and walk.texts and len(walk.texts[0]) <= 120:
            title = walk.texts.pop(0)  # no title placeholder: the first short line is the best guess
        slide.title = " ".join(title.split())[:200]
        slide.body = "\n".join(walk.texts)
        slide.notes = _notes_text(zf, part, rels)
        seen: set[str] = set()
        for rid, alt, cropped in walk.pics:
            rel = rels.get(rid)
            if not rel or rel[2]:
                if rel and rel[2]:
                    slide.skipped.append(PicInfo(name=posixpath.basename(rel[0]) or "링크", reason="파일 밖(링크)에 있는 그림이에요. 파워포인트에서 그림을 삽입해 저장해 주세요."))
                continue
            pic = _picture(zf, rel[0], stage, state)
            pic.caption = " ".join(alt.split())[:200]
            pic.cropped = cropped
            if pic.reason:
                slide.skipped.append(pic)
            elif pic.key not in seen:  # the same picture twice on one slide counts once
                seen.add(pic.key)
                if len(slide.images) >= MAX_IMAGES_PER_SLIDE:
                    pic.reason = f"DOI 하나에는 이미지를 {MAX_IMAGES_PER_SLIDE}장까지 넣을 수 있어요."
                    slide.skipped.append(pic)
                else:
                    slide.images.append(pic)
    return slides, warnings


_SAFE_NAME = re.compile(r"[\\/:*?\"<>|\x00-\x1f]")


def clean_filename(name: str) -> str:
    base = _SAFE_NAME.sub("_", name.replace("\\", "/").rsplit("/", 1)[-1]).strip() or "presentation.pptx"
    return base[:120]
