"""P2B-09: issue-only creation, one-time page expansion, conditional placement, rollback."""
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import placement
from app.main import create_app
from app.vault import Vault

TODAY = date.today().isoformat()
MONTH = TODAY[:7]


@pytest.fixture()
def env(tmp_path: Path):
    app = create_app(tmp_path / "t.db", tmp_path / "vault")
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c, tmp_path / "vault"


def opt(c, key, label, parent=None):
    body = {"label": label, **({"parent": parent} if parent else {})}
    c.post(f"/api/todos/fields/{key}/options", json=body)
    return next(o["value"] for o in c.get(f"/api/todos/fields/{key}").json()["options"] if o["label"] == label)


def issue(c, title, **extra):
    r = c.post("/api/todos", json={"title": title, **extra})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture()
def world(env):
    c, vault = env
    c.post("/api/todos/fields", json={"key": "product", "label": "제품", "type": "choice", "options": []})
    v = {
        "setup": opt(c, "type", "셋업"), "eval": opt(c, "type", "평가"),
        "hbm": opt(c, "product", "HBM"), "dram": opt(c, "product", "DRAM"),
    }
    rules = [
        {"conditions": [{"field": "type", "op": "is", "value": v["setup"]},
                        {"field": "product", "op": "is", "value": v["hbm"]}], "path": "MI 공정업무/셋업/{제품}"},
        {"conditions": [{"field": "type", "op": "is", "value": v["eval"]}], "path": "MI 공정업무/평가/{연}-{월}"},
    ]
    assert c.put("/api/todos/page-rules", json={"rules": rules}).status_code == 200
    return c, vault, v


def dirs(vault: Path) -> set[str]:
    return {p.parent.relative_to(vault).as_posix() for p in vault.rglob("_page.json") if ".trash" not in p.parts}


def boom(*_a, **_k):
    raise RuntimeError("injected failure")


# ---- issue-only vs. page ----------------------------------------------------------------

def test_issue_only_creates_no_page(world) -> None:
    c, vault, _ = world
    t = issue(c, "단독 이슈", note="메모")
    assert t["page_path"] is None
    assert dirs(vault) == set()  # nothing in the vault yet


def test_expand_places_by_and_rule_and_links_same_id(world) -> None:
    c, vault, v = world
    t = issue(c, "HBM 셋업 점검", props={"type": v["setup"], "product": v["hbm"]}, planned_date=TODAY)
    r = c.post(f"/api/todos/{t['id']}/page", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] is True
    assert body["path"] == "MI 공정업무/셋업/HBM/HBM 셋업 점검"
    page = c.get("/api/pages", params={"path": body["path"]}).json()
    assert page["meta"]["task_id"] == t["id"] and page["meta"]["type"] == "note"
    assert c.get(f"/api/todos/{t['id']}").json()["page_path"] == body["path"]
    # missing folders were created as automatic pages and show up in the tree
    tree = c.get("/api/pages/tree").json()["tree"]
    mi = next(n for n in tree if n["title"] == "MI 공정업무")
    assert mi["auto"] is True and mi["children"][0]["auto"] is True
    leaf = mi["children"][0]["children"][0]["children"][0]
    assert leaf["task_id"] == t["id"] and leaf["auto"] is False


def test_second_expand_opens_existing_page_and_keeps_memo_and_journal_link(world) -> None:
    c, vault, v = world
    t = issue(c, "연결 유지", props={"type": v["eval"]}, planned_date=TODAY, note="처음 메모")
    first = c.post(f"/api/todos/{t['id']}/page", json={}).json()
    assert first["page"]["content"] == "처음 메모"  # memo seeds the page body
    c.put("/api/pages", params={"path": first["path"]}, json={"content": "페이지에서 고침"})
    again = c.post(f"/api/todos/{t['id']}/page", json={"override": {"kind": "folder", "path": "다른/곳"}}).json()
    assert again["created"] is False and again["path"] == first["path"]
    assert again["page"]["content"] == "페이지에서 고침"  # never overwritten
    assert not (vault / "다른").exists()  # the second run created nothing
    got = c.get(f"/api/todos/{t['id']}").json()
    assert got["note"] == "처음 메모" and got["id"] == t["id"]
    day = c.get(f"/api/journal/{MONTH}").json()["days"][TODAY]
    assert f"할일 #{t['id']}" in day
    owners = [p for p in vault.rglob("_page.json") if f'"task_id": {t["id"]}' in p.read_text(encoding="utf-8")]
    assert len(owners) == 1


