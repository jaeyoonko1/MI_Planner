"""Write FAKE recipe files (D-17) in the formats the generic parsers read: xml, ini, fixed-width/kv/table txt.

Usage: python scripts/make_sample_recipes.py [out_dir]   (default ./sample_recipes). Values are invented;
never put real recipe or equipment names here.
"""
from __future__ import annotations

import sys
from pathlib import Path


def samples() -> dict[str, bytes]:
    xml = """<?xml version="1.0" encoding="utf-8"?>
<Recipe>
  <Header><Created>2026-01-01</Created></Header>
  <Optics><Param Name="Focus">1.25</Param><Param Name="Gain">3</Param></Optics>
  <Scan Timestamp="2026-01-01T00:00:00">
    <Pass><Speed>20</Speed></Pass><Pass><Speed>40</Speed></Pass><Mode>FAST</Mode>
  </Scan>
</Recipe>
"""
    ini = "; fake\n[System]\nSerial = EQ-A01\n[Optics]\nFocus = 1.25\nExposure = 12\n[Detect1]\nThreshold = 30\n[Detect2]\nThreshold = 45\n"
    fixed = "FOCUS_OFFSET        0.50\nSTAGE_SPEED         120\nMODE                AUTO\n"
    kv = "# fake\nGain = 3\nName: LOT-TEST-001\n"
    table = "id,x,y\nP1,1.0,2.0\nP2,3.0,4.0\n"
    return {
        "recipe.xml": xml.encode("utf-8"),
        "optics.xml": xml.replace("encoding=\"utf-8\"", "encoding=\"euc-kr\"").replace("Recipe", "레시피").encode("cp949"),
        "params/main.ini": ini.encode("utf-8-sig"),
        "params.txt": fixed.encode("cp949"),
        "notes.txt": kv.encode("utf-8"),
        "points.txt": table.encode("utf-8"),
    }


def main(argv: list[str]) -> int:
    out = Path(argv[1] if len(argv) > 1 else "sample_recipes")
    for rel, data in samples().items():
        path = out / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    print(f"wrote {len(samples())} fake files to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
