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
from .models import (
    Component,
    ComponentDependency,
    RiskAlert,
    RiskChangeRecord,
    RiskMonitorRun,
    RiskMonitorSnapshot,
    ScanLog,
    ScanTask,
    UploadFileRecord,
    VulnerabilityRecord,
)
from .risk_monitor_service import monitor_component_update, raw_json, snapshot_risk_level

settings = get_settings()

celery_app = Celery(
    "juxin_sca",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)
celery_app.conf.broker_connection_retry_on_startup = True
celery_app.conf.task_always_eager = settings.celery_task_always_eager
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


@celery_app.task(name="sca.demo_scan")
def demo_scan(project_name: str) -> dict[str, str]:
    return {"project": project_name, "status": "queued", "message": "软件成分分析任务已进入队列"}


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

        task.status = "running"
        task.progress = 5
        task.task_type = task.task_type or "project_scan_task"
        _ensure_child_scan_tasks(db, task)
        _mark_child(db, task.id, "prepare_source_task", "running", "正在解压源码包", 30)
        task.started_at = datetime.now(timezone.utc)
        record.status = "scanning"
        db.add(ScanLog(scan_task_id=task.id, level="info", message="开始解析源码依赖"))
        db.commit()

        try:
            extract_dir = upload_root / "extracted" / record.upload_id
            _extract_archive(Path(record.storage_path), extract_dir)
            _mark_child(db, task.id, "prepare_source_task", "completed", "源码准备完成", 100)
            result = parse_source_dependencies(extract_dir)
            _mark_child(db, task.id, "normalize_results_task", "running", "正在标准化依赖识别结果", 50)

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
                    license_name="unknown",
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
            _mark_child(db, task.id, "merge_components_task", "completed", "组件合并完成", 100)
            _mark_child(db, task.id, "merge_vulnerabilities_task", "skipped", "等待漏洞查询后合并", 100)
            for task_type in [
                "opensca_scan_task",
                "syft_sbom_task",
                "trivy_scan_task",
                "dependency_track_upload_task",
                "dependency_track_fetch_task",
                "ai_noise_reduction_task",
                "report_generate_task",
            ]:
                _mark_child(db, task.id, task_type, "skipped", "本次源码依赖解析未触发该子任务", 100)
            task.status = "success"
            task.progress = 100
            task.summary = f"识别依赖 {len(result.components)} 个，扫描模式：{result.scan_mode}"
            if result.fallback_enabled:
                task.summary += "，已启用兜底识别"
            task.finished_at = datetime.now(timezone.utc)
            record.status = "scanned"
            db.add(ScanLog(scan_task_id=task.id, level="info", message=task.summary))
            db.commit()
            return {"status": "success", "components": len(result.components)}
        except Exception as exc:
            task.status = "failed"
            task.summary = str(exc)
            task.finished_at = datetime.now(timezone.utc)
            record.status = "failed"
            db.add(ScanLog(scan_task_id=task.id, level="error", message=str(exc)))
            db.commit()
            return {"status": "failed", "components": 0}


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
                        project_id=component.project_id,
                        component_id=component.id,
                        change_type="version_update",
                        before_value=component.package_version,
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


@celery_app.task(name="sca.check_remediation_overdue")
def check_remediation_overdue() -> dict[str, int | str]:
    init_db()
    from .remediation_service import mark_overdue_tickets

    with SessionLocal() as db:
        result = mark_overdue_tickets(db, settings.notification_email_enabled, settings.notification_email_to)
        db.commit()
        return result