def test_partial_match_does_not_apply_and_first_matching_rule_wins(world) -> None:
    c, vault, v = world
    only_type = issue(c, "유형만", props={"type": v["setup"]})  # rule 1 needs product too -> default
    p = c.post("/api/todos/page-preview", json={"task_id": only_type["id"]}).json()
    assert p["by"].startswith("기본") and p["folder"].startswith("일지/")
    both = issue(c, "둘 다", props={"type": v["setup"], "product": v["hbm"]})
    p = c.post("/api/todos/page-preview", json={"task_id": both["id"]}).json()
    assert p["by"] == "규칙 1" and p["rule"] == 0 and p["folder"] == "MI 공정업무/셋업/HBM"
    c.put("/api/todos/page-rules", json={"rules": [  # an earlier rule shadows a later one
        {"conditions": [{"field": "type", "op": "is", "value": v["setup"]}], "path": "먼저"},
        {"conditions": [{"field": "product", "op": "is", "value": v["hbm"]}], "path": "나중"},
    ]})
    assert c.post("/api/todos/page-preview", json={"task_id": both["id"]}).json()["folder"] == "먼저"


def test_rule_ops_hierarchy_and_template_variables(world) -> None:
    c, vault, v = world
    hbm_a = opt(c, "product", "HBM-A", parent=v["hbm"])
    c.put("/api/todos/page-rules", json={"rules": [
        {"conditions": [{"field": "product", "op": "is", "value": v["hbm"]}], "path": "제품/{제품}/{유형}"},
        {"conditions": [{"field": "product", "op": "empty"}], "path": "제품없음"},
    ]})
    child = issue(c, "하위 값", props={"product": hbm_a})  # a child value matches its parent's rule
    p = c.post("/api/todos/page-preview", json={"task_id": child["id"]}).json()
    assert p["folder"] == "제품/HBM/HBM-A/미분류"  # hierarchy expands to a path, missing value -> 미분류
    none = issue(c, "값 없음")
    assert c.post("/api/todos/page-preview", json={"task_id": none["id"]}).json()["folder"] == "제품없음"


def test_fallbacks_and_journal_page(world) -> None:
    c, vault, v = world
    t = issue(c, "규칙 밖", planned_date="2026-03-09")
    p = c.post("/api/todos/page-preview", json={"task_id": t["id"]}).json()
    assert p["folder"] == "일지/2026/2026-03" and p["journal"] is True
    r = c.post(f"/api/todos/{t['id']}/page", json={}).json()
    assert r["path"] == "일지/2026/2026-03/규칙 밖"
    month = c.get("/api/pages", params={"path": "일지/2026/2026-03"}).json()
    assert month["meta"]["type"] == "journal"  # a real month page, not an automatic note folder
    assert c.get("/api/journal/2026-03").status_code == 200  # journal still reads fine with a child page
    assert c.put("/api/todos/page-rules", json={"rules": [], "fallback": "type"}).json()["fallback"] == "type"
    t2 = issue(c, "유형별", props={"type": v["eval"]}, planned_date="2026-03-09")
    assert c.post("/api/todos/page-preview", json={"task_id": t2["id"]}).json()["folder"] == "MI 공정업무/평가"
    assert c.put("/api/todos/page-rules", json={"rules": [], "fallback": "nope"}).status_code == 400
    assert c.get("/api/todos/page-rules").json()["fallback"] == "type"


# ---- preview + override -----------------------------------------------------------------

