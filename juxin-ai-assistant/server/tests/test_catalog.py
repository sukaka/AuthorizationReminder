import json
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.models import Assistant, Task, TaskField, TaskPromptBinding

EXPECTED_COUNTS = {
    "general": 8,
    "sales": 12,
    "delivery": 12,
    "tender": 16,
    "hr": 10,
    "security": 11,
    "documents": 9,
    "training": 10,
}


def test_catalog_contains_all_confirmed_assistants_and_tasks() -> None:
    catalog = json.loads(
        Path("catalog/assistants.json").read_text(encoding="utf-8")
    )
    by_code = {item["code"]: item for item in catalog["assistants"]}

    assert set(by_code) == set(EXPECTED_COUNTS)
    assert {
        code: len(assistant["tasks"])
        for code, assistant in by_code.items()
    } == EXPECTED_COUNTS
    assert sum(EXPECTED_COUNTS.values()) == 88
    assert {
        task["name"]
        for task in by_code["sales"]["tasks"]
    } >= {"报价说明生成", "合同初稿辅助", "回款跟进话术"}
    tender_names = {
        task["name"]
        for task in by_code["tender"]["tasks"]
    }
    assert {
        "合同初稿辅助",
        "报价说明生成",
        "回款跟进话术",
    }.isdisjoint(tender_names)
    assert {
        "招标文件解读",
        "评分项分析",
        "废标风险检查",
    } <= tender_names

    task_codes: set[str] = set()
    prompt_ids: set[int] = set()
    for assistant in catalog["assistants"]:
        for task in assistant["tasks"]:
            assert task["code"] not in task_codes
            task_codes.add(task["code"])
            assert task["prompt_external_id"] > 0
            assert task["prompt_external_id"] not in prompt_ids
            prompt_ids.add(task["prompt_external_id"])
            assert task["status"] == "DRAFT"
            assert task["fields"]
            assert all(field["field_key"] for field in task["fields"])

    tasks = {
        task["code"]: task
        for assistant in catalog["assistants"]
        for task in assistant["tasks"]
    }
    assert {
        field["field_key"]
        for field in tasks["work-summary"]["fields"]
    } >= {"work_content", "period", "audience"}
    assert {
        field["field_key"]
        for field in tasks["quote-explanation"]["fields"]
    } >= {"customer_background", "quote_items"}
    assert {
        field["field_key"]
        for field in tasks["contract-draft-assist"]["fields"]
    } >= {"parties", "subject_matter", "key_terms"}
    assert {
        field["field_key"]
        for field in tasks["tender-document-interpretation"]["fields"]
    } >= {"tender_content", "focus_areas"}


class PublishedCatalogPrompts:
    async def get_published(
        self,
        prompt_id: int,
        version: int | None = None,
    ) -> dict:
        return {
            "prompt_id": prompt_id,
            "version_no": 1,
            "content": "处理 {{background}}",
        }


class MissingCatalogPrompts:
    async def get_published(
        self,
        prompt_id: int,
        version: int | None = None,
    ) -> dict:
        raise LookupError(f"{prompt_id} 未发布")


@pytest.mark.asyncio
async def test_catalog_seed_is_idempotent(generation_db) -> None:
    from scripts.seed_catalog import load_catalog, seed_catalog

    catalog = load_catalog()
    first = await seed_catalog(
        generation_db,
        catalog,
        PublishedCatalogPrompts(),
    )
    second = await seed_catalog(
        generation_db,
        catalog,
        PublishedCatalogPrompts(),
    )

    assert first["assistants_created"] == 8
    assert first["tasks_created"] == 88
    assert second["assistants_created"] == 0
    assert second["tasks_created"] == 0
    assert generation_db.scalar(
        select(func.count()).select_from(Assistant)
    ) == 8
    assert generation_db.scalar(
        select(func.count()).select_from(Task)
    ) == 88
    assert generation_db.scalar(
        select(func.count()).select_from(TaskPromptBinding)
    ) == 88
    assert generation_db.scalar(
        select(func.count()).select_from(TaskField)
    ) >= 88 * 3


@pytest.mark.asyncio
async def test_catalog_seed_keeps_missing_prompts_draft(generation_db) -> None:
    from scripts.seed_catalog import load_catalog, seed_catalog

    report = await seed_catalog(
        generation_db,
        load_catalog(),
        MissingCatalogPrompts(),
    )

    assert len(report["missing_prompts"]) == 88
    assert set(
        generation_db.scalars(select(Task.status)).all()
    ) == {"DRAFT"}


@pytest.mark.asyncio
async def test_catalog_seed_preserves_admin_edits_without_force(
    generation_db,
) -> None:
    from scripts.seed_catalog import load_catalog, seed_catalog

    catalog = load_catalog()
    await seed_catalog(
        generation_db,
        catalog,
        PublishedCatalogPrompts(),
    )
    task = generation_db.scalar(
        select(Task).where(Task.code == "meeting-minutes")
    )
    field = generation_db.scalar(
        select(TaskField).where(
            TaskField.task_id == task.id,
            TaskField.field_key == "background",
        )
    )
    task.description = "管理员自定义描述"
    field.label = "管理员自定义字段"
    generation_db.commit()

    await seed_catalog(
        generation_db,
        catalog,
        PublishedCatalogPrompts(),
    )
    generation_db.refresh(task)
    generation_db.refresh(field)

    assert task.description == "管理员自定义描述"
    assert field.label == "管理员自定义字段"
