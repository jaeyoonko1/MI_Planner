"""P6-03: generic xml/ini/txt parsers, mapping selection + application, collection hook, re-parse. Fake data only."""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

import parsers
from app import rcp_parse
from parsers import base, mapping
from parsers.base import ParseError

# collection fixtures (in-process fake FTP server) from the P6-02 tests
from test_rcp_collect import FakeServer, env, make_source, run_and_wait  # noqa: F401

ROOT = Path(__file__).resolve().parent.parent


def parse(name: str, data: bytes, file_name: str = "", options: dict | None = None):
    return parsers.get(name).parse(data, file_name or f"a.{name}", options)


# ---- registry -----------------------------------------------------------------------------------------------------

def test_builtin_parsers_registered_and_picked_by_extension():
    assert {"xml", "ini", "txt"} <= set(base.names())
    assert parsers.pick("a.XML").name == "xml" and parsers.pick("sub/x.ini").name == "ini"
    assert parsers.pick("x.txt").name == "txt" and parsers.pick("x.doc") is None
    assert all(not parsers.get(n).can_write for n in ("xml", "ini", "txt"))  # D-11: nothing writable yet


# ---- xml ----------------------------------------------------------------------------------------------------------

XML = """<?xml version="1.0" encoding="utf-8"?>
<Recipe xmlns="urn:fake">
  <!-- comment -->
  <Header Rev="3"><Created>2026-01-01</Created></Header>
  <Optics><Focus unit="um">1.25</Focus><Empty/></Optics>
  <Scan><Pass><Speed>20</Speed></Pass><Pass><Speed>40</Speed></Pass><Pass><Speed>60</Speed></Pass></Scan>
</Recipe>"""


def test_xml_paths_attributes_repeats_namespace():
    got = parse("xml", XML.encode()).as_dict()
    assert got == {
        "Header@Rev": "3", "Header/Created": "2026-01-01", "Optics/Focus@unit": "um", "Optics/Focus": "1.25",
        "Optics/Empty": "", "Scan/Pass/Speed": "20", "Scan/Pass[2]/Speed": "40", "Scan/Pass[3]/Speed": "60"}
    assert list(got)[0] == "Header@Rev"  # document order


def test_xml_key_attr_option():
    xml = '<R><G><Param Name="Focus" Id="1">1.0</Param><Param Name="Gain">3</Param><Param>9</Param></G></R>'
    got = parse("xml", xml.encode(), options={"key_attr": "Name"}).as_dict()
    assert got == {"G/Focus@Id": "1", "G/Focus": "1.0", "G/Gain": "3", "G/Param": "9"}
    with pytest.raises(ParseError):
        parse("xml", b"<a/>", options={"key_attr": 5})


def test_xml_text_beside_children_is_warned_not_stored():
    res = parse("xml", b"<R><A>stray<B>1</B></A></R>")
    assert res.as_dict() == {"A/B": "1"} and "A:" in res.warnings[0]


@pytest.mark.parametrize("enc,declared", [("utf-8", "utf-8"), ("utf-8-sig", "utf-8"), ("cp949", "euc-kr"),
                                          ("utf-16", "utf-16"), ("cp949", "utf-8")])  # last: wrong declaration
def test_xml_encodings(enc, declared):
    text = f'<?xml version="1.0" encoding="{declared}"?><R><이름>초점 값</이름></R>'
    res = parse("xml", text.encode(enc))
    assert res.as_dict() == {"이름": "초점 값"}
    assert res.encoding in (enc, "utf-8-sig", "utf-16", "cp949")


def test_xml_malformed_messages_are_korean_and_safe():
    for bad in (b"<a><b></a>", b"", b"not xml at all", b"<a>", b"<a b=1/>"):
        with pytest.raises(ParseError) as e:
            parse("xml", bad)
        assert "XML" in str(e.value) or "텍스트" in str(e.value)


def test_xml_entity_and_doctype_attacks_rejected():
    laughs = ('<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;">'
              '<!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]><lolz>&lol3;</lolz>')
    xxe = '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///c:/windows/win.ini">]><r>&x;</r>'
    spaced_lower = "<r><!  doctype r []></r>"
    for evil in (laughs, xxe, spaced_lower):
        for enc in ("utf-8", "utf-16"):
            with pytest.raises(ParseError) as e:
                parse("xml", evil.encode(enc))
            assert "DOCTYPE" in str(e.value)
    # also hidden deep into a big file
    with pytest.raises(ParseError):
        parse("xml", b"<r>" + b"<a>1</a>" * 200_000 + b"<!DOCTYPE x></r>")


