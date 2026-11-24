"""Add FAKE DOI entries (generated placeholder images) to a running app, for trying out the P5-02 screen.

Usage:  python scripts/seed_doi_sample.py [--url http://127.0.0.1:8765]
Only invented names (PROD-TEST-A, EQ-A01 ...) and flat generated colours are used (AGENTS.md: no real company data).
Standard library only; images are written by hand as PNG.
"""
from __future__ import annotations

import argparse
import json
import struct
import urllib.request
import zlib

SAMPLES = [
    ("Scratch near wafer edge", "PROD-TEST-A", "PLAN-A1", "S0010", "Scratch", ["edge", "scratch"], "EQ-A01 / mode B", 3),
    ("Particle cluster after clean", "PROD-TEST-A", "PLAN-A1", "S0020", "Particle", ["particle", "post-clean"], "EQ-A02", 1),
    ("Void in contact hole", "PROD-TEST-B", "PLAN-B1", "S0030", "Void", ["contact", "void"], "EQ-B01", 2),
    ("Overlay shift on M1", "PROD-TEST-B", "PLAN-B1", "S0040", "Overlay", ["m1"], "EQ-B01", 0),
    ("Pattern collapse", "PROD-TEST-A", "PLAN-A2", "S0010", "Pattern", ["collapse", "edge"], "EQ-A01", 4),
]
PALETTE = [(72, 112, 220), (66, 170, 160), (214, 120, 90), (150, 110, 210), (210, 170, 70), (90, 150, 90)]


def png(w: int, h: int, rgb: tuple[int, int, int]) -> bytes:
    """A soft diagonal gradient so cards do not look flat."""
    rows = []
    for y in range(h):
        row = bytearray([0])
        for x in range(w):
            k = (x + y) / (w + h)
            row += bytes(min(255, int(c * (0.95 + 0.45 * k))) for c in rgb)
        rows.append(bytes(row))
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"".join(rows))) + chunk(b"IEND", b"")


def call(base: str, method: str, path: str, body: bytes | None = None, js: bool = True) -> dict:
    req = urllib.request.Request(base + path, data=body, method=method, headers={"Content-Type": "application/json"} if js else {})
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8765")
    base = ap.parse_args().url.rstrip("/")
    for n, (title, product, plan, step, defect, tags, tool, images) in enumerate(SAMPLES):
        doi = call(base, "POST", "/api/doi", json.dumps({
            "title": title, "product": product, "plan": plan, "step": step, "defect_type": defect, "tags": tags,
            "tool_condition": tool, "source_dept": "DEPT-TEST", "source_author": "tester",
            "description": f"Placeholder entry {n + 1}. Generated image, no real data.",
        }).encode())
        for i in range(images):
            w, h = (640, 480) if i % 2 == 0 else (480, 640)
            call(base, "POST", f"/api/doi/{doi['id']}/images?width={w}&height={h}", png(w, h, PALETTE[(n + i) % len(PALETTE)]), js=False)
        print("added", doi["id"], title)


if __name__ == "__main__":
    main()
