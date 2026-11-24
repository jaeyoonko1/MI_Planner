from fastapi import APIRouter, Request

from app import skills_index

router = APIRouter(prefix="/api/skills")


@router.get("")
def skills(request: Request) -> dict:
    return {"skills": skills_index.list_skills(getattr(request.app.state, "skills_dir", skills_index.SKILLS_DIR))}