def test_xml_depth_and_size_limits():
    deep = "<a>" * 5000 + "1" + "</a>" * 5000
    with pytest.raises(ParseError) as e:
        parse("xml", deep.encode())
    assert "깊" in str(e.value)
    with pytest.raises(ParseError) as e:  # too many parameters
        parse("xml", b"<r>" + b"<i>1</i>" * (base.MAX_PARAMS + 1) + b"</r>")
    assert "많" in str(e.value)
    with pytest.raises(ParseError) as e:
        parse("xml", b"<r>" + b" " * base.MAX_FILE_BYTES + b"</r>")
    assert "커요" in str(e.value)


def test_binary_and_utf16_garbage_rejected():
    with pytest.raises(ParseError):
        parse("txt", b"abc\x00\x01\x02def")
    with pytest.raises(ParseError):
        parse("ini", b"\xff\xfe\x00")  # truncated UTF-16 (odd length)


# ---- ini ----------------------------------------------------------------------------------------------------------

def test_ini_sections_comments_duplicates_lines():
    text = "; c\ntop = 1\n[Optics]\nFocus = 1.25\nGain: 3\n# x\nFocus = 2\n[Bad\nnonsense\n[Stage/Fast]\nSpeed=5\n"
    res = parse("ini", text.encode("cp949"))
    assert res.as_dict() == {"top": "1", "Optics/Focus": "1.25", "Optics/Gain": "3", "Optics/Focus[2]": "2",
                             "Stage_Fast/Speed": "5"}
    assert [p.line for p in res.params][:3] == [2, 4, 5]
    assert len(res.warnings) == 2 and res.encoding == "utf-8-sig"  # pure ASCII is valid UTF-8


def test_ini_bom_and_empty():
    assert parse("ini", b"\xef\xbb\xbf[A]\nk=v\n").as_dict() == {"A/k": "v"}
    assert parse("ini", b"").warnings == ["읽을 수 있는 항목이 없어요."]


# ---- txt ----------------------------------------------------------------------------------------------------------

def test_txt_kv_table_fixed():
    kv = parse("txt", "# fake\nGain = 3\nName: LOT-TEST-001\nTabbed\t7\nGain = 4\nlonely\n".encode("utf-8"))
    assert kv.as_dict() == {"Gain": "3", "Name": "LOT-TEST-001", "Tabbed": "7", "Gain[2]": "4"} and kv.warnings
    table = parse("txt", b"id,x,y\nP1,1,2\nP2,3\nP1,5,6\n", options={"mode": "table", "delimiter": ","})
    assert table.as_dict() == {"P1/x": "1", "P1/y": "2", "P1[2]/x": "5", "P1[2]/y": "6", "P2/x": "3"}
    ws = parse("txt", b"id  a  b\nR1  1  2\n", options={"mode": "table"})
    assert ws.as_dict() == {"R1/a": "1", "R1/b": "2"}
    fixed = parse("txt", "FOCUS_OFFSET        0.50\nMODE                자동\n".encode("cp949"),
                  options={"mode": "fixed", "name_cols": [0, 20], "value_cols": [20, 40]})
    assert fixed.as_dict() == {"FOCUS_OFFSET": "0.50", "MODE": "자동"}


def test_txt_bad_options_and_long_line():
    for opt in ({"mode": "nope"}, {"mode": "fixed"}, {"mode": "fixed", "name_cols": [5, 2], "value_cols": [6, 9]},
                {"mode": "fixed", "name_cols": [0, True], "value_cols": [1, 9]}):
        with pytest.raises(ParseError):
            parse("txt", b"a b\n", options=opt)
    with pytest.raises(ParseError):
        parse("txt", b"k = " + b"x" * 200_000 + b"\n")
    with pytest.raises(ParseError):
        parse("txt", b"a=1", options=["not", "a", "dict"])  # type: ignore[arg-type]


def test_cp949_vs_latin1_fallback():
    assert parse("txt", "이름 = 홍길동\n".encode("cp949")).params[0].value == "홍길동"
    assert parse("txt", b"k = \xff\xfe\xfd\n").encoding == "latin-1"


