"""RCP management API (P6-01 read-only skeleton, P6-02 sources + collection, D-36).

Nothing here writes to equipment. FTP is only reached through `rcp_ftp.ReadOnlyFtp`, only when `rcp_enabled` is on,
and only for a profile defined in config/local.json.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app import config, rcp_collect, rcp_ftp, rcp_parse
from app.repositories import recipes as repo
from app.routers import settings as settings_router
from app.routers.tasks import get_conn
from parsers import mapping as mapping_files

router = APIRouter(prefix="/api")


@router.get("/recipe-sources")
def list_sources(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return {"items": repo.list_sources(conn)}


@router.get("/recipe-sources/{source_id}")
def get_source(source_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return {"source": repo.get_source(conn, source_id)}


@router.get("/recipes")
def list_recipes(source_id: int | None = None, q: str = "", include_missing: bool = False,
                 conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return {"items": repo.list_recipes(conn, source_id, q.strip()[:100], include_missing)}


@router.get("/recipes/{recipe_id}")
def get_recipe(recipe_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return repo.get_recipe(conn, recipe_id)


@router.get("/recipe-snapshots/{snapshot_id}")
def get_snapshot(snapshot_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    got = repo.get_snapshot(conn, snapshot_id)
    return {**got, "parse": rcp_parse.parse_state(conn, got["snapshot"])}


@router.get("/recipe-runs")
def list_runs(source_id: int | None = None, limit: int = 50, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return {"items": repo.list_runs(conn, source_id, limit)}


# ---- sources (P6-02) --------------------------------------------------------------------------------------------

@router.post("/recipe-sources", status_code=201)
def create_source(data: dict[str, Any], conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return {"source": repo.create_source(conn, data)}


@router.patch("/recipe-sources/{source_id}")
def update_source(source_id: int, data: dict[str, Any], conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return {"source": repo.update_source(conn, source_id, data)}


@router.delete("/recipe-sources/{source_id}")
def delete_source(source_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    repo.delete_source(conn, source_id)
    return {"ok": True}


# ---- collection (P6-02) -----------------------------------------------------------------------------------------

def _cfg_path(request: Request) -> Path:
    return getattr(request.app.state, "config_path", config.DEFAULT_CONFIG_PATH)


def _runner(request: Request) -> rcp_collect.Runner:
    state = request.app.state
    if getattr(state, "rcp_runner", None) is None:
        state.rcp_runner = rcp_collect.Runner()
    return state.rcp_runner


def _require_enabled(request: Request) -> None:
    if settings_router.read_all(request.app.state.db_path)["rcp_enabled"] != "on":
        raise repo.RecipeError("RCP 관리가 꺼져 있어요. 켠 뒤에 설비에 연결할 수 있어요.", 403)


def _profile(request: Request, name: str) -> config.FtpProfile:
    try:
        return config.get_profile(_cfg_path(request), name)
    except config.ConfigError as exc:
        raise repo.RecipeError(str(exc), exc.status) from exc


def _opener(request: Request, profile: config.FtpProfile):
    return rcp_ftp.make_opener(profile, getattr(request.app.state, "ftp_factory", None))


def _limits(request: Request) -> rcp_collect.Limits:
    try:
        return rcp_collect.Limits.from_config(config.get_limits(_cfg_path(request)))
    except config.ConfigError as exc:
        raise repo.RecipeError(str(exc), exc.status) from exc


@router.get("/recipe-ftp/profiles")
def ftp_profiles(request: Request) -> dict:
    """Profile names and non-secret options only; host, account and password never leave config/local.json."""
    try:
        return {"items": config.profile_names(_cfg_path(request))}
    except config.ConfigError as exc:
        raise repo.RecipeError(str(exc), exc.status) from exc


class FilterPreviewIn(BaseModel):
    rules: list[dict[str, Any]] = []
    names: list[str] = []


@router.post("/recipe-preview/filter")
def preview_filter(body: FilterPreviewIn) -> dict:
    """Pure evaluation of a name filter against given names: no network, no storage."""
    rules = repo.validate_filter(body.rules)
    names = body.names[:5000]
    return {"items": [{"name": n, "match": repo.name_matches(n, rules)} for n in names],
            "truncated": len(body.names) > len(names)}


class ListPreviewIn(BaseModel):
    ftp_profile: str
    remote_dir: str = ""
    layout: str = "folder"


@router.post("/recipe-preview/list")
def preview_list(body: ListPreviewIn, request: Request) -> dict:
    """List what a source would offer as recipes (names only). Connects, but downloads nothing."""
    _require_enabled(request)
    if body.layout not in ("folder", "file"):
        raise repo.RecipeError("레이아웃은 folder 또는 file이에요.", 422)
    profile = _profile(request, body.ftp_profile)
    limits = _limits(request)
    runner = _runner(request)
    if not runner.acquire():
        raise repo.RecipeError("다른 수집이 진행 중이에요. 끝난 뒤에 다시 시도해 주세요.", 409)
    fallback = False
    try:
        ftp = rcp_ftp.ReadOnlyFtp(_opener(request, profile))
        try:
            entries, rejected = rcp_collect.list_candidates(ftp, body.remote_dir, body.layout, limits)
            fallback = ftp.used_list_fallback
        finally:
            ftp.close()
    except Exception as exc:  # noqa: BLE001 - never let host/account text out
        raise repo.RecipeError(rcp_ftp.describe(exc, profile.secrets()), 502) from exc
    finally:
        runner.release()
    entries.sort(key=lambda e: e.name.lower())
    return {"names": [e.name for e in entries[:5000]], "total": len(entries), "rejected": len(rejected),
            "list_fallback": fallback}


@router.post("/recipe-sources/{source_id}/run", status_code=202)
def run_source(source_id: int, request: Request, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    """Start a collection in a worker thread; poll `GET /api/recipe-runs/{id}` for progress."""
    _require_enabled(request)
    source = repo.get_source(conn, source_id)
    if not source["enabled"]:
        raise repo.RecipeError("꺼져 있는 소스예요. 켠 뒤에 수집해 주세요.", 409)
    profile = _profile(request, source["ftp_profile"])
    limits = _limits(request)
    runner = _runner(request)
    if not runner.acquire():
        raise repo.RecipeError("다른 수집이 진행 중이에요. 끝난 뒤에 다시 시도해 주세요.", 409)
    try:
        run_id = rcp_collect.create_run(conn, source_id)
        runner.start(db_path=request.app.state.db_path, data_dir=request.app.state.db_path.parent / "recipes",
                     source_id=source_id, run_id=run_id, ftp_open=_opener(request, profile),
                     secrets=profile.secrets(), limits=limits)
    except BaseException:
        runner.release()
        raise
    return {"run": repo.get_run(conn, run_id)}


@router.get("/recipe-runs/{run_id}")
def get_run(run_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return {"run": repo.get_run(conn, run_id)}


@router.post("/recipe-runs/{run_id}/cancel")
def cancel_run(run_id: int, request: Request, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    repo.get_run(conn, run_id)
    return {"cancelling": _runner(request).cancel(run_id)}


# ---- parsing (P6-03) --------------------------------------------------------------------------------------------
# Local only: reads cached blobs and rewrites parameter rows of existing snapshots. Never contacts equipment.

def _data_dir(request: Request) -> Path:
    return request.app.state.db_path.parent / "recipes"


@router.get("/recipe-mappings")
def list_mappings() -> dict:
    """Mapping files found (config/recipe_mappings overrides parsers/mappings): name, vendor, version, error."""
    return {"items": mapping_files.available()}


@router.post("/recipe-snapshots/{snapshot_id}/reparse")
def reparse_snapshot(snapshot_id: int, request: Request, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    """Parse the cached files again with the current mapping. Same snapshot, no new version."""
    got = rcp_parse.reparse_snapshot(conn, _data_dir(request), snapshot_id)
    return {**got, "parse": rcp_parse.parse_state(conn, got["snapshot"])}


@router.post("/recipe-sources/{source_id}/reparse")
def reparse_source(source_id: int, request: Request, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    """Re-parse the current snapshot of every recipe of the source (after editing its mapping file)."""
    if _runner(request).busy():
        raise repo.RecipeError("수집이 진행 중이에요. 끝난 뒤에 다시 파싱해 주세요.", 409)
    return rcp_parse.reparse_source(conn, _data_dir(request), source_id)
