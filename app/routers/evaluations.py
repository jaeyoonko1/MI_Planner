from __future__ import annotations

import sqlite3
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field, StringConstraints, model_validator

from app.repositories import evaluations as repo
from app.routers.tasks import get_conn

router = APIRouter(prefix="/api/evaluations")
cell_router = APIRouter(prefix="/api/eval-cells")
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120, pattern=r"^[^\x00-\x1f]+$")]


class EquipmentInput(BaseModel):
    name: Name
    vendor: Name | None = None


class LotInput(BaseModel):
    lot_no: Name
    wafers: Annotated[list[Name], Field(min_length=1, max_length=25)]


class ExclusionInput(BaseModel):
    equipment: Name
    lot_no: Name
    wafer_no: Name


class EvaluationInput(BaseModel):
    name: Name
    template_id: Annotated[int, Field(strict=True, gt=0)]
    equipment: Annotated[list[EquipmentInput], Field(min_length=1, max_length=10)]
    lots: Annotated[list[LotInput], Field(min_length=1, max_length=20)]
    excluded: Annotated[list[ExclusionInput], Field(max_length=5_000)] = Field(default_factory=list)
    parent: str | None = None
    request_id: UUID | None = None

    @model_validator(mode="after")
    def validate_matrix(self) -> EvaluationInput:
        names = {entry.name for entry in self.equipment}
        lots = {entry.lot_no: set(entry.wafers) for entry in self.lots}
        if len(names) != len(self.equipment) or len(lots) != len(self.lots):
            raise ValueError("설비 또는 Lot 이름이 중복됐어요.")
        if any(len(lots[entry.lot_no]) != len(entry.wafers) for entry in self.lots):
            raise ValueError("같은 Lot의 웨이퍼가 중복됐어요.")
        excluded = {(item.equipment, item.lot_no, item.wafer_no) for item in self.excluded}
        if len(excluded) != len(self.excluded):
            raise ValueError("제외할 조합이 중복됐어요.")
        if any(name not in names or wafer not in lots.get(lot, ()) for name, lot, wafer in excluded):
            raise ValueError("제외할 조합이 설비·Lot·웨이퍼 목록과 일치하지 않아요.")
        if len(excluded) == len(names) * sum(map(len, lots.values())):
            raise ValueError("평가할 조합을 하나 이상 남겨 주세요.")
        return self


@router.get("")
def list_evaluations(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return {"items": repo.list_evaluations(conn)}


@router.get("/{evaluation_id}/board")
def get_board(evaluation_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return repo.get_board(conn, evaluation_id)


@router.get("/{evaluation_id}")
def get_evaluation(evaluation_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return repo.get_evaluation(conn, evaluation_id)


@router.post("", status_code=201, responses={200: {"description": "Repeated create request"}})
def create_evaluation(
    body: EvaluationInput, request: Request, response: Response, conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    result = repo.create_evaluation(conn, request.app.state.vault, body.model_dump(mode="json"))
    if not result["created"]:
        response.status_code = 200
    return result


StageKey = Annotated[str, StringConstraints(min_length=1, max_length=64)]


class StageMove(BaseModel):
    cell_id: Annotated[int, Field(strict=True, gt=0)]
    stage_key: StageKey | None


class StageRequest(BaseModel):
    """Either one target for many cells, or one target per cell (undo, "next stage")."""

    cell_ids: Annotated[list[Annotated[int, Field(strict=True, gt=0)]], Field(max_length=repo.MAX_MOVES)] | None = None
    stage_key: StageKey | None = None
    moves: Annotated[list[StageMove], Field(max_length=repo.MAX_MOVES)] | None = None

    @model_validator(mode="after")
    def one_form(self) -> StageRequest:
        if (self.cell_ids is None) == (self.moves is None):
            raise ValueError("cell_ids와 moves 중 하나만 보내 주세요.")
        if self.moves is not None and "stage_key" in self.model_fields_set:
            raise ValueError("moves와 stage_key는 함께 보낼 수 없어요.")
        if self.cell_ids is not None and "stage_key" not in self.model_fields_set:
            raise ValueError("stage_key가 필요해요. 미배정으로 돌리려면 null을 보내 주세요.")
        return self


@router.post("/{evaluation_id}/cells/stage")
def move_cells(evaluation_id: int, body: StageRequest, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    moves = [(m.cell_id, m.stage_key) for m in body.moves] if body.moves is not None else [
        (cell_id, body.stage_key) for cell_id in body.cell_ids or []]
    return repo.apply_stage_moves(conn, evaluation_id, moves)


class CellPatch(BaseModel):
    values: dict[Annotated[str, StringConstraints(min_length=1, max_length=64)], Any] | None = None
    note: Annotated[str, Field(max_length=repo.MAX_NOTE * 2)] | None = None


@cell_router.patch("/{cell_id}")
def patch_cell(cell_id: int, body: CellPatch, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    if not body.model_fields_set & {"values", "note"}:
        raise repo.EvaluationError("바꿀 내용이 없어요.")
    return repo.update_cell(conn, cell_id, body.values, body.note, "note" in body.model_fields_set)


@cell_router.get("/{cell_id}/history")
def get_cell_history(cell_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return {"items": repo.cell_history(conn, cell_id)}