# ---- mapping ------------------------------------------------------------------------------------------------------

def test_mapping_apply_order_ignore_unmapped():
    data = mapping.load("example_xml_vendor")
    rows, warns = mapping.apply(data, [("Header/Created", "x"), ("Zeta", "z"), ("Scan/Pass/Speed", "20"),
                                       ("Optics/Focus", "1.0"), ("Scan@Timestamp", "t"), ("Scan/Pass[2]/Speed", "abc")])
    assert [r["path"] for r in rows] == ["Optics/Focus", "Scan/Pass/Speed", "Scan/Pass[2]/Speed", "Zeta"]
    assert rows[0] == {"path": "Optics/Focus", "value": "1.0", "label": "초점", "unit": "um", "group": "광학"}
    assert len(warns) == 1 and "Scan/Pass[2]/Speed" in warns[0]
    hidden, _ = mapping.apply(mapping.load("example_ini_vendor"), [("Optics/Focus", "1"), ("Serial", "x"), ("System/A", "1")])
    assert [r["path"] for r in hidden] == ["Optics/Focus"]  # show_unmapped=false, ignore System/*
    plain, _ = mapping.apply(None, [("a", "1")])
    assert plain == [{"path": "a", "value": "1", "label": "", "unit": "", "group": ""}]


def test_mapping_file_rules_first_match_and_basename():
    data = mapping.load("example_xml_vendor")
    assert mapping.file_rule(data, "recipe.xml") == ("xml", {"key_attr": "Name"})
    assert mapping.file_rule(data, "sub/dir/Recipe.XML") == ("xml", {"key_attr": "Name"})  # basename, any case
    assert mapping.file_rule(data, "other.xml") == ("xml", {})
    assert mapping.file_rule(data, "a.txt") is None and mapping.file_rule(None, "a.xml") is None
    ini = mapping.load("example_vendor")  # pattern with a folder: matches the full path only
    assert mapping.file_rule(ini, "params/a.ini") == ("ini", {}) and mapping.file_rule(ini, "other/a.ini") is None


def test_mapping_options_validation():
    data = mapping.load("example_xml_vendor")
    bad = {**data, "files": [{"match": "*.xml", "parser": "xml", "options": ["x"]}]}
    assert mapping.validate(bad)


def test_mapping_selection_by_vendor_and_model(tmp_path):
    local = tmp_path / "local"
    local.mkdir()
    base_data = mapping.load("example_xml_vendor")
    (local / "mine.json").write_text(json.dumps({**base_data, "vendor": "Acme", "models": ["M9"]}), encoding="utf-8")
    (local / "broken.json").write_text("{not json", encoding="utf-8")
    dirs = (local, mapping.SEARCH_DIRS[1])
    names = {m["name"]: m for m in mapping.available(dirs)}
    assert "mine" in names and names["broken"]["error"] and not names["example_xml_vendor"]["error"]
    assert mapping.find_for("acme", "m9", dirs) == "mine"
    assert mapping.find_for("Acme", "other", dirs) == ""  # model not listed
    assert mapping.find_for("VENDOR-B", "anything", dirs) == "example_ini_vendor"  # empty models = any model
    assert mapping.find_for("", "M9", dirs) == "" and mapping.find_for("nobody", "", dirs) == ""


def test_config_mapping_overrides_committed(tmp_path, monkeypatch):
    local = tmp_path / "cfg"
    local.mkdir()
    data = mapping.load("example_ini_vendor")
    (local / "example_ini_vendor.json").write_text(json.dumps({**data, "mapping_version": "local.9"}), encoding="utf-8")
    monkeypatch.setattr(mapping, "SEARCH_DIRS", (local, mapping.SEARCH_DIRS[1]))
    assert rcp_parse.resolve_mapping({"mapping": "example_ini_vendor"}).version == "local.9"
    ctx = rcp_parse.resolve_mapping({"mapping": "does_not_exist"})
    assert ctx.data is None and "찾을 수 없어요" in ctx.error
    assert rcp_parse.resolve_mapping({"vendor": "VENDOR-B", "model": "x"}).auto is True


# ---- parse_one: never raises ---------------------------------------------------------------------------------------

