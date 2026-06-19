import pytest
from sqlalchemy import func, select

from app.models import Assistant, Task, TaskField, TaskPromptBinding


class PublishedPromptClient:
    async def get_published(self, prompt_id: int, version: int | None = None):
        assert prompt_id == 7
        assert version is None
        return {"prompt_id": 7, "version_no": 3, "content": "{{work_content}}"}


class MissingPromptClient:
    async def get_published(self, prompt_id: int, version: int | None = None):
        raise LookupError("not published")


@pytest.mark.asyncio
async def test_seed_is_idempotent_and_activates_only_a_published_prompt(generation_db):
    from scripts.seed import seed_work_summary

    await seed_work_summary(generation_db, PublishedPromptClient(), prompt_id=7)
    await seed_work_summary(generation_db, PublishedPromptClient(), prompt_id=7)

    assert generation_db.scalar(select(func.count()).select_from(Assistant)) == 1
    assert generation_db.scalar(select(func.count()).select_from(Task)) == 1
    assert generation_db.scalar(select(func.count()).select_from(TaskField)) == 3
    assert generation_db.scalar(select(func.count()).select_from(TaskPromptBinding)) == 1
    task = generation_db.scalar(select(Task).where(Task.code == "work-summary"))
    assert task.uuid == "work-summary"
    assert task.status == "ACTIVE"


@pytest.mark.asyncio
async def test_seed_keeps_task_draft_when_prompt_is_not_published(generation_db):
    from scripts.seed import seed_work_summary

    await seed_work_summary(generation_db, MissingPromptClient(), prompt_id=7)

    task = generation_db.scalar(select(Task).where(Task.code == "work-summary"))
    assert task.status == "DRAFT"
