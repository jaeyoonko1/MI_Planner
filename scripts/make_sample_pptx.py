"""Write a FAKE .pptx (standard library only) for trying the P5-03 DOI PPT import and for tests.

Usage:  python scripts/make_sample_pptx.py [out.pptx]      (default: data/sample_doi.pptx)
Only invented names (PROD-TEST-A, EQ-A01 ...) and generated flat-colour pictures are used.
`build_pptx(slides)` is importable; a slide is a dict:
  title, body (list of lines), table (list of rows), notes, hidden (bool),
  pics: list of (file name in ppt/media, bytes, grouped: bool)
"""
from __future__ import annotations

import sys
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.seed_doi_sample import png  # noqa: E402

NS = ('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"')
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def _para(text: str) -> str:
    return f"<a:p><a:r><a:t>{escape(text)}</a:t></a:r></a:p>"


def _text_shape(sid: int, name: str, lines: list[str], ph: str = "") -> str:
    nv = f'<p:nvPr><p:ph type="{ph}"/></p:nvPr>' if ph else "<p:nvPr/>"
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="{name}"/><p:cNvSpPr/>{nv}</p:nvSpPr><p:spPr/>'
            f'<p:txBody><a:bodyPr/>{"".join(_para(t) for t in lines)}</p:txBody></p:sp>')


def _pic(sid: int, rid: str, alt: str = "") -> str:
    return (f'<p:pic><p:nvPicPr><p:cNvPr id="{sid}" name="Picture {sid}" descr="{escape(alt)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>'
            f'<p:blipFill><a:blip r:embed="{rid}"/></p:blipFill><p:spPr/></p:pic>')


def _table(rows: list[list[str]]) -> str:
    trs = "".join("<a:tr>" + "".join(f"<a:tc><a:txBody><a:bodyPr/>{_para(c)}</a:txBody></a:tc>" for c in r) + "</a:tr>" for r in rows)
    return (f'<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="90" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
            f'<a:graphic><a:graphicData><a:tbl>{trs}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>')


def _slide_xml(s: dict, rids: list[tuple[str, bool]]) -> str:
    shapes = []
    if s.get("title"):
        shapes.append(_text_shape(2, "Title", [s["title"]], "title"))
    if s.get("body"):
        shapes.append(_text_shape(3, "Body", s["body"]))
    shapes.append(_text_shape(4, "Slide Number", ["9"], "sldNum"))
    if s.get("table"):
        shapes.append(_table(s["table"]))
    loose = [_pic(10 + i, rid) for i, (rid, grouped) in enumerate(rids) if not grouped]
    grouped = [_pic(30 + i, rid, "alt text") for i, (rid, g) in enumerate(rids) if g]
    shapes.extend(loose)
    if grouped:
        shapes.append(f'<p:grpSp><p:nvGrpSpPr><p:cNvPr id="20" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>{"".join(grouped)}</p:grpSp>')
    show = ' show="0"' if s.get("hidden") else ""
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld {NS}{show}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/>'
            f'<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>{"".join(shapes)}</p:spTree></p:cSld></p:sld>')


def _notes_xml(text: str) -> str:
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes {NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/>'
            f'<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>{_text_shape(2, "Notes", text.split(chr(10)), "body")}</p:spTree></p:cSld></p:notes>')


def _rels(items: list[tuple[str, str, str]]) -> str:
    body = "".join(f'<Relationship Id="{i}" Type="{REL}/{t}" Target="{target}"/>' for i, t, target in items)
    return f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{body}</Relationships>'


def build_pptx(slides: list[dict]) -> bytes:
    out = BytesIO()
    with ZipFile(out, "w", ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        ids = "".join(f'<p:sldId id="{256 + n}" r:id="rId{n + 1}"/>' for n in range(len(slides)))
        z.writestr("ppt/presentation.xml", f'<?xml version="1.0" encoding="UTF-8"?><p:presentation {NS}><p:sldIdLst>{ids}</p:sldIdLst></p:presentation>')
        z.writestr("ppt/_rels/presentation.xml.rels", _rels([(f"rId{n + 1}", "slide", f"slides/slide{n + 1}.xml") for n in range(len(slides))]))
        media: dict[str, bytes] = {}
        for n, s in enumerate(slides, 1):
            rels, rids = [], []
            for i, (name, data, grouped) in enumerate(s.get("pics", []), 1):
                media[name] = data
                rels.append((f"rId{i}", "image", f"../media/{name}"))
                rids.append((f"rId{i}", grouped))
            if s.get("notes"):
                rels.append(("rId99", "notesSlide", f"../notesSlides/notesSlide{n}.xml"))
                z.writestr(f"ppt/notesSlides/notesSlide{n}.xml", _notes_xml(s["notes"]))
            z.writestr(f"ppt/slides/slide{n}.xml", _slide_xml(s, rids))
            z.writestr(f"ppt/slides/_rels/slide{n}.xml.rels", _rels(rels))
        for name, data in media.items():
            z.writestr(f"ppt/media/{name}", data)
    return out.getvalue()


# a few bytes that look like an EMF header (used to test the "unsupported format" path)
FAKE_EMF = b"\x01\x00\x00\x00" + b"\x00" * 36 + b" EMF" + b"\x00" * 40


def sample_slides() -> list[dict]:
    logo = png(24, 24, (30, 30, 30))
    a, b, c = png(160, 120, (72, 112, 220)), png(160, 120, (214, 120, 90)), png(200, 100, (66, 170, 160))
    return [
        {"title": "Scratch near wafer edge", "body": ["PROD-TEST-A / PLAN-A1 / S0010", "Found on LOT-TEST-001 at EQ-A01"],
         "notes": "Seen after CMP.\nCheck with EQ-A02 too.", "pics": [("image1.png", a, False), ("image9.png", logo, False)]},
        {"title": "Particle cluster", "body": ["EQ-A02 mode B"], "table": [["Wafer", "Count"], ["W01", "12"]],
         "pics": [("image2.png", b, True), ("image3.png", c, True), ("image9.png", logo, False)]},
        {"title": "Legacy drawing", "body": ["vector picture only"], "pics": [("image4.emf", FAKE_EMF, False), ("image9.png", logo, False)]},
        {"title": "Text only summary", "body": ["No pictures on this slide"], "pics": [("image9.png", logo, False)], "hidden": True},
    ]


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "data/sample_doi.pptx")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(build_pptx(sample_slides()))
    print(f"wrote {target}")
