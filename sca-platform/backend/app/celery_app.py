import shutil
import tarfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from celery import Celery
from sqlalchemy import delete

from .config import get_settings
from .database import SessionLocal, init_db
from .dependency_parser import parse_source_dependencies
from .license_enrichment_service import enrich_missing_component_licenses
from .reachability_service import analyze_component_reachability
from .models import (
    Component,
    ComponentDependency,
    DependencyTrackProject,
    RawScanArtifact,
    RiskAlert,
    RiskChangeRecord,
    RiskMonitorRun,
    RiskMonitorSnapshot,
    ScanLog,
    ScanTask,
    ScannerTaskResult,
    SystemSetting,
    UploadFileRecord,
    VulnerabilityRecord,
)
from .risk_monitor_service import monitor_component_update, raw_json, snapshot_risk_level
from .scanners import opensca_client, syft_client, trivy_client
from .scanners.base import ScannerCommandResult, command_to_log_line, file_sha256
from .scanners.dependency_track_client import DependencyTrackClient
from .vulnerability_service import query_component_vulnerabilities, vulnerability_source_status

settings = get_settings()

UNKNOWN_VERSION_VALUES = {"", "unknown", "none", "null", "n/a", "na", "未声明", "未知"}
SYSTEM_CONFIG_DEPENDENCY_TRACK_URL = "dependency_track_url"
SYSTEM_CONFIG_DEPENDENCY_TRACK_API_KEY = "dependency_track_api_key"

celery_app = Celery(
    "juxin_sca",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)
celery_app.conf.broker_connection_retry_on_startup = True
celery_app.conf.task_always_eager = settings.celery_task_always_eager
celery_app.conf.task_routes = {
    "sca.scan_uploaded_file": {"queue": "scanner"},
    "sca.query_project_vulnerabilities": {"queue": "scanner"},
    "sca.enrich_project_licenses": {"queue": "scanner"},
}
celery_app.conf.beat_schedule = {
    "sca-risk-monitor": {
        "task": "sca.monitor_risks",
        "schedule": settings.risk_monitor_interval_seconds,
    },
    "sca-remediation-overdue": {
        "task": "sca.check_remediation_overdue",
        "schedule": settings.remediation_overdue_check_seconds,
    }
}


def _safe_target(root: Path, member_name: str) -> Path:
    target = root / member_name
    resolved_root = root.resolve()
    resolved_target = target.resolve()
    if resolved_root != resolved_target and resolved_root not in resolved_target.parents:
        raise ValueError(f"压缩包包含不安全路径: {member_name}")
    return target


def _extract_archive(archive: Path, destination: Path) -> None:
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True, exist_ok=True)
    lower = archive.name.lower()
    if lower.endswith(".zip"):
        with zipfile.ZipFile(archive) as zipped:
            for member in zipped.infolist():
                _safe_target(destination, member.filename)
            zipped.extractall(destination)
        return
    if lower.endswith(".tar.gz") or lower.endswith(".tgz"):
        with tarfile.open(archive, "r:gz") as tar:
            for member in tar.getmembers():
                _safe_target(destination, member.name)
            tar.extractall(destination)
        return
    raise ValueError("仅支持 zip、tar.gz、tgz 源码包")


