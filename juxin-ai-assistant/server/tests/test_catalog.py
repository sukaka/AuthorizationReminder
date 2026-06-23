import json
from copy import deepcopy
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.models import (
    Assistant,
    KnowledgeItem,
    KnowledgeTaskLink,
    Task,
    TaskField,
    TaskPromptBinding,
)

CATALOG_PATH = Path("catalog/assistants.json")
MANIFEST_PATH = Path("catalog/manual-v1.10.json")


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_catalog_contains_every_v110_manifest_task() -> None:
    catalog = load_json(CATALOG_PATH)
    manifest = load_json(MANIFEST_PATH)
    by_code = {item["code"]: item for item in catalog["assistants"]}
    tasks = {
        task["code"]: task
        for assistant in catalog["assistants"]
        for task in assistant["tasks"]
    }
    task_assistants = {
        task["code"]: assistant["code"]
        for assistant in catalog["assistants"]
        for task in assistant["tasks"]
    }

    assert {"presales", "software-testing"} <= set(by_code)
    assert len(tasks) == 88 + sum(
        task["merge_existing_code"] is None
        for task in manifest["tasks"]
    )
    for manifest_task in manifest["tasks"]:
        task_code = (
            manifest_task["merge_existing_code"]
            or manifest_task["code"]
        )
        task = tasks[task_code]
        assert task["prompt_content"] == manifest_task["prompt"]
        assert task["source_version"] == manifest["source"]["version"]
        assert task["source_ref"] == manifest_task["source_ref"]
        assert task["document_type"] == manifest_task["document_type"]
        assert task["formal_document"] == manifest_task["formal_document"]
        assert task["name"] == manifest_task["name"]
        if manifest_task["scene"]:
            assert task["description"] == manifest_task["scene"]
        else:
            assert task["description"].strip()
        assert task["fields"] == manifest_task["fields"]
        assert task["output_format"]
        assert task["safety_notice"]
        assert task_assistants[task_code] == manifest_task["assistant_code"]
        if manifest_task["merge_existing_code"]:
            assert task["code"] == manifest_task["merge_existing_code"]
        else:
            assert (
                task["prompt_external_id"]
                == manifest_task["prompt_external_id"]
            )

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
            assert isinstance(task["fields"], list)
            assert task["prompt_content"].strip()
            assert "source_version" in task
            assert "source_ref" in task
            assert task["document_type"]
            assert isinstance(task["formal_document"], bool)
            assert all(field["field_key"] for field in task["fields"])

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
    }


def test_catalog_validation_requires_runtime_metadata() -> None:
    from scripts.seed_catalog import validate_catalog

    catalog = load_json(CATALOG_PATH)
    task = catalog["assistants"][0]["tasks"][0]
    for field_name in (
        "prompt_content",
        "source_version",
        "source_ref",
        "document_type",
        "formal_document",
    ):
        invalid = deepcopy(catalog)
        invalid["assistants"][0]["tasks"][0].pop(field_name)
        with pytest.raises(ValueError, match=field_name):
            validate_catalog(invalid)


def test_catalog_validation_accepts_multiselect() -> None:
    from scripts.seed_catalog import validate_catalog

    catalog = load_json(CATALOG_PATH)
    assert any(
        field.get("field_type") == "MULTISELECT"
        for assistant in catalog["assistants"]
        for task in assistant["tasks"]
        for field in task["fields"]
    )
    validate_catalog(catalog)


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
    assistant_count = len(catalog["assistants"])
    task_count = sum(
        len(assistant["tasks"])
        for assistant in catalog["assistants"]
    )
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

    assert first["assistants_created"] == assistant_count
    assert first["tasks_created"] == task_count
    assert second["assistants_created"] == 0
    assert second["tasks_created"] == 0
    assert generation_db.scalar(
        select(func.count()).select_from(Assistant)
    ) == assistant_count
    assert generation_db.scalar(
        select(func.count()).select_from(Task)
    ) == task_count
    assert generation_db.scalar(
        select(func.count()).select_from(TaskPromptBinding)
    ) == task_count
    assert generation_db.scalar(
        select(func.count()).select_from(TaskField)
    ) >= task_count


@pytest.mark.asyncio
async def test_catalog_seed_keeps_missing_prompts_draft(generation_db) -> None:
    from scripts.seed_catalog import load_catalog, seed_catalog

    catalog = load_catalog()
    task_count = sum(
        len(assistant["tasks"])
        for assistant in catalog["assistants"]
    )
    report = await seed_catalog(
        generation_db,
        catalog,
        MissingCatalogPrompts(),
    )

    assert len(report["missing_prompts"]) == task_count
    assert set(
        generation_db.scalars(select(Task.status)).all()
    ) == {"DRAFT"}


