"""P6-04: snapshot history, diff and multi-recipe comparison (fake data; tolerance comes from the mapping file)."""
import json
import time
import zipfile
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db, rcp_compare
from app.main import create_app
from app.repositories import recipes as repo
from app.repositories.recipes import FileIn, RecipeError
from parsers import mapping

MAPPING = {
    "format": "mi-planner-recipe-mapping", "format_version": 1, "vendor": "V", "mapping_version": "1",
    "files": [{"match": "*", "parser": "fake"}],
    "params": [
        {"path": "Focus", "label": "초점", "unit": "um", "group": "광학", "compare": "number", "tolerance": 0.05},
        {"path": "Gain", "label": "게인", "group": "광학", "compare": "number"},
        {"path_glob": "Scan/*", "label": "스캔", "group": "스캔", "compare": "text"},
    ],
}


@pytest.fixture()
def env(tmp_path: Path, monkeypatch):
    d = tmp_path / "maps"
    d.mkdir()
    (d / "tmap.json").write_text(json.dumps(MAPPING), encoding="utf-8")
    monkeypatch.setattr(mapping, "SEARCH_DIRS", (d,))
    path = tmp_path / "r.db"
    db.init_db(path)
    conn = db.connect(path)
    yield conn, d, tmp_path
    conn.close()


def _src(conn, name="S1", mapping_name="tmap", equipment="EQ-A01"):
    return repo.create_source(conn, {"name": name, "equipment": equipment, "line": "L1", "ftp_profile": "p",
                                     "mapping": mapping_name})


def _snap(conn, rid, params, sha="a"):
    """params: {path: value}; one file a.fake whose hash is `sha`."""
    rows = [{"path": k, "value": v, "group": "광학" if k in ("Focus", "Gain") else ("스캔" if k.startswith("Scan/") else ""),
             "label": {"Focus": "초점", "Gain": "게인"}.get(k, ""), "unit": "um" if k == "Focus" else ""}
            for k, v in params.items()]
    f = FileIn("a.fake", sha * 64, 5, "blobs/x", parser="fake", params=rows)
    sid, _ = repo.add_snapshot(conn, rid, [f])
    conn.commit()
    return sid


def _rec(conn, src, name, params, sha="a"):
    rid = repo.upsert_recipe(conn, src["id"], name)
    return rid, _snap(conn, rid, params, sha)


# ---- value comparison ---------------------------------------------------------------------------------------------

def test_compare_values_tolerance_edges():
    cv = rcp_compare.compare_values
    assert cv("1.00", "1.05", "number", 0.05) == (False, "same")      # boundary is equal
    assert cv("1.00", "1.0501", "number", 0.05)[0] is True
    assert cv("0.1", "0.3", "number", 0.2) == (False, "same")          # float noise
    assert cv("1", "1.0", "number", 0)[0] is False                      # numeric equality ignores formatting
    assert cv("1", "1.0", "text", 0)[0] is True                         # text compares exactly
    assert cv("1,200", "1200", "number", 0)[0] is False
    assert cv("1.0", "1.04", "text", 0.5)[0] is True                    # tolerance never applies to text
    assert cv("1.0", "1.04", "number", -0.05)[0] is False               # sign of tolerance ignored
    assert cv("nan", "nan", "number", 0)[0] is False                    # nan/inf are plain text
    assert cv("inf", "1", "number", 0) == (True, "type_changed")


def test_type_change_numeric_to_text():
    assert rcp_compare.compare_values("5", "FAST", "text") == (True, "type_changed")
    assert rcp_compare.compare_values("5", "", "number") == (True, "type_changed")
    assert rcp_compare.compare_values("A", "B") == (True, "changed")


def test_rules_exact_before_glob_and_default_text():
    r = rcp_compare.Rules([MAPPING])
    assert r.get("Focus") == ("number", 0.05)
    assert r.get("Scan/Mode") == ("text", 0.0)
    assert r.get("Unknown") == ("text", 0.0)
    assert rcp_compare.Rules([None]).get("Focus") == ("text", 0.0)


# ---- diff / history -----------------------------------------------------------------------------------------------

