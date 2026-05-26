from contextlib import asynccontextmanager
from typing import Annotated

import redis
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .auth import get_current_user, require_action
from .celery_app import demo_scan
from .config import Settings, get_settings
from .database import check_database, get_db, init_db
from .models import AnalysisProject, Component
from .schemas import OverviewOut, UserPayload


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


settings = get_settings()
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="聚信软件成分分析平台第一阶段 API，复用聚信统一登录平台。",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["system"])
def health(settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, str]:
    return {"status": "ok", "app": settings.app_name, "version": settings.app_version}


@app.get("/ready", tags=["system"])
def ready(settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, object]:
    db_ok = check_database()
    redis_client = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=1, socket_timeout=1)
    redis_ok = bool(redis_client.ping())
    return {"status": "ok" if db_ok and redis_ok else "degraded", "database": db_ok, "redis": redis_ok}


@app.get("/api/sca/me", response_model=UserPayload, tags=["auth"])
async def me(user: Annotated[UserPayload, Depends(get_current_user)]) -> UserPayload:
    return user


@app.get("/api/sca/overview", response_model=OverviewOut, tags=["sca"])
async def overview(
    request: Request,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> OverviewOut:
    await require_action("sca:read", request, user, settings)
    projects = db.scalars(select(AnalysisProject).order_by(AnalysisProject.created_at.desc()).limit(5)).all()
    project_count = db.scalar(select(func.count(AnalysisProject.id))) or 0
    component_count = db.scalar(select(func.count(Component.id))) or 0
    high_risk_count = db.scalar(select(func.count(AnalysisProject.id)).where(AnalysisProject.risk_level == "high")) or 0
    pending_count = db.scalar(select(func.count(Component.id)).where(Component.vulnerability_status == "pending")) or 0
    return OverviewOut(
        project_count=project_count,
        component_count=component_count,
        high_risk_count=high_risk_count,
        pending_component_count=pending_count,
        recent_projects=projects,
        user=user,
    )


@app.post("/api/sca/tasks/demo", tags=["sca"])
async def enqueue_demo_task(
    request: Request,
    user: Annotated[UserPayload, Depends(get_current_user)],
) -> dict[str, str]:
    await require_action("sca:write", request, user, settings)
    task = demo_scan.delay("bootstrap-demo")
    return {"task_id": task.id, "status": "queued"}
