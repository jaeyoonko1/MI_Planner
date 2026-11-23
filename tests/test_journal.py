from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import journal
from app.main import create_app

SAMPLE = """## 2026-11-24
- [ ] 3사 평가 Lot2 리뷰 요청
- 설비 A 레시피 문의 회신

## 2026-11-02
- 월요일 메모
"""


def test_parse_and_render_roundtrip() -> None:
    pre, days = journal.parse(SAMPLE)
    assert pre == ""
    assert list(days) == ["2026-11-24", "2026-11-02"]
    assert days["2026-11-02"] == "- 월요일 메모"
    out = journal.render(pre, days)
    assert out.index("2026-11-02") < out.index("2026-11-24")  # sorted by date
    assert journal.parse(out) == (pre, days)


def test_non_date_headings_and_fences_stay_in_body() -> None:
    text = "intro\n\n## 2026-11-03\n## 메모\n```\n## 2026-11-09\n```\nend\n"
    pre, days = journal.parse(text)
    assert pre == "intro"
    assert list(days) == ["2026-11-03"]
    assert "## 2026-11-09" in days["2026-11-03"] and "## 메모" in days["2026-11-03"]


def test_set_day_replace_insert_remove() -> None:
    text = journal.set_day(SAMPLE, "2026-11-24", "- 바뀐 내용")
    assert "바뀐 내용" in text and "Lot2" not in text
    text = journal.set_day(text, "2026-11-10", "- 새 날")
    assert list(journal.parse(text)[1]) == ["2026-11-02", "2026-11-10", "2026-11-24"]
    text = journal.set_day(text, "2026-11-10", "  \n")
    assert "2026-11-10" not in text
    assert journal.set_day("", "2026-11-01", "") == ""


@pytest.fixture()
def client(tmp_path: Path):
    with TestClient(create_app(tmp_path / "t.db", tmp_path / "vault")) as c:
        c.vault_dir = tmp_path / "vault"  # type: ignore[attr-defined]
        yield c


def test_get_month_auto_creates_pages(client) -> None:
    r = client.get("/api/journal/2026-11").json()
    assert r == {"month": "2026-11", "path": "일지/2026/2026-11", "days": {}, "tasks": {}}
    tree = client.get("/api/pages/tree").json()["tree"]
    month = tree[0]["children"][0]["children"][0]
    assert (month["type"], month["title"]) == ("journal", "2026년 11월")


def test_put_day_writes_file_in_spec_format(client) -> None:
    client.put("/api/journal/2026-11/24", json={"content": "- [ ] 할일\n- 메모"})
    client.put("/api/journal/2026-11/2", json={"content": "- 앞날"})
    r = client.get("/api/journal/2026-11").json()
    assert r["days"] == {"2026-11-24": "- [ ] 할일\n- 메모", "2026-11-02": "- 앞날"}
    file = client.vault_dir / "일지" / "2026" / "2026-11" / "index.md"
    text = file.read_text(encoding="utf-8")
    assert text.startswith("## 2026-11-02\n- 앞날\n\n## 2026-11-24\n")
    client.put("/api/journal/2026-11/24", json={"content": ""})
    assert "2026-11-24" not in client.get("/api/journal/2026-11").json()["days"]


@pytest.mark.parametrize("url", ["/api/journal/2026-13", "/api/journal/abc", "/api/journal/2026-11/31"])
def test_invalid_month_or_day(client, url) -> None:
    r = client.put(url, json={"content": "x"}) if url.count("/") == 4 else client.get(url)
    assert r.status_code == 400 and "error" in r.json()
