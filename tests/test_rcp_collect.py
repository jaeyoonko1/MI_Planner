"""P6-02: read-only FTP collection with an in-process fake FTP (no real network)."""
import ftplib
import hashlib
import json
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db, rcp_collect
from app.main import create_app
from app.rcp_ftp import ReadOnlyFtp, describe, parse_list_line

HOST, USER, PASSWORD = "ftp.secret-host.test", "alice", "hunter2"


class FakeServer:
    """A tiny FTP server model. Tree: dict = directory, bytes = file. Every command is logged."""

    def __init__(self, tree, mlsd=True, password=PASSWORD):
        self.tree, self.mlsd, self.password = tree, mlsd, password
        self.log: list[str] = []
        self.fail: dict[str, BaseException] = {}  # RETR path -> exception
        self.connect_error: BaseException | None = None
        self.gate: threading.Event | None = None
        self.encodings: list[str] = []
        self.opened = 0

    def node(self, path):
        cur = self.tree
        for part in [p for p in path.split("/") if p]:
            if not isinstance(cur, dict) or part not in cur:
                raise ftplib.error_perm("550 No such file or directory")
            cur = cur[part]
        return cur


class FakeFtp:
    def __init__(self, server):
        self.s, self.cwd_path, self.encoding = server, "/", "utf-8"

    def connect(self, host, port, timeout):
        self.s.opened += 1
        self.s.encodings.append(self.encoding)
        if self.s.connect_error:
            raise self.s.connect_error
        assert host == HOST

    def login(self, user, password):
        if password != self.s.password:  # real servers often echo the account back
            raise ftplib.error_perm(f"530 Login incorrect for {user}@{HOST} password {password}")

    def set_pasv(self, flag):
        self.s.log.append(f"PASV={flag}")

    def pwd(self):
        return "/"

    def cwd(self, path):
        self.s.log.append(f"CWD {path}")
        if not isinstance(self.s.node(path), dict):
            raise ftplib.error_perm("550 Not a directory")
        self.cwd_path = path

    def _entries(self):
        node = self.s.node(self.cwd_path)
        return node.items()

    def mlsd(self, path="", facts=()):
        self.s.log.append("MLSD")
        if not self.s.mlsd:
            raise ftplib.error_perm("500 MLSD not understood")
        yield ".", {"type": "cdir"}
        for name, v in self._entries():
            if isinstance(v, dict):
                yield name, {"type": "dir", "modify": "20260101000000"}
            else:
                yield name, {"type": "file", "size": str(len(v)), "modify": "20260101120000"}

    def retrlines(self, cmd, callback):
        self.s.log.append(cmd)
        assert cmd == "LIST"
        for name, v in self._entries():
            if isinstance(v, dict):
                callback(f"drwxr-xr-x   2 ftp ftp 4096 Jan 01 10:00 {name}")
            else:
                callback(f"-rw-r--r--   1 ftp ftp {len(v):>8} Jan 01 10:00 {name}")
        callback("lrwxrwxrwx   1 ftp ftp 4 Jan 01 10:00 link -> x")

    def retrbinary(self, cmd, callback, blocksize=8192):
        self.s.log.append(cmd)
        assert cmd.startswith("RETR ")
        path = cmd[5:]
        if self.s.gate is not None:
            self.s.gate.wait(10)
        if path in self.s.fail:
            raise self.s.fail[path]
        data = self.s.node(path)
        assert isinstance(data, bytes)
        for i in range(0, len(data), 16):
            callback(data[i:i + 16])

    def quit(self):
        pass

    def close(self):
        pass

    def __getattr__(self, name):  # any write command would land here
        if name.startswith(("stor", "delete", "rename", "mkd", "rmd", "sendcmd", "voidcmd")):
            raise AssertionError(f"write/unknown FTP command attempted: {name}")
        raise AttributeError(name)


def tree():
    return {"recipes": {
        "aabb_100": {"main.fake": b"focus=1.0\n", "sub": {"extra.fake": b"gain=2\n"}, "notes.doc": b"skip"},
        "aabb_200": {"main.fake": b"focus=2.0\n"},
        "ccdd_300": {"main.fake": b"focus=3.0\n"},
        "aabb_old": {"main.fake": b"focus=0\n"},
    }}


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