PROJECT_SCAN_STEPS = [
    ("prepare_source_task", "source", 15),
    ("opensca_scan_task", "opensca", settings.opensca_timeout),
    ("syft_sbom_task", "syft", settings.syft_timeout),
    ("trivy_scan_task", "trivy", settings.trivy_timeout),
    ("dependency_track_upload_task", "dependency-track", settings.dependency_track_timeout),
    ("dependency_track_fetch_task", "dependency-track", settings.dependency_track_timeout),
    ("normalize_results_task", "juxin-normalizer", 600),
    ("merge_components_task", "juxin-merger", 600),
    ("license_enrichment_task", "juxin-license", settings.license_enrichment_timeout_ms // 1000),
    ("merge_vulnerabilities_task", "juxin-merger", 600),
    ("ai_noise_reduction_task", "juxin-ai", settings.openai_timeout_ms // 1000),
    ("report_generate_task", "juxin-report", 600),
]


def _ensure_child_scan_tasks(db, task: ScanTask) -> None:
    existing = {
        row.task_type
        for row in db.query(ScanTask).filter(ScanTask.parent_task_id == task.id).all()
    }
    for task_type, engine_name, timeout in PROJECT_SCAN_STEPS:
        if task_type in existing:
            continue
        db.add(
            ScanTask(
                project_id=task.project_id,
                upload_file_id=task.upload_file_id,
                parent_task_id=task.id,
                task_type=task_type,
                engine_name=engine_name,
                status="pending",
                progress=0,
                summary="等待执行",
                timeout_seconds=timeout,
            )
        )


def _mark_child(db, parent_id: int, task_type: str, status: str, summary: str = "", progress: int = 100, error: str = "") -> None:
    child = db.query(ScanTask).filter(ScanTask.parent_task_id == parent_id, ScanTask.task_type == task_type).first()
    if not child:
        return
    child.status = status
    child.progress = progress
    child.summary = summary or child.summary
    child.error_message = error
    now = datetime.now(timezone.utc)
    if status == "running" and not child.started_at:
        child.started_at = now
    if status in {"completed", "failed", "timeout", "partial_completed", "skipped", "canceled"}:
        child.finished_at = now


def _child_task(db, parent_id: int, task_type: str) -> ScanTask | None:
    return db.query(ScanTask).filter(ScanTask.parent_task_id == parent_id, ScanTask.task_type == task_type).first()


def _mark_parent(db, task: ScanTask, status: str, progress: int, summary: str, error: str = "") -> None:
    task.status = status
    task.progress = max(0, min(100, progress))
    task.summary = summary
    task.error_message = error
    now = datetime.now(timezone.utc)
    if status == "running" and not task.started_at:
        task.started_at = now
    if status in {"success", "completed", "failed", "timeout", "partial_completed", "skipped", "canceled"}:
        task.finished_at = now


def _record_artifact(db, task: ScanTask, engine_name: str, artifact_type: str, path_text: str) -> None:
    if not path_text:
        return
    path = Path(path_text)
    if not path.exists() or not path.is_file():
        return
    db.add(
        RawScanArtifact(
            project_id=task.project_id,
            scan_id=task.id,
            engine_name=engine_name,
            artifact_type=artifact_type,
            file_path=str(path),
            file_name=path.name,
            file_size=path.stat().st_size,
            sha256=file_sha256(path),
        )
    )


def _record_scanner_result(
    db,
    parent_task: ScanTask,
    task_type: str,
    result: ScannerCommandResult,
    component_count: int = 0,
    vulnerability_count: int = 0,
    license_count: int = 0,
) -> None:
    child = _child_task(db, parent_task.id, task_type)
    if not child:
        return
    stored_error_message = (
        f"{result.error_type}: {result.error_message}"
        if result.error_type and result.error_message
        else result.error_message
    )
    child.raw_result_path = result.raw_result_path
    child.error_message = stored_error_message
    child.summary = stored_error_message or ("执行完成" if result.status == "completed" else result.status)
    child.status = result.status
    child.progress = 100
    child.finished_at = datetime.now(timezone.utc)
    html_report_path = next((item for item in result.report_files if item.endswith(".html")), "")
    sarif_report_path = next((item for item in result.report_files if item.endswith(".sarif")), "")
    db.add(
        ScannerTaskResult(
            project_id=parent_task.project_id,
            scan_id=parent_task.id,
            scan_task_id=child.id,
            engine_name=result.engine_name,
            status=result.status,
            component_count=component_count,
            vulnerability_count=vulnerability_count,
            license_count=license_count,
            raw_result_path=result.raw_result_path,
            normalized_result_path=sarif_report_path,
            html_report_path=html_report_path,
            stdout_log_path=result.stdout_log_path,
            stderr_log_path=result.stderr_log_path,
            error_message=stored_error_message,
            started_at=child.started_at,
            finished_at=child.finished_at,
        )
    )
    if result.command:
        db.add(ScanLog(scan_task_id=parent_task.id, level="info", message=f"{result.engine_name} 执行命令: {command_to_log_line(result.command)}"))
    if result.command_log_path:
        db.add(ScanLog(scan_task_id=parent_task.id, level="info", message=f"{result.engine_name} 命令日志: {result.command_log_path}"))
    if result.report_files:
        db.add(ScanLog(scan_task_id=parent_task.id, level="info", message=f"{result.engine_name} 报告文件: {', '.join(result.report_files)}"))
    for report_file in result.report_files:
        suffix = Path(report_file).suffix.lower()
        artifact_type = "html_report" if suffix == ".html" else "sarif_report" if suffix == ".sarif" else "raw_json"
        _record_artifact(db, parent_task, result.engine_name, artifact_type, report_file)
    if not result.report_files:
        _record_artifact(db, parent_task, result.engine_name, "raw_json", result.raw_result_path)
    _record_artifact(db, parent_task, result.engine_name, "stdout_log", result.stdout_log_path)
    _record_artifact(db, parent_task, result.engine_name, "stderr_log", result.stderr_log_path)


def _effective_dependency_track_settings(db):
    rows = db.query(SystemSetting).filter(
        SystemSetting.key.in_([SYSTEM_CONFIG_DEPENDENCY_TRACK_URL, SYSTEM_CONFIG_DEPENDENCY_TRACK_API_KEY])
    ).all()
    values = {row.key: str(row.value or "").strip() for row in rows}
    url = (values.get(SYSTEM_CONFIG_DEPENDENCY_TRACK_URL) or settings.dependency_track_url or "").rstrip("/")
    api_key = values.get(SYSTEM_CONFIG_DEPENDENCY_TRACK_API_KEY) or settings.dependency_track_api_key or ""
    return settings.model_copy(update={"dependency_track_url": url, "dependency_track_api_key": api_key.strip()})


def _run_scanner_children(db, task: ScanTask, extract_dir: Path) -> None:
    _mark_child(db, task.id, "opensca_scan_task", "running", "正在执行 OpenSCA 扫描", 20)
    _mark_parent(db, task, "running", 20, "正在执行 OpenSCA 扫描")
    db.commit()
    opensca_result = opensca_client.scan_source(extract_dir, Path(settings.opensca_output_dir) / str(task.id), settings)
    _record_scanner_result(db, task, "opensca_scan_task", opensca_result)
    db.add(ScanLog(scan_task_id=task.id, level="info", message=f"OpenSCA: {opensca_result.status} {opensca_result.error_message}".strip()))
    _mark_parent(db, task, "running", 40, "OpenSCA 扫描完成，正在生成 SBOM")
    db.commit()

    _mark_child(db, task.id, "syft_sbom_task", "running", "正在执行 Syft SBOM 生成", 20)
    _mark_parent(db, task, "running", 45, "正在执行 Syft SBOM 生成")
    db.commit()
    syft_results = syft_client.generate_sbom(str(extract_dir), Path(settings.syft_output_dir) / str(task.id), settings)
    syft_statuses = [item.status for item in syft_results]
    syft_result = next((item for item in syft_results if item.raw_result_path.endswith("cyclonedx.json")), syft_results[0])
    _record_scanner_result(db, task, "syft_sbom_task", syft_result)
    for item in syft_results[1:]:
        _record_artifact(db, task, item.engine_name, "spdx_bom" if "spdx" in item.raw_result_path else "raw_json", item.raw_result_path)
    db.add(ScanLog(scan_task_id=task.id, level="info", message=f"Syft: {','.join(syft_statuses)} {syft_result.error_message}".strip()))
    _mark_parent(db, task, "running", 60, "SBOM 生成完成，正在执行 Trivy 扫描")
    db.commit()

    _mark_child(db, task.id, "trivy_scan_task", "running", "正在执行 Trivy 文件系统扫描", 20)
    _mark_parent(db, task, "running", 65, "正在执行 Trivy 文件系统扫描")
    db.commit()
    trivy_result = trivy_client.scan_fs(extract_dir, Path(settings.trivy_output_dir) / str(task.id), settings)
    _record_scanner_result(db, task, "trivy_scan_task", trivy_result)
    db.add(ScanLog(scan_task_id=task.id, level="info", message=f"Trivy: {trivy_result.status} {trivy_result.error_message}".strip()))
    _mark_parent(db, task, "running", 75, "Trivy 扫描完成，正在处理 Dependency-Track")
    db.commit()

    dtrack_settings = _effective_dependency_track_settings(db)
    dtrack = DependencyTrackClient(dtrack_settings)
    if not dtrack.enabled():
        _mark_child(db, task.id, "dependency_track_upload_task", "skipped", "Dependency-Track 未配置 API Key", 100)
        _mark_child(db, task.id, "dependency_track_fetch_task", "skipped", "Dependency-Track 未配置 API Key", 100)
        _mark_parent(db, task, "running", 82, "Dependency-Track 未配置，正在标准化本地结果")
        db.commit()
        return
    bom_path = Path(syft_result.raw_result_path) if syft_result.raw_result_path else Path()
    if not bom_path.exists():
        _mark_child(db, task.id, "dependency_track_upload_task", "failed", "缺少 CycloneDX BOM，无法上传 Dependency-Track", 100, "缺少 CycloneDX BOM")
        _mark_child(db, task.id, "dependency_track_fetch_task", "skipped", "等待 BOM 上传成功后拉取", 100)
        _mark_parent(db, task, "running", 82, "缺少 BOM，跳过 Dependency-Track，正在标准化本地结果")
        db.commit()
        return
    try:
        _mark_child(db, task.id, "dependency_track_upload_task", "running", "正在上传 CycloneDX BOM", 40)
        _mark_parent(db, task, "running", 78, "正在上传 CycloneDX BOM")
        db.commit()
        project_name = task.project.name if task.project else f"project-{task.project_id}"
        project = dtrack.create_project(project_name, "latest")
        project_uuid = str(project.get("uuid") or "")
        dtrack.upload_bom(project_uuid, bom_path)
        row = db.query(DependencyTrackProject).filter(DependencyTrackProject.local_project_id == task.project_id).first()
        if not row:
            row = DependencyTrackProject(local_project_id=task.project_id)
            db.add(row)
        row.dependency_track_project_uuid = project_uuid
        row.dependency_track_project_name = project_name
        row.dependency_track_project_version = "latest"
        row.bom_uploaded_at = datetime.now(timezone.utc)
        row.last_status = "bom_uploaded"
        _mark_child(db, task.id, "dependency_track_upload_task", "completed", "BOM 已上传 Dependency-Track", 100)

        _mark_child(db, task.id, "dependency_track_fetch_task", "running", "正在拉取 Dependency-Track 指标", 40)
        _mark_parent(db, task, "running", 82, "正在拉取 Dependency-Track 指标")
        db.commit()
        metrics = dtrack.fetch_metrics(project_uuid)
        row.last_metrics_json = raw_json(metrics)
        row.last_fetch_at = datetime.now(timezone.utc)
        row.last_status = "fetched"
        _mark_child(db, task.id, "dependency_track_fetch_task", "completed", "Dependency-Track 指标已拉取", 100)
        _mark_parent(db, task, "running", 85, "Dependency-Track 处理完成，正在标准化本地结果")
        db.commit()
    except Exception as exc:
        message = str(exc)
        _mark_child(db, task.id, "dependency_track_upload_task", "failed", message, 100, message)
        _mark_child(db, task.id, "dependency_track_fetch_task", "skipped", "Dependency-Track 上传失败，跳过拉取", 100)
        db.add(ScanLog(scan_task_id=task.id, level="error", message=f"Dependency-Track: {message}"))
        _mark_parent(db, task, "running", 85, "Dependency-Track 失败，正在标准化本地结果")
        db.commit()


def _latest_source_root(db, project_id: int) -> Path | None:
    # 优先查找已扫描/扫描中的上传文件
    record = (
        db.query(UploadFileRecord)
        .filter(UploadFileRecord.project_id == project_id, UploadFileRecord.status.in_(["scanned", "scanning", "completed"]))
        .order_by(UploadFileRecord.created_at.desc())
        .first()
    )
    if record:
        root = Path(settings.upload_root) / "extracted" / record.upload_id
        if root.exists():
            return root
    # 回退：查找任何状态的上传文件（包括 uploading/uploaded）
    any_record = (
        db.query(UploadFileRecord)
        .filter(UploadFileRecord.project_id == project_id, UploadFileRecord.status.in_(["uploading", "uploaded", "processing"]))
        .order_by(UploadFileRecord.created_at.desc())
        .first()
    )
    if any_record:
        root = Path(settings.upload_root) / "extracted" / any_record.upload_id
        if root.exists():
            return root
    # 最后回退：扫描所有 extracted 目录查找匹配的项目文件
    extracted_root = Path(settings.upload_root) / "extracted"
    if extracted_root.exists():
        for child in sorted(extracted_root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            if child.is_dir():
                # 检查是否有任何源码文件
                for src_file in child.rglob("*"):
                    if src_file.is_file() and src_file.suffix.lower() in {".java", ".py", ".js", ".jsx", ".ts", ".tsx", ".vue", ".go", ".rb", ".php", ".cs", ".rs"}:
                        return child
    return None


def _is_unknown_version(value: object) -> bool:
    return str(value or "").strip().lower() in UNKNOWN_VERSION_VALUES


def _latest_monitor_snapshot(db, component: Component) -> RiskMonitorSnapshot | None:
    return (
        db.query(RiskMonitorSnapshot)
        .filter_by(project_id=component.project_id, component_id=component.id)
        .order_by(RiskMonitorSnapshot.checked_at.desc(), RiskMonitorSnapshot.id.desc())
        .first()
    )


def _snapshot_current_version(snapshot: RiskMonitorSnapshot | None) -> str:
    version = str(snapshot.current_version or "").strip() if snapshot else ""
    return "" if _is_unknown_version(version) else version


def _persist_inferred_monitor_snapshot(db, component: Component, data: dict[str, object]) -> str:
    version = str(data.get("current_version") or "").strip()
    if _is_unknown_version(version):
        return ""
    db.add(
        RiskMonitorSnapshot(
            project_id=component.project_id,
            component_id=component.id,
            component_name=component.package_name,
            current_version=version,
            latest_version=str(data.get("latest_version") or ""),
            latest_source=str(data.get("latest_source") or ""),
            update_available=bool(data.get("update_available")),
            version_delta=str(data.get("version_delta") or "unknown"),
            current_version_published_at=str(data.get("current_version_published_at") or ""),
            component_age_years=float(data.get("component_age_years") or 0),
            eol_status=str(data.get("eol_status") or "unknown"),
            eol_date=str(data.get("eol_date") or ""),
            vulnerability_count=db.query(VulnerabilityRecord).filter_by(component_id=component.id).count(),
            risk_level="review",
            recommendation=str(data.get("recommendation") or "未声明版本，按默认安装行为以最新版本作为当前推断版本。"),
            raw_json=raw_json(data.get("raw") or {}),
        )
    )
    return version


def _inferred_component_version(db, component: Component) -> str:
    if not (_is_unknown_version(component.package_version) or not component.version_detected):
        return ""
    snapshot_version = _snapshot_current_version(_latest_monitor_snapshot(db, component))
    if snapshot_version:
        return snapshot_version
    try:
        return _persist_inferred_monitor_snapshot(db, component, monitor_component_update(component, settings))
    except Exception:
        return ""


def _component_for_vulnerability_query(db, component: Component) -> Component:
    inferred_version = _inferred_component_version(db, component)
    if not inferred_version:
        return component
    purl = component.purl
    if purl and "@" in purl:
        purl = f"{purl.rsplit('@', 1)[0]}@{inferred_version}"
    return Component(
        id=component.id,
        project_id=component.project_id,
        package_name=component.package_name,
        package_version=inferred_version,
        normalized_name=component.normalized_name,
        package_manager=component.package_manager,
        purl=purl,
        cpe=component.cpe,
        group_id=component.group_id,
        artifact_id=component.artifact_id,
        version_normalized=inferred_version,
        ecosystem=component.ecosystem,
        scope=component.scope,
        dependency_type=component.dependency_type,
        source_path=component.source_path,
        source_file=component.source_file,
        evidence_level=component.evidence_level,
        evidence_file=component.evidence_file,
        evidence_text=component.evidence_text,
        detected_by=component.detected_by,
        confidence_score=component.confidence_score,
        version_conflict=component.version_conflict,
        conflict_reason=component.conflict_reason,
        scan_mode=component.scan_mode,
        detection_method=component.detection_method,
        evidence_type=component.evidence_type,
        confidence_level=component.confidence_level,
        need_manual_confirm=component.need_manual_confirm,
        version_detected=True,
        need_manual_version_confirm=component.need_manual_version_confirm,
        declared_version=component.declared_version,
        resolved_version=inferred_version,
        version_lock_status=component.version_lock_status,
        version_risk_type=component.version_risk_type,
        risk_explanation=component.risk_explanation,
        fix_recommendation=component.fix_recommendation,
        license_name=component.license_name,
    )


def _persist_vulnerability_findings(db, project_id: int, component: Component, source_root: Path | None) -> int:
    reachability = analyze_component_reachability(component, source_root)
    query_component = _component_for_vulnerability_query(db, component)
    findings = query_component_vulnerabilities(query_component, settings)
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
    return len(findings)


@celery_app.task(name="sca.demo_scan")
def demo_scan(project_name: str) -> dict[str, str]:
    return {"project": project_name, "status": "queued", "message": "软件成分分析任务已进入队列"}


@celery_app.task(name="sca.query_project_vulnerabilities")
def query_project_vulnerabilities_task(scan_task_id: int) -> dict[str, int | str]:
    init_db()
    with SessionLocal() as db:
        task = db.get(ScanTask, scan_task_id)
        if not task:
            return {"status": "missing", "vulnerabilities": 0}
        try:
            _mark_parent(db, task, "running", 5, "正在准备漏洞查询任务")
            db.add(ScanLog(scan_task_id=task.id, level="info", message="开始异步查询组件漏洞情报"))
            coverage = vulnerability_source_status(settings)
            db.add(
                ScanLog(
                    scan_task_id=task.id,
                    level="info",
                    message="漏洞源覆盖检查："
                    + "；".join(f"{item.label}={'已启用' if item.enabled else '未启用'}（{item.detail}）" for item in coverage),
                )
            )
            db.commit()

            components = db.query(Component).filter_by(project_id=task.project_id).order_by(Component.id.asc()).all()
            db.execute(delete(VulnerabilityRecord).where(VulnerabilityRecord.project_id == task.project_id))
            source_root = _latest_source_root(db, task.project_id)
            total_components = len(components)
            total_findings = 0
            if not components:
                _mark_parent(db, task, "success", 100, "项目暂无组件，漏洞查询已结束")
                db.commit()
                return {"status": "success", "vulnerabilities": 0}

            for index, component in enumerate(components, start=1):
                _mark_parent(
                    db,
                    task,
                    "running",
                    5 + int(index / total_components * 90),
                    f"正在查询漏洞情报：{index}/{total_components} {component.package_name}",
                )
                total_findings += _persist_vulnerability_findings(db, task.project_id, component, source_root)
                if index == 1 or index == total_components or index % 5 == 0:
                    db.commit()

            _mark_parent(db, task, "success", 100, f"漏洞查询完成：组件 {total_components} 个，漏洞 {total_findings} 条")
            db.add(ScanLog(scan_task_id=task.id, level="info", message=task.summary))
            db.commit()
            return {"status": "success", "vulnerabilities": total_findings, "components": total_components}
        except Exception as exc:
            message = str(exc)
            _mark_parent(db, task, "failed", 100, message, message)
            db.add(ScanLog(scan_task_id=task.id, level="error", message=f"漏洞查询失败：{message}"))
            db.commit()
            return {"status": "failed", "vulnerabilities": 0}


@celery_app.task(name="sca.scan_uploaded_file")
def scan_uploaded_file(scan_task_id: int) -> dict[str, int | str]:
    init_db()
    upload_root = Path(settings.upload_root)
    with SessionLocal() as db:
        task = db.get(ScanTask, scan_task_id)
        if not task:
            return {"status": "missing", "components": 0}
        record = db.get(UploadFileRecord, task.upload_file_id)
        if not record:
            task.status = "failed"
            task.summary = "上传文件不存在"
            db.commit()
            return {"status": "failed", "components": 0}

        task.task_type = task.task_type or "project_scan_task"
        _ensure_child_scan_tasks(db, task)
        _mark_parent(db, task, "running", 5, "开始解析源码依赖")
        _mark_child(db, task.id, "prepare_source_task", "running", "正在解压源码包", 30)
        record.status = "scanning"
        db.add(ScanLog(scan_task_id=task.id, level="info", message="开始解析源码依赖"))
        db.commit()

        try:
            extract_dir = upload_root / "extracted" / record.upload_id
            _extract_archive(Path(record.storage_path), extract_dir)
            _mark_child(db, task.id, "prepare_source_task", "completed", "源码准备完成", 100)
            _mark_parent(db, task, "running", 15, "源码准备完成")
            db.commit()
            _run_scanner_children(db, task, extract_dir)
            result = parse_source_dependencies(extract_dir)
            _mark_child(db, task.id, "normalize_results_task", "running", "正在标准化依赖识别结果", 50)
            _mark_parent(db, task, "running", 88, "正在标准化依赖识别结果")
            db.commit()

            db.execute(delete(ComponentDependency).where(ComponentDependency.project_id == record.project_id))
            db.execute(delete(Component).where(Component.project_id == record.project_id))
            db.flush()

            by_key: dict[str, Component] = {}
            for item in result.components:
                component = Component(
                    project_id=record.project_id,
                    package_name=item.name,
                    package_version=item.version,
                    normalized_name=item.normalized_name,
                    package_manager=item.package_manager,
                    purl=item.purl,
                    cpe=item.cpe,
                    group_id=item.group_id,
                    artifact_id=item.artifact_id,
                    version_normalized=item.version_normalized,
                    ecosystem=item.ecosystem,
                    scope=item.scope,
                    dependency_type=item.dependency_type,
                    source_path=item.source_path,
                    source_file=item.source_file,
                    evidence_level=item.evidence_level,
                    evidence_file=item.evidence_file,
                    evidence_line=item.evidence_line,
                    evidence_text=item.evidence_text,
                    detected_by=item.detected_by,
                    confidence_score=item.confidence_score,
                    version_conflict=item.version_conflict,
                    conflict_reason=item.conflict_reason,
                    scan_mode=item.scan_mode,
                    detection_method=item.detection_method,
                    evidence_type=item.evidence_type,
                    confidence_level=item.confidence_level,
                    need_manual_confirm=item.need_manual_confirm,
                    version_detected=item.version_detected,
                    need_manual_version_confirm=item.need_manual_version_confirm,
                    declared_version=item.declared_version,
                    resolved_version=item.resolved_version,
                    version_lock_status=item.version_lock_status,
                    version_risk_type=item.version_risk_type,
                    risk_explanation=item.risk_explanation,
                    fix_recommendation=item.fix_recommendation,
                    sha1=item.sha1,
                    sha256=item.sha256,
                    component_file_size=item.file_size,
                    component_file_path=item.file_path,
                    component_file_name=item.file_name,
                    license_name=item.license_name or "未声明",
                    license_raw=item.license_raw,
                    license_source=item.license_source,
                    license_confidence=item.license_confidence,
                    license_needs_review=item.license_needs_review,
                    vulnerability_status="pending",
                    note=record.scan_note,
                )
                db.add(component)
                db.flush()
                by_key[item.key] = component

            for dep in result.dependencies:
                child = by_key.get(dep.child_key)
                if not child:
                    continue
                parent = by_key.get(dep.parent_key) if dep.parent_key else None
                db.add(
                    ComponentDependency(
                        project_id=record.project_id,
                        parent_component_id=parent.id if parent else None,
                        child_component_id=child.id,
                        relationship_type=dep.relationship_type,
                    )
                )

            for message in result.logs:
                db.add(ScanLog(scan_task_id=task.id, level="info", message=message))
            _mark_child(db, task.id, "normalize_results_task", "completed", "标准化完成", 100)
            _mark_parent(db, task, "running", 93, "标准化完成，正在合并组件")
            _mark_child(db, task.id, "merge_components_task", "completed", "组件合并完成", 100)
            _mark_parent(db, task, "running", 96, "组件合并完成")
            if settings.celery_task_always_eager:
                _mark_child(db, task.id, "license_enrichment_task", "skipped", "同步测试模式下跳过异步许可证补全", 100)
            else:
                _mark_child(db, task.id, "license_enrichment_task", "pending", "等待自动匹配许可协议", 0)
            _mark_child(db, task.id, "merge_vulnerabilities_task", "skipped", "等待漏洞查询后合并", 100)
            for task_type in [
                "ai_noise_reduction_task",
                "report_generate_task",
            ]:
                _mark_child(db, task.id, task_type, "skipped", "本次源码依赖解析未触发该子任务", 100)
            summary = f"识别依赖 {len(result.components)} 个，扫描模式：{result.scan_mode}"
            if result.fallback_enabled:
                summary += "，已启用兜底识别"
            _mark_parent(db, task, "success", 100, summary)
            record.status = "scanned"
            db.add(ScanLog(scan_task_id=task.id, level="info", message=task.summary))
            db.commit()
            if not settings.celery_task_always_eager:
                try:
                    enrich_project_licenses.delay(record.project_id, task.id)
                except Exception as exc:
                    db.add(ScanLog(scan_task_id=task.id, level="warning", message=f"许可证补全任务触发失败：{exc}"))
                    db.commit()
            try:
                monitor_project_versions.delay(record.project_id)
            except Exception as exc:
                db.add(ScanLog(scan_task_id=task.id, level="warning", message=f"版本补齐任务触发失败：{exc}"))
                db.commit()
            return {"status": "success", "components": len(result.components)}
        except Exception as exc:
            _mark_parent(db, task, "failed", 100, str(exc), str(exc))
            record.status = "failed"
            db.add(ScanLog(scan_task_id=task.id, level="error", message=str(exc)))
            db.commit()
            return {"status": "failed", "components": 0}


@celery_app.task(name="sca.enrich_project_licenses")
def enrich_project_licenses(project_id: int, parent_task_id: int | None = None) -> dict[str, int | str]:
    init_db()
    with SessionLocal() as db:
        if parent_task_id:
            _mark_child(db, parent_task_id, "license_enrichment_task", "running", "正在自动匹配许可协议", 10)
            db.add(ScanLog(scan_task_id=parent_task_id, level="info", message="开始自动匹配许可协议信息"))
            db.commit()
        try:
            stats = enrich_missing_component_licenses(db, project_id)
            if parent_task_id:
                summary = f"许可证匹配完成：候选 {stats['total']} 个，更新 {stats['updated']} 个，缓存命中 {stats['cached']} 个，失败 {stats['failed']} 个"
                _mark_child(db, parent_task_id, "license_enrichment_task", "completed", summary, 100)
                db.add(ScanLog(scan_task_id=parent_task_id, level="info", message=summary))
            db.commit()
            return {"status": "success", **stats}
        except Exception as exc:
            if parent_task_id:
                _mark_child(db, parent_task_id, "license_enrichment_task", "failed", "许可证匹配失败", 100, str(exc))
                db.add(ScanLog(scan_task_id=parent_task_id, level="error", message=f"许可证匹配失败：{exc}"))
            db.commit()
            return {"status": "failed", "total": 0, "updated": 0, "cached": 0, "failed": 1}


@celery_app.task(name="sca.monitor_risks")
def monitor_risks() -> dict[str, int | str]:
    init_db()
    with SessionLocal() as db:
        run = RiskMonitorRun(status="running", summary="持续风险监测执行中")
        db.add(run)
        db.flush()
        components = db.query(Component).all()
        updated = 0
        for component in components:
            data = monitor_component_update(component, settings)
            vulnerability_count = db.query(VulnerabilityRecord).filter_by(component_id=component.id).count()
            risk_level = snapshot_risk_level(
                bool(data["update_available"]),
                str(data["version_delta"]),
                str(data["eol_status"]),
                vulnerability_count,
            )
            snapshot = RiskMonitorSnapshot(
                project_id=component.project_id,
                component_id=component.id,
                component_name=component.package_name,
                current_version=str(data.get("current_version") or component.package_version),
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
                        project_id=component.project_id,
                        component_id=component.id,
                        change_type="version_update",
                        before_value=str(data.get("current_version") or component.package_version),
                        after_value=snapshot.latest_version,
                        message=snapshot.recommendation,
                    )
                )
                db.add(
                    RiskAlert(
                        project_id=component.project_id,
                        component_id=component.id,
                        level=risk_level if risk_level in {"high", "medium", "low"} else "medium",
                        title=f"{component.package_name} 存在版本更新",
                        message=snapshot.recommendation,
                        notification_channel="email" if settings.notification_email_enabled else "",
                        email_to=settings.notification_email_to,
                    )
                )
        run.status = "success"
        run.checked_projects = len({component.project_id for component in components})
        run.updated_components = updated
        run.summary = f"已监测组件 {len(components)} 个，发现更新 {updated} 个"
        run.finished_at = datetime.now(timezone.utc)
        db.commit()
        return {"status": "success", "components": len(components), "updates": updated}


@celery_app.task(name="sca.monitor_project_versions")
def monitor_project_versions(project_id: int) -> dict[str, int | str]:
    init_db()
    with SessionLocal() as db:
        components = db.query(Component).filter_by(project_id=project_id).all()
        for component in components:
            data = monitor_component_update(component, settings)
            vulnerability_count = db.query(VulnerabilityRecord).filter_by(component_id=component.id).count()
            risk_level = snapshot_risk_level(
                bool(data["update_available"]),
                str(data["version_delta"]),
                str(data["eol_status"]),
                vulnerability_count,
            )
            db.add(
                RiskMonitorSnapshot(
                    project_id=component.project_id,
                    component_id=component.id,
                    component_name=component.package_name,
                    current_version=str(data.get("current_version") or component.package_version),
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
            )
        db.commit()
        return {"status": "success", "components": len(components), "project_id": project_id}


@celery_app.task(name="sca.check_remediation_overdue")
def check_remediation_overdue() -> dict[str, int | str]:
    init_db()
    from .remediation_service import mark_overdue_tickets

    with SessionLocal() as db:
        result = mark_overdue_tickets(db, settings.notification_email_enabled, settings.notification_email_to)
        db.commit()
        return result