def test_preview_draft_and_overrides(world) -> None:
    c, vault, v = world
    draft = {"title": "새 이슈", "props": {"type": v["setup"], "product": v["hbm"]}}
    p = c.post("/api/todos/page-preview", json={"draft": draft}).json()
    assert p["page_path"] == "MI 공정업무/셋업/HBM/새 이슈"
    assert p["new_folders"] == ["MI 공정업무", "MI 공정업무/셋업", "MI 공정업무/셋업/HBM"]
    assert dirs(vault) == set()  # a preview never writes
    j = c.post("/api/todos/page-preview", json={"draft": {**draft, "planned_date": "2026-01-05"},
                                                "override": {"kind": "journal"}}).json()
    assert j["folder"] == "일지/2026/2026-01" and j["by"] == "일지 아래"
    f = c.post("/api/todos/page-preview", json={"draft": draft, "override": {"kind": "folder", "path": "스터디/광학"}}).json()
    assert f["folder"] == "스터디/광학" and f["by"] == "직접 지정"
    for bad in ({"kind": "folder", "path": "../밖"}, {"kind": "folder", "path": ""}, {"kind": "folder", "path": "a/files"},
                {"kind": "folder", "path": "a:b"}, {"kind": "zzz"}):
        assert c.post("/api/todos/page-preview", json={"draft": draft, "override": bad}).status_code == 400
    assert c.post("/api/todos/page-preview", json={"draft": {"title": " "}}).status_code == 400


def test_expand_with_override_folder_and_journal(world) -> None:
    c, vault, v = world
    a = issue(c, "지정 폴더")
    r = c.post(f"/api/todos/{a['id']}/page", json={"override": {"kind": "folder", "path": "스터디/광학"}}).json()
    assert r["path"] == "스터디/광학/지정 폴더" and r["placement"]["by"] == "직접 지정"
    b = issue(c, "일지 아래", planned_date=f"{MONTH}-15")
    r = c.post(f"/api/todos/{b['id']}/page", json={"override": {"kind": "journal"}}).json()
    assert r["path"] == f"일지/{MONTH[:4]}/{MONTH}/일지 아래"


def test_unsafe_titles_and_values_become_safe_paths(world) -> None:
    c, vault, v = world
    weird = opt(c, "product", "A/B:C?")
    c.put("/api/todos/page-rules", json={"rules": [
        {"conditions": [{"field": "product", "op": "set"}], "path": "제품/{제품}"}]})
    t = issue(c, 'a<b>:"c"?', props={"product": weird})
    r = c.post(f"/api/todos/{t['id']}/page", json={}).json()
    assert r["path"] == "제품/ABC/abc"  # slash and other illegal characters vanish
    t2 = issue(c, "...")
    o2 = {"override": {"kind": "folder", "path": "x"}}
    assert c.post(f"/api/todos/{t2['id']}/page", json=o2).json()["path"] == f"x/이슈 {t2['id']}"
    d1, d2 = issue(c, "같은 제목"), issue(c, "같은 제목")
    o = {"override": {"kind": "folder", "path": "dup"}}
    assert c.post(f"/api/todos/{d1['id']}/page", json=o).json()["path"] == "dup/같은 제목"
    assert c.post(f"/api/todos/{d2['id']}/page", json=o).json()["path"] == "dup/같은 제목 (2)"


# ---- classification changes never move files; relocate is explicit -----------------------

def test_later_changes_do_not_move_and_relocate_is_explicit(world) -> None:
    c, vault, v = world
    t = issue(c, "이동 시험", props={"type": v["setup"], "product": v["hbm"]})
    path = c.post(f"/api/todos/{t['id']}/page", json={}).json()["path"]
    c.patch(f"/api/todos/{t['id']}", json={"props": {"product": v["dram"]}})  # classification changes
    assert c.get(f"/api/todos/{t['id']}").json()["page_path"] == path
    assert c.get("/api/pages", params={"path": path}).status_code == 200  # same file, same place
    ov = c.post("/api/todos/page-rules/overview", json={}).json()
    row = next(p for p in ov["pages"] if p["task_id"] == t["id"])
    assert row["differs"] is True and row["folder"] == "MI 공정업무/셋업/HBM"
    other = issue(c, "형제")
    c.post(f"/api/todos/{other['id']}/page", json={"override": {"kind": "folder", "path": "스터디"}})
    dest = {"override": {"kind": "folder", "path": "스터디"}}
    moved = c.post(f"/api/todos/{t['id']}/page/relocate", json=dest).json()
    assert moved["moved"] is True and moved["path"] == "스터디/이동 시험"
    assert c.get(f"/api/todos/{t['id']}").json()["page_path"] == "스터디/이동 시험"
    assert c.get("/api/pages", params={"path": path}).status_code == 404
    kids = next(n for n in c.get("/api/pages/tree").json()["tree"] if n["title"] == "스터디")["children"]
    assert [k["title"] for k in kids] == ["형제", "이동 시험"]  # lands last
    assert c.post(f"/api/todos/{t['id']}/page/relocate", json=dest).json()["moved"] is False
    into_self = {"override": {"kind": "folder", "path": "스터디/형제"}}
    assert c.post(f"/api/todos/{other['id']}/page/relocate", json=into_self).status_code == 400
    plain = issue(c, "페이지 없음")
    assert c.post(f"/api/todos/{plain['id']}/page/relocate", json={}).status_code == 409


