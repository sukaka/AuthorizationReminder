import asyncio
import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal
from app.models import Assistant, Task, TaskField, TaskPromptBinding
from app.prompt_client import PromptCenterClient


FIELD_DEFINITIONS = (
    {
        "field_key": "work_content",
        "label": "工作内容",
        "field_type": "TEXTAREA",
        "required": True,
        "placeholder": "写下本期完成的工作、进展和问题",
        "options_json": [],
        "sort_order": 10,
    },
    {
        "field_key": "period",
        "label": "总结周期",
        "field_type": "TEXT",
        "required": False,
        "placeholder": "例如：本周、2026 年 6 月",
        "options_json": [],
        "sort_order": 20,
    },
    {
        "field_key": "audience",
        "label": "阅读对象",
        "field_type": "SELECT",
        "required": False,
        "placeholder": "",
        "options_json": ["直属领导", "项目组", "部门全员", "客户"],
        "sort_order": 30,
    },
)


async def seed_work_summary(
    db: Session,
    prompt_client: PromptCenterClient,
    *,
    prompt_id: int,
    fail_if_unpublished: bool = False,
) -> Task:
    assistant = db.scalar(select(Assistant).where(Assistant.code == "general"))
    if assistant is None:
        assistant = Assistant(
            uuid="general",
            code="general",
            name="通用助手",
            description="总结、润色与日常办公表达",
            icon="sparkles",
            sort_order=10,
            status="ACTIVE",
        )
        db.add(assistant)
        db.flush()
    else:
        assistant.name = "通用助手"
        assistant.description = "总结、润色与日常办公表达"
        assistant.status = "ACTIVE"

    task = db.scalar(select(Task).where(Task.code == "work-summary"))
    if task is None:
        task = Task(
            uuid="work-summary",
            assistant_id=assistant.id,
            code="work-summary",
            name="工作总结",
        )
        db.add(task)
        db.flush()
    task.assistant_id = assistant.id
    task.name = "工作总结"
    task.description = "把零散进展整理成结构清晰、重点明确、适合汇报的工作总结。"
    task.output_format = "Markdown"
    task.safety_notice = "生成内容需由员工复核后再对外发送。"
    task.sort_order = 10

    existing_fields = {
        field.field_key: field
        for field in db.scalars(
            select(TaskField).where(TaskField.task_id == task.id)
        ).all()
    }
    for definition in FIELD_DEFINITIONS:
        field = existing_fields.get(definition["field_key"])
        if field is None:
            field = TaskField(task_id=task.id, field_key=definition["field_key"])
            db.add(field)
        for key, value in definition.items():
            setattr(field, key, value)

    binding = db.scalar(
        select(TaskPromptBinding).where(TaskPromptBinding.task_id == task.id)
    )
    if binding is None:
        binding = TaskPromptBinding(task_id=task.id)
        db.add(binding)
    binding.prompt_external_id = prompt_id
    binding.version_policy = "PUBLISHED"
    binding.pinned_version = None
    binding.status = "ACTIVE"

    try:
        await prompt_client.get_published(prompt_id)
    except (LookupError, ValueError):
        task.status = "DRAFT"
        db.commit()
        if fail_if_unpublished:
            raise RuntimeError("工作总结 Prompt 尚未发布，任务保持 DRAFT")
    else:
        task.status = "ACTIVE"
        db.commit()
    db.refresh(task)
    return task


async def async_main() -> None:
    settings = get_settings()
    prompt_id = int(os.environ["WORK_SUMMARY_PROMPT_ID"])
    prompt_client = PromptCenterClient(
        settings.prompt_center_url,
        settings.prompt_center_runtime_token,
        settings.auth_fetch_timeout_ms / 1000,
    )
    with SessionLocal() as db:
        await seed_work_summary(
            db,
            prompt_client,
            prompt_id=prompt_id,
            fail_if_unpublished=os.environ.get("SEED_REQUIRE_PUBLISHED", "true").lower()
            in {"1", "true", "yes"},
        )


def main() -> None:
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
