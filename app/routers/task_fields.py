from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app import placement
from app.repositories import task_fields as repo
from app.routers.tasks import get_conn

# Registered before the tasks router so "/fields" is not read as a task id.
router = APIRouter(prefix="/api/todos")


@router.get("/fields")
def list_fields(include_archived: bool = True, conn=Depends(get_conn)) -> dict:
    return {"items": repo.list_fields(conn, include_archived=include_archived)}


@router.post("/fields", status_code=201)
def create_field(body: dict[str, Any], conn=Depends(get_conn)) -> dict:
    return repo.create_field(conn, body)


@router.put("/fields/order")
def reorder_fields(body: dict[str, Any], conn=Depends(get_conn)) -> dict:
    keys = body.get("keys")
    if not isinstance(keys, list):
        raise repo.TaskError("keys 목록이 필요합니다.")
    return {"items": repo.reorder(conn, keys)}


@router.get("/fields/{key}")
def get_field(key: str, conn=Depends(get_conn)) -> dict:
    return {**repo.get_field(conn, key), "used_by": repo.usage_count(conn, key)}


@router.patch("/fields/{key}")
def patch_field(key: str, body: dict[str, Any], conn=Depends(get_conn)) -> dict:
    return repo.update_field(conn, key, body)


@router.post("/fields/{key}/options", status_code=201)
def add_option(key: str, body: dict[str, Any], conn=Depends(get_conn)) -> dict:
    return repo.add_option(conn, key, body)


@router.delete("/fields/{key}")
def delete_field(key: str, purge: bool = False, conn=Depends(get_conn)) -> dict:
    return repo.delete_field(conn, key, purge=purge)


@router.get("/page-rules")
def get_rules(conn=Depends(get_conn)) -> dict:
    return {"rules": repo.get_rules(conn), "fallback": placement.get_fallback(conn)}


@router.put("/page-rules")
def put_rules(body: dict[str, Any], conn=Depends(get_conn)) -> dict:
    rules = repo.validate_rules(conn, body.get("rules"))  # validate everything before writing anything
    if "fallback" in body and body["fallback"] not in placement.FALLBACKS:
        raise repo.TaskError("기본 위치를 알 수 없어요.")
    saved = repo.set_rules(conn, rules)
    if "fallback" in body:
        placement.set_fallback(conn, body["fallback"])
    return {"rules": saved, "fallback": placement.get_fallback(conn)}