SOURCE = {"name": "SRC-1", "ftp_profile": "line1", "remote_dir": "/recipes", "layout": "folder",
          "equipment": "EQ-A01", "line": "LINE-1", "file_globs": ["*.fake"],
          "name_filter": [{"type": "contains", "value": "aabb"}, {"type": "suffix", "value": "_old", "exclude": True}]}


@pytest.fixture()
def env(tmp_path: Path):
    server = FakeServer(tree())
    cfg = tmp_path / "local.json"
    cfg.write_text(json.dumps({"recipe_ftp": {"profiles": {"line1": {
        "host": HOST, "port": 21, "user": USER, "password": PASSWORD, "encoding": "cp949", "passive": True,
        "timeout": 5}}}}), encoding="utf-8")
    app = create_app(tmp_path / "data" / "r.db", tmp_path / "vault")
    app.state.config_path = cfg
    app.state.ftp_factory = lambda: FakeFtp(server)
    with TestClient(app, raise_server_exceptions=False) as client:
        client.put("/api/settings/rcp_enabled", json={"value": "on"})
        yield client, server, tmp_path, cfg


def make_source(client, **kw):
    res = client.post("/api/recipe-sources", json={**SOURCE, **kw})
    assert res.status_code == 201, res.text
    return res.json()["source"]["id"]


def run_and_wait(client, sid, expect=202):
    res = client.post(f"/api/recipe-sources/{sid}/run")
    assert res.status_code == expect, res.text
    if expect != 202:
        return res
    rid = res.json()["run"]["id"]
    for _ in range(400):
        run = client.get(f"/api/recipe-runs/{rid}").json()["run"]
        if run["status"] != "running":
            time.sleep(0.02)  # let the worker release the runner lock
            return run
        time.sleep(0.02)
    raise AssertionError("run did not finish")


def no_leak(*payloads):
    text = json.dumps(payloads, ensure_ascii=False)
    for secret in (HOST, USER, PASSWORD):
        assert secret not in text


def test_wrapper_exposes_no_write_methods():
    public = {n for n in dir(ReadOnlyFtp) if not n.startswith("_")}
    assert public <= {"abs_path", "close", "list_dir", "reconnect", "retrieve"}
    for name in ("storbinary", "storlines", "delete", "rename", "mkd", "rmd", "sendcmd", "voidcmd", "_ftp_write"):
        assert not hasattr(ReadOnlyFtp, name)
    assert not hasattr(rcp_collect, "storbinary")


def test_collect_success_cache_and_snapshots(env):
    client, server, tmp, _ = env
    sid = make_source(client)
    run = run_and_wait(client, sid)
    assert run["status"] == "ok", run
    assert (run["listed"], run["matched"], run["downloaded"], run["new_snapshots"], run["unchanged"]) == (4, 2, 3, 2, 0)
    items = client.get("/api/recipes", params={"source_id": sid}).json()["items"]
    assert [r["name"] for r in items] == ["aabb_100", "aabb_200"]  # ccdd filtered out, aabb_old excluded
    rid = items[0]["id"]
    files = client.get(f"/api/recipes/{rid}").json()["current"]["files"]
    assert [f["rel_path"] for f in files] == ["main.fake", "sub/extra.fake"]  # notes.doc not matched by *.fake
    blob = tmp / "data" / "recipes" / "blobs" / sha(b"focus=1.0\n")[:2] / sha(b"focus=1.0\n")
    assert blob.read_bytes() == b"focus=1.0\n"
    assert not list((tmp / "data" / "recipes").rglob("*.part"))
    assert not (tmp / "data" / "recipes" / ".tmp" / str(run["id"])).exists()
    assert server.encodings == ["cp949"]  # profile encoding applied before connecting
    # read-only: only CWD/MLSD/RETR and PASV were ever issued
    assert all(c.startswith(("CWD", "MLSD", "RETR", "PASV")) for c in server.log)
    no_leak(run, client.get("/api/recipe-runs").json())


