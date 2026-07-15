from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.crypto import ContentCipher
from app.database import SessionLocal
from app.models import WorkArtifact, WorkArtifactVersion
from app.professional_delivery.catalog_service import ensure_builtin_catalog
from app.professional_delivery.models import (
    LegacyDeliverableMapping,
    SkillDefinition,
    SkillVersion,
    TemplateDefinition,
    TemplateVersion,
)
from app.project_context_models import ProjectArtifact
from app.project_task_models import ProjectDeliverable
from app.project_workspace_models import Project


SOURCE_TYPES = ("work_artifact", "project_artifact", "project_deliverable")
COMPLETE_SOURCE_TYPE = "complete"


@dataclass(frozen=True, slots=True)
class BackfillCheckpoint:
    source_type: str = SOURCE_TYPES[0]
    last_id: int = 0

    @classmethod
    def from_value(cls, value: dict[str, Any] | None) -> "BackfillCheckpoint":
        if not value:
            return cls()
        source_type = str(value.get("source_type", SOURCE_TYPES[0]))
        if source_type not in {*SOURCE_TYPES, COMPLETE_SOURCE_TYPE}:
            raise ValueError(f"未知回填阶段：{source_type}")
        last_id = int(value.get("last_id", 0))
        if last_id < 0:
            raise ValueError("checkpoint.last_id 不能小于 0")
        return cls(source_type=source_type, last_id=last_id)


@dataclass(slots=True)
class BackfillReport:
    dry_run: bool
    batch_size: int
    scanned: int = 0
    created_artifacts: int = 0
    created_versions: int = 0
    normalized_artifacts: int = 0
    created_mappings: int = 0
    skipped_mapped: int = 0
    legacy_incomplete: int = 0
    by_source: dict[str, int] = field(
        default_factory=lambda: {source_type: 0 for source_type in SOURCE_TYPES}
    )
    checkpoint: dict[str, Any] = field(default_factory=dict)
    complete: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _canonical_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _legacy_catalog_versions(db: Session) -> tuple[SkillVersion, TemplateVersion]:
    skill = db.scalar(
        select(SkillDefinition).where(SkillDefinition.skill_key == "legacy_import")
    )
    template = db.scalar(
        select(TemplateDefinition).where(
            TemplateDefinition.template_key == "legacy_document"
        )
    )
    if (
        skill is None
        or skill.current_published_version_id is None
        or template is None
        or template.current_published_version_id is None
    ):
        raise RuntimeError("专业交付内置目录尚未初始化，请先执行目录种子脚本")
    skill_version = db.get(SkillVersion, skill.current_published_version_id)
    template_version = db.get(TemplateVersion, template.current_published_version_id)
    if skill_version is None or template_version is None:
        raise RuntimeError("专业交付旧数据导入目录版本无效")
    return skill_version, template_version


def _latest_version(db: Session, artifact_id: int) -> WorkArtifactVersion | None:
    return db.scalar(
        select(WorkArtifactVersion)
        .where(WorkArtifactVersion.artifact_id == artifact_id)
        .order_by(WorkArtifactVersion.version.desc(), WorkArtifactVersion.id.desc())
        .limit(1)
    )


