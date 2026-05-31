from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated
import shutil
import uuid

import redis
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .auth import get_current_user, require_action
from .celery_app import demo_scan, scan_uploaded_file
from .config import Settings, get_settings
from .database import check_database, get_db, init_db
from .models import (
    AnalysisProject,
    Component,
    ComponentDependency,
    Project,
    ScanLog,
    ScanTask,
    UploadFileRecord,
)
from .schemas import (
    ComponentOut,
    DependencyTreeNode,
    OverviewOut,
    ProjectListItem,
    ScanLogOut,
    ScanTaskOut,
    UploadFileOut,
    UploadListOut,
    UploadSessionCreate,
    UserPayload,
)
from .upload_service import (
    add_upload_log,
    chunk_size,
    ensure_project,
    ensure_upload_dirs,
    remove_upload_artifacts,
    save_upload_file,
    to_upload_out,
    validate_archive_filename,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    ensure_upload_dirs(Path(settings.upload_root))
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
    project_count = db.scalar(select(func.count(Project.id))) or 0
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


def _stored_name(upload_id: str, filename: str) -> str:
    lower = filename.lower()
    if lower.endswith(".tar.gz"):
        suffix = ".tar.gz"
    elif lower.endswith(".tgz"):
        suffix = ".tgz"
    else:
        suffix = ".zip"
    return f"{upload_id}{suffix}"


def _enqueue_scan(db: Session, record: UploadFileRecord) -> None:
    celery_task_id = uuid.uuid4().hex
    scan_task = ScanTask(
        project_id=record.project_id,
        upload_file_id=record.id,
        celery_task_id=celery_task_id,
        status="queued",
        summary="等待依赖识别任务执行",
    )
    db.add(scan_task)
    db.flush()
    scan_uploaded_file.apply_async(args=[scan_task.id], task_id=celery_task_id)
    db.refresh(record)


@app.post("/api/sca/uploads", response_model=UploadFileOut, tags=["uploads"])
async def upload_source_archive(
    request: Request,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    project_name: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    scan_note: Annotated[str, Form()] = "",
) -> UploadFileOut:
    await require_action("sca:write", request, user, settings)
    filename = validate_archive_filename(file.filename or "")
    upload_id = uuid.uuid4().hex
    upload_root = Path(settings.upload_root)
    ensure_upload_dirs(upload_root)
    destination = upload_root / "archives" / _stored_name(upload_id, filename)
    size = await save_upload_file(file, destination, settings.upload_max_bytes)

    project = ensure_project(db, project_name, scan_note, user.username)
    record = UploadFileRecord(
        project_id=project.id,
        upload_id=upload_id,
        original_filename=filename,
        stored_filename=destination.name,
        storage_path=str(destination),
        content_type=file.content_type or "",
        file_size=size,
        received_bytes=size,
        total_chunks=1,
        status="completed",
        scan_note=scan_note,
        created_by=user.username,
        completed_at=datetime.now(timezone.utc),
    )
    db.add(record)
    db.flush()
    add_upload_log(db, record.id, "completed", f"上传完成：{filename}")
    _enqueue_scan(db, record)
    db.commit()
    db.refresh(record)
    return to_upload_out(record)


@app.post("/api/sca/uploads/sessions", response_model=UploadFileOut, tags=["uploads"])
async def create_upload_session(
    request: Request,
    payload: UploadSessionCreate,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> UploadFileOut:
    await require_action("sca:write", request, user, settings)
    filename = validate_archive_filename(payload.filename)
    if payload.total_size <= 0 or payload.total_size > settings.upload_max_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="上传文件超过大小限制")
    if payload.total_chunks <= 0 or payload.total_chunks > 10000:
        raise HTTPException(status_code=400, detail="分片数量不合法")
    project = ensure_project(db, payload.project_name, payload.scan_note, user.username)
    upload_id = uuid.uuid4().hex
    record = UploadFileRecord(
        project_id=project.id,
        upload_id=upload_id,
        original_filename=filename,
        stored_filename=_stored_name(upload_id, filename),
        content_type="application/octet-stream",
        file_size=payload.total_size,
        received_bytes=0,
        total_chunks=payload.total_chunks,
        status="uploading",
        scan_note=payload.scan_note,
        created_by=user.username,
    )
    db.add(record)
    db.flush()
    add_upload_log(db, record.id, "session_created", f"创建断点续传会话：{filename}")
    db.commit()
    db.refresh(record)
    return to_upload_out(record)


@app.put("/api/sca/uploads/{upload_id}/chunks/{chunk_index}", tags=["uploads"])
async def upload_chunk(
    request: Request,
    upload_id: str,
    chunk_index: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, int | str]:
    await require_action("sca:write", request, user, settings)
    record = db.scalar(select(UploadFileRecord).where(UploadFileRecord.upload_id == upload_id))
    if not record:
        raise HTTPException(status_code=404, detail="上传会话不存在")
    if chunk_index < 0 or chunk_index >= record.total_chunks:
        raise HTTPException(status_code=400, detail="分片序号不合法")
    chunk = await request.body()
    if not chunk:
        raise HTTPException(status_code=400, detail="分片内容不能为空")
    chunk_dir = Path(settings.upload_root) / "chunks" / upload_id
    chunk_dir.mkdir(parents=True, exist_ok=True)
    chunk_path = chunk_dir / f"{chunk_index:08d}.part"
    chunk_path.write_bytes(chunk)
    received = sum(chunk_size(chunk_dir / f"{index:08d}.part") for index in range(record.total_chunks))
    if received > settings.upload_max_bytes or received > record.file_size:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="上传文件超过大小限制")
    record.received_bytes = received
    record.status = "uploading"
    add_upload_log(db, record.id, "chunk_uploaded", f"已上传分片 {chunk_index + 1}/{record.total_chunks}")
    db.commit()
    return {"upload_id": upload_id, "received_bytes": received, "status": record.status}