def test_snapshot_diff_added_removed_changed_within_tolerance(env):
    conn, _, _ = env
    src = _src(conn)
    rid = repo.upsert_recipe(conn, src["id"], "R1")
    s1 = _snap(conn, rid, {"Focus": "1.00", "Gain": "2", "Scan/Mode": "FAST", "Old": "x", "Num": "5"}, "a")
    s2 = _snap(conn, rid, {"Focus": "1.04", "Gain": "3", "Scan/Mode": "FAST", "New": "y", "Num": "five"}, "b")
    out = rcp_compare.snapshot_diff(conn, s1, s2, only_changes=False)
    by = {r["path"]: r for r in out["rows"]}
    assert by["Focus"]["status"] == "same" and by["Focus"]["within_tolerance"]
    assert by["Focus"]["delta"] == pytest.approx(0.04)
    assert by["Gain"]["status"] == "changed" and by["Gain"]["delta"] == 1
    assert by["Scan/Mode"]["status"] == "same" and not by["Scan/Mode"]["within_tolerance"]
    assert by["New"]["status"] == "added" and by["New"]["old"] is None
    assert by["Old"]["status"] == "removed" and by["Old"]["new"] is None
    assert by["Num"]["status"] == "changed" and by["Num"]["type_changed"] is True
    s = out["summary"]
    assert (s["added"], s["removed"], s["changed"], s["type_changed"], s["within_tolerance"]) == (1, 1, 2, 1, 1)
    assert s["total_changes"] == 4 and s["files_changed"] == 1
    only = rcp_compare.snapshot_diff(conn, s1, s2)
    assert {r["path"] for r in only["rows"]} == {"Gain", "New", "Old", "Num"}


def test_diff_reads_tolerance_from_mapping_now(env):
    conn, d, _ = env
    src = _src(conn)
    rid = repo.upsert_recipe(conn, src["id"], "R1")
    s1 = _snap(conn, rid, {"Focus": "1.00"}, "a")
    s2 = _snap(conn, rid, {"Focus": "1.04"}, "b")
    assert rcp_compare.snapshot_diff(conn, s1, s2)["summary"]["changed"] == 0
    tight = {**MAPPING, "params": [{"path": "Focus", "compare": "number", "tolerance": 0.01}]}
    (d / "tmap.json").write_text(json.dumps(tight), encoding="utf-8")
    assert rcp_compare.snapshot_diff(conn, s1, s2)["summary"]["changed"] == 1  # no re-parse needed


def test_diff_same_path_in_different_files_is_distinct(env):
    conn, _, _ = env
    src = _src(conn)
    rid = repo.upsert_recipe(conn, src["id"], "R1")

    def f(rel, v, sha):
        return FileIn(rel, sha * 64, 1, "b", parser="fake", params=[{"path": "Gain", "value": v}])

    s1, _ = repo.add_snapshot(conn, rid, [f("a.fake", "1", "a"), f("b.fake", "1", "b")])
    s2, _ = repo.add_snapshot(conn, rid, [f("a.fake", "1", "a"), f("b.fake", "2", "c")])
    rows = rcp_compare.snapshot_diff(conn, s1, s2)["rows"]
    assert [(r["file"], r["status"]) for r in rows] == [("b.fake", "changed")]


def test_diff_rejects_other_recipe_and_missing(env):
    conn, _, _ = env
    src = _src(conn)
    _, s1 = _rec(conn, src, "R1", {"Gain": "1"}, "a")
    _, s2 = _rec(conn, src, "R2", {"Gain": "1"}, "b")
    with pytest.raises(RecipeError) as e:
        rcp_compare.snapshot_diff(conn, s1, s2)
    assert e.value.status == 422
    with pytest.raises(RecipeError) as e:
        rcp_compare.snapshot_diff(conn, s1, 9999)
    assert e.value.status == 404


