from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from ..models import Assistant, AssistantModeVersion, GenerationRecord, Task
from .errors import GovernanceError
from .schemas import AssistantModeOut, AssistantModeUpsertIn


AVAILABLE_MODE_TOOLS = {
    "company_knowledge_search",
    "current_attachment_search",
    "document_structure_validate",
    "document_template_select",
    "file_parse",
    "personal_memory",
    "personal_reference_search",
    "pptx_export",
    "reference_source_validate",
    "web_research",
    "web_search",
    "word_export",
}


def _snapshot(row: Assistant) -> dict[str, object]:
    return {
        "code": row.code,
        "name": row.name,
        "description": row.description,
        "icon": row.icon,
        "allowed_tools": list(row.allowed_tools_json or []),
        "default_source_scope": row.default_source_scope,
        "default_output_structure": row.default_output_structure,
        "word_template": row.word_template,
        "status": row.status,
        "test_cases": list(row.test_cases_json or []),
        "review_status": row.review_status,
    }


def _save_version(db: Session, row: Assistant, *, actor_id: str, action: str) -> None:
    db.add(AssistantModeVersion(
        assistant_id=row.id,
        version=row.version,
        snapshot_json=_snapshot(row),
        action=action,
        created_by=actor_id,
    ))
    db.flush()


def _ensure_baseline(db: Session, row: Assistant) -> None:
    exists = db.scalar(
        select(AssistantModeVersion.id).where(
            AssistantModeVersion.assistant_id == row.id,
            AssistantModeVersion.version == row.version,
        )
    )
    if exists is None:
        _save_version(db, row, actor_id=row.updated_by or "system", action="baseline")


def get_mode(db: Session, mode_uuid: str) -> Assistant:
    row = db.scalar(select(Assistant).where(Assistant.uuid == mode_uuid))
    if row is None:
        raise GovernanceError(404, "ASSISTANT_MODE_NOT_FOUND", "助手模式不存在")
    _ensure_baseline(db, row)
    return row


def list_modes(db: Session) -> list[Assistant]:
    rows = list(db.scalars(select(Assistant).order_by(Assistant.sort_order, Assistant.id)))
    for row in rows:
        _ensure_baseline(db, row)
    return rows


def create_mode(
    db: Session,
    *,
    body: AssistantModeUpsertIn,
    actor_id: str,
) -> Assistant:
    if db.scalar(select(Assistant.id).where(Assistant.code == body.code)) is not None:
        raise GovernanceError(409, "ASSISTANT_MODE_CODE_EXISTS", "助手模式编码已存在")
    row = Assistant(
        code=body.code,
        name=body.name,
        description=body.description,
        icon=body.icon,
        status="DRAFT",
        allowed_tools_json=body.allowed_tools,
        default_source_scope=body.default_source_scope,
        default_output_structure=body.default_output_structure,
        word_template=body.word_template,
        version=1,
        test_cases_json=body.test_cases,
        review_status=body.review_status,
        created_by=actor_id,
        updated_by=actor_id,
    )
    db.add(row)
    db.flush()
    _save_version(db, row, actor_id=actor_id, action="create")
    return row


def update_mode(
    db: Session,
    *,
    mode_uuid: str,
    body: AssistantModeUpsertIn,
    actor_id: str,
) -> Assistant:
    row = get_mode(db, mode_uuid)
    if body.code != row.code:
        raise GovernanceError(409, "ASSISTANT_MODE_CODE_IMMUTABLE", "助手模式编码不可修改")
    row.name = body.name
    row.description = body.description
    row.icon = body.icon
    row.allowed_tools_json = body.allowed_tools
    row.default_source_scope = body.default_source_scope
    row.default_output_structure = body.default_output_structure
    row.word_template = body.word_template
    row.test_cases_json = body.test_cases
    row.review_status = body.review_status
    row.version += 1
    row.updated_by = actor_id
    _save_version(db, row, actor_id=actor_id, action="update")
    return row


def set_mode_status(
    db: Session,
    *,
    mode_uuid: str,
    status: str,
    actor_id: str,
) -> Assistant:
    row = get_mode(db, mode_uuid)
    if status == "ACTIVE" and row.review_status != "approved":
        raise GovernanceError(409, "ASSISTANT_MODE_REVIEW_REQUIRED", "助手模式审核通过后才能启用")
    if row.status == status:
        return row
    row.status = status
    row.version += 1
    row.updated_by = actor_id
    _save_version(db, row, actor_id=actor_id, action=status.lower())
    return row


def rollback_mode(
    db: Session,
    *,
    mode_uuid: str,
    version: int,
    actor_id: str,
) -> Assistant:
    row = get_mode(db, mode_uuid)
    target = db.scalar(
        select(AssistantModeVersion).where(
            AssistantModeVersion.assistant_id == row.id,
            AssistantModeVersion.version == version,
        )
    )
    if target is None:
        raise GovernanceError(404, "ASSISTANT_MODE_VERSION_NOT_FOUND", "助手模式历史版本不存在")
    snapshot = target.snapshot_json or {}
    for field in (
        "name",
        "description",
        "icon",
        "default_source_scope",
        "default_output_structure",
        "word_template",
        "status",
        "review_status",
    ):
        if field in snapshot:
            setattr(row, field, snapshot[field])
    row.allowed_tools_json = list(snapshot.get("allowed_tools") or [])
    row.test_cases_json = list(snapshot.get("test_cases") or [])
    row.version += 1
    row.updated_by = actor_id
    _save_version(db, row, actor_id=actor_id, action="rollback")
    return row


def test_mode(row: Assistant, *, user_input: str) -> list[str]:
    issues = [
        f"工具不可用：{tool}"
        for tool in (row.allowed_tools_json or [])
        if tool not in AVAILABLE_MODE_TOOLS
    ]
    if not row.default_output_structure.strip():
        issues.append("未配置默认输出结构")
    if not user_input.strip() and not row.test_cases_json:
        issues.append("缺少测试输入")
    return issues


def mode_out(db: Session, row: Assistant) -> AssistantModeOut:
    total, failed = db.execute(
        select(
            func.count(GenerationRecord.id),
            func.sum(
                case((GenerationRecord.status == "FAILED", 1), else_=0)
            ),
        )
        .join(Task, Task.id == GenerationRecord.task_id)
        .where(Task.assistant_id == row.id)
    ).one()
    versions = list(db.scalars(
        select(AssistantModeVersion.version)
        .where(AssistantModeVersion.assistant_id == row.id)
        .order_by(AssistantModeVersion.version.desc())
    ))
    total_count = int(total or 0)
    failed_count = int(failed or 0)
    return AssistantModeOut(
        uuid=row.uuid,
        code=row.code,
        name=row.name,
        description=row.description,
        icon=row.icon,
        allowed_tools=list(row.allowed_tools_json or []),
        default_source_scope=row.default_source_scope,
        default_output_structure=row.default_output_structure,
        word_template=row.word_template,
        status=row.status,
        version=row.version,
        test_cases=list(row.test_cases_json or []),
        review_status=row.review_status,
        failure_rate=round(failed_count / total_count, 4) if total_count else 0.0,
        available_versions=versions,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )
