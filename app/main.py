from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import db, memo, rcp_collect
from fastapi.exceptions import RequestValidationError

from app.repositories.eval_templates import TemplateError
from app.repositories.evaluations import EvaluationError
from app.repositories.doi import DoiError
from app.repositories.plans import PlanError
from app.repositories.recipes import RecipeError
from app.repositories.tasks import TaskError
from app.routers import dashboard as dashboard_router
from app.routers import eval_templates, evaluations
from app.routers import doi as doi_router
from app.routers import doi_import as doi_import_router
from app.routers import doi_package as doi_package_router
from app.routers import html_pages
from app.routers import plans as plans_router
from app.routers import recipes as recipes_router
from app.routers import search as search_router
from app.routers import settings as settings_router
from app.routers import skills as skills_router
from app.routers import journal as journal_router
from app.routers import pages
from app.routers import ppt as ppt_router
from app.routers import structure as structure_router
from app.routers import task_pages
from app.routers import task_fields as task_fields_router
from app.routers import tasks as tasks_router
from app.vault import DEFAULT_VAULT_PATH, Vault, VaultError

APP_VERSION = "0.1.0"
WEB_DIR = Path(__file__).resolve().parent.parent / "web"


def create_app(
    db_path: Path = db.DEFAULT_DB_PATH, vault_path: Path = DEFAULT_VAULT_PATH
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        db.init_db(db_path)  # apply pending migrations on startup
        conn = db.connect(db_path)
        try:
            memo.sweep(conn, app.state.vault)  # unify issue memos with their page bodies (P2B-10)
            rcp_collect.reap_stale(conn)  # a run left running by a restart can never finish (P6-02)
        finally:
            conn.close()
        yield

    app = FastAPI(title="MI_Planner", version=APP_VERSION, lifespan=lifespan)
    app.state.db_path = db_path
    app.state.vault = Vault(vault_path)
    app.include_router(ppt_router.router)
    app.include_router(html_pages.router)  # before pages.router (/state vs "")
    app.include_router(pages.router)
    app.include_router(journal_router.router)
    app.include_router(task_pages.router)  # before tasks (/page-preview, /{id}/page)
    app.include_router(task_fields_router.router)  # before tasks (/fields vs /{task_id})
    app.include_router(tasks_router.router)
    app.include_router(structure_router.router)
    app.include_router(settings_router.router)
    app.include_router(skills_router.router)
    app.include_router(dashboard_router.router)
    app.include_router(eval_templates.router)
    app.include_router(search_router.router)
    app.include_router(evaluations.router)
    app.include_router(evaluations.cell_router)
    app.include_router(plans_router.router)
    app.include_router(recipes_router.router)
    app.include_router(doi_import_router.router)
    app.include_router(doi_package_router.router)
    app.include_router(doi_router.router)
    app.include_router(doi_router.image_router)

    @app.middleware("http")
    async def revalidate_static(request, call_next):
        # Local app: always revalidate UI files so an updated css/js is never served stale from cache.
        response = await call_next(request)
        if not request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-cache"
        return response

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "version": APP_VERSION}

    @app.exception_handler(VaultError)
    async def on_vault_error(_, exc: VaultError) -> JSONResponse:
        return JSONResponse({"error": str(exc)}, status_code=exc.status)

    @app.exception_handler(TemplateError)
    async def on_template_error(_, exc: TemplateError) -> JSONResponse:
        return JSONResponse({"error": str(exc)}, status_code=exc.status)

    @app.exception_handler(EvaluationError)
    async def on_evaluation_error(_, exc: EvaluationError) -> JSONResponse:
        return JSONResponse({"error": str(exc)}, status_code=exc.status)

    @app.exception_handler(PlanError)
    async def on_plan_error(_, exc: PlanError) -> JSONResponse:
        return JSONResponse({"error": str(exc)}, status_code=exc.status)

    @app.exception_handler(RecipeError)
    async def on_recipe_error(_, exc: RecipeError) -> JSONResponse:
        return JSONResponse({"error": str(exc)}, status_code=exc.status)

    @app.exception_handler(DoiError)
    async def on_doi_error(_, exc: DoiError) -> JSONResponse:
        return JSONResponse({"error": str(exc)}, status_code=exc.status)

    @app.exception_handler(TaskError)
    async def on_task_error(_, exc: TaskError) -> JSONResponse:
        return JSONResponse({"error": str(exc)}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def on_validation_error(_, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse({"error": "잘못된 요청입니다.", "detail": str(exc.errors())}, status_code=422)

    @app.exception_handler(Exception)
    async def on_error(_, exc: Exception) -> JSONResponse:
        return JSONResponse({"error": str(exc)}, status_code=500)

    if WEB_DIR.is_dir():
        app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
    return app


app = create_app()