@pytest.mark.asyncio
async def test_catalog_seed_upserts_manual_knowledge_and_task_links(
    generation_db,
) -> None:
    from scripts.seed_catalog import load_catalog, seed_catalog

    report = await seed_catalog(
        generation_db,
        load_catalog(),
        PublishedCatalogPrompts(),
        force_config=True,
    )

    assert report["knowledge_upserted"] > 0
    company = generation_db.scalar(
        select(KnowledgeItem).where(
            KnowledgeItem.title == "聚信得仁公司知识与官网口径 V1.10"
        )
    )
    assert company is not None
    assert generation_db.scalar(
        select(func.count())
        .select_from(KnowledgeTaskLink)
        .where(KnowledgeTaskLink.knowledge_id == company.id)
    ) > 88
    assert set(
        generation_db.scalars(select(KnowledgeItem.category)).all()
    ) <= {
        "COMPANY",
        "PRODUCT",
        "SERVICE",
        "SALES_SCRIPT",
        "DELIVERY",
        "TENDER",
        "FAQ",
        "CASE",
        "TRAINING",
        "COMPLIANCE",
        "TECHNICAL",
    }


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
        select(TaskField)
        .where(TaskField.task_id == task.id)
        .order_by(TaskField.sort_order)
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


def old_meeting_minutes_catalog() -> dict:
    return {
        "version": 1,
        "field_templates": {},
        "assistants": [
            {
                "code": "general",
                "name": "通用助手",
                "description": "旧助手描述",
                "icon": "sparkles",
                "sort_order": 10,
                "tasks": [
                    {
                        "code": "meeting-minutes",
                        "name": "会议纪要",
                        "description": "旧任务描述",
                        "output_format": "Markdown",
                        "safety_notice": "旧安全提醒",
                        "prompt_external_id": 1002,
                        "prompt_content": "旧版会议纪要 Prompt",
                        "source_version": "",
                        "source_ref": "",
                        "document_type": "PLAIN_TEXT",
                        "formal_document": False,
                        "status": "DRAFT",
                        "fields": [
                            {
                                "field_key": "background",
                                "label": "背景信息",
                                "field_type": "TEXTAREA",
                                "required": True,
                                "sort_order": 10,
                            }
                        ],
                    }
                ],
            }
        ],
    }


@pytest.mark.asyncio
async def test_force_v110_preserves_existing_task_identity(generation_db) -> None:
    from scripts.seed_catalog import load_catalog, seed_catalog

    await seed_catalog(
        generation_db,
        old_meeting_minutes_catalog(),
        PublishedCatalogPrompts(),
    )
    before = generation_db.scalar(
        select(Task).where(Task.code == "meeting-minutes")
    )
    identity = (before.id, before.uuid)

    await seed_catalog(
        generation_db,
        load_catalog(),
        PublishedCatalogPrompts(),
        force_config=True,
    )
    after = generation_db.scalar(
        select(Task).where(Task.code == "meeting-minutes")
    )

    assert (after.id, after.uuid) == identity
    assert after.source_version == "V1.10"
    assert after.source_ref
    assert after.document_type == "MINUTES"
    assert after.formal_document is True


def single_task_catalog() -> dict:
    return {
        "version": 1,
        "field_templates": {},
        "assistants": [
            {
                "code": "general",
                "name": "通用助手",
                "description": "描述",
                "icon": "sparkles",
                "sort_order": 10,
                "tasks": [
                    {
                        "code": "sample",
                        "name": "示例任务",
                        "description": "描述",
                        "output_format": "Markdown",
                        "safety_notice": "需人工复核",
                        "prompt_external_id": 7,
                        "prompt_content": "处理 {{background}}",
                        "source_version": "V1.10",
                        "source_ref": "V1.10｜测试",
                        "document_type": "PLAIN_TEXT",
                        "formal_document": False,
                        "status": "DRAFT",
                        "fields": [
                            {
                                "field_key": "background",
                                "label": "背景",
                                "field_type": "MULTISELECT",
                                "required": True,
                                "options_json": ["甲", "乙"],
                                "sort_order": 10,
                            }
                        ],
                    }
                ],
            }
        ],
    }


class VersionedCatalogPrompts:
    def __init__(self, published_versions: dict[int, int]) -> None:
        self.published_versions = published_versions
        self.calls: list[tuple[int, int | None]] = []

    async def get_published(
        self,
        prompt_id: int,
        version: int | None = None,
    ) -> dict:
        self.calls.append((prompt_id, version))
        published = self.published_versions[prompt_id]
        if version is not None and version != published:
            raise LookupError("版本未发布")
        return {
            "prompt_id": prompt_id,
            "version_no": published,
            "content": "Prompt",
        }


