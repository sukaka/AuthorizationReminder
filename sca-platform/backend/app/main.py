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
    ImageScan,
    ImageScanFinding,
    Project,
    RiskAlert,
    RiskChangeRecord,
    RiskMonitorRun,
    RiskMonitorSnapshot,
    ReportExport,
    SbomDocument,
    ScanLog,
    ScanTask,
    UploadFileRecord,
    VulnerabilityRecord,
)
from .schemas import (
    AiTriageAnalyzeIn,
    AiTriageConfirmIn,
    AiTriageOut,
    AssetComponentListOut,
    AssetDashboardOut,
    AssetGraphOut,
    CveQueryIn,
    ComponentOut,
    DependencyTreeNode,
    ImageScanCreateIn,
    ImageScanFindingOut,
    ImageScanOut,
    OverviewOut,
    ProjectListItem,
    RiskAlertOut,
    RiskChangeOut,
    RiskMonitorRunOut,
    RiskMonitorSnapshotOut,
    RiskTrendItem,
    RiskTrendOut,
    ReportCreateIn,
    ReportOut,
    ScanLogOut,
    ScanTaskOut,
    SbomCreateIn,
    SbomOut,
    UploadFileOut,
    UploadListOut,
    UploadSessionCreate,
    UserPayload,
    VulnerabilityListOut,
    VulnerabilityOut,
    VulnerabilityStatsOut,
    VulnerabilityTrendItem,
    VulnerabilityTrendOut,
)
from .ai_triage_service import analyze_vulnerabilities_with_ai
from .asset_service import asset_components, asset_dashboard, asset_graph
from .report_service import generate_report
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


def _ensure_project_exists(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


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
                    package_name=finding.package_name,
                    package_version=finding.package_version,
                    ecosystem=finding.ecosystem,
                    cvss_score=finding.cvss_score,
                    severity=finding.severity,
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
        select(VulnerabilityRecord).where(VulnerabilityRecord.project_id == project_id).order_by(VulnerabilityRecord.cvss_score.desc())
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
        select(VulnerabilityRecord).where(VulnerabilityRecord.project_id == project_id).order_by(VulnerabilityRecord.cvss_score.desc())
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
            package_name=item.package_name,
            package_version=item.package_version,
            ecosystem=item.ecosystem,
            cvss_score=item.cvss_score,
            severity=item.severity,
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
    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "unknown": 0}
    for item in items:
        counts[item.severity if item.severity in counts else "unknown"] += 1
    average_cvss = round(sum(item.cvss_score for item in items) / len(items), 2) if items else 0
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
    items = db.scalars(select(VulnerabilityRecord).where(VulnerabilityRecord.project_id == project_id)).all()
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
        path = generate_report(db, project_id, payload.format, settings.report_root)
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
    size = await save_upload_file(file, path, settings.upload_max_bytes * 10)
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
    analyzed = analyze_vulnerabilities_with_ai(vulnerabilities, context, settings)
    rows: list[AiTriageResult] = []
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
            model=str(item.get("model") or settings.openai_model),
            raw_json=json.dumps(item.get("raw") or {}, ensure_ascii=False),
        )
        db.add(row)
        rows.append(row)
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows


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