def test_tree_move_and_delete_keep_issue_links(world) -> None:
    c, vault, v = world
    t = issue(c, "트리 이동")
    c.post(f"/api/todos/{t['id']}/page", json={"override": {"kind": "folder", "path": "스터디/가"}})
    c.post("/api/pages", json={"parent": "", "title": "성과", "type": "note"})
    moved = c.patch("/api/pages", params={"path": "스터디"}, json={"parent": "성과"}).json()
    assert moved["path"] == "성과/스터디"
    assert c.get(f"/api/todos/{t['id']}").json()["page_path"] == "성과/스터디/가/트리 이동"
    again = c.post(f"/api/todos/{t['id']}/page", json={}).json()
    assert again["created"] is False and again["path"] == "성과/스터디/가/트리 이동"
    assert c.delete("/api/pages", params={"path": "성과/스터디/가/트리 이동"}).status_code == 200
    assert c.get(f"/api/todos/{t['id']}").json()["page_path"] is None
    assert list((vault / ".trash").iterdir())  # went to the trash, not deleted
    new = c.post(f"/api/todos/{t['id']}/page", json={"override": {"kind": "folder", "path": "성과"}}).json()
    assert new["created"] is True and new["path"] == "성과/트리 이동"


def test_stale_page_path_is_repaired_not_duplicated(world) -> None:
    c, vault, v = world
    t = issue(c, "캐시 어긋남")
    real = c.post(f"/api/todos/{t['id']}/page", json={"override": {"kind": "folder", "path": "스터디"}}).json()["path"]
    c.patch(f"/api/todos/{t['id']}", json={"page_path": "없는/경로"})
    r = c.post(f"/api/todos/{t['id']}/page", json={}).json()
    assert r["created"] is False and r["path"] == real
    assert c.get(f"/api/todos/{t['id']}").json()["page_path"] == real


# ---- all or nothing -----------------------------------------------------------------------

def test_failed_link_rolls_back_vault_and_allows_retry(world, monkeypatch) -> None:
    c, vault, v = world
    t = issue(c, "실패 시험", props={"type": v["setup"], "product": v["hbm"]})
    before = dirs(vault)
    real = placement._link
    monkeypatch.setattr(placement, "_link", boom)
    assert c.post(f"/api/todos/{t['id']}/page", json={}).status_code == 500
    assert dirs(vault) == before  # no page, no automatic folders
    assert c.get(f"/api/todos/{t['id']}").json()["page_path"] is None
    monkeypatch.setattr(placement, "_link", real)
    ok = c.post(f"/api/todos/{t['id']}/page", json={}).json()
    assert ok["created"] is True and ok["path"] == "MI 공정업무/셋업/HBM/실패 시험"


def test_failure_while_writing_page_cleans_up(world, monkeypatch) -> None:
    c, vault, v = world
    t = issue(c, "쓰기 실패", note="본문")
    before = dirs(vault)
    monkeypatch.setattr(Vault, "write", boom)
    r = c.post(f"/api/todos/{t['id']}/page", json={"override": {"kind": "folder", "path": "가/나"}})
    assert r.status_code == 500
    assert dirs(vault) == before
    assert c.get(f"/api/todos/{t['id']}").json()["page_path"] is None


def test_existing_folders_survive_a_failed_expansion(world, monkeypatch) -> None:
    c, vault, v = world
    c.post("/api/pages", json={"parent": "", "title": "스터디", "type": "note"})
    t = issue(c, "남아야 함")
    before = dirs(vault)
    monkeypatch.setattr(placement, "_link", boom)
    c.post(f"/api/todos/{t['id']}/page", json={"override": {"kind": "folder", "path": "스터디/새 폴더"}})
    assert dirs(vault) == before and "스터디" in dirs(vault)


