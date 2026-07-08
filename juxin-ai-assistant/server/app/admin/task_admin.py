from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..models import (
    Assistant,
    GenerationRecord,
    Task,
    TaskField,
    TaskPromptBinding,
)
from .errors import GovernanceError
from .schemas import (
    TaskAdminOut,
    TaskCreateIn,
    TaskFieldAdminOut,
    TaskFieldsReplaceIn,
    PromptBindingOut,
)


def _task_or_error(db: Session, task_uuid: str) -> Task:
    task = db.scalar(select(Task).where(Task.uuid == task_uuid))
    if task is None:
        raise GovernanceError(404, "TASK_NOT_FOUND", "任务不存在")
    return task


def task_out(db: Session, task: Task) -> TaskAdminOut:
    assistant_uuid = db.scalar(
        select(Assistant.uuid).where(Assistant.id == task.assistant_id)
    )
    fields = db.scalars(
        select(TaskField)
        .where(TaskField.task_id == task.id)
        .order_by(TaskField.sort_order, TaskField.id)
    ).all()
    binding = db.scalar(
        select(TaskPromptBinding).where(TaskPromptBinding.task_id == task.id)
    )
    return TaskAdminOut(
        uuid=task.uuid,
        assistant_uuid=assistant_uuid or "",
        code=task.code,
        name=task.name,
        description=task.description,
        output_format=task.output_format,
        safety_notice=task.safety_notice,
        sort_order=task.sort_order,
        status=task.status,
        fields=[
            TaskFieldAdminOut(
                field_key=field.field_key,
                label=field.label,
                field_type=field.field_type.upper(),
                required=field.required,
                placeholder=field.placeholder,
                example=field.example,
                options=field.options_json or [],
                validation=field.validation_json or {},
                sort_order=field.sort_order,
            )
            for field in fields
        ],
        prompt_binding=(
            PromptBindingOut(
                prompt_external_id=binding.prompt_external_id,
                version_policy=binding.version_policy,
                pinned_version=binding.pinned_version,
                status=binding.status,
            )
            if binding is not None
            else None
        ),
    )


def list_tasks(db: Session) -> list[TaskAdminOut]:
    tasks = db.scalars(select(Task).order_by(Task.sort_order, Task.id)).all()
    return [task_out(db, task) for task in tasks]


def create_task(db: Session, body: TaskCreateIn, actor_id: str) -> Task:
    assistant = db.scalar(
        select(Assistant).where(Assistant.uuid == body.assistant_uuid)
    )
    if assistant is None:
        raise GovernanceError(422, "ASSISTANT_NOT_FOUND", "助手不存在")
    if db.scalar(select(Task.id).where(Task.code == body.code)) is not None:
        raise GovernanceError(409, "TASK_CODE_EXISTS", "任务编码已存在")
    task = Task(
        assistant_id=assistant.id,
        code=body.code,
        name=body.name,
        description=body.description,
        output_format=body.output_format,
        safety_notice=body.safety_notice,
        sort_order=body.sort_order,
        status="DRAFT",
        created_by=actor_id,
        updated_by=actor_id,
    )
    db.add(task)
    db.flush()
    return task


def replace_fields(
    db: Session,
    task_uuid: str,
    body: TaskFieldsReplaceIn,
    actor_id: str,
) -> Task:
    task = _task_or_error(db, task_uuid)
    db.execute(delete(TaskField).where(TaskField.task_id == task.id))
    db.add_all(
        [
            TaskField(
                task_id=task.id,
                field_key=item.field_key,
                label=item.label,
                field_type=item.field_type.value.lower(),
                required=item.required,
                placeholder=item.placeholder,
                example=item.example,
                options_json=item.options,
                validation_json=item.validation,
                sort_order=item.sort_order,
                created_by=actor_id,
                updated_by=actor_id,
            )
            for item in body.fields
        ]
    )
    task.updated_by = actor_id
    db.flush()
    return task


def delete_draft_task(db: Session, task_uuid: str) -> None:
    task = _task_or_error(db, task_uuid)
    generation_count = db.scalar(
        select(func.count(GenerationRecord.id)).where(
            GenerationRecord.task_id == task.id
        )
    ) or 0
    if task.status != "DRAFT" or task.ever_active or generation_count:
        raise GovernanceError(
            409,
            "TASK_DISABLE_REQUIRED",
            "已有使用记录或非草稿任务只能停用",
        )
    db.delete(task)
