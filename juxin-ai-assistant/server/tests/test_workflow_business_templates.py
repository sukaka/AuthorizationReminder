import hashlib
import json

from sqlalchemy import select


def _hash(value):
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _approval_token(result):
    approval = next(item for item in result.steps if item.get("id") == "approval")
    return approval["output"]["approval_token"]


def test_first_three_business_templates_are_builtin_and_closed(generation_db):
    from app.workflow_engine import get_workflow_definition, save_custom_workflow

    expected = {
        "monthly_business_report": ["project_read", "business", "artifact", "approval", "business"],
        "overdue_item_reminder": ["business", "artifact", "approval", "notification"],
        "approved_deliverable_archive": ["business", "business", "artifact", "notification"],
    }
    for workflow_id, types in expected.items():
        definition = get_workflow_definition(workflow_id)
        assert definition is not None
        assert [step["type"] for step in definition["steps"]] == types

    invalid = {
        "id": "invalid_business_action",
        "name": "invalid",
        "steps": [{"id": "run", "type": "business", "params": {"action": "python"}}],
    }
    try:
        save_custom_workflow(invalid, None)
    except ValueError as exc:
        assert str(exc) == "invalid_business_action:python"
    else:
        raise AssertionError("unknown business actions must be rejected")


def test_monthly_report_waits_then_archives_with_owner_scope(generation_db):
    from app.config import Settings
    from app.models import AgentArtifact
    from app.workflow_run_service import WorkflowRunService

    service = WorkflowRunService(generation_db, Settings())
    project = {
        "uuid": "project-1",
        "name": "经营项目",
        "metrics": {"revenue": 120, "cost": 80},
        "facts": [{"text": "已签约", "reference_id": "ref-1"}],
        "references": [{"id": "ref-1", "title": "合同"}],
    }
    result, row = service.start_and_run(
        workflow_id="monthly_business_report",
        owner_user_id="owner-monthly",
        input_text="生成月报",
        context={
            "project_uuid": "project-1",
            "report_period": "2026-06",
            "project_records": {"project-1": project},
        },
    )
    assert result.status == "waiting_human"
    report = next(item for item in result.steps if item["id"] == "report_skill")["output"]["output"]
    assert report["skill_id"] == "local.monthly_business_report"
    assert report["quality"]["passed"] is True
    token = _approval_token(result)
    confirmed, _ = service.confirm(row.uuid, "owner-monthly", approval_token=token)
    assert confirmed.status == "succeeded"
    archive = confirmed.outputs["steps"]["archive"]["output"]
    assert archive["archive_business_key"].startswith("deliverable:owner-monthly:")
    artifacts = generation_db.scalars(
        select(AgentArtifact).where(AgentArtifact.run_id == row.uuid)
    ).all()
    assert len(artifacts) == 1
    assert artifacts[0].owner_user_id == "owner-monthly"