def test_create_with_page_is_atomic(world, monkeypatch) -> None:
    c, vault, v = world
    body = {"title": "한 번에", "props": {"type": v["setup"], "product": v["hbm"]}, "planned_date": TODAY}
    r = c.post("/api/todos/with-page", json=body)
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["created"] and d["path"] == "MI 공정업무/셋업/HBM/한 번에"
    assert d["task"]["page_path"] == d["path"] and d["task"]["journal_days"]  # journal line was created too
    n_tasks = len(c.get("/api/todos").json()["items"])
    before = dirs(vault)
    monkeypatch.setattr(placement, "_link", boom)
    assert c.post("/api/todos/with-page", json={**body, "title": "실패"}).status_code == 500
    assert len(c.get("/api/todos").json()["items"]) == n_tasks  # no issue left without its page
    assert dirs(vault) == before
    assert c.post("/api/todos/with-page", json={"title": "  "}).status_code == 400


def test_relocate_failure_puts_page_back(world, monkeypatch) -> None:
    c, vault, v = world
    t = issue(c, "되돌아옴")
    path = c.post(f"/api/todos/{t['id']}/page", json={"override": {"kind": "folder", "path": "스터디"}}).json()["path"]
    c.put("/api/pages", params={"path": path}, json={"content": "내용"})
    meta_before = c.get("/api/pages", params={"path": path}).json()["meta"]
    before = dirs(vault)
    monkeypatch.setattr(placement, "_link", boom)
    r = c.post(f"/api/todos/{t['id']}/page/relocate", json={"override": {"kind": "folder", "path": "성과/새"}})
    assert r.status_code == 500
    assert dirs(vault) == before
    back = c.get("/api/pages", params={"path": path}).json()
    assert back["content"] == "내용" and back["meta"] == meta_before
    assert c.get(f"/api/todos/{t['id']}").json()["page_path"] == path


# ---- rule editor support ----------------------------------------------------------------

def test_overview_counts_examples_and_draft_rules(world) -> None:
    c, vault, v = world
    issue(c, "A", props={"type": v["setup"], "product": v["hbm"]})
    issue(c, "B", props={"type": v["eval"]})
    issue(c, "C", props={"type": v["eval"]})
    ov = c.post("/api/todos/page-rules/overview", json={}).json()
    assert [r["matches"] for r in ov["rules"]] == [1, 2]
    assert ov["rules"][0]["example"]["folder"] == "MI 공정업무/셋업/HBM"
    assert ov["fallbacks"][0]["key"] == "journal"
    draft = [{"conditions": [{"field": "type", "op": "set"}], "path": "전부"}]
    d = c.post("/api/todos/page-rules/overview", json={"rules": draft}).json()
    assert d["rules"][0]["matches"] == 3  # unsaved draft is evaluated, nothing is written
    assert c.get("/api/todos/page-rules").json()["rules"] != draft
    bad = c.post("/api/todos/page-rules/overview", json={"rules": [{"conditions": [], "path": "{없는변수}"}]})
    assert bad.status_code == 400


def test_rule_without_conditions_never_matches(world) -> None:
    c, vault, v = world
    c.put("/api/todos/page-rules", json={"rules": [{"conditions": [], "path": "전부"}]})
    t = issue(c, "빈 규칙")
    assert c.post("/api/todos/page-preview", json={"task_id": t["id"]}).json()["by"].startswith("기본")


def test_preview_for_relocation_reports_current_location(world) -> None:
    c, vault, v = world
    t = issue(c, "위치 미리보기", props={"type": v["setup"], "product": v["hbm"]})
    path = c.post(f"/api/todos/{t['id']}/page", json={}).json()["path"]
    plain = c.post("/api/todos/page-preview", json={"task_id": t["id"]}).json()
    assert plain == {"exists": True, "path": path}  # expanding again would just open it
    rel = c.post("/api/todos/page-preview", json={"task_id": t["id"], "relocate": True,
                                                  "override": {"kind": "folder", "path": "스터디"}}).json()
    assert rel["exists"] is True and rel["current"] == path and rel["folder"] == "스터디"
