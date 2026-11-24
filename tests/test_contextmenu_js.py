"""V-010: pure placement / item / keyboard logic of the context menu (web/test/run_contextmenu.mjs)."""
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_contextmenu_core_cases():
    res = subprocess.run(
        ["node", str(ROOT / "web" / "test" / "run_contextmenu.mjs")],
        capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    assert res.returncode == 0, res.stdout + res.stderr
