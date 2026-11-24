"""Runs the pure line-editor logic tests (web/test/run_lineeditor.mjs) when Node.js is available."""
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_lineeditor_core_cases():
    res = subprocess.run(
        ["node", str(ROOT / "web" / "test" / "run_lineeditor.mjs")],
        capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    assert res.returncode == 0, res.stdout + res.stderr


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_memo_core_cases():
    """P2B-10: image width markdown + heading fold plan (web/test/run_memo.mjs)."""
    res = subprocess.run(
        ["node", str(ROOT / "web" / "test" / "run_memo.mjs")],
        capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    assert res.returncode == 0, res.stdout + res.stderr


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_note_column_layout_cases():
    res = subprocess.run(
        ["node", str(ROOT / "web" / "test" / "run_note_columns.mjs")],
        capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    assert res.returncode == 0, res.stdout + res.stderr


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_note_table_cases():
    res = subprocess.run(
        ["node", str(ROOT / "web" / "test" / "run_note_tables.mjs")],
        capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    assert res.returncode == 0, res.stdout + res.stderr


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_note_format_core_cases():
    """P3-04: toolbar presets, size stepping and shortcut mapping (web/test/run_note_format.mjs)."""
    res = subprocess.run(
        ["node", str(ROOT / "web" / "test" / "run_note_format.mjs")],
        capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    assert res.returncode == 0, res.stdout + res.stderr


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_eval_board_model():
    """P4-04: board indexes, progress counts and filters (web/test/run_eval_board.mjs)."""
    result = subprocess.run(
        ["node", str(ROOT / "web" / "test" / "run_eval_board.mjs")],
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_eval_select_model():
    """P4-05: multi-select helpers, next-stage moves and time formatting (web/test/run_eval_select.mjs)."""
    result = subprocess.run(
        ["node", str(ROOT / "web" / "test" / "run_eval_select.mjs")],
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