def test_history_summaries_and_revert(env):
    conn, _, _ = env
    src = _src(conn)
    rid = repo.upsert_recipe(conn, src["id"], "R1")
    _snap(conn, rid, {"Gain": "1", "Old": "x"}, "a")
    _snap(conn, rid, {"Gain": "2", "New": "y"}, "b")
    s3 = _snap(conn, rid, {"Gain": "1", "Old": "x"}, "a")  # revert A→B→A is a new snapshot
    h = rcp_compare.history(conn, rid)
    assert [i["is_current"] for i in h["items"]] == [True, False, False]
    assert h["items"][2]["summary"] is None and h["items"][2]["previous_id"] is None
    mid, top = h["items"][1]["summary"], h["items"][0]["summary"]
    assert (mid["added"], mid["removed"], mid["changed"]) == (1, 1, 1)
    assert (top["added"], top["removed"], top["changed"]) == (1, 1, 1)
    assert h["items"][0]["id"] == s3 and h["items"][0]["previous_id"] == h["items"][1]["id"]


def test_history_limit_keeps_base(env):
    conn, _, _ = env
    src = _src(conn)
    rid = repo.upsert_recipe(conn, src["id"], "R1")
    for i in range(4):
        _snap(conn, rid, {"Gain": str(i)}, "abcd"[i])
    h = rcp_compare.history(conn, rid, limit=2)
    assert len(h["items"]) == 2 and h["truncated"] is True
    assert h["items"][1]["summary"]["changed"] == 1  # oldest shown is still diffed against the dropped base


# ---- comparison ---------------------------------------------------------------------------------------------------

def test_compare_marks_tolerance_missing_and_groups(env):
    conn, _, _ = env
    s1, s2 = _src(conn, "S1"), _src(conn, "S2", equipment="EQ-B01")
    r1, _ = _rec(conn, s1, "RA", {"Focus": "1.00", "Gain": "2", "Scan/Mode": "FAST", "Only1": "q"}, "a")
    r2, _ = _rec(conn, s2, "RB", {"Focus": "1.05", "Gain": "2.5", "Scan/Mode": "SLOW", "Only2": "z"}, "b")
    r3, _ = _rec(conn, s1, "RC", {"Focus": "1.20", "Gain": "2", "Scan/Mode": "FAST"}, "c")
    out = rcp_compare.compare_recipes(conn, rcp_compare.parse_specs(f"{r1},{r2},{r3}"))
    rows = {r["path"]: r for r in out["rows"]}
    assert rows["Focus"]["marks"] == ["", "", "d"] and rows["Focus"]["diff"]    # 1.05 within 0.05, 1.20 not
    assert rows["Gain"]["marks"] == ["", "d", ""]
    assert rows["Scan/Mode"]["marks"] == ["", "d", ""]
    assert rows["Only1"]["marks"] == ["", "m", "m"] and rows["Only1"]["values"][1] is None
    assert rows["Only2"]["marks"] == ["m", "", "m"]                            # reference = first present value
    assert rows["Focus"]["label"] == "초점" and rows["Focus"]["group"] == "광학"
    assert [g["name"] for g in out["groups"]] == ["광학", "스캔", ""]
    assert out["summary"] == {"total": 5, "differing": 5, "missing": 2}
    assert [c["equipment"] for c in out["columns"]] == ["EQ-A01", "EQ-B01", "EQ-A01"]


def test_compare_identical_recipes_have_no_diff(env):
    conn, _, _ = env
    s = _src(conn)
    r1, _ = _rec(conn, s, "RA", {"Focus": "1.0", "Gain": "2"}, "a")
    r2, _ = _rec(conn, s, "RB", {"Focus": "1.03", "Gain": "2.0"}, "b")
    out = rcp_compare.compare_recipes(conn, rcp_compare.parse_specs(f"{r1},{r2}"))
    assert out["summary"]["differing"] == 0 and not any(r["diff"] for r in out["rows"])


def test_compare_pinned_snapshot_and_spec_validation(env):
    conn, _, _ = env
    s = _src(conn)
    rid = repo.upsert_recipe(conn, s["id"], "RA")
    old = _snap(conn, rid, {"Gain": "1"}, "a")
    _snap(conn, rid, {"Gain": "2"}, "b")
    r2, _ = _rec(conn, s, "RB", {"Gain": "1"}, "c")
    out = rcp_compare.compare_recipes(conn, rcp_compare.parse_specs(f"{rid}:{old},{r2}"))
    assert out["rows"][0]["diff"] is False and out["columns"][0]["snapshot_id"] == old
    for bad in ["1", "1,1", ",".join(str(i) for i in range(1, 8)), "a,b", ""]:
        with pytest.raises(RecipeError):
            rcp_compare.parse_specs(bad)
    other_snap = _snap(conn, repo.upsert_recipe(conn, s["id"], "RZ"), {"Gain": "9"}, "z")
    with pytest.raises(RecipeError):
        rcp_compare.compare_recipes(conn, [(rid, other_snap), (r2, None)])
    empty = repo.upsert_recipe(conn, s["id"], "NoSnap")
    with pytest.raises(RecipeError) as e:
        rcp_compare.compare_recipes(conn, [(rid, None), (empty, None)])
    assert "NoSnap" in str(e.value)