def _legacy_version(
    db: Session,
    *,
    artifact: WorkArtifact,
    source_type: str,
    source_uuid: str,
    project_id: int | None,
    skill_version: SkillVersion,
    template_version: TemplateVersion,
) -> tuple[WorkArtifactVersion, bool]:
    version = _latest_version(db, artifact.id)
    created = version is None
    if version is None:
        version = WorkArtifactVersion(
            artifact_id=artifact.id,
            version=max(artifact.version or 1, 1),
            created_by=artifact.created_by or artifact.owner_user_id,
            source="legacy_import",
            source_ref=f"{source_type}:{source_uuid}",
            file_name=artifact.file_name or "",
            file_path_or_blob_ref=artifact.file_path_or_blob_ref or "",
            source_summary_json=artifact.source_summary_json or [],
            content_summary=artifact.content_summary or "",
            status="active",
        )
        db.add(version)
        db.flush()

    version.skill_version_id = skill_version.id
    version.template_version_id = template_version.id
    version.content_format = version.content_format or "structured_json"
    version.content_schema_version = version.content_schema_version or "1"
    version.content_hash = version.content_hash or _canonical_hash(
        {
            "legacy_source_type": source_type,
            "legacy_source_uuid": source_uuid,
            "title": artifact.title,
            "summary": version.content_summary or artifact.content_summary or "",
            "file_name": version.file_name or artifact.file_name or "",
            "file_ref": (
                version.file_path_or_blob_ref
                or artifact.file_path_or_blob_ref
                or ""
            ),
        }
    )
    version.title_snapshot = version.title_snapshot or artifact.title
    version.summary_snapshot = (
        version.summary_snapshot or version.content_summary or artifact.content_summary or ""
    )
    version.change_summary = version.change_summary or "2.0 历史成果回填"
    version.project_scope_snapshot_json = {
        "scope_type": "project" if project_id is not None else "personal",
        "project_id": project_id,
    }
    version.input_summary_json = {
        "legacy_source_type": source_type,
        "legacy_source_uuid": source_uuid,
    }
    version.source_policy_snapshot_json = {
        "mode": "legacy_import",
        "content_available": bool(
            version.content_ciphertext is not None and version.content_nonce is not None
        ),
        "requires_human_review": True,
    }
    version.creation_reason = "legacy"
    version.legacy_incomplete = True
    artifact.current_version_id = version.id
    return version, created


def _normalize_artifact(
    artifact: WorkArtifact,
    *,
    project_id: int | None,
    project_task_id: int | None = None,
) -> None:
    artifact.deliverable_type = (
        artifact.deliverable_type or artifact.artifact_type or "legacy_import"
    )[:48]
    artifact.scope_type = "project" if project_id is not None else "personal"
    artifact.formality = "working"
    artifact.project_id = project_id
    if project_task_id is not None:
        artifact.project_task_id = project_task_id
    artifact.lifecycle_status = "draft"
    artifact.approval_flow_version_id = None
    artifact.approved_version_id = None
    artifact.approved_content_hash = ""
    artifact.delivered_version_id = None
    artifact.row_version = max(artifact.row_version or 1, 1)
    artifact.created_by = artifact.created_by or artifact.owner_user_id
    artifact.record_status = artifact.record_status or "active"


def _mapping(
    db: Session,
    *,
    source_type: str,
    source_uuid: str,
) -> LegacyDeliverableMapping | None:
    return db.scalar(
        select(LegacyDeliverableMapping).where(
            LegacyDeliverableMapping.source_type == source_type,
            LegacyDeliverableMapping.source_uuid == source_uuid,
        )
    )


def _project_artifact_requires_clone(
    db: Session,
    *,
    row: ProjectArtifact,
    artifact: WorkArtifact,
) -> bool:
    if artifact.project_id is not None and artifact.project_id != row.project_id:
        return True
    earlier_project_id = db.scalar(
        select(ProjectArtifact.project_id)
        .where(
            ProjectArtifact.artifact_id == row.artifact_id,
            ProjectArtifact.id < row.id,
            ProjectArtifact.project_id != row.project_id,
        )
        .order_by(ProjectArtifact.id)
        .limit(1)
    )
    return earlier_project_id is not None


def _clone_artifact_for_project(
    db: Session,
    *,
    artifact: WorkArtifact,
    project_id: int,
) -> WorkArtifact:
    clone = WorkArtifact(
        owner_user_id=artifact.owner_user_id,
        conversation_id=artifact.conversation_id or "",
        message_id=artifact.message_id or "",
        task_state_id=artifact.task_state_id or "",
        export_record_uuid=artifact.export_record_uuid or "",
        title=artifact.title,
        artifact_type=artifact.artifact_type,
        deliverable_type=artifact.deliverable_type or artifact.artifact_type,
        scope_type="project",
        formality="working",
        project_id=project_id,
        lifecycle_status="draft",
        row_version=1,
        created_by=artifact.created_by or artifact.owner_user_id,
        source_scope=artifact.source_scope or "professional_delivery_backfill",
        source_summary_json=artifact.source_summary_json or [],
        content_summary=artifact.content_summary or "",
        file_name=artifact.file_name or "",
        file_path_or_blob_ref=artifact.file_path_or_blob_ref or "",
        version=max(artifact.version or 1, 1),
        status=artifact.status or "active",
    )
    db.add(clone)
    db.flush()
    return clone


