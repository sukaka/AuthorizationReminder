from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated
import json
import shutil
import uuid

import redis
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .auth import get_current_user, require_action
from .celery_app import demo_scan, scan_uploaded_file
from .config import Settings, get_settings
from .database import check_database, get_db, init_db
from .models import (
    AnalysisProject,
    AiTriageResult,
    Component,
    ComponentDependency,
    DependencyTrackProject,
    ImageScan,
    ImageScanFinding,
    Project,
    BackupJob,
    DevopsScanEvent,
    RemediationEvent,
    RemediationTicket,
    RiskAlert,
    RiskChangeRecord,
    RiskMonitorRun,
    RiskMonitorSnapshot,
    ReportExport,
    SbomDocument,
    ScanLog,
    ScanTask,
    SystemSetting,
    UploadFileRecord,
    VulnerabilityRecord,
    VulnerabilityWhitelist,
)
from .schemas import (
    AiTriageAnalyzeIn,
    AiTriageConfirmIn,
    AiTriageMetaOut,
    AiTriageOut,
    AssetComponentListOut,
    AssetDashboardOut,
    AssetGraphOut,
    BackupCreateIn,
    BackupJobListOut,
    BackupJobOut,
    CveQueryIn,
    ComponentOut,
    ComponentManualVersionIn,
    DependencyTrackStatusOut,
    DependencyTreeNode,
    DevopsDashboardOut,
    DevopsEventListOut,
    DevopsEventOut,
    DevopsWebhookIn,
    ImageScanCreateIn,
    ImageScanFindingOut,
    ImageScanOut,
    OpsConfigOut,
    OverviewOut,
    ProjectListItem,
    RemediationEventOut,
    RemediationTicketCreateIn,
    RemediationTicketListOut,
    RemediationTicketOut,
    RemediationTransitionIn,
    RemediationVerifyIn,
    RiskAlertOut,
    RiskChangeOut,
    RiskMonitorRunOut,
    RiskMonitorSnapshotOut,
    RiskTrendItem,
    RiskTrendOut,
    ReportCreateIn,
    ReportOut,
    ScanLogOut,
    ScanCompletenessOut,
    ScanTaskOut,
    SbomCreateIn,
    SbomOut,
    SystemConfigOut,
    SystemConfigUpdateIn,
    UploadFileOut,
    UploadListOut,
    UploadSessionCreate,
    UserPayload,
    VulnerabilityListOut,
    VulnerabilityOut,
    VulnerabilityStatsOut,
    VulnerabilityTrendItem,
    VulnerabilityTrendOut,
    WhitelistCreateIn,
    WhitelistOut,
)
from .ai_triage_service import (
    AI_SCHEMA_VERSION,
    AI_TRIAGE_JSON_SCHEMA,
    AI_TRIAGE_PROMPT_TEMPLATE,
    SENSITIVE_KEYS,
    analyze_vulnerabilities_with_ai,
    cached_ai_result,
)
from .asset_service import asset_components, asset_dashboard, asset_graph
from .devops_service import devops_dashboard, record_devops_event
from .ops_service import plan_backup_path, production_config
from .remediation_service import create_ticket_no, ignore_vulnerability, mark_overdue_tickets, transition_ticket, verify_ticket
from .report_service import generate_report
from .reachability_service import analyze_component_reachability
from .risk_monitor_service import monitor_component_update, raw_json, snapshot_risk_level
from .sbom_service import generate_sbom, scan_image
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
from .vulnerability_service import query_component_vulnerabilities, query_cve


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    ensure_upload_dirs(Path(settings.upload_root))
    yield


settings = get_settings()
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="聚信软件成分分析平台 API，覆盖源码上传、依赖识别、漏洞查询、报告导出、SBOM、镜像扫描、持续监测、AI 降噪与资产中心。",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SYSTEM_CONFIG_UPLOAD_MAX_MB = "upload_max_file_size_mb"
SYSTEM_CONFIG_OPENAI_API_KEY = "openai_api_key"
SYSTEM_CONFIG_OPENAI_BASE_URL = "openai_base_url"
SYSTEM_CONFIG_OPENAI_MODEL = "openai_model"
SYSTEM_CONFIG_OPENAI_TIMEOUT_MS = "openai_timeout_ms"
DEFAULT_UPLOAD_MAX_FILE_SIZE_MB = 2048
DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"


def _setting_map(db: Session) -> dict[str, str]:
    return {item.key: item.value for item in db.scalars(select(SystemSetting)).all()}


def _to_int(value: object, fallback: int, min_value: int = 0, max_value: int = 102400) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(min_value, min(max_value, number))


def _normalize_openai_base_url(value: str) -> str:
    text = str(value or "").strip().rstrip("/")
    if not text:
        return DEFAULT_OPENAI_BASE_URL
    if text.endswith("/chat/completions"):
        text = text[: -len("/chat/completions")]
    return text.rstrip("/") or DEFAULT_OPENAI_BASE_URL


def _openai_chat_url(base_url: str) -> str:
    return f"{_normalize_openai_base_url(base_url)}/chat/completions"