def test_rerun_unchanged_then_changed(env):
    client, server, *_ = env
    sid = make_source(client)
    run_and_wait(client, sid)
    again = run_and_wait(client, sid)
    assert (again["status"], again["unchanged"], again["new_snapshots"]) == ("ok", 2, 0)
    rid = client.get("/api/recipes", params={"source_id": sid}).json()["items"][0]["id"]
    assert len(client.get(f"/api/recipes/{rid}").json()["snapshots"]) == 1
    server.tree["recipes"]["aabb_100"]["main.fake"] = b"focus=1.5\n"
    third = run_and_wait(client, sid)
    assert (third["unchanged"], third["new_snapshots"]) == (1, 1)
    assert len(client.get(f"/api/recipes/{rid}").json()["snapshots"]) == 2


def test_missing_marked_only_after_full_success(env):
    client, server, *_ = env
    sid = make_source(client)
    run_and_wait(client, sid)
    del server.tree["recipes"]["aabb_200"]
    # a partial run (aabb_100 fails) must not mark anything missing
    server.fail["/recipes/aabb_100/main.fake"] = ftplib.error_perm("550 denied")
    part = run_and_wait(client, sid)
    assert part["status"] == "error" or part["status"] == "partial"
    assert all(not r["missing"] for r in client.get("/api/recipes", params={"source_id": sid, "include_missing": True}).json()["items"])
    del server.fail["/recipes/aabb_100/main.fake"]
    ok = run_and_wait(client, sid)
    assert ok["status"] == "ok"
    items = {r["name"]: r for r in client.get("/api/recipes", params={"source_id": sid, "include_missing": True}).json()["items"]}
    assert items["aabb_200"]["missing"] is True and items["aabb_100"]["missing"] is False
    # it comes back -> flag cleared
    server.tree["recipes"]["aabb_200"] = {"main.fake": b"focus=2.0\n"}
    run_and_wait(client, sid)
    items = {r["name"]: r for r in client.get("/api/recipes", params={"source_id": sid, "include_missing": True}).json()["items"]}
    assert items["aabb_200"]["missing"] is False


def test_empty_listing_does_not_mark_missing(env):
    client, server, *_ = env
    sid = make_source(client)
    run_and_wait(client, sid)
    server.tree["recipes"] = {}
    run = run_and_wait(client, sid)
    assert run["status"] == "ok" and "누락 표시는 하지 않았어요" in run["message"]
    assert all(not r["missing"] for r in client.get("/api/recipes", params={"source_id": sid, "include_missing": True}).json()["items"])


def test_partial_failure_keeps_other_recipes(env):
    client, server, *_ = env
    sid = make_source(client)
    server.fail["/recipes/aabb_100/sub/extra.fake"] = ftplib.error_perm("550 denied by 'alice' on ftp.secret-host.test")
    run = run_and_wait(client, sid)
    assert run["status"] == "partial", run
    assert run["errors"][0]["recipe"] == "aabb_100" and run["errors"][0]["file"] == "sub/extra.fake"
    assert [r["name"] for r in client.get("/api/recipes", params={"source_id": sid}).json()["items"]] == ["aabb_200"]
    no_leak(run)


def test_timeout_during_download_is_recorded(env):
    client, server, *_ = env
    sid = make_source(client)
    server.fail["/recipes/aabb_200/main.fake"] = TimeoutError(f"timed out talking to {HOST}")
    run = run_and_wait(client, sid)
    assert run["status"] == "partial"
    assert "시간이 초과" in run["errors"][0]["message"]
    assert run["errors"][0]["recipe"] == "aabb_200"
    no_leak(run)


def test_connect_timeout_and_refused(env):
    client, server, *_ = env
    sid = make_source(client)
    server.connect_error = TimeoutError(HOST)
    run = run_and_wait(client, sid)
    assert run["status"] == "error" and "시간이 초과" in run["message"]
    server.connect_error = ConnectionRefusedError(f"refused {HOST}:21")
    run = run_and_wait(client, sid)
    assert run["status"] == "error" and "거부" in run["message"]
    no_leak(run, client.get("/api/recipe-runs").json())


def test_bad_credentials_message_has_no_secrets(env):
    client, server, *_ = env
    server.password = "other-password"
    sid = make_source(client)
    run = run_and_wait(client, sid)
    assert run["status"] == "error" and "로그인에 실패" in run["message"]
    no_leak(run, client.get("/api/recipe-runs").json())
    # the preview endpoint is just as quiet
    res = client.post("/api/recipe-preview/list", json={"ftp_profile": "line1", "remote_dir": "/recipes"})
    assert res.status_code == 502 and "로그인에 실패" in res.json()["error"]
    no_leak(res.json())