def test_monthly_report_snapshot_and_parameters_are_stable_and_quality_is_explicit(
    generation_db,
):
    """The local report primitive is a deterministic, auditable boundary.

    Run IDs and artifact IDs are intentionally excluded from this golden
    assertion: the business snapshot and parameter hashes are the values that
    must remain stable for replay and duplicate-trigger detection.
    """
    from app.config import Settings
    from app.workflow_run_service import WorkflowRunService

    service = WorkflowRunService(generation_db, Settings())
    base_context = {
        "project_uuid": "project-golden",
        "report_period": "2026-06",
        "project_records": {
            "project-golden": {
                "uuid": "project-golden",
                "name": "经营项目 Golden",
                "metrics": {"cost": 80, "revenue": 120},
                "facts": [{"text": "已签约", "reference_id": "ref-1"}],
                "references": [{"id": "ref-1", "title": "合同"}],
            }
        },
    }

    first, _ = service.start_and_run(
        workflow_id="monthly_business_report",
        owner_user_id="owner-monthly-golden",
        input_text="生成月报",
        context=base_context,
    )
    second, _ = service.start_and_run(
        workflow_id="monthly_business_report",
        owner_user_id="owner-monthly-golden",
        input_text="生成月报",
        context=base_context,
    )
    first_report = next(item for item in first.steps if item["id"] == "report_skill")["output"]["output"]
    second_report = next(item for item in second.steps if item["id"] == "report_skill")["output"]["output"]
    assert first_report == second_report
    assert first_report["source_snapshot_hash"] == _hash(base_context["project_records"]["project-golden"])
    assert first_report["parameter_hash"] == _hash(
        {
            "project_uuid": "project-golden",
            "period": "2026-06",
            "source_snapshot_hash": first_report["source_snapshot_hash"],
        }
    )
    assert first_report["quality"] == {"passed": True, "issues": []}

    changed = {
        **base_context,
        "project_records": {
            "project-golden": {
                **base_context["project_records"]["project-golden"],
                "metrics": {"cost": 81, "revenue": 120},
            }
        },
    }
    changed_result, _ = service.start_and_run(
        workflow_id="monthly_business_report",
        owner_user_id="owner-monthly-golden",
        input_text="生成月报",
        context=changed,
    )
    changed_report = next(
        item for item in changed_result.steps if item["id"] == "report_skill"
    )["output"]["output"]
    assert changed_report["source_snapshot_hash"] != first_report["source_snapshot_hash"]
    assert changed_report["parameter_hash"] != first_report["parameter_hash"]

    quality_result, _ = service.start_and_run(
        workflow_id="monthly_business_report",
        owner_user_id="owner-monthly-golden",
        input_text="生成月报",
        context={
            **base_context,
            "project_records": {
                "project-golden": {
                    **base_context["project_records"]["project-golden"],
                    "facts": [{"text": "未提供来源"}],
                }
            },
        },
    )
    quality_report = next(
        item for item in quality_result.steps if item["id"] == "report_skill"
    )["output"]["output"]
    assert quality_report["quality"] == {
        "passed": False,
        "issues": ["fact_0_missing_reference"],
    }


def test_overdue_reminder_groups_deterministically_and_enqueues_after_approval(generation_db):
    from app.config import Settings
    from app.models import WorkflowNotificationOutbox
    from app.workflow_run_service import WorkflowRunService

    service = WorkflowRunService(generation_db, Settings())
    result, row = service.start_and_run(
        workflow_id="overdue_item_reminder",
        owner_user_id="owner-overdue",
        input_text="提醒逾期事项",
        context={
            "overdue_items": [
                {"id": "b", "owner": "u-2", "due_date": "2026-07-02", "status": "overdue"},
                {"id": "a", "owner": "u-1", "due_date": "2026-07-01", "status": "overdue"},
            ]
        },
    )
    assert result.status == "waiting_human"
    grouped = next(item for item in result.steps if item["id"] == "group_overdue")["output"]["output"]
    assert grouped["overdue_count"] == 2
    assert [group["owner"] for group in grouped["groups"]] == ["u-1", "u-2"]
    confirmed, _ = service.confirm(row.uuid, "owner-overdue", approval_token=_approval_token(result))
    assert confirmed.status == "succeeded"
    outbox = generation_db.scalars(
        select(WorkflowNotificationOutbox).where(
            WorkflowNotificationOutbox.run_id == row.uuid,
            WorkflowNotificationOutbox.owner_user_id == "owner-overdue",
        )
    ).all()
    assert len(outbox) == 1
    assert outbox[0].channel == "in_app"


