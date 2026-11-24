"""P6-01: recipe schema, repository (filter, snapshot hash semantics), read-only API, RCP settings flags, parsers."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import create_app
from app.repositories import recipes as repo
from app.repositories.recipes import FileIn, RecipeError
from parsers import base, mapping


@pytest.fixture()
def conn(tmp_path: Path):
    path = tmp_path / "r.db"
    db.init_db(path)
    c = db.connect(path)
    yield c
    c.close()


@pytest.fixture()
def client(tmp_path: Path):
    with TestClient(create_app(tmp_path / "r.db", tmp_path / "vault"), raise_server_exceptions=False) as c:
        yield c


def _source(conn, name="SRC-1", **kw):
    data = {"name": name, "vendor": "VENDOR-X", "model": "MODEL-1", "equipment": "EQ-A01", "line": "LINE-1",
            "ftp_profile": "line1", "remote_dir": "/recipes", "name_filter": [{"type": "contains", "value": "aabb"}],
            "file_globs": ["*.fake"], **kw}
    return repo.create_source(conn, data)


def _file(rel="a.fake", sha="1" * 64, params=None):
    return FileIn(rel, sha, 10, f"blobs/{sha[:2]}/{sha}", parser="fake",
                  params=params if params is not None else [{"path": "Focus", "value": "1.0"}])


def test_name_filter_semantics():
    rules = repo.validate_filter([{"type": "contains", "value": "AABB"}, {"type": "suffix", "value": "_old", "exclude": True}])
    assert repo.name_matches("aabb_bb100000", rules)
    assert not repo.name_matches("aabb_bb100000_OLD", rules)
    assert not repo.name_matches("ccdd_bb100000", rules)
    assert repo.name_matches("anything", [])  # no include rule → all included
    assert repo.name_matches("x_test", repo.validate_filter([{"type": "glob", "value": "x_*"}]))
    for bad in [{"type": "regex", "value": "a.*"}, {"type": "contains", "value": ""}, {"type": "prefix", "value": "a" * 200}, "aabb"]:
        with pytest.raises(RecipeError):
            repo.validate_filter([bad])


def test_source_validation_keeps_credentials_out(conn):
    s = _source(conn)
    assert s["name_filter"][0]["value"] == "aabb" and s["enabled"] is True
    with pytest.raises(RecipeError) as e:
        _source(conn, "SRC-2", ftp_profile="ftp://user:pw@10.0.0.1")
    assert e.value.status == 422
    with pytest.raises(RecipeError) as e:
        _source(conn)
    assert e.value.status == 409
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(recipe_sources)")}
    assert not cols & {"host", "user", "password"}


def test_snapshot_only_on_content_change_and_revert(conn):
    src = _source(conn)
    rid = repo.upsert_recipe(conn, src["id"], "aabb_bb100000", "/recipes/aabb_bb100000")
    a = [_file()]
    sid1, created = repo.add_snapshot(conn, rid, a)
    assert created
    assert repo.add_snapshot(conn, rid, [_file()]) == (sid1, False)  # unchanged → no new history
    sid2, created = repo.add_snapshot(conn, rid, [_file(sha="2" * 64, params=[{"path": "Focus", "value": "1.2"}])])
    assert created and sid2 != sid1
    sid3, created = repo.add_snapshot(conn, rid, [_file()])  # revert to A is a new version
    assert created and sid3 not in (sid1, sid2)
    conn.commit()
    got = repo.get_recipe(conn, rid)
    assert [s["id"] for s in got["snapshots"]] == [sid3, sid2, sid1]
    assert got["current"]["params"] == [{"path": "Focus", "value": "1.0", "label": "", "unit": "", "group_name": "", "file": "a.fake"}]


def test_content_hash_is_order_independent_and_path_sensitive():
    f1, f2 = _file("a.fake", "1" * 64), _file("b.fake", "2" * 64)
    assert repo.content_hash([f1, f2]) == repo.content_hash([f2, f1])
    assert repo.content_hash([f1]) != repo.content_hash([_file("c.fake", "1" * 64)])


def test_duplicate_file_paths_rejected_and_parse_status(conn):
    rid = repo.upsert_recipe(conn, _source(conn)["id"], "aabb_1")
    with pytest.raises(RecipeError):
        repo.add_snapshot(conn, rid, [_file(), _file()])
    bad = FileIn("b.fake", "3" * 64, 1, "x", parser="fake", error="읽기 실패")
    sid, _ = repo.add_snapshot(conn, rid, [_file(), bad])
    assert repo.get_snapshot(conn, sid)["snapshot"]["parse_status"] == "partial"


def test_upsert_recipe_clears_missing(conn):
    src = _source(conn)
    rid = repo.upsert_recipe(conn, src["id"], "aabb_1")
    conn.execute("UPDATE recipes SET missing = 1 WHERE id = ?", (rid,))
    assert repo.list_recipes(conn) == []
    assert len(repo.list_recipes(conn, include_missing=True)) == 1
    assert repo.upsert_recipe(conn, src["id"], "aabb_1") == rid
    assert repo.list_recipes(conn)[0]["missing"] is False


def test_read_only_api(client, tmp_path):
    assert client.get("/api/recipe-sources").json() == {"items": []}
    c = db.connect(tmp_path / "r.db")
    src = _source(c)
    rid = repo.upsert_recipe(c, src["id"], "aabb_100")
    repo.upsert_recipe(c, src["id"], "aabb_200")
    repo.add_snapshot(c, rid, [_file()])
    c.execute("INSERT INTO recipe_runs (source_id, started_at, status) VALUES (?, 'x', 'ok')", (src["id"],))
    c.commit()
    c.close()
    items = client.get("/api/recipe-sources").json()["items"]
    assert items[0]["recipe_count"] == 2 and items[0]["last_run_at"] == "x"
    assert client.get(f"/api/recipe-sources/{src['id']}").json()["source"]["equipment"] == "EQ-A01"
    assert [r["name"] for r in client.get("/api/recipes", params={"q": "100"}).json()["items"]] == ["aabb_100"]
    assert client.get("/api/recipes", params={"q": "%"}).json()["items"] == []  # LIKE wildcards escaped
    body = client.get(f"/api/recipes/{rid}").json()
    assert body["current"]["params"][0]["value"] == "1.0" and len(body["snapshots"]) == 1
    sid = body["snapshots"][0]["id"]
    assert client.get(f"/api/recipe-snapshots/{sid}").json()["files"][0]["rel_path"] == "a.fake"
    assert client.get("/api/recipe-runs").json()["items"][0]["status"] == "ok"
    res = client.get("/api/recipes/999")
    assert res.status_code == 404 and "error" in res.json()
    for method in ("post", "put", "patch", "delete"):  # skeleton is read-only
        assert getattr(client, method)(f"/api/recipes/{rid}").status_code == 405


def test_rcp_flags_default_off_and_write_needs_enabled(client):
    s = client.get("/api/settings").json()["settings"]
    assert (s["rcp_enabled"], s["rcp_write_enabled"]) == ("off", "off")
    res = client.put("/api/settings/rcp_write_enabled", json={"value": "on"})
    assert res.status_code == 400 and "error" in res.json()
    assert client.put("/api/settings/rcp_enabled", json={"value": "yes"}).status_code == 400
    assert client.put("/api/settings/rcp_enabled", json={"value": "on"}).status_code == 200
    assert client.put("/api/settings/rcp_write_enabled", json={"value": "on"}).status_code == 200
    s = client.put("/api/settings/rcp_enabled", json={"value": "off"}).json()["settings"]
    assert (s["rcp_enabled"], s["rcp_write_enabled"]) == ("off", "off")  # disabling RCP revokes write


def test_parser_registry_and_fake_parser():
    from parsers import fake  # noqa: F401  (registers the test-only parser)
    assert "fake" in base.names()
    p = base.get("fake")
    assert base.pick("aabb.fake") is p and base.pick("aabb.zzz") is None
    res = p.parse("# 주석\nFocus = 1.0\nStage/Speed=20\n잘못된 줄\n".encode("cp949"), "a.fake")
    assert res.as_dict() == {"Focus": "1.0", "Stage/Speed": "20"}
    assert res.params[0].line == 2 and res.encoding == "cp949" and len(res.warnings) == 1
    with pytest.raises(base.ParseError):
        p.parse(b"A=1\nA=2\n")
    with pytest.raises(base.ParseError):
        p.parse(b"=1\n")
    with pytest.raises(base.ParseError):
        base.get("nope")
    with pytest.raises(ValueError):
        @base.register
        class Clash(base.RecipeParser):
            name = "fake"

            def _parse(self, data, file_name, options):
                return base.ParseResult()


def test_mapping_example_and_validation(tmp_path):
    data = mapping.load("example_vendor")
    assert data["vendor"] == "VENDOR-X" and data["format_version"] == 1
    assert mapping.validate({**data, "format_version": 99})
    assert mapping.validate({**data, "files": []})
    assert mapping.validate({**data, "params": [{"label": "x"}]})
    override = tmp_path / "local"
    override.mkdir()
    (override / "example_vendor.json").write_text(json.dumps({**data, "vendor": "LOCAL"}), encoding="utf-8")
    assert mapping.load("example_vendor", (override, mapping.SEARCH_DIRS[1]))["vendor"] == "LOCAL"
    for bad in ("../x", "a/b", ""):
        with pytest.raises(mapping.MappingError):
            mapping.load(bad)