@app.post("/api/sca/uploads/{upload_id}/complete", response_model=UploadFileOut, tags=["uploads"])
async def complete_resumable_upload(
    request: Request,
    upload_id: str,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> UploadFileOut:
    await require_action("sca:write", request, user, settings)
    record = db.scalar(select(UploadFileRecord).where(UploadFileRecord.upload_id == upload_id))
    if not record:
        raise HTTPException(status_code=404, detail="上传会话不存在")
    upload_root = Path(settings.upload_root)
    chunk_dir = upload_root / "chunks" / upload_id
    missing = [index for index in range(record.total_chunks) if not (chunk_dir / f"{index:08d}.part").exists()]
    if missing:
        raise HTTPException(status_code=400, detail=f"缺少分片：{missing[:5]}")
    ensure_upload_dirs(upload_root)
    destination = upload_root / "archives" / record.stored_filename
    with destination.open("wb") as output:
        for index in range(record.total_chunks):
            output.write((chunk_dir / f"{index:08d}.part").read_bytes())
    actual_size = destination.stat().st_size
    if actual_size != record.file_size:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="合并文件大小与声明大小不一致")
    record.storage_path = str(destination)
    record.received_bytes = actual_size
    record.status = "completed"
    record.completed_at = datetime.now(timezone.utc)
    add_upload_log(db, record.id, "completed", "断点续传合并完成")
    shutil.rmtree(chunk_dir, ignore_errors=True)
    _enqueue_scan(db, record)
    db.commit()
    db.refresh(record)
    return to_upload_out(record)


@app.get("/api/sca/uploads", response_model=UploadListOut, tags=["uploads"])
async def list_uploads(
    request: Request,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> UploadListOut:
    await require_action("sca:read", request, user, settings)
    items = db.scalars(select(UploadFileRecord).order_by(UploadFileRecord.created_at.desc())).all()
    return UploadListOut(total=len(items), items=[to_upload_out(item) for item in items])


@app.delete("/api/sca/uploads/{upload_file_id}", tags=["uploads"])
async def delete_upload(
    request: Request,
    upload_file_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, str]:
    await require_action("sca:write", request, user, settings)
    record = db.get(UploadFileRecord, upload_file_id)
    if not record:
        raise HTTPException(status_code=404, detail="上传文件不存在")
    remove_upload_artifacts(Path(settings.upload_root), record)
    db.delete(record)
    db.commit()
    return {"status": "deleted"}


@app.get("/api/sca/projects", response_model=list[ProjectListItem], tags=["sca"])
async def list_projects(
    request: Request,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ProjectListItem]:
    await require_action("sca:read", request, user, settings)
    return list(db.scalars(select(Project).order_by(Project.created_at.desc())).all())


@app.get("/api/sca/projects/{project_id}/components", response_model=list[ComponentOut], tags=["sca"])
async def list_components(
    request: Request,
    project_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ComponentOut]:
    await require_action("sca:read", request, user, settings)
    return list(db.scalars(select(Component).where(Component.project_id == project_id).order_by(Component.ecosystem, Component.package_name)).all())


@app.get("/api/sca/projects/{project_id}/dependency-tree", response_model=list[DependencyTreeNode], tags=["sca"])
async def dependency_tree(
    request: Request,
    project_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[DependencyTreeNode]:
    await require_action("sca:read", request, user, settings)
    components = db.scalars(select(Component).where(Component.project_id == project_id)).all()
    by_id = {component.id: component for component in components}
    roots: dict[str, DependencyTreeNode] = {}
    direct_edges = db.scalars(
        select(ComponentDependency).where(
            ComponentDependency.project_id == project_id,
            ComponentDependency.parent_component_id.is_(None),
        )
    ).all()
    for edge in direct_edges:
        child = by_id.get(edge.child_component_id)
        if not child:
            continue
        root = roots.setdefault(
            child.ecosystem,
            DependencyTreeNode(id=f"ecosystem:{child.ecosystem}", label=child.ecosystem or "unknown", ecosystem=child.ecosystem),
        )
        root.children.append(
            DependencyTreeNode(
                id=f"component:{child.id}",
                label=child.package_name,
                ecosystem=child.ecosystem,
                version=child.package_version,
            )
        )
    return list(roots.values())


@app.get("/api/sca/projects/{project_id}/scan-tasks", response_model=list[ScanTaskOut], tags=["sca"])
async def list_scan_tasks(
    request: Request,
    project_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ScanTaskOut]:
    await require_action("sca:read", request, user, settings)
    return list(db.scalars(select(ScanTask).where(ScanTask.project_id == project_id).order_by(ScanTask.created_at.desc())).all())


@app.get("/api/sca/projects/{project_id}/scan-logs", response_model=list[ScanLogOut], tags=["sca"])
async def list_scan_logs(
    request: Request,
    project_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ScanLogOut]:
    await require_action("sca:read", request, user, settings)
    task_ids = select(ScanTask.id).where(ScanTask.project_id == project_id)
    return list(db.scalars(select(ScanLog).where(ScanLog.scan_task_id.in_(task_ids)).order_by(ScanLog.created_at.asc())).all())