@pytest.mark.asyncio
async def test_staged_prompts_pin_validated_versions(generation_db) -> None:
    from scripts.seed_catalog import seed_catalog

    client = VersionedCatalogPrompts({7: 3})
    await seed_catalog(
        generation_db,
        single_task_catalog(),
        client,
        staged_prompts={7: 3},
    )
    binding = generation_db.scalar(select(TaskPromptBinding))

    assert client.calls == [(7, 3)]
    assert binding.version_policy == "PINNED"
    assert binding.pinned_version == 3
    assert binding.status == "ACTIVE"


@pytest.mark.asyncio
async def test_staged_prompts_reject_admin_custom_binding_without_force(
    generation_db,
) -> None:
    from scripts.seed_catalog import seed_catalog

    catalog = single_task_catalog()
    await seed_catalog(
        generation_db,
        catalog,
        VersionedCatalogPrompts({7: 1}),
    )
    binding = generation_db.scalar(select(TaskPromptBinding))
    binding.prompt_external_id = 70
    generation_db.commit()

    with pytest.raises(ValueError, match="--force-config"):
        await seed_catalog(
            generation_db,
            catalog,
            VersionedCatalogPrompts({7: 3}),
            staged_prompts={7: 3},
        )

    generation_db.refresh(binding)
    assert binding.prompt_external_id == 70
    assert binding.version_policy == "PUBLISHED"
    assert binding.pinned_version is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "staged_prompts",
    ({}, {7: 0}, {8: 1}, {7: 1, 8: 1}),
)
async def test_staged_prompts_reject_invalid_mapping_atomically(
    generation_db,
    staged_prompts,
) -> None:
    from scripts.seed_catalog import seed_catalog

    with pytest.raises(ValueError):
        await seed_catalog(
            generation_db,
            single_task_catalog(),
            VersionedCatalogPrompts({7: 1}),
            staged_prompts=staged_prompts,
        )

    assert generation_db.scalar(
        select(func.count()).select_from(Assistant)
    ) == 0


@pytest.mark.asyncio
async def test_staged_prompts_reject_unpublished_version_atomically(
    generation_db,
) -> None:
    from scripts.seed_catalog import seed_catalog

    with pytest.raises(ValueError, match="尚未发布"):
        await seed_catalog(
            generation_db,
            single_task_catalog(),
            VersionedCatalogPrompts({7: 2}),
            staged_prompts={7: 3},
        )

    assert generation_db.scalar(
        select(func.count()).select_from(Assistant)
    ) == 0


@pytest.mark.asyncio
async def test_finalize_published_only_matching_active_bindings(
    generation_db,
) -> None:
    from scripts.seed_catalog import seed_catalog

    catalog = single_task_catalog()
    client = VersionedCatalogPrompts({7: 2})
    await seed_catalog(
        generation_db,
        catalog,
        client,
        staged_prompts={7: 2},
    )
    await seed_catalog(
        generation_db,
        catalog,
        client,
        staged_prompts={7: 2},
        finalize_published=True,
    )
    binding = generation_db.scalar(select(TaskPromptBinding))

    assert binding.version_policy == "PUBLISHED"
    assert binding.pinned_version is None
    assert binding.status == "ACTIVE"


@pytest.mark.asyncio
async def test_finalize_published_leaves_mismatched_binding_pinned(
    generation_db,
) -> None:
    from scripts.seed_catalog import seed_catalog

    catalog = single_task_catalog()
    client = VersionedCatalogPrompts({7: 2})
    await seed_catalog(
        generation_db,
        catalog,
        client,
        staged_prompts={7: 2},
    )
    binding = generation_db.scalar(select(TaskPromptBinding))
    binding.pinned_version = 1
    generation_db.commit()

    await seed_catalog(
        generation_db,
        catalog,
        client,
        staged_prompts={7: 2},
        finalize_published=True,
    )
    generation_db.refresh(binding)

    assert binding.version_policy == "PINNED"
    assert binding.pinned_version == 1


@pytest.mark.asyncio
async def test_finalize_published_leaves_inactive_matching_binding_pinned(
    generation_db,
) -> None:
    from scripts.seed_catalog import seed_catalog

    catalog = single_task_catalog()
    client = VersionedCatalogPrompts({7: 2})
    await seed_catalog(
        generation_db,
        catalog,
        client,
        staged_prompts={7: 2},
    )
    binding = generation_db.scalar(select(TaskPromptBinding))
    binding.status = "DISABLED"
    generation_db.commit()

    await seed_catalog(
        generation_db,
        catalog,
        client,
        staged_prompts={7: 2},
        finalize_published=True,
    )
    generation_db.refresh(binding)

    assert binding.version_policy == "PINNED"
    assert binding.pinned_version == 2
