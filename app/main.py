from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import db
from fastapi.exceptions import RequestValidationError

from app.repositories.tasks import TaskError
from app.routers import journal as journal_router
from app.routers import pages
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
        yield

    app = FastAPI(title="MI_Planner", version=APP_VERSION, lifespan=lifespan)
    app.state.db_path = db_path
    app.state.vault = Vault(vault_path)
    app.include_router(pages.router)
    app.include_router(journal_router.router)
    app.include_router(tasks_router.router)

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "version": APP_VERSION}

    @app.exception_handler(VaultError)
    async def on_vault_error(_, exc: VaultError) -> JSONResponse:
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
