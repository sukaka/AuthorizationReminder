import base64

from sqlalchemy import func, select

from app.crypto import ContentCipher
from app.models import WorkArtifact, WorkArtifactVersion
from app.professional_delivery.catalog_service import ensure_builtin_catalog
from app.professional_delivery.models import LegacyDeliverableMapping
from app.project_context_models import ProjectArtifact
from app.project_task_models import ProjectDeliverable
from app.project_workspace_models import Project
from scripts.backfill_professional_delivery import backfill_professional_deliverables


def _seed_legacy_rows(generation_db) -> tuple[WorkArtifact, Project, ProjectDeliverable]:
    ensure_builtin_catalog(
        generation_db,
        cipher=ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode("ascii")),
        key_version="v1",
    )
    project = Project(
        name="历史项目",
        owner_user_id="project-owner",
        created_by="project-owner",
    )
    generation_db.add(project)
    generation_db.flush()

    artifact = WorkArtifact(
        owner_user_id="legacy-owner",
        title="历史工作成果",
        artifact_type="report",
        source_scope="personal",
        content_summary="历史工作成果摘要",
        file_name="legacy-work.docx",
        file_path_or_blob_ref="legacy/legacy-work.docx",
        created_by="legacy-owner",
    )
    generation_db.add(artifact)
    generation_db.flush()
    version = WorkArtifactVersion(
        artifact_id=artifact.id,
        version=1,
        source="legacy",
        source_ref="legacy-work-ref",
        content_summary="历史工作成果摘要",
        legacy_incomplete=True,
        created_by="legacy-owner",
    )
    generation_db.add(version)
    generation_db.flush()
    artifact.current_version_id = version.id
    generation_db.add(
        ProjectArtifact(
            project_id=project.id,
            artifact_id=artifact.id,
            linked_by="project-owner",
        )
    )

    project_deliverable = ProjectDeliverable(
        project_id=project.id,
        title="历史项目交付物",
        deliverable_type="security_report",
        status="approved",
        content_summary="历史项目交付摘要",
        file_name="legacy-project.docx",
        file_ref="legacy/legacy-project.docx",
        version=3,
        submitted_by="project-owner",
        approved_by="project-owner",
        created_by="project-owner",
    )
    generation_db.add(project_deliverable)
    generation_db.commit()
    return artifact, project, project_deliverable


def test_professional_delivery_backfill_supports_dry_run_checkpoint_and_replay(
    generation_db,
) -> None:
    artifact, project, project_deliverable = _seed_legacy_rows(generation_db)
    original_artifact_count = generation_db.scalar(select(func.count(WorkArtifact.id)))

    dry_run = backfill_professional_deliverables(
        generation_db,
        batch_size=2,
        dry_run=True,
    )
    generation_db.rollback()

    assert dry_run["dry_run"] is True
    assert dry_run["scanned"] == 2
    assert dry_run["complete"] is False
    assert dry_run["created_mappings"] == 2
    assert generation_db.scalar(select(func.count(LegacyDeliverableMapping.id))) == 0
    assert generation_db.scalar(select(func.count(WorkArtifact.id))) == original_artifact_count

    checkpoint = None
    reports = []
    while True:
        report = backfill_professional_deliverables(
            generation_db,
            batch_size=1,
            checkpoint=checkpoint,
        )
        generation_db.commit()
        reports.append(report)
        checkpoint = report["checkpoint"]
        if report["complete"]:
            break

    mappings = generation_db.scalars(
        select(LegacyDeliverableMapping).order_by(LegacyDeliverableMapping.source_type)
    ).all()
    assert {mapping.source_type for mapping in mappings} == {
        "work_artifact",
        "project_artifact",
        "project_deliverable",
    }
    assert sum(report["created_mappings"] for report in reports) == 3
    assert generation_db.scalar(select(func.count(WorkArtifact.id))) == 2

    generation_db.refresh(artifact)
    assert artifact.scope_type == "project"
    assert artifact.project_id == project.id
    assert artifact.lifecycle_status == "draft"
    assert artifact.approved_version_id is None
    assert artifact.delivered_version_id is None

    imported_mapping = next(
        mapping
        for mapping in mappings
        if mapping.source_type == "project_deliverable"
    )
    imported = generation_db.get(WorkArtifact, imported_mapping.deliverable_id)
    imported_version = generation_db.get(
        WorkArtifactVersion,
        imported_mapping.deliverable_version_id,
    )
    assert imported is not None
    assert imported_version is not None
    assert imported.title == project_deliverable.title
    assert imported.scope_type == "project"
    assert imported.project_id == project.id
    assert imported.lifecycle_status == "draft"
    assert imported.approved_version_id is None
    assert imported.delivered_version_id is None
    assert imported_version.version == 3
    assert imported_version.legacy_incomplete is True
    assert imported_version.skill_version_id is not None
    assert imported_version.template_version_id is not None
    assert imported_version.source_policy_snapshot_json == {
        "mode": "legacy_import",
        "content_available": False,
        "requires_human_review": True,
    }

    replay = backfill_professional_deliverables(generation_db, batch_size=100)
    generation_db.commit()
    assert replay["complete"] is True
    assert replay["created_artifacts"] == 0
    assert replay["created_versions"] == 0
    assert replay["created_mappings"] == 0
    assert replay["skipped_mapped"] == 3
    assert generation_db.scalar(select(func.count(LegacyDeliverableMapping.id))) == 3
    assert generation_db.scalar(select(func.count(WorkArtifact.id))) == 2


def test_project_artifact_backfill_clones_cross_project_links(generation_db) -> None:
    artifact, first_project, _ = _seed_legacy_rows(generation_db)
    second_project = Project(
        name="第二个历史项目",
        owner_user_id="second-owner",
        created_by="second-owner",
    )
    generation_db.add(second_project)
    generation_db.flush()
    generation_db.add(
        ProjectArtifact(
            project_id=second_project.id,
            artifact_id=artifact.id,
            linked_by="second-owner",
        )
    )
    generation_db.commit()

    dry_run = backfill_professional_deliverables(
        generation_db,
        batch_size=100,
        dry_run=True,
    )
    generation_db.rollback()
    assert dry_run["created_artifacts"] == 2
    assert dry_run["created_versions"] == 2

    report = backfill_professional_deliverables(generation_db, batch_size=100)
    generation_db.commit()
    assert report["complete"] is True

    mappings = generation_db.scalars(
        select(LegacyDeliverableMapping).where(
            LegacyDeliverableMapping.source_type == "project_artifact"
        )
    ).all()
    assert len(mappings) == 2
    assert len({mapping.deliverable_id for mapping in mappings}) == 2
    assert {
        generation_db.get(WorkArtifact, mapping.deliverable_id).project_id
        for mapping in mappings
    } == {first_project.id, second_project.id}

    replay = backfill_professional_deliverables(generation_db, batch_size=100)
    generation_db.commit()
    assert replay["created_artifacts"] == 0
    assert replay["created_versions"] == 0
    assert replay["created_mappings"] == 0
    assert generation_db.scalar(select(func.count(LegacyDeliverableMapping.id))) == 4