def test_parse_one_failure_modes_become_errors():
    ctx = rcp_parse.MappingCtx()
    assert rcp_parse.parse_one(b"\x00\x01", "bin.txt", ctx)[:2] == ("txt", "텍스트 파일이 아니에요 (바이너리 내용이 들어 있어요).")
    assert rcp_parse.parse_one(b"data", "photo.jpg", ctx) == ("", "", [], [])  # unknown type: not an error
    name, err, rows, _ = rcp_parse.parse_one(b"<a><b></a>", "x.xml", ctx)
    assert name == "xml" and "XML" in err and rows == []
    bad_rule = rcp_parse.MappingCtx("m", {"files": [{"match": "*.zzz", "parser": "nope"}]})
    assert "등록되지 않은 파서" in rcp_parse.parse_one(b"x", "a.zzz", bad_rule)[1]

    class Boom(base.RecipeParser):
        name = "boom"

        def _parse(self, data, file_name, options):
            raise RuntimeError("secret internal detail C:\\x")
    base.register(Boom)
    try:
        boom = rcp_parse.MappingCtx("m", {"files": [{"match": "*.boom", "parser": "boom"}]})
        out = rcp_parse.parse_one(b"x", "a.boom", boom)
        assert out[1] == rcp_parse.UNEXPECTED and "secret" not in out[1]
    finally:
        base._REGISTRY.pop("boom")


# ---- sample generator ----------------------------------------------------------------------------------------------