def test_limits(env):
    client, server, tmp, cfg = env
    data = json.loads(cfg.read_text(encoding="utf-8"))
    data["recipe_ftp"]["limits"] = {"max_files": 2}
    cfg.write_text(json.dumps(data), encoding="utf-8")
    sid = make_source(client)
    run = run_and_wait(client, sid)  # aabb_100 has 2 files, aabb_200 would be the 3rd
    assert run["status"] == "partial" and "한도" in run["message"]
    assert [r["name"] for r in client.get("/api/recipes", params={"source_id": sid}).json()["items"]] == ["aabb_100"]
    data["recipe_ftp"]["limits"] = {"max_file_bytes": 4}
    cfg.write_text(json.dumps(data), encoding="utf-8")
    server.tree["recipes"]["aabb_200"]["main.fake"] = b"x" * 100
    run = run_and_wait(client, sid)
    assert run["status"] in ("partial", "error") and any("한도" in e["message"] for e in run["errors"])
    # connection was reopened after the aborted transfer, later files still worked
    assert server.opened >= 3


def test_total_bytes_limit(env):
    client, server, tmp, cfg = env
    data = json.loads(cfg.read_text(encoding="utf-8"))
    data["recipe_ftp"]["limits"] = {"max_total_bytes": 15}
    cfg.write_text(json.dumps(data), encoding="utf-8")
    run = run_and_wait(client, make_source(client))
    assert run["status"] == "partial" and "합계" in run["message"]


def test_list_fallback_when_mlsd_missing(env):
    client, server, *_ = env
    server.mlsd = False
    sid = make_source(client)
    run = run_and_wait(client, sid)
    assert run["status"] == "ok" and "LIST" in run["message"] and run["new_snapshots"] == 2
    assert "LIST" in server.log


def test_file_layout(env):
    client, server, *_ = env
    server.tree["files"] = {"aabb_x.rcp": b"1", "zzz.rcp": b"2", "dir": {"a": b"3"}}
    sid = make_source(client, name="FILES", layout="file", remote_dir="/files", file_globs=[])
    run = run_and_wait(client, sid)
    assert run["status"] == "ok" and run["matched"] == 1
    assert [r["name"] for r in client.get("/api/recipes", params={"source_id": sid}).json()["items"]] == ["aabb_x.rcp"]


def test_unsafe_remote_names_are_rejected(env):
    client, server, *_ = env
    server.tree["recipes"]["aabb_bad\\name"] = {"main.fake": b"x"}
    run = run_and_wait(client, make_source(client))
    assert run["status"] == "partial"
    assert any("안전하지 않은" in e["message"] for e in run["errors"])
    assert "aabb_bad" not in [r["name"] for r in client.get("/api/recipes").json()["items"]]


def test_refused_when_rcp_disabled_and_no_connection(env):
    client, server, *_ = env
    sid = make_source(client)
    client.put("/api/settings/rcp_enabled", json={"value": "off"})
    res = client.post(f"/api/recipe-sources/{sid}/run")
    assert res.status_code == 403 and "꺼져" in res.json()["error"]
    assert client.post("/api/recipe-preview/list", json={"ftp_profile": "line1"}).status_code == 403
    assert server.opened == 0 and client.get("/api/recipe-runs").json()["items"] == []


def test_run_guards(env):
    client, server, *_ = env
    sid = make_source(client)
    off = make_source(client, name="OFF", enabled=False)
    nop = make_source(client, name="NOPROF", ftp_profile="missing")
    assert client.post(f"/api/recipe-sources/{off}/run").status_code == 409
    res = client.post(f"/api/recipe-sources/{nop}/run")
    assert res.status_code == 422 and "missing" in res.json()["error"]
    assert client.post("/api/recipe-sources/999/run").status_code == 404
    assert server.opened == 0
    # a second run while one is active is refused
    server.gate = threading.Event()
    res = client.post(f"/api/recipe-sources/{sid}/run")
    assert res.status_code == 202
    assert client.post(f"/api/recipe-sources/{sid}/run").status_code == 409
    assert client.post("/api/recipe-preview/list", json={"ftp_profile": "line1"}).status_code == 409
    server.gate.set()


