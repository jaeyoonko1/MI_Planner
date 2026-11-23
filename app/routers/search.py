from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from app import search
from app.routers.tasks import get_conn

router = APIRouter(prefix="/api/search")


@router.get("")
def find(
    request: Request,
    q: Annotated[str, Query(max_length=250)] = "",
    limit: Annotated[int, Query(ge=1, le=60)] = 30,
    conn=Depends(get_conn),
) -> dict:
    return search.search(request.app.state.vault, conn, q, limit)


@router.get("/backlinks")
def backlinks(request: Request, path: Annotated[str, Query(min_length=1)]) -> dict:
    return {"pages": search.backlinks(request.app.state.vault, path)}
