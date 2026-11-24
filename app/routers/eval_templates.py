from __future__ import annotations

import sqlite3
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import AfterValidator, BaseModel, Field, StringConstraints, model_validator

from app.repositories import eval_templates as repo
from app.routers.tasks import get_conn

router = APIRouter(prefix="/api/eval-templates")

NonEmpty = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Color = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]
WarningHours = Annotated[float, Field(strict=True, gt=0, allow_inf_nan=False)]


class Stage(BaseModel):
    key: NonEmpty
    label: NonEmpty
    color: Color
    warn_hours: WarningHours | None = None


class ValueField(BaseModel):
    key: NonEmpty
    label: NonEmpty
    type: Literal["number", "text", "okng", "check"]


def _unique_keys(entries: list[Stage] | list[ValueField]) -> list[Stage] | list[ValueField]:
    if len({entry.key for entry in entries}) != len(entries):
        raise ValueError("같은 목록에서 키는 중복될 수 없습니다.")
    return entries


Stages = Annotated[list[Stage], Field(min_length=1), AfterValidator(_unique_keys)]
ValueFields = Annotated[list[ValueField], AfterValidator(_unique_keys)]


class TemplateIn(BaseModel):
    name: NonEmpty
    stages: Stages
    fields: ValueFields = Field(default_factory=list)
    is_master: bool = False


class TemplatePatch(BaseModel):
    name: NonEmpty | None = None
    stages: Stages | None = None
    fields: ValueFields | None = None
    is_master: bool | None = None

    @model_validator(mode="after")
    def no_null_fields(self) -> TemplatePatch:
        if any(getattr(self, name) is None for name in self.model_fields_set):
            raise ValueError("변경할 항목에 null을 지정할 수 없습니다.")
        return self


@router.get("")
def list_templates(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return {"items": repo.list_templates(conn)}


@router.post("", status_code=201)
def create_template(body: TemplateIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return repo.create_template(conn, body.model_dump())


@router.patch("/{template_id}")
def update_template(
    template_id: int, body: TemplatePatch, conn: sqlite3.Connection = Depends(get_conn)
) -> dict:
    return repo.update_template(conn, template_id, body.model_dump(exclude_unset=True))


@router.get("/{template_id}/usage")
def template_usage(template_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return repo.stage_usage(conn, template_id)


@router.delete("/{template_id}")
def delete_template(template_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    repo.delete_template(conn, template_id)
    return {"deleted": template_id}