def test_cancel(env):
    client, server, *_ = env
    sid = make_source(client)
    server.gate = threading.Event()
    rid = client.post(f"/api/recipe-sources/{sid}/run").json()["run"]["id"]
    for _ in range(100):  # wait until the first download is blocked on the gate
        if any(c.startswith("RETR") for c in server.log):
            break
        time.sleep(0.02)
    assert client.post(f"/api/recipe-runs/{rid}/cancel").json()["cancelling"] is True
    server.gate.set()
    for _ in range(200):
        run = client.get(f"/api/recipe-runs/{rid}").json()["run"]
        if run["status"] != "running":
            break
        time.sleep(0.02)
    assert run["status"] == "cancelled"
    assert client.post(f"/api/recipe-runs/{rid}/cancel").json()["cancelling"] is False


def test_preview_endpoints(env):
    client, server, *_ = env
    res = client.post("/api/recipe-preview/list", json={"ftp_profile": "line1", "remote_dir": "/recipes", "layout": "folder"})
    assert res.status_code == 200 and res.json()["names"] == ["aabb_100", "aabb_200", "aabb_old", "ccdd_300"]
    assert not any(c.startswith("RETR") for c in server.log)  # names only, nothing downloaded
    names = res.json()["names"]
    out = client.post("/api/recipe-preview/filter", json={"rules": SOURCE["name_filter"], "names": names}).json()
    assert [i["name"] for i in out["items"] if i["match"]] == ["aabb_100", "aabb_200"]
    bad = client.post("/api/recipe-preview/filter", json={"rules": [{"type": "regex", "value": "a.*"}], "names": names})
    assert bad.status_code == 422
    ci = client.post("/api/recipe-preview/filter", json={"rules": [{"type": "glob", "value": "AABB_*"}], "names": names}).json()
    assert sum(i["match"] for i in ci["items"]) == 3  # case-insensitive
    assert client.post("/api/recipe-preview/list", json={"ftp_profile": "nope"}).status_code == 422


def test_profiles_endpoint_hides_connection_details(env):
    client, *_ = env
    res = client.get("/api/recipe-ftp/profiles")
    assert res.json()["items"] == [{"name": "line1", "encoding": "cp949", "passive": True, "ready": True}]
    no_leak(res.json())


def test_source_crud(env):
    client, *_ = env
    sid = make_source(client)
    assert client.post("/api/recipe-sources", json=SOURCE).status_code == 409
    res = client.patch(f"/api/recipe-sources/{sid}", json={"name_filter": [{"type": "prefix", "value": "cc"}], "enabled": False})
    src = res.json()["source"]
    assert src["name_filter"][0]["value"] == "cc" and src["enabled"] is False and src["remote_dir"] == "/recipes"
    assert client.patch(f"/api/recipe-sources/{sid}", json={"ftp_profile": "host.example:21"}).status_code == 422
    assert client.delete(f"/api/recipe-sources/{sid}").status_code == 200
    assert client.get(f"/api/recipe-sources/{sid}").status_code == 404


def test_stale_running_runs_are_closed(tmp_path: Path):
    path = tmp_path / "s.db"
    db.init_db(path)
    conn = db.connect(path)
    rid = rcp_collect.create_run(conn, None)
    assert rcp_collect.reap_stale(conn) == 1
    row = conn.execute("SELECT status, message FROM recipe_runs WHERE id = ?", (rid,)).fetchone()
    assert row["status"] == "error" and "중단" in row["message"]
    conn.close()


def test_parse_list_lines_and_describe():
    u = parse_list_line("-rw-r--r--   1 ftp ftp     1234 Jan 01 10:00 my recipe.xml")
    assert (u.name, u.is_dir, u.size) == ("my recipe.xml", False, 1234)
    assert parse_list_line("drwxr-xr-x   2 ftp ftp 4096 Jan 01 2025 Folder A").is_dir
    d = parse_list_line("01-02-26  09:30AM       <DIR>          DosDir")
    assert d.is_dir and d.name == "DosDir"
    assert parse_list_line("lrwxrwxrwx 1 ftp ftp 4 Jan 01 10:00 l -> x") is None
    assert parse_list_line("total 12") is None
    msg = describe(ConnectionResetError(f"reset by {HOST} for {USER}"), [HOST, USER])
    assert HOST not in msg and USER not in msg
    assert PASSWORD not in describe(RuntimeError(PASSWORD), [PASSWORD])
