"""V-007: OneNote / Word / Outlook clipboard HTML -> note document (web/test/run_paste_doc.mjs)."""
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_paste_doc_cases():
    res = subprocess.run(
        ["node", str(ROOT / "web" / "test" / "run_paste_doc.mjs")],
        capture_output=True, text=True, encoding="utf-8", timeout=90,
    )
    assert res.returncode == 0, res.stdout + res.stderr


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_paste_table_still_passes_with_document_parser():
    """The table converter (V-001) shares its runs with the document converter: it must not change."""
    res = subprocess.run(
        ["node", str(ROOT / "web" / "test" / "run_paste_table.mjs")],
        capture_output=True, text=True, encoding="utf-8", timeout=90,
    )
    assert res.returncode == 0, res.stdout + res.stderr
