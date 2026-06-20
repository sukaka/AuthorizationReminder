from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Task, TaskPromptBinding
from ..prompt_client import PromptCenterClient
from .errors import GovernanceError
from .schemas import (
    PromptBindingIn,
    TaskConfigurationIn,
    TaskFieldsReplaceIn,
    TaskUpdateIn,
    VersionPolicy,
)
from .task_admin import _task_or_error, replace_fields


def _apply_task_update(
    task: Task,
    body: TaskUpdateIn,
    actor_id: str,
) -> None:
    updates = body.model_dump(exclude_none=True)
    status = updates.pop("status", None)
    for key, value in updates.items():
        setattr(task, key, value)
    if status is not None:
        task.ever_active = (
            task.ever_active
            or task.status != "DRAFT"
            or status.value == "ACTIVE"
        )
        task.status = status.value
    task.updated_by = actor_id


async def _validate_prompt_binding(
    body: PromptBindingIn,
    prompt_client: PromptCenterClient,
) -> None:
    version = (
        body.pinned_version
        if body.version_policy is VersionPolicy.PINNED
        else None
    )
    try:
        await prompt_client.get_published(body.prompt_external_id, version)
    except LookupError as exc:
        raise GovernanceError(
            409,
            "PUBLISHED_PROMPT_REQUIRED",
            "绑定的已发布 Prompt 不可用",
        ) from exc


def _upsert_prompt_binding(
    db: Session,
    task: Task,
    body: PromptBindingIn,
    actor_id: str,
) -> None:
    binding = db.scalar(
        select(TaskPromptBinding).where(TaskPromptBinding.task_id == task.id)
    )
    if binding is None:
        binding = TaskPromptBinding(task_id=task.id)
        db.add(binding)
    binding.prompt_external_id = body.prompt_external_id
    binding.version_policy = body.version_policy.value
    binding.pinned_version = body.pinned_version
    binding.status = body.status
    binding.updated_by = actor_id
    task.updated_by = actor_id


async def update_task(
    db: Session,
    task_uuid: str,
    body: TaskUpdateIn,
    actor_id: str,
    prompt_client: PromptCenterClient,
) -> Task:
    task = _task_or_error(db, task_uuid)
    if body.status is not None and body.status.value == "ACTIVE":
        binding = db.scalar(
            select(TaskPromptBinding).where(
                TaskPromptBinding.task_id == task.id,
                TaskPromptBinding.status == "ACTIVE",
            )
        )
        if binding is None:
            raise GovernanceError(
                409,
                "PUBLISHED_PROMPT_REQUIRED",
                "启用任务前必须绑定已发布 Prompt",
            )
        version = (
            binding.pinned_version
            if binding.version_policy == VersionPolicy.PINNED.value
            else None
        )
        try:
            await prompt_client.get_published(binding.prompt_external_id, version)
        except LookupError as exc:
            raise GovernanceError(
                409,
                "PUBLISHED_PROMPT_REQUIRED",
                "绑定的已发布 Prompt 不可用",
            ) from exc
    _apply_task_update(task, body, actor_id)
    return task


async def update_prompt_binding(
    db: Session,
    task_uuid: str,
    body: PromptBindingIn,
    actor_id: str,
    prompt_client: PromptCenterClient,
) -> Task:
    task = _task_or_error(db, task_uuid)
    await _validate_prompt_binding(body, prompt_client)
    _upsert_prompt_binding(db, task, body, actor_id)
    db.flush()
    return task


async def update_task_configuration(
    db: Session,
    task_uuid: str,
    body: TaskConfigurationIn,
    actor_id: str,
    prompt_client: PromptCenterClient,
) -> Task:
    task = _task_or_error(db, task_uuid)
    target_status = (
        body.task.status.value
        if body.task.status is not None
        else task.status
    )
    if target_status == "ACTIVE" and body.prompt_binding.status != "ACTIVE":
        raise GovernanceError(
            409,
            "PUBLISHED_PROMPT_REQUIRED",
            "启用任务必须绑定有效的已发布 Prompt",
        )
    await _validate_prompt_binding(body.prompt_binding, prompt_client)
    with db.begin_nested():
        _upsert_prompt_binding(
            db,
            task,
            body.prompt_binding,
            actor_id,
        )
        replace_fields(
            db,
            task_uuid,
            TaskFieldsReplaceIn(fields=body.fields),
            actor_id,
        )
        _apply_task_update(task, body.task, actor_id)
        db.flush()
    return task