def test_compare_large_table_is_fast_enough(env):
    conn, _, _ = env
    s = _src(conn)
    big = {f"P/{i}": str(i) for i in range(5000)}
    r1, _ = _rec(conn, s, "BIG1", big, "a")
    r2, _ = _rec(conn, s, "BIG2", {**big, "P/7": "x"}, "b")
    t = time.perf_counter()
    out = rcp_compare.compare_recipes(conn, rcp_compare.parse_specs(f"{r1},{r2}"))
    assert time.perf_counter() - t < 3
    assert out["summary"]["total"] == 5000 and out["summary"]["differing"] == 1


def test_filter_rows():
    rows = [{"diff": True, "group": "광학", "path": "Focus", "label": "초점", "file": "a", "values": ["1", "2"]},
            {"diff": False, "group": "", "path": "Zed", "label": "", "file": "a", "values": ["9", "9"]}]
    f = rcp_compare.filter_rows
    assert len(f(rows)) == 2 and len(f(rows, only_diff=True)) == 1
    assert [r["path"] for r in f(rows, group="")] == ["Zed"]
    assert [r["path"] for r in f(rows, q=" 초점 ")] == ["Focus"]
    assert [r["path"] for r in f(rows, q="9")] == ["Zed"]


# ---- API ----------------------------------------------------------------------------------------------------------

def test_api_history_diff_compare_export(env):
    conn, _, tmp = env
    s = _src(conn)
    rid = repo.upsert_recipe(conn, s["id"], "RA")
    a = _snap(conn, rid, {"Focus": "1.0", "Gain": "1", "=SUM(A1)": "=1+1"}, "a")
    b = _snap(conn, rid, {"Focus": "1.0", "Gain": "2", "=SUM(A1)": "=1+1"}, "b")
    r2, _ = _rec(conn, s, "RB", {"Focus": "1.0", "Gain": "1"}, "c")
    conn.close()
    with TestClient(create_app(tmp / "r.db", tmp / "vault"), raise_server_exceptions=False) as c:
        h = c.get(f"/api/recipes/{rid}/history").json()
        assert [i["id"] for i in h["items"]] == [b, a]
        assert h["items"][0]["summary"]["changed"] == 1
        d = c.get(f"/api/recipes/{rid}/diff", params={"a": a, "b": b}).json()
        assert [r["path"] for r in d["rows"]] == ["Gain"] and d["a"]["id"] == a
        assert c.get(f"/api/recipes/{r2}/diff", params={"a": a, "b": b}).status_code == 422
        assert c.get(f"/api/recipes/{rid}/diff", params={"a": a, "b": 999}).json()["error"]
        cmp_ = c.get("/api/recipe-compare", params={"ids": f"{rid},{r2}"}).json()
        assert cmp_["summary"]["differing"] == 2 and len(cmp_["columns"]) == 2  # Gain + the formula-like row
        assert c.get("/api/recipe-compare", params={"ids": "1"}).status_code == 422
        res = c.get("/api/recipe-compare/export.xlsx", params={"ids": f"{rid},{r2}", "only_diff": "true"})
        assert res.status_code == 200 and "spreadsheetml" in res.headers["content-type"]
        z = zipfile.ZipFile(BytesIO(res.content))
        sheet = z.read("xl/worksheets/sheet1.xml").decode()
        assert "다름 ≠" in sheet and "Gain" in sheet and "Focus" not in sheet
        assert "<f>" not in sheet  # formula-looking text stays text
        assert "RA" in z.read("xl/worksheets/sheet2.xml").decode()