def _samples():
    spec = importlib.util.spec_from_file_location("make_sample_recipes", ROOT / "scripts" / "make_sample_recipes.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.samples()


def test_fake_samples_parse_with_fake_mappings():
    s = _samples()
    for fname, mname, expect in [("recipe.xml", "example_xml_vendor", "Optics/Focus"),
                                 ("params/main.ini", "example_ini_vendor", "Optics/Focus"),
                                 ("params.txt", "example_txt_vendor", "FOCUS_OFFSET"),
                                 ("points.txt", "example_txt_vendor", "P1/x"),
                                 ("optics.xml", "", "Scan/Mode"), ("notes.txt", "", "Gain")]:
        ctx = rcp_parse.MappingCtx(mname, mapping.load(mname) if mname else None)
        name, err, rows, _ = rcp_parse.parse_one(s[fname], fname, ctx)
        assert not err and expect in {r["path"] for r in rows}, (fname, err)


# ---- collection hook + re-parse -----------------------------------------------------------------------------------

MAP_V1 = {"format": "mi-planner-recipe-mapping", "format_version": 1, "vendor": "VENDOR-T", "mapping_version": "1",
          "files": [{"match": "*.xml", "parser": "xml", "options": {"key_attr": "Name"}}, {"match": "*.ini", "parser": "ini"}],
          "params": [{"path": "Optics/Focus", "label": "초점", "unit": "um", "group": "광학", "compare": "number"}],
          "ignore": ["Header/*"], "show_unmapped": True}


@pytest.fixture()
def maps(tmp_path, monkeypatch):
    d = tmp_path / "maps"
    d.mkdir()
    (d / "t1.json").write_text(json.dumps(MAP_V1), encoding="utf-8")
    monkeypatch.setattr(mapping, "SEARCH_DIRS", (d,))
    return d


def _tree():
    good = b'<R><Header><Created>x</Created></Header><Optics><P Name="Focus">1.25</P></Optics></R>'
    return {"recipes": {"aabb_1": {
        "ok.xml": good, "main.ini": "[Optics]\nGain = 3\n".encode("cp949"), "broken.xml": b"<a><b></a>",
        "evil.xml": b'<!DOCTYPE r [<!ENTITY a "&a;&a;">]><r>&a;</r>', "pic.bin": b"\x89PNG\x00\x00"}}}


def _snapshot(client, sid):
    rid = client.get("/api/recipes", params={"source_id": sid}).json()["items"][0]["id"]
    got = client.get(f"/api/recipes/{rid}").json()
    return rid, got, client.get(f"/api/recipe-snapshots/{got['current']['snapshot']['id']}").json()


def test_collection_parses_and_survives_bad_files(env, maps):
    client, server, tmp, _ = env
    server.tree = _tree()
    sid = make_source(client, mapping="t1", file_globs=[], name_filter=[])
    run = run_and_wait(client, sid)
    assert run["status"] == "ok", run  # unparseable files never fail the run
    assert "파싱 못 한 파일 2개" in run["message"]
    assert sorted(e["file"] for e in run["errors"]) == ["broken.xml", "evil.xml"]
    assert all(e["message"].startswith("파싱 실패") for e in run["errors"])
    _, got, snap = _snapshot(client, sid)
    s = snap["snapshot"]
    assert s["parse_status"] == "partial" and s["file_count"] == 5
    assert s["parser_info"]["mapping"] == "t1" and s["parser_info"]["parsers"] == {"xml": "1", "ini": "1"}
    files = {f["rel_path"]: f for f in snap["files"]}
    assert files["ok.xml"]["parser"] == "xml" and not files["ok.xml"]["error"]
    assert "DOCTYPE" in files["evil.xml"]["error"] and "XML" in files["broken.xml"]["error"]
    assert files["pic.bin"]["parser"] == "" and files["pic.bin"]["error"] == ""  # kept, simply not parsed
    params = {(p["file"], p["path"]): p for p in snap["params"]}
    focus = params[("ok.xml", "Optics/Focus")]
    assert (focus["value"], focus["label"], focus["unit"], focus["group_name"]) == ("1.25", "초점", "um", "광학")
    assert ("ok.xml", "Header/Created") not in params and params[("main.ini", "Optics/Gain")]["value"] == "3"
    assert snap["parse"]["stale"] is False
    assert got["current"]["snapshot"]["param_count"] == len(snap["params"]) == 2


def test_all_files_failing_marks_error_and_unparsed_only_when_nothing_applies(env, maps):
    client, server, *_ = env
    server.tree = {"recipes": {"r1": {"a.xml": b"<x>"}, "r2": {"p.bin": b"\x00\x01"}}}
    sid = make_source(client, mapping="", file_globs=[], name_filter=[])
    run_and_wait(client, sid)
    statuses = {r["name"]: client.get(f"/api/recipe-snapshots/{r['current_snapshot_id']}").json()["snapshot"]["parse_status"]
                for r in client.get("/api/recipes", params={"source_id": sid}).json()["items"]}
    assert statuses == {"r1": "error", "r2": "unparsed"}


def test_missing_mapping_file_falls_back_and_is_reported(env, maps):
    client, server, *_ = env
    server.tree = _tree()
    sid = make_source(client, mapping="gone", file_globs=["*.xml", "*.ini"], name_filter=[])
    run = run_and_wait(client, sid)
    assert run["status"] == "ok" and "매핑을 쓰지 못했어요" in run["message"]
    _, _, snap = _snapshot(client, sid)
    assert "찾을 수 없어요" in snap["snapshot"]["parser_info"]["mapping_error"]
    assert snap["parse"]["mapping_error"] and any(p["path"] == "Header/Created" for p in snap["params"])  # unmapped passthrough


def test_rerun_does_not_duplicate_and_reparse_updates_in_place(env, maps):
    client, server, tmp, _ = env
    server.tree = _tree()
    sid = make_source(client, mapping="t1", file_globs=[], name_filter=[])
    run_and_wait(client, sid)
    rid, got, snap = _snapshot(client, sid)
    snap_id = got["current"]["snapshot"]["id"]
    again = run_and_wait(client, sid)
    assert again["unchanged"] == 1 and again["new_snapshots"] == 0
    # the mapping file is edited (new label, new version)
    (maps / "t1.json").write_text(json.dumps({**MAP_V1, "mapping_version": "2", "params": [
        {"path": "Optics/Focus", "label": "초점(수정)", "unit": "mm", "group": "광학"}]}), encoding="utf-8")
    stale = client.get(f"/api/recipe-snapshots/{snap_id}").json()
    assert stale["parse"]["stale"] is True and next(p for p in stale["params"] if p["path"] == "Optics/Focus")["label"] == "초점"  # nothing changed until asked
    res = client.post(f"/api/recipe-snapshots/{snap_id}/reparse")
    assert res.status_code == 200, res.text
    body = res.json()
    focus = next(p for p in body["params"] if p["path"] == "Optics/Focus")
    assert (focus["label"], focus["unit"]) == ("초점(수정)", "mm") and body["parse"]["stale"] is False
    assert body["snapshot"]["id"] == snap_id and body["snapshot"]["content_hash"] == snap["snapshot"]["content_hash"]
    assert body["snapshot"]["parser_info"]["mapping_version"] == "2"
    assert len(client.get(f"/api/recipes/{rid}").json()["snapshots"]) == 1  # no duplicate version
    # reparse the whole source
    (maps / "t1.json").write_text(json.dumps({**MAP_V1, "mapping_version": "3"}), encoding="utf-8")
    res = client.post(f"/api/recipe-sources/{sid}/reparse")
    assert res.status_code == 200 and res.json() == {"snapshots": 1, "with_problems": 1}
    assert len(client.get(f"/api/recipes/{rid}").json()["snapshots"]) == 1
    assert client.get("/api/recipe-snapshots/9999/reparse").status_code in (404, 405)
    assert client.post("/api/recipe-snapshots/9999/reparse").status_code == 404


def test_reparse_detects_missing_and_tampered_blob(env, maps):
    client, server, tmp, _ = env
    server.tree = {"recipes": {"r1": {"a.ini": b"[S]\nk=1\n", "b.ini": b"[S]\nk=2\n"}}}
    sid = make_source(client, mapping="", file_globs=[], name_filter=[])
    run_and_wait(client, sid)
    _, got, _ = _snapshot(client, sid)
    snap_id = got["current"]["snapshot"]["id"]
    files = {f["rel_path"]: f for f in got["current"]["files"]}
    blobs = tmp / "data" / "recipes" / "blobs"
    sha_a, sha_b = files["a.ini"]["sha256"], files["b.ini"]["sha256"]
    (blobs / sha_a[:2] / sha_a).unlink()
    (blobs / sha_b[:2] / sha_b).write_bytes(b"[S]\nk=999\n")  # tampered
    body = client.post(f"/api/recipe-snapshots/{snap_id}/reparse").json()
    errs = {f["rel_path"]: f["error"] for f in body["files"]}
    assert "찾을 수 없어요" in errs["a.ini"] and "달라요" in errs["b.ini"]
    assert body["snapshot"]["parse_status"] == "error" and body["params"] == []


def test_reparse_never_escapes_blob_dir(env, maps):
    client, server, tmp, _ = env
    server.tree = {"recipes": {"r1": {"a.ini": b"[S]\nk=1\n"}}}
    sid = make_source(client, mapping="", file_globs=[], name_filter=[])
    run_and_wait(client, sid)
    _, got, _ = _snapshot(client, sid)
    snap_id = got["current"]["snapshot"]["id"]
    secret = tmp / "secret.txt"
    secret.write_text("k = leaked\n", encoding="utf-8")
    from app import db
    conn = db.connect(tmp / "data" / "r.db")
    conn.execute("UPDATE recipe_files SET cache_path = ?, sha256 = '' WHERE snapshot_id = ?", ("../../secret.txt", snap_id))
    conn.commit()
    conn.close()
    body = client.post(f"/api/recipe-snapshots/{snap_id}/reparse").json()
    assert body["params"] == [] and "찾을 수 없어요" in body["files"][0]["error"]


def test_mappings_endpoint_and_auto_selection(env, maps):
    client, server, *_ = env
    items = client.get("/api/recipe-mappings").json()["items"]
    assert [m["name"] for m in items] == ["t1"] and items[0]["vendor"] == "VENDOR-T"
    server.tree = _tree()
    sid = make_source(client, mapping="", vendor="vendor-t", file_globs=["ok.xml"], name_filter=[])  # no mapping named
    run_and_wait(client, sid)
    _, _, snap = _snapshot(client, sid)
    assert snap["snapshot"]["parser_info"]["mapping"] == "t1" and snap["snapshot"]["parser_info"]["mapping_auto"] is True
    assert any(p["label"] == "초점" for p in snap["params"])


def test_reparse_refused_while_collecting(env, maps):
    client, server, *_ = env
    sid = make_source(client)
    runner = client.app.state.rcp_runner if getattr(client.app.state, "rcp_runner", None) else None
    if runner is None:
        from app import rcp_collect
        runner = client.app.state.rcp_runner = rcp_collect.Runner()
    assert runner.acquire()
    try:
        res = client.post(f"/api/recipe-sources/{sid}/reparse")
        assert res.status_code == 409
    finally:
        runner.release()