def _record_mapping(
    db: Session,
    *,
    source_type: str,
    source_uuid: str,
    source_project_id: int | None,
    artifact: WorkArtifact,
    version: WorkArtifactVersion,
) -> None:
    db.add(
        LegacyDeliverableMapping(
            source_type=source_type,
            source_uuid=source_uuid,
            source_project_id=source_project_id,
            deliverable_id=artifact.id,
            deliverable_version_id=version.id,
            status="completed",
        )
    )


def _work_artifact_rows(
    db: Session,
    *,
    after_id: int,
    limit: int,
) -> list[WorkArtifact]:
    mapped_deliverables = select(
        LegacyDeliverableMapping.deliverable_id
    )
    work_source_deliverables = select(
        LegacyDeliverableMapping.deliverable_id
    ).where(LegacyDeliverableMapping.source_type == "work_artifact")
    legacy_version_artifacts = select(WorkArtifactVersion.artifact_id).where(
        WorkArtifactVersion.legacy_incomplete.is_(True)
    )
    return list(
        db.scalars(
            select(WorkArtifact)
            .where(
                WorkArtifact.id > after_id,
                or_(
                    WorkArtifact.id.not_in(mapped_deliverables),
                    WorkArtifact.id.in_(work_source_deliverables),
                ),
                or_(
                    WorkArtifact.current_version_id.is_(None),
                    WorkArtifact.id.in_(legacy_version_artifacts),
                ),
            )
            .order_by(WorkArtifact.id)
            .limit(limit)
        ).all()
    )


def _source_rows(
    db: Session,
    *,
    source_type: str,
    after_id: int,
    limit: int,
) -> list[Any]:
    if source_type == "work_artifact":
        return _work_artifact_rows(db, after_id=after_id, limit=limit)
    model = ProjectArtifact if source_type == "project_artifact" else ProjectDeliverable
    return list(
        db.scalars(
            select(model).where(model.id > after_id).order_by(model.id).limit(limit)
        ).all()
    )


def _backfill_row(
    db: Session,
    *,
    source_type: str,
    row: WorkArtifact | ProjectArtifact | ProjectDeliverable,
    skill_version: SkillVersion,
    template_version: TemplateVersion,
    report: BackfillReport,
) -> None:
    if _mapping(db, source_type=source_type, source_uuid=row.uuid) is not None:
        report.skipped_mapped += 1
        return

    project_id: int | None = None
    project_task_id: int | None = None
    created_artifact = False
    if source_type == "work_artifact":
        artifact = row
        project_id = artifact.project_id
        project_task_id = artifact.project_task_id
    elif source_type == "project_artifact":
        project_id = row.project_id
        artifact = db.get(WorkArtifact, row.artifact_id)
        if artifact is None:
            raise RuntimeError(f"项目成果关联缺少原成果：{row.uuid}")
        if _project_artifact_requires_clone(db, row=row, artifact=artifact):
            artifact = _clone_artifact_for_project(
                db,
                artifact=artifact,
                project_id=project_id,
            )
            created_artifact = True
    else:
        project_id = row.project_id
        project_task_id = row.task_id
        project = db.get(Project, project_id)
        if project is None:
            raise RuntimeError(f"项目交付物缺少项目：{row.uuid}")
        owner_user_id = project.owner_user_id
        artifact = WorkArtifact(
            owner_user_id=owner_user_id,
            title=row.title,
            artifact_type=row.deliverable_type or "document",
            deliverable_type=row.deliverable_type or "document",
            scope_type="project",
            formality="working",
            project_id=project_id,
            project_task_id=project_task_id,
            lifecycle_status="draft",
            row_version=1,
            created_by=row.created_by or owner_user_id,
            source_scope="professional_delivery_backfill",
            source_summary_json=[],
            content_summary=row.content_summary or "",
            file_name=row.file_name or "",
            file_path_or_blob_ref=row.file_ref or "",
            version=max(row.version or 1, 1),
            status="active",
        )
        db.add(artifact)
        db.flush()
        created_artifact = True

    _normalize_artifact(
        artifact,
        project_id=project_id,
        project_task_id=project_task_id,
    )
    version, created_version = _legacy_version(
        db,
        artifact=artifact,
        source_type=source_type,
        source_uuid=row.uuid,
        project_id=project_id,
        skill_version=skill_version,
        template_version=template_version,
    )
    _record_mapping(
        db,
        source_type=source_type,
        source_uuid=row.uuid,
        source_project_id=project_id,
        artifact=artifact,
        version=version,
    )
    report.created_artifacts += int(created_artifact)
    report.created_versions += int(created_version)
    report.normalized_artifacts += 1
    report.created_mappings += 1
    report.legacy_incomplete += 1


