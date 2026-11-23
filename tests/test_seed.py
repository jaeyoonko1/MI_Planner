from pathlib import Path

from app.vault import Vault
from scripts.seed_sample import seed


def test_seed_creates_tree_and_is_idempotent(tmp_path: Path) -> None:
    vault = Vault(tmp_path / "vault")
    first = seed(vault)
    assert first > 10
    assert seed(vault) == 0
    titles = [n["title"] for n in vault.tree()]
    assert titles[:2] == ["일지", "MI 공정업무"]
    assert vault.read("스터디/광학")["meta"]["type"] == "html"
    assert "LOT-TEST-001" in vault.read("MI 공정업무/설비사 평가/2026 샘플 평가")["content"]
