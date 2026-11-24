"""RCP management read-only API (P6-01 skeleton, D-36). No collection, no writes to equipment."""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends

from app.repositories import recipes as repo
from app.routers.tasks import get_conn

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
    return repo.get_snapshot(conn, snapshot_id)


@router.get("/recipe-runs")
def list_runs(source_id: int | None = None, limit: int = 50, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return {"items": repo.list_runs(conn, source_id, limit)}