def backfill_professional_deliverables(
    db: Session,
    *,
    batch_size: int = 500,
    checkpoint: dict[str, Any] | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    if batch_size <= 0:
        raise ValueError("batch_size 必须大于 0")
    current = BackfillCheckpoint.from_value(checkpoint)
    report = BackfillReport(dry_run=dry_run, batch_size=batch_size)
    if current.source_type == COMPLETE_SOURCE_TYPE:
        report.complete = True
        report.checkpoint = asdict(current)
        return report.to_dict()

    catalog_versions = None if dry_run else _legacy_catalog_versions(db)
    start_index = SOURCE_TYPES.index(current.source_type)
    remaining = batch_size

    for source_index in range(start_index, len(SOURCE_TYPES)):
        source_type = SOURCE_TYPES[source_index]
        after_id = current.last_id if source_index == start_index else 0
        rows = _source_rows(
            db,
            source_type=source_type,
            after_id=after_id,
            limit=remaining,
        )
        for row in rows:
            report.scanned += 1
            report.by_source[source_type] += 1
            if dry_run:
                if _mapping(
                    db,
                    source_type=source_type,
                    source_uuid=row.uuid,
                ) is not None:
                    report.skipped_mapped += 1
                else:
                    report.created_mappings += 1
                    report.legacy_incomplete += 1
                    if source_type == "project_deliverable":
                        report.created_artifacts += 1
                        report.created_versions += 1
                    elif source_type == "project_artifact":
                        artifact = db.get(WorkArtifact, row.artifact_id)
                        if artifact is None:
                            raise RuntimeError(f"项目成果关联缺少原成果：{row.uuid}")
                        if _project_artifact_requires_clone(
                            db,
                            row=row,
                            artifact=artifact,
                        ):
                            report.created_artifacts += 1
                            report.created_versions += 1
            else:
                assert catalog_versions is not None
                _backfill_row(
                    db,
                    source_type=source_type,
                    row=row,
                    skill_version=catalog_versions[0],
                    template_version=catalog_versions[1],
                    report=report,
                )
            after_id = row.id
            remaining -= 1

        if remaining == 0:
            report.checkpoint = {
                "source_type": source_type,
                "last_id": after_id,
            }
            return report.to_dict()

    report.complete = True
    report.checkpoint = {"source_type": COMPLETE_SOURCE_TYPE, "last_id": 0}
    return report.to_dict()


def _read_checkpoint(path: Path | None) -> dict[str, Any] | None:
    if path is None or not path.exists():
        return None
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("checkpoint 文件必须是 JSON 对象")
    return value


def _write_checkpoint(path: Path | None, checkpoint: dict[str, Any]) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(
        json.dumps(checkpoint, ensure_ascii=False, sort_keys=True),
        encoding="utf-8",
    )
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="回填 2.0 历史成果到 3.0 专业交付模型")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--checkpoint-file", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    settings = get_settings()
    checkpoint = _read_checkpoint(args.checkpoint_file)
    with SessionLocal() as db:
        try:
            if not args.dry_run:
                ensure_builtin_catalog(
                    db,
                    cipher=ContentCipher(settings.content_encryption_key),
                    key_version=settings.content_encryption_key_version,
                )
            report = backfill_professional_deliverables(
                db,
                batch_size=args.batch_size,
                checkpoint=checkpoint,
                dry_run=args.dry_run,
            )
            if args.dry_run:
                db.rollback()
            else:
                db.commit()
                _write_checkpoint(args.checkpoint_file, report["checkpoint"])
        except Exception:
            db.rollback()
            raise
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