def test_overdue_group_golden_filters_explicit_non_overdue_and_is_order_independent(
    generation_db,
):
    from app.config import Settings
    from app.workflow_run_service import WorkflowRunService

    items = [
        {"id": "z", "owner": "u-2", "due_date": "2026-07-05", "status": "overdue"},
        {"id": "not-overdue", "owner": "u-1", "due_date": "2026-07-01", "status": "done"},
        {"id": "a", "owner": "u-1", "due_date": "2026-07-01", "status": "overdue"},
        {"id": "implicit", "owner": "u-2", "due_date": "2026-07-04"},
    ]
    service = WorkflowRunService(generation_db, Settings())
    outputs = []
    for ordered_items in (items, list(reversed(items))):
        result, _ = service.start_and_run(
            workflow_id="overdue_item_reminder",
            owner_user_id="owner-overdue-golden",
            input_text="提醒逾期事项",
            context={"overdue_items": ordered_items},
        )
        outputs.append(
            next(item for item in result.steps if item["id"] == "group_overdue")["output"]["output"]
        )
    assert outputs[0] == outputs[1]
    assert outputs[0]["overdue_count"] == 3
    assert [group["owner"] for group in outputs[0]["groups"]] == ["u-1", "u-2"]
    assert [group["count"] for group in outputs[0]["groups"]] == [1, 2]
    expected_groups = [
        {"owner": "u-1", "count": 1, "items": [items[2]]},
        {"owner": "u-2", "count": 2, "items": [items[3], items[0]]},
    ]
    # The persisted step output is depth-bounded, so the hash is the golden
    # value that proves the complete, pre-bounded item ordering.
    assert outputs[0]["group_hash"] == _hash({"groups": expected_groups})


def test_approved_deliverable_archive_checks_hash_and_is_idempotent(generation_db):
    from app.config import Settings
    from app.models import AgentArtifact, WorkflowNotificationOutbox
    from app.workflow_run_service import WorkflowRunService

    service = WorkflowRunService(generation_db, Settings())
    deliverable = {"uuid": "deliverable-1", "version": 2, "title": "已审批交付物", "project_uuid": "p-1"}
    result, row = service.start_and_run(
        workflow_id="approved_deliverable_archive",
        owner_user_id="owner-archive",
        input_text="归档交付物",
        context={
            "approved_deliverable": deliverable,
            "approval_status": "approved",
            "approval_param_hash": _hash(deliverable),
        },
    )
    assert result.status == "succeeded"
    archive = result.outputs["steps"]["archive"]["output"]
    assert archive["archive_business_key"] == "deliverable:owner-archive:deliverable-1:v2"
    assert archive["archive_idempotency_key"] == hashlib.sha256(
        archive["archive_business_key"].encode("utf-8")
    ).hexdigest()
    assert generation_db.scalar(
        select(AgentArtifact).where(AgentArtifact.run_id == row.uuid)
    ) is not None
    assert generation_db.scalar(
        select(WorkflowNotificationOutbox).where(WorkflowNotificationOutbox.run_id == row.uuid)
    ) is not None


def test_approved_deliverable_archive_blocks_unapproved_or_hash_mismatch(generation_db):
    from app.config import Settings
    from app.workflow_run_service import WorkflowRunService

    service = WorkflowRunService(generation_db, Settings())
    deliverable = {
        "uuid": "deliverable-golden",
        "version": 3,
        "title": "已审批交付物",
        "project_uuid": "p-golden",
    }
    for context, expected_error in (
        (
            {
                "approved_deliverable": deliverable,
                "approval_status": "pending",
                "approval_param_hash": _hash(deliverable),
            },
            "approval_required",
        ),
        (
            {
                "approved_deliverable": deliverable,
                "approval_status": "approved",
                "approval_param_hash": "0" * 64,
            },
            "approval_parameter_hash_mismatch",
        ),
    ):
        result, _ = service.start_and_run(
            workflow_id="approved_deliverable_archive",
            owner_user_id="owner-archive-golden",
            input_text="归档交付物",
            context=context,
        )
        assert result.status == "failed"
        assert result.error == expected_error
        failed_step = result.steps[0]
        assert failed_step["id"] == "validate_approval"
        assert failed_step["status"] == "failed"
