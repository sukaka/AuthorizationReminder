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
from .models import Component, ComponentDependency, ScanLog, ScanTask, UploadFileRecord

settings = get_settings()

celery_app = Celery(
    "juxin_sca",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)
celery_app.conf.broker_connection_retry_on_startup = True
celery_app.conf.task_always_eager = settings.celery_task_always_eager


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
        task.started_at = datetime.now(timezone.utc)
        record.status = "scanning"
        db.add(ScanLog(scan_task_id=task.id, level="info", message="开始解析源码依赖"))
        db.commit()

        try:
            extract_dir = upload_root / "extracted" / record.upload_id
            _extract_archive(Path(record.storage_path), extract_dir)
            result = parse_source_dependencies(extract_dir)

            db.execute(delete(ComponentDependency).where(ComponentDependency.project_id == record.project_id))
            db.execute(delete(Component).where(Component.project_id == record.project_id))
            db.flush()

            by_key: dict[str, Component] = {}
            for item in result.components:
                component = Component(
                    project_id=record.project_id,
                    package_name=item.name,
                    package_version=item.version,
                    ecosystem=item.ecosystem,
                    scope=item.scope,
                    source_path=item.source_path,
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
            task.status = "success"
            task.summary = f"识别依赖 {len(result.components)} 个"
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