def _mask_secret(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if len(text) <= 8:
        return f"{text[:2]}****"
    return f"{text[:4]}****{text[-4:]}"


def _system_config_payload(db: Session) -> SystemConfigOut:
    values = _setting_map(db)
    upload_mb = _to_int(values.get(SYSTEM_CONFIG_UPLOAD_MAX_MB), DEFAULT_UPLOAD_MAX_FILE_SIZE_MB)
    api_key = str(values.get(SYSTEM_CONFIG_OPENAI_API_KEY) or settings.openai_api_key or "").strip()
    base_url = _normalize_openai_base_url(values.get(SYSTEM_CONFIG_OPENAI_BASE_URL) or settings.openai_api_url)
    model = str(values.get(SYSTEM_CONFIG_OPENAI_MODEL) or settings.openai_model or "gpt-4o-mini").strip() or "gpt-4o-mini"
    timeout_ms = _to_int(values.get(SYSTEM_CONFIG_OPENAI_TIMEOUT_MS), settings.openai_timeout_ms, 1000, 300000)
    return SystemConfigOut(
        upload_max_file_size_mb=upload_mb,
        upload_max_file_size_bytes=upload_mb * 1024 * 1024 if upload_mb > 0 else 0,
        openai_api_key_configured=bool(api_key),
        openai_api_key_masked=_mask_secret(api_key),
        openai_base_url=base_url,
        openai_model=model,
        openai_timeout_ms=timeout_ms,
    )


def _upsert_setting(db: Session, key: str, value: object, username: str) -> None:
    row = db.scalar(select(SystemSetting).where(SystemSetting.key == key))
    if row:
        row.value = str(value)
        row.updated_by = username
        return
    db.add(SystemSetting(key=key, value=str(value), updated_by=username))


def _effective_ai_settings(db: Session) -> Settings:
    values = _setting_map(db)
    api_key = str(values.get(SYSTEM_CONFIG_OPENAI_API_KEY) or settings.openai_api_key or "").strip()
    base_url = _normalize_openai_base_url(values.get(SYSTEM_CONFIG_OPENAI_BASE_URL) or settings.openai_api_url)
    model = str(values.get(SYSTEM_CONFIG_OPENAI_MODEL) or settings.openai_model or "gpt-4o-mini").strip() or "gpt-4o-mini"
    timeout_ms = _to_int(values.get(SYSTEM_CONFIG_OPENAI_TIMEOUT_MS), settings.openai_timeout_ms, 1000, 300000)
    return settings.model_copy(update={
        "openai_api_key": api_key,
        "openai_api_url": _openai_chat_url(base_url),
        "openai_model": model,
        "openai_timeout_ms": timeout_ms,
    })


def _upload_limit_bytes(db: Session) -> int:
    values = _setting_map(db)
    upload_mb = _to_int(values.get(SYSTEM_CONFIG_UPLOAD_MAX_MB), DEFAULT_UPLOAD_MAX_FILE_SIZE_MB)
    return upload_mb * 1024 * 1024 if upload_mb > 0 else 0


def _ensure_upload_size_allowed(db: Session, size: int) -> None:
    limit_bytes = _upload_limit_bytes(db)
    if limit_bytes > 0 and size > limit_bytes:
        limit_mb = round(limit_bytes / 1024 / 1024, 2)
        raise HTTPException(status_code=413, detail=f"文件超过系统配置的上传大小上限：{limit_mb} MB")


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


@app.get("/api/sca/system-config", response_model=SystemConfigOut, tags=["system"])
async def get_system_config(
    request: Request,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> SystemConfigOut:
    await require_action("sca:read", request, user, settings)
    return _system_config_payload(db)


@app.put("/api/sca/system-config", response_model=SystemConfigOut, tags=["system"])
async def update_system_config(
    request: Request,
    payload: SystemConfigUpdateIn,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> SystemConfigOut:
    await require_action("sca:write", request, user, settings)
    username = str(user.username or "system")
    _upsert_setting(db, SYSTEM_CONFIG_UPLOAD_MAX_MB, payload.upload_max_file_size_mb, username)
    _upsert_setting(db, SYSTEM_CONFIG_OPENAI_BASE_URL, _normalize_openai_base_url(payload.openai_base_url), username)
    _upsert_setting(db, SYSTEM_CONFIG_OPENAI_MODEL, payload.openai_model.strip() or "gpt-4o-mini", username)
    _upsert_setting(db, SYSTEM_CONFIG_OPENAI_TIMEOUT_MS, payload.openai_timeout_ms, username)
    if payload.clear_openai_api_key:
        _upsert_setting(db, SYSTEM_CONFIG_OPENAI_API_KEY, "", username)
    elif payload.openai_api_key.strip():
        _upsert_setting(db, SYSTEM_CONFIG_OPENAI_API_KEY, payload.openai_api_key.strip(), username)
    db.commit()
    return _system_config_payload(db)


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
    # Celery worker uses a separate DB session; commit before enqueue so it can read the task.
    db.commit()
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
    size = await save_upload_file(file, destination)
    try:
        _ensure_upload_size_allowed(db, size)
    except HTTPException:
        destination.unlink(missing_ok=True)
        raise

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
    if payload.total_size <= 0:
        raise HTTPException(status_code=400, detail="文件大小必须大于 0")
    _ensure_upload_size_allowed(db, payload.total_size)
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
    _ensure_upload_size_allowed(db, len(chunk))
    chunk_dir = Path(settings.upload_root) / "chunks" / upload_id
    chunk_dir.mkdir(parents=True, exist_ok=True)
    chunk_path = chunk_dir / f"{chunk_index:08d}.part"
    chunk_path.write_bytes(chunk)
    received = sum(chunk_size(chunk_dir / f"{index:08d}.part") for index in range(record.total_chunks))
    if received > record.file_size:
        raise HTTPException(status_code=400, detail="已上传分片大小超过声明大小")
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


@app.get("/api/sca/projects/{project_id}/scan-completeness", response_model=ScanCompletenessOut, tags=["sca"])
async def scan_completeness(
    request: Request,
    project_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ScanCompletenessOut:
    await require_action("sca:read", request, user, settings)
    _ensure_project_exists(db, project_id)
    components = db.scalars(select(Component).where(Component.project_id == project_id)).all()
    modes = {component.scan_mode for component in components if component.scan_mode}
    has_standard_manifest = any(component.scan_mode in {"manifest_scan", "lockfile_scan", "mixed_scan"} and component.detected_by != "fallback" for component in components)
    fallback_enabled = any(component.detected_by == "fallback" for component in components)
    message = ""
    suggestions: list[str] = []
    if fallback_enabled or not has_standard_manifest:
        message = "当前项目未发现标准依赖清单文件，系统已通过二进制、目录、源码导入语句等方式进行兜底识别。识别结果可能不完整，建议上传完整源码、SBOM、lock 文件或运行环境镜像以提升准确率。"
        suggestions = [
            "pom.xml / build.gradle",
            "package.json / package-lock.json / yarn.lock / pnpm-lock.yaml",
            "requirements.txt / poetry.lock / Pipfile.lock",
            "go.mod / go.sum",
            "composer.lock",
            "Gemfile.lock",
            "SBOM 文件",
            "Docker 镜像 tar",
            "war / jar 包",
            "运行目录",
            "pip freeze 输出",
            "npm list 输出",
            "mvn dependency:tree 输出",
        ]
    return ScanCompletenessOut(
        project_id=project_id,
        has_standard_manifest=has_standard_manifest,
        scan_mode="mixed_scan" if len(modes) > 1 else (next(iter(modes)) if modes else "unknown"),
        component_count=len(components),
        high_confidence_count=sum(1 for component in components if component.confidence_level == "High"),
        medium_confidence_count=sum(1 for component in components if component.confidence_level in {"Medium", "Medium-High"}),
        low_confidence_count=sum(1 for component in components if component.confidence_level == "Low"),
        unknown_version_count=sum(1 for component in components if component.package_version == "unknown" or not component.version_detected),
        manual_confirm_count=sum(1 for component in components if component.need_manual_confirm or component.need_manual_version_confirm),
        fallback_enabled=fallback_enabled,
        message=message,
        suggestions=suggestions,
    )


@app.patch("/api/sca/components/{component_id}/manual-version", response_model=ComponentOut, tags=["sca"])
async def update_component_manual_version(
    request: Request,
    component_id: int,
    payload: ComponentManualVersionIn,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ComponentOut:
    await require_action("sca:write", request, user, settings)
    component = db.get(Component, component_id)
    if not component:
        raise HTTPException(status_code=404, detail="组件不存在")
    version = payload.version.strip()
    if not version:
        raise HTTPException(status_code=400, detail="版本号不能为空")
    component.package_version = version
    component.version_normalized = version
    component.resolved_version = version
    component.version_detected = True
    component.need_manual_version_confirm = False
    component.need_manual_confirm = False
    component.version_lock_status = "人工补录版本"
    component.version_risk_type = ""
    component.risk_explanation = "组件版本由人工补录，可重新执行漏洞匹配。"
    component.fix_recommendation = ""
    if payload.package_manager:
        component.package_manager = payload.package_manager
    if payload.purl:
        component.purl = payload.purl
    if payload.note:
        component.note = payload.note
    db.commit()
    db.refresh(component)
    return component


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


@app.post("/api/sca/scan-tasks/{scan_task_id}/rerun", response_model=ScanTaskOut, tags=["sca"])
async def rerun_scan_subtask(
    request: Request,
    scan_task_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ScanTaskOut:
    await require_action("sca:write", request, user, settings)
    task = db.get(ScanTask, scan_task_id)
    if not task:
        raise HTTPException(status_code=404, detail="扫描任务不存在")
    if task.parent_task_id is None:
        raise HTTPException(status_code=400, detail="主任务请通过重新上传或重新扫描触发")
    task.status = "pending"
    task.progress = 0
    task.error_message = ""
    task.summary = "已加入重新执行队列"
    task.started_at = None
    task.finished_at = None
    db.add(ScanLog(scan_task_id=task.parent_task_id, level="info", message=f"子任务已标记重新执行：{task.task_type}"))
    db.commit()
    db.refresh(task)
    return task


@app.get("/api/sca/projects/{project_id}/dependency-track", response_model=DependencyTrackStatusOut, tags=["sca"])
async def dependency_track_status(
    request: Request,
    project_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> DependencyTrackStatusOut:
    await require_action("sca:read", request, user, settings)
    _ensure_project_exists(db, project_id)
    row = db.scalar(select(DependencyTrackProject).where(DependencyTrackProject.local_project_id == project_id))
    if not row:
        return DependencyTrackStatusOut(local_project_id=project_id, last_status="not_linked")
    return row


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


def _ensure_project_exists(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


def _latest_source_root(db: Session, project_id: int) -> Path | None:
    record = db.scalar(
        select(UploadFileRecord)
        .where(UploadFileRecord.project_id == project_id, UploadFileRecord.status.in_(["scanned", "scanning", "completed"]))
        .order_by(UploadFileRecord.created_at.desc())
    )
    if not record:
        return None
    root = Path(settings.upload_root) / "extracted" / record.upload_id
    return root if root.exists() else None


@app.post("/api/sca/projects/{project_id}/vulnerabilities/query", response_model=VulnerabilityListOut, tags=["vulnerabilities"])
async def query_project_vulnerabilities(
    request: Request,
    project_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> VulnerabilityListOut:
    await require_action("sca:write", request, user, settings)
    _ensure_project_exists(db, project_id)
    components = db.scalars(select(Component).where(Component.project_id == project_id)).all()
    db.execute(delete(VulnerabilityRecord).where(VulnerabilityRecord.project_id == project_id))
    db.flush()
    for component in components:
        reachability = analyze_component_reachability(component, _latest_source_root(db, project_id))
        findings = query_component_vulnerabilities(component, settings)
        component.vulnerability_status = "vulnerable" if findings else "clean"
        for finding in findings:
            db.add(
                VulnerabilityRecord(
                    project_id=project_id,
                    component_id=component.id,
                    source=finding.source,
                    advisory_id=finding.advisory_id,
                    cve_id=finding.cve_id,
                    cwe_id=finding.cwe_id,
                    package_name=finding.package_name,
                    package_version=finding.package_version,
                    ecosystem=finding.ecosystem,
                    cvss_score=finding.cvss_score,
                    severity=finding.severity,
                    epss_score=finding.epss_score,
                    cisa_kev=finding.cisa_kev,
                    confidence_score=finding.confidence_score,
                    match_status=finding.match_status,
                    matched_by=finding.matched_by,
                    match_reason=finding.match_reason,
                    version_range=finding.version_range,
                    needs_human_review=finding.needs_human_review,
                    false_positive_possibility=finding.false_positive_possibility,
                    risk_priority=finding.risk_priority,
                    risk_score=finding.risk_score,
                    priority_reason=finding.priority_reason,
                    suggested_deadline=finding.suggested_deadline,
                    remediation_type=finding.remediation_type,
                    business_impact=finding.business_impact,
                    reachability_status=reachability.reachability_status,
                    reachability_evidence=reachability.reachability_evidence,
                    entry_points=reachability.entry_points,
                    related_files=reachability.related_files,
                    call_path_summary=reachability.call_path_summary,
                    description=finding.description,
                    fixed_version=finding.fixed_version,
                    published_at_text=finding.published_at,
                    has_poc=finding.has_poc,
                    exploited_in_wild=finding.exploited_in_wild,
                    detail_url=finding.detail_url,
                    raw_json="",
                )
            )
    db.commit()
    items = db.scalars(
        select(VulnerabilityRecord).where(VulnerabilityRecord.project_id == project_id).order_by(VulnerabilityRecord.risk_score.desc(), VulnerabilityRecord.cvss_score.desc())
    ).all()
    return VulnerabilityListOut(total=len(items), items=list(items))


@app.get("/api/sca/projects/{project_id}/vulnerabilities", response_model=VulnerabilityListOut, tags=["vulnerabilities"])
async def list_project_vulnerabilities(
    request: Request,
    project_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> VulnerabilityListOut:
    await require_action("sca:read", request, user, settings)
    _ensure_project_exists(db, project_id)
    items = db.scalars(
        select(VulnerabilityRecord).where(VulnerabilityRecord.project_id == project_id).order_by(VulnerabilityRecord.risk_score.desc(), VulnerabilityRecord.cvss_score.desc())
    ).all()
    return VulnerabilityListOut(total=len(items), items=list(items))


@app.post("/api/sca/vulnerabilities/cve", response_model=VulnerabilityListOut, tags=["vulnerabilities"])
async def query_cve_detail(
    request: Request,
    payload: CveQueryIn,
    user: Annotated[UserPayload, Depends(get_current_user)],
) -> VulnerabilityListOut:
    await require_action("sca:read", request, user, settings)
    findings = query_cve(payload.cve_id, settings)
    rows = [
        VulnerabilityOut(
            id=index,
            project_id=0,
            component_id=None,
            source=item.source,
            advisory_id=item.advisory_id,
            cve_id=item.cve_id,
            cwe_id=getattr(item, "cwe_id", ""),
            package_name=item.package_name,
            package_version=item.package_version,
            ecosystem=item.ecosystem,
            cvss_score=item.cvss_score,
            severity=item.severity,
            epss_score=item.epss_score,
            cisa_kev=item.cisa_kev,
            confidence_score=item.confidence_score,
            match_status=item.match_status,
            matched_by=item.matched_by,
            match_reason=item.match_reason,
            version_range=item.version_range,
            needs_human_review=item.needs_human_review,
            false_positive_possibility=item.false_positive_possibility,
            risk_priority=item.risk_priority,
            risk_score=item.risk_score,
            priority_reason=item.priority_reason,
            suggested_deadline=item.suggested_deadline,
            remediation_type=item.remediation_type,
            business_impact=item.business_impact,
            reachability_status=getattr(item, "reachability_status", "unknown"),
            reachability_evidence=getattr(item, "reachability_evidence", ""),
            entry_points=getattr(item, "entry_points", ""),
            related_files=getattr(item, "related_files", ""),
            call_path_summary=getattr(item, "call_path_summary", ""),
            description=item.description,
            fixed_version=item.fixed_version,
            published_at_text=item.published_at,
            has_poc=item.has_poc,
            exploited_in_wild=item.exploited_in_wild,
            detail_url=item.detail_url,
        )
        for index, item in enumerate(findings, start=1)
    ]
    return VulnerabilityListOut(total=len(rows), items=rows)


@app.get("/api/sca/projects/{project_id}/vulnerabilities/stats", response_model=VulnerabilityStatsOut, tags=["vulnerabilities"])
async def vulnerability_stats(
    request: Request,
    project_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> VulnerabilityStatsOut:
    await require_action("sca:read", request, user, settings)
    items = db.scalars(select(VulnerabilityRecord).where(VulnerabilityRecord.project_id == project_id)).all()
    confirmed_items = [item for item in items if item.match_status == "affected" and not item.needs_human_review]
    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "unknown": 0}
    for item in confirmed_items:
        counts[item.severity if item.severity in counts else "unknown"] += 1
    average_cvss = round(sum(item.cvss_score for item in confirmed_items) / len(confirmed_items), 2) if confirmed_items else 0
    return VulnerabilityStatsOut(
        total=len(items),
        by_severity=counts,
        poc_count=sum(1 for item in items if item.has_poc),
        exploited_count=sum(1 for item in items if item.exploited_in_wild),
        average_cvss=average_cvss,
    )


@app.get("/api/sca/projects/{project_id}/vulnerabilities/trend", response_model=VulnerabilityTrendOut, tags=["vulnerabilities"])
async def vulnerability_trend(
    request: Request,
    project_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> VulnerabilityTrendOut:
    await require_action("sca:read", request, user, settings)
    items = [
        item
        for item in db.scalars(select(VulnerabilityRecord).where(VulnerabilityRecord.project_id == project_id)).all()
        if item.match_status == "affected" and not item.needs_human_review
    ]
    buckets: dict[str, dict[str, int]] = {}
    for item in items:
        month = item.published_at_text[:7] if item.published_at_text else "unknown"
        bucket = buckets.setdefault(month, {"total": 0, "critical": 0, "high": 0, "medium": 0, "low": 0})
        bucket["total"] += 1
        if item.severity in bucket:
            bucket[item.severity] += 1
    return VulnerabilityTrendOut(items=[VulnerabilityTrendItem(month=month, **buckets[month]) for month in sorted(buckets)])


@app.post("/api/sca/projects/{project_id}/reports", response_model=ReportOut, tags=["reports"])
async def create_report(
    request: Request,
    project_id: int,
    payload: ReportCreateIn,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ReportOut:
    await require_action("sca:read", request, user, settings)
    _ensure_project_exists(db, project_id)
    try:
        path = generate_report(db, project_id, payload.format, settings.report_root, payload.metadata.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    report = ReportExport(
        project_id=project_id,
        format=payload.format,
        filename=path.name,
        storage_path=str(path),
        status="generated",
        created_by=user.username,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


@app.get("/api/sca/projects/{project_id}/reports", response_model=list[ReportOut], tags=["reports"])
async def list_reports(
    request: Request,
    project_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ReportOut]:
    await require_action("sca:read", request, user, settings)
    return list(db.scalars(select(ReportExport).where(ReportExport.project_id == project_id).order_by(ReportExport.created_at.desc())).all())


@app.get("/api/sca/reports/{report_id}/download", tags=["reports"])
async def download_report(
    request: Request,
    report_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> FileResponse:
    await require_action("sca:read", request, user, settings)
    report = db.get(ReportExport, report_id)
    if not report or not Path(report.storage_path).exists():
        raise HTTPException(status_code=404, detail="报告不存在")
    return FileResponse(report.storage_path, filename=report.filename)


@app.post("/api/sca/projects/{project_id}/sbom", response_model=SbomOut, tags=["sbom"])
async def create_sbom(
    request: Request,
    project_id: int,
    payload: SbomCreateIn,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> SbomOut:
    await require_action("sca:read", request, user, settings)
    _ensure_project_exists(db, project_id)
    try:
        path, component_count, source = generate_sbom(db, project_id, payload.format, settings)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    document = SbomDocument(
        project_id=project_id,
        format=payload.format,
        filename=path.name,
        storage_path=str(path),
        component_count=component_count,
        status="generated",
        source=source,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@app.get("/api/sca/projects/{project_id}/sbom", response_model=list[SbomOut], tags=["sbom"])
async def list_sbom_documents(
    request: Request,
    project_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[SbomOut]:
    await require_action("sca:read", request, user, settings)
    return list(db.scalars(select(SbomDocument).where(SbomDocument.project_id == project_id).order_by(SbomDocument.created_at.desc())).all())


@app.get("/api/sca/sbom/{sbom_id}/download", tags=["sbom"])
async def download_sbom(
    request: Request,
    sbom_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> FileResponse:
    await require_action("sca:read", request, user, settings)
    document = db.get(SbomDocument, sbom_id)
    if not document or not Path(document.storage_path).exists():
        raise HTTPException(status_code=404, detail="SBOM 不存在")
    return FileResponse(document.storage_path, filename=document.filename, media_type="application/json")


@app.post("/api/sca/image-scans", response_model=ImageScanOut, tags=["image-scan"])
async def create_image_scan(
    request: Request,
    payload: ImageScanCreateIn,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ImageScanOut:
    await require_action("sca:write", request, user, settings)
    if not payload.image_ref.strip():
        raise HTTPException(status_code=400, detail="请填写镜像名称")
    scan = ImageScan(image_ref=payload.image_ref.strip(), scanner=payload.scanner, status="running")
    db.add(scan)
    db.commit()
    db.refresh(scan)
    return scan_image(db, scan, settings)


@app.post("/api/sca/image-scans/tar", response_model=ImageScanOut, tags=["image-scan"])
async def upload_image_tar_scan(
    request: Request,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: Annotated[UploadFile, File()],
    scanner: Annotated[str, Form()] = "trivy",
) -> ImageScanOut:
    await require_action("sca:write", request, user, settings)
    if scanner not in {"trivy", "grype"}:
        raise HTTPException(status_code=400, detail="仅支持 trivy 或 grype")
    output_dir = Path(settings.sbom_root) / "images"
    output_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}-{file.filename or 'image.tar'}"
    path = output_dir / filename
    size = await save_upload_file(file, path)
    scan = ImageScan(image_ref=file.filename or "", tar_path=str(path), scanner=scanner, status="running", summary=f"已上传镜像 tar：{size} bytes")
    db.add(scan)
    db.commit()
    db.refresh(scan)
    return scan_image(db, scan, settings)


@app.get("/api/sca/image-scans", response_model=list[ImageScanOut], tags=["image-scan"])
async def list_image_scans(
    request: Request,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ImageScanOut]:
    await require_action("sca:read", request, user, settings)
    return list(db.scalars(select(ImageScan).order_by(ImageScan.created_at.desc()).limit(50)).all())


@app.get("/api/sca/image-scans/{scan_id}/findings", response_model=list[ImageScanFindingOut], tags=["image-scan"])
async def list_image_scan_findings(
    request: Request,
    scan_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ImageScanFindingOut]:
    await require_action("sca:read", request, user, settings)
    return list(db.scalars(select(ImageScanFinding).where(ImageScanFinding.image_scan_id == scan_id)).all())


@app.post("/api/sca/projects/{project_id}/risk-monitor/run", response_model=RiskMonitorRunOut, tags=["risk-monitor"])
async def run_project_risk_monitor(
    request: Request,
    project_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> RiskMonitorRunOut:
    await require_action("sca:write", request, user, settings)
    _ensure_project_exists(db, project_id)
    run = RiskMonitorRun(status="running", summary="手动持续风险监测执行中")
    db.add(run)
    db.flush()
    components = list(db.scalars(select(Component).where(Component.project_id == project_id)))
    updated = 0
    for component in components:
        data = monitor_component_update(component, settings)
        vulnerability_count = db.scalar(select(func.count(VulnerabilityRecord.id)).where(VulnerabilityRecord.component_id == component.id)) or 0
        risk_level = snapshot_risk_level(bool(data["update_available"]), str(data["version_delta"]), str(data["eol_status"]), vulnerability_count)
        snapshot = RiskMonitorSnapshot(
            project_id=project_id,
            component_id=component.id,
            component_name=component.package_name,
            current_version=component.package_version,
            latest_version=str(data["latest_version"]),
            latest_source=str(data["latest_source"]),
            update_available=bool(data["update_available"]),
            version_delta=str(data["version_delta"]),
            current_version_published_at=str(data.get("current_version_published_at") or ""),
            component_age_years=float(data.get("component_age_years") or 0),
            eol_status=str(data["eol_status"]),
            eol_date=str(data["eol_date"]),
            vulnerability_count=vulnerability_count,
            risk_level=risk_level,
            recommendation=str(data["recommendation"]),
            raw_json=raw_json(data.get("raw") or {}),
        )
        db.add(snapshot)
        if snapshot.update_available:
            updated += 1
            db.add(
                RiskChangeRecord(
                    project_id=project_id,
                    component_id=component.id,
                    change_type="version_update",
                    before_value=component.package_version,
                    after_value=snapshot.latest_version,
                    message=snapshot.recommendation,
                )
            )
            db.add(
                RiskAlert(
                    project_id=project_id,
                    component_id=component.id,
                    level=risk_level if risk_level in {"high", "medium", "low"} else "medium",
                    title=f"{component.package_name} 存在版本更新",
                    message=snapshot.recommendation,
                    notification_channel="email" if settings.notification_email_enabled else "",
                    email_to=settings.notification_email_to,
                )
            )
    run.status = "success"
    run.checked_projects = 1
    run.updated_components = updated
    run.summary = f"已监测组件 {len(components)} 个，发现更新 {updated} 个"
    run.finished_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(run)
    return run


@app.get("/api/sca/projects/{project_id}/risk-monitor/snapshots", response_model=list[RiskMonitorSnapshotOut], tags=["risk-monitor"])
async def list_risk_snapshots(
    request: Request,
    project_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[RiskMonitorSnapshotOut]:
    await require_action("sca:read", request, user, settings)
    return list(db.scalars(select(RiskMonitorSnapshot).where(RiskMonitorSnapshot.project_id == project_id).order_by(RiskMonitorSnapshot.checked_at.desc())).all())


@app.get("/api/sca/projects/{project_id}/risk-monitor/alerts", response_model=list[RiskAlertOut], tags=["risk-monitor"])
async def list_risk_alerts(
    request: Request,
    project_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[RiskAlertOut]:
    await require_action("sca:read", request, user, settings)
    return list(db.scalars(select(RiskAlert).where(RiskAlert.project_id == project_id).order_by(RiskAlert.created_at.desc())).all())


@app.get("/api/sca/projects/{project_id}/risk-monitor/changes", response_model=list[RiskChangeOut], tags=["risk-monitor"])
async def list_risk_changes(
    request: Request,
    project_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[RiskChangeOut]:
    await require_action("sca:read", request, user, settings)
    return list(db.scalars(select(RiskChangeRecord).where(RiskChangeRecord.project_id == project_id).order_by(RiskChangeRecord.created_at.desc())).all())


@app.get("/api/sca/projects/{project_id}/risk-monitor/trend", response_model=RiskTrendOut, tags=["risk-monitor"])
async def risk_monitor_trend(
    request: Request,
    project_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> RiskTrendOut:
    await require_action("sca:read", request, user, settings)
    alerts = db.scalars(select(RiskAlert).where(RiskAlert.project_id == project_id)).all()
    buckets: dict[str, dict[str, int]] = {}
    for alert in alerts:
        day = alert.created_at.strftime("%Y-%m-%d")
        bucket = buckets.setdefault(day, {"total": 0, "critical": 0, "high": 0, "medium": 0, "low": 0})
        bucket["total"] += 1
        if alert.level in bucket:
            bucket[alert.level] += 1
    return RiskTrendOut(items=[RiskTrendItem(day=day, **buckets[day]) for day in sorted(buckets)])


@app.post("/api/sca/projects/{project_id}/ai-triage/analyze", response_model=list[AiTriageOut], tags=["ai-triage"])
async def analyze_ai_triage(
    request: Request,
    project_id: int,
    payload: AiTriageAnalyzeIn,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[AiTriageOut]:
    await require_action("sca:write", request, user, settings)
    _ensure_project_exists(db, project_id)
    vulnerabilities = list(
        db.scalars(
            select(VulnerabilityRecord).where(
                VulnerabilityRecord.project_id == project_id,
                VulnerabilityRecord.id.in_(payload.vulnerability_ids),
            )
        )
    )
    context = payload.context.model_dump()
    effective_settings = _effective_ai_settings(db)
    rows: list[AiTriageResult] = []
    missing: list[VulnerabilityRecord] = []
    for vulnerability in vulnerabilities:
        cached = cached_ai_result(db, project_id, vulnerability, context)
        cache_matches_ai_runtime = (
            not effective_settings.openai_api_key
            or (cached and cached.model == effective_settings.openai_model and cached.model != "local-heuristic")
        )
        if cached and cache_matches_ai_runtime:
            rows.append(cached)
        else:
            missing.append(vulnerability)
    analyzed = analyze_vulnerabilities_with_ai(missing, context, effective_settings) if missing else []
    for item in analyzed:
        usage = item.get("token_usage") or {}
        row = AiTriageResult(
            project_id=project_id,
            vulnerability_id=int(item["vulnerability_id"]),
            ai_risk_level=str(item["ai_risk_level"]),
            noise_reason=str(item["noise_reason"]),
            immediate_fix=bool(item["immediate_fix"]),
            suspected_false_positive=bool(item["suspected_false_positive"]),
            remediation=str(item["remediation"]),
            fix_deadline=str(item["fix_deadline"]),
            risk_explanation=str(item["risk_explanation"]),
            priority_score=float(item["priority_score"]),
            exposure_context=json.dumps(context, ensure_ascii=False),
            token_prompt=int(usage.get("prompt_tokens") or 0),
            token_completion=int(usage.get("completion_tokens") or 0),
            token_total=int(usage.get("total_tokens") or 0),
            model=str(item.get("model") or effective_settings.openai_model),
            ai_schema_version=str(item.get("ai_schema_version") or "ai-triage-v2"),
            input_hash=str(item.get("input_hash") or ""),
            ai_priority=str(item.get("ai_priority") or item["ai_risk_level"]),
            confidence=float(item.get("confidence") or 0),
            is_likely_false_positive=bool(item.get("is_likely_false_positive")),
            reason=str(item.get("reason") or item["noise_reason"]),
            evidence_summary=str(item.get("evidence_summary") or item["risk_explanation"]),
            business_impact=str(item.get("business_impact") or ""),
            fix_advice=str(item.get("fix_advice") or item["remediation"]),
            temporary_mitigation=str(item.get("temporary_mitigation") or ""),
            need_manual_review=bool(item.get("need_manual_review")),
            manual_review_reason=str(item.get("manual_review_reason") or ""),
            raw_json=json.dumps(item.get("raw") or {}, ensure_ascii=False),
        )
        db.add(row)
        rows.append(row)
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows


@app.get("/api/sca/ai-triage/meta", response_model=AiTriageMetaOut, tags=["ai-triage"])
async def ai_triage_meta(
    request: Request,
    user: Annotated[UserPayload, Depends(get_current_user)],
) -> AiTriageMetaOut:
    await require_action("sca:read", request, user, settings)
    return AiTriageMetaOut(
        schema_version=AI_SCHEMA_VERSION,
        prompt_template=AI_TRIAGE_PROMPT_TEMPLATE,
        json_schema=AI_TRIAGE_JSON_SCHEMA,
        supported_priorities=["P0", "P1", "P2", "P3", "Review", "Ignore"],
        redaction_keys=sorted(SENSITIVE_KEYS),
    )


@app.get("/api/sca/projects/{project_id}/ai-triage/results", response_model=list[AiTriageOut], tags=["ai-triage"])
async def list_ai_triage_results(
    request: Request,
    project_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[AiTriageOut]:
    await require_action("sca:read", request, user, settings)
    return list(db.scalars(select(AiTriageResult).where(AiTriageResult.project_id == project_id).order_by(AiTriageResult.priority_score.desc())).all())


@app.post("/api/sca/ai-triage/{result_id}/confirm", response_model=AiTriageOut, tags=["ai-triage"])
async def confirm_ai_triage_result(
    request: Request,
    result_id: int,
    payload: AiTriageConfirmIn,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AiTriageOut:
    await require_action("sca:write", request, user, settings)
    row = db.get(AiTriageResult, result_id)
    if not row:
        raise HTTPException(status_code=404, detail="AI 降噪结果不存在")
    row.human_status = payload.human_status
    row.confirmed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return row


@app.post("/api/sca/remediation/overdue/check", tags=["remediation"])
async def check_remediation_overdue_api(
    request: Request,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, int | str]:
    await require_action("sca:write", request, user, settings)
    result = mark_overdue_tickets(db, settings.notification_email_enabled, settings.notification_email_to)
    db.commit()
    return result


@app.get("/api/sca/assets/dashboard", response_model=AssetDashboardOut, tags=["assets"])
async def assets_dashboard(
    request: Request,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AssetDashboardOut:
    await require_action("sca:read", request, user, settings)
    return AssetDashboardOut(**asset_dashboard(db))


@app.get("/api/sca/assets/components", response_model=AssetComponentListOut, tags=["assets"])
async def list_asset_components(
    request: Request,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    search: str = "",
) -> AssetComponentListOut:
    await require_action("sca:read", request, user, settings)
    items = asset_components(db, search)
    return AssetComponentListOut(total=len(items), items=items)


@app.get("/api/sca/assets/graph", response_model=AssetGraphOut, tags=["assets"])
async def assets_graph(
    request: Request,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AssetGraphOut:
    await require_action("sca:read", request, user, settings)
    return AssetGraphOut(**asset_graph(db))


@app.post("/api/sca/projects/{project_id}/remediation/tickets", response_model=RemediationTicketOut, tags=["remediation"])
async def create_remediation_ticket(
    request: Request,
    project_id: int,
    payload: RemediationTicketCreateIn,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> RemediationTicketOut:
    await require_action("sca:write", request, user, settings)
    _ensure_project_exists(db, project_id)
    vulnerability = db.get(VulnerabilityRecord, payload.vulnerability_id)
    if not vulnerability or vulnerability.project_id != project_id:
        raise HTTPException(status_code=404, detail="漏洞不存在")
    ticket = RemediationTicket(
        project_id=project_id,
        vulnerability_id=vulnerability.id,
        ticket_no=create_ticket_no(project_id, vulnerability.id),
        assignee=payload.assignee,
        priority=payload.priority,
        due_date=payload.due_date,
        fix_version=payload.fix_version or vulnerability.fixed_version,
        created_by=user.username,
    )
    db.add(ticket)
    db.flush()
    db.add(RemediationEvent(ticket_id=ticket.id, from_status="", to_status=ticket.status, actor=user.username, comment="创建整改工单"))
    db.commit()
    db.refresh(ticket)
    return ticket


@app.get("/api/sca/projects/{project_id}/remediation/tickets", response_model=RemediationTicketListOut, tags=["remediation"])
async def list_remediation_tickets(
    request: Request,
    project_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> RemediationTicketListOut:
    await require_action("sca:read", request, user, settings)
    items = list(db.scalars(select(RemediationTicket).where(RemediationTicket.project_id == project_id).order_by(RemediationTicket.created_at.desc())))
    return RemediationTicketListOut(total=len(items), items=items)


@app.post("/api/sca/remediation/tickets/{ticket_id}/transition", response_model=RemediationTicketOut, tags=["remediation"])
async def transition_remediation_ticket(
    request: Request,
    ticket_id: int,
    payload: RemediationTransitionIn,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> RemediationTicketOut:
    await require_action("sca:write", request, user, settings)
    ticket = db.get(RemediationTicket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="整改工单不存在")
    try:
        transition_ticket(db, ticket, payload.status, user.username, payload.comment)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    db.refresh(ticket)
    return ticket


@app.post("/api/sca/remediation/tickets/{ticket_id}/verify", response_model=RemediationTicketOut, tags=["remediation"])
async def verify_remediation_ticket(
    request: Request,
    ticket_id: int,
    payload: RemediationVerifyIn,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> RemediationTicketOut:
    await require_action("sca:write", request, user, settings)
    ticket = db.get(RemediationTicket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="整改工单不存在")
    try:
        verify_ticket(db, ticket, payload.verification_result, user.username, payload.comment)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    db.refresh(ticket)
    return ticket


@app.get("/api/sca/remediation/tickets/{ticket_id}/events", response_model=list[RemediationEventOut], tags=["remediation"])
async def list_remediation_events(
    request: Request,
    ticket_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[RemediationEventOut]:
    await require_action("sca:read", request, user, settings)
    return list(db.scalars(select(RemediationEvent).where(RemediationEvent.ticket_id == ticket_id).order_by(RemediationEvent.created_at.asc())))


@app.post("/api/sca/projects/{project_id}/remediation/whitelist", response_model=WhitelistOut, tags=["remediation"])
async def create_vulnerability_whitelist(
    request: Request,
    project_id: int,
    payload: WhitelistCreateIn,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> WhitelistOut:
    await require_action("sca:write", request, user, settings)
    vulnerability = db.get(VulnerabilityRecord, payload.vulnerability_id)
    if not vulnerability or vulnerability.project_id != project_id:
        raise HTTPException(status_code=404, detail="漏洞不存在")
    row = ignore_vulnerability(db, vulnerability, payload.reason, payload.expires_at, user.username)
    db.commit()
    db.refresh(row)
    return row


@app.get("/api/sca/projects/{project_id}/remediation/whitelist", response_model=list[WhitelistOut], tags=["remediation"])
async def list_vulnerability_whitelist(
    request: Request,
    project_id: int,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[WhitelistOut]:
    await require_action("sca:read", request, user, settings)
    return list(db.scalars(select(VulnerabilityWhitelist).where(VulnerabilityWhitelist.project_id == project_id).order_by(VulnerabilityWhitelist.created_at.desc())))


@app.post("/api/sca/devops/webhooks/gitlab", response_model=DevopsEventOut, tags=["devsecops"])
async def gitlab_webhook(
    request: Request,
    payload: DevopsWebhookIn,
    db: Annotated[Session, Depends(get_db)],
) -> DevopsEventOut:
    event = record_devops_event(db, {**payload.model_dump(), "source": "gitlab"}, settings)
    db.commit()
    db.refresh(event)
    return event


@app.post("/api/sca/devops/webhooks/github", response_model=DevopsEventOut, tags=["devsecops"])
async def github_actions_webhook(
    request: Request,
    payload: DevopsWebhookIn,
    db: Annotated[Session, Depends(get_db)],
) -> DevopsEventOut:
    event = record_devops_event(db, {**payload.model_dump(), "source": "github-actions"}, settings)
    db.commit()
    db.refresh(event)
    return event


@app.post("/api/sca/devops/webhooks/jenkins", response_model=DevopsEventOut, tags=["devsecops"])
async def jenkins_webhook(
    request: Request,
    payload: DevopsWebhookIn,
    db: Annotated[Session, Depends(get_db)],
) -> DevopsEventOut:
    event = record_devops_event(db, {**payload.model_dump(), "source": "jenkins"}, settings)
    db.commit()
    db.refresh(event)
    return event


@app.get("/api/sca/devops/events", response_model=DevopsEventListOut, tags=["devsecops"])
async def list_devops_events(
    request: Request,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> DevopsEventListOut:
    await require_action("sca:read", request, user, settings)
    items = list(db.scalars(select(DevopsScanEvent).order_by(DevopsScanEvent.created_at.desc()).limit(100)))
    return DevopsEventListOut(total=len(items), items=items)


@app.get("/api/sca/devops/dashboard", response_model=DevopsDashboardOut, tags=["devsecops"])
async def devops_dashboard_api(
    request: Request,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> DevopsDashboardOut:
    await require_action("sca:read", request, user, settings)
    return DevopsDashboardOut(**devops_dashboard(list(db.scalars(select(DevopsScanEvent)))))


@app.get("/api/sca/ops/config", response_model=OpsConfigOut, tags=["ops"])
async def ops_config(
    request: Request,
    user: Annotated[UserPayload, Depends(get_current_user)],
) -> OpsConfigOut:
    await require_action("sca:read", request, user, settings)
    return OpsConfigOut(**production_config(settings))


@app.post("/api/sca/ops/backups", response_model=BackupJobOut, tags=["ops"])
async def create_backup_job(
    request: Request,
    payload: BackupCreateIn,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> BackupJobOut:
    await require_action("sca:write", request, user, settings)
    job = BackupJob(
        scope=payload.scope,
        target=payload.target,
        status="planned",
        storage_path=plan_backup_path(settings, payload.scope),
        summary="已创建备份计划，生产环境由定时脚本执行 pg_dump 与 volume 归档",
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


@app.get("/api/sca/ops/backups", response_model=BackupJobListOut, tags=["ops"])
async def list_backup_jobs(
    request: Request,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> BackupJobListOut:
    await require_action("sca:read", request, user, settings)
    items = list(db.scalars(select(BackupJob).order_by(BackupJob.created_at.desc()).limit(50)))
    return BackupJobListOut(total=len(items), items=items)
