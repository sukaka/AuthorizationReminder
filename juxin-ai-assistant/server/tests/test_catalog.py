import json
import os
from copy import deepcopy
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.crypto import ContentCipher, EncryptedPayload
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
async def test_catalog_seed_upserts_quality_rules_idempotently_and_scopes_links(
    generation_db,
) -> None:
    from scripts.seed_catalog import load_catalog, seed_catalog

    catalog = load_catalog()
    manifest = load_json(MANIFEST_PATH)
    cipher = ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"])

    await seed_catalog(
        generation_db,
        catalog,
        PublishedCatalogPrompts(),
        force_config=True,
        cipher=cipher,
        key_version="v1",
    )
    first_rules = generation_db.scalars(
        select(KnowledgeItem).where(
            KnowledgeItem.tags_json.contains("quality-rule")
        )
    ).all()
    first_by_key = {
        next(
            tag.removeprefix("key:")
            for tag in item.tags_json
            if tag.startswith("key:")
        ): item.uuid
        for item in first_rules
    }

    await seed_catalog(
        generation_db,
        catalog,
        PublishedCatalogPrompts(),
        force_config=True,
        cipher=cipher,
        key_version="v1",
    )
    rules = generation_db.scalars(
        select(KnowledgeItem).where(
            KnowledgeItem.tags_json.contains("quality-rule")
        )
    ).all()
    second_by_key = {
        next(
            tag.removeprefix("key:")
            for tag in item.tags_json
            if tag.startswith("key:")
        ): item.uuid
        for item in rules
    }

    assert len(rules) == len(manifest["quality_rules"]) == 12
    assert second_by_key == first_by_key
    assert all(
        {"manual:V1.10", "quality-rule"} <= set(item.tags_json)
        for item in rules
    )
    assert all(
        item.category
        in {
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
        for item in rules
    )
    by_title = {
        rule["source_title"]: rule["prompt"]
        for rule in manifest["quality_rules"]
    }
    assert all(
        item.content_ciphertext != by_title[item.title].encode()
        for item in rules
    )
    assert {
        cipher.decrypt_json(
            EncryptedPayload(
                ciphertext=item.content_ciphertext,
                nonce=item.content_nonce,
            ),
            item.uuid.encode(),
        )["content"]
        for item in rules
    } == {content.strip() for content in by_title.values()}

    for rule in rules:
        assistant_tag = next(
            tag for tag in rule.tags_json if tag.startswith("assistant:")
        )
        assistant_code = assistant_tag.split(":", 1)[1]
        linked_assistants = set(
            generation_db.scalars(
                select(Assistant.code)
                .join(Task, Task.assistant_id == Assistant.id)
                .join(
                    KnowledgeTaskLink,
                    KnowledgeTaskLink.task_id == Task.id,
                )
                .where(KnowledgeTaskLink.knowledge_id == rule.id)
            ).all()
        )
        assert linked_assistants == {assistant_code}

    catalog_task_count = sum(
        len(assistant["tasks"]) for assistant in catalog["assistants"]
    )
    assert generation_db.scalar(
        select(func.count()).select_from(Task)
    ) == catalog_task_count


@pytest.mark.asyncio
async def test_catalog_seed_rejects_quality_rule_for_unknown_assistant(
    generation_db,
) -> None:
    from scripts.seed_catalog import load_catalog, seed_catalog

    manifest = load_json(MANIFEST_PATH)
    manifest["quality_rules"][0]["assistant_code"] = "unknown-assistant"

    with pytest.raises(ValueError, match="unknown-assistant"):
        await seed_catalog(
            generation_db,
            load_catalog(),
            PublishedCatalogPrompts(),
            manual_manifest=manifest,
        )


@pytest.mark.asyncio
async def test_quality_rule_title_change_updates_same_seeded_row(
    generation_db,
) -> None:
    from scripts.seed_catalog import load_catalog, seed_catalog

    catalog = load_catalog()
    manifest = load_json(MANIFEST_PATH)
    await seed_catalog(
        generation_db,
        catalog,
        PublishedCatalogPrompts(),
        manual_manifest=manifest,
    )
    original = generation_db.scalar(
        select(KnowledgeItem).where(
            KnowledgeItem.title
            == manifest["quality_rules"][0]["source_title"]
        )
    )
    assert original is not None
    original_uuid = original.uuid

    changed = deepcopy(manifest)
    changed["quality_rules"][0]["source_title"] = "更新后的规则标题"
    await seed_catalog(
        generation_db,
        catalog,
        PublishedCatalogPrompts(),
        manual_manifest=changed,
    )

    updated = generation_db.scalar(
        select(KnowledgeItem).where(
            KnowledgeItem.title == "更新后的规则标题"
        )
    )
    active_rules = [
        row
        for row in generation_db.scalars(select(KnowledgeItem)).all()
        if row.status == "ACTIVE"
        and isinstance(row.tags_json, list)
        and "quality-rule" in row.tags_json
    ]
    assert updated is not None
    assert updated.uuid == original_uuid
    assert len(active_rules) == 12


@pytest.mark.asyncio
async def test_quality_rule_removal_deactivates_only_current_seed_rules(
    generation_db,
) -> None:
    from app.admin.knowledge_admin import update_knowledge
    from app.admin.schemas import KnowledgeUpdateIn
    from scripts.seed_catalog import (
        load_catalog,
        quality_rule_key,
        seed_catalog,
    )

    catalog = load_catalog()
    manifest = load_json(MANIFEST_PATH)
    cipher = ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"])
    await seed_catalog(
        generation_db,
        catalog,
        PublishedCatalogPrompts(),
        manual_manifest=manifest,
        cipher=cipher,
        key_version="v1",
    )
    removed_rule = manifest["quality_rules"][0]
    removed_key_tag = f"key:{quality_rule_key(removed_rule)}"
    removed = next(
        row
        for row in generation_db.scalars(select(KnowledgeItem)).all()
        if isinstance(row.tags_json, list)
        and removed_key_tag in row.tags_json
    )
    linked_task = generation_db.scalar(
        select(Task)
        .join(
            KnowledgeTaskLink,
            KnowledgeTaskLink.task_id == Task.id,
        )
        .where(KnowledgeTaskLink.knowledge_id == removed.id)
    )
    assert linked_task is not None
    update_knowledge(
        generation_db,
        removed.uuid,
        KnowledgeUpdateIn(content="管理员临时修改后又从 manifest 删除"),
        "admin-user",
        cipher,
        "v1",
    )
    generation_db.commit()
    assert removed.updated_by == "admin-user"

    def add_protected_rule(
        *,
        uuid: str,
        tags: list[str],
        created_by: str,
    ) -> KnowledgeItem:
        encrypted = cipher.encrypt_json({"content": uuid}, uuid.encode())
        item = KnowledgeItem(
            uuid=uuid,
            title=uuid,
            category="COMPANY",
            tags_json=tags,
            keywords_json=[],
            content_ciphertext=encrypted.ciphertext,
            content_nonce=encrypted.nonce,
            key_version="v1",
            priority=0,
            status="ACTIVE",
            created_by=created_by,
            updated_by=created_by,
        )
        generation_db.add(item)
        generation_db.flush()
        generation_db.add(
            KnowledgeTaskLink(
                knowledge_id=item.id,
                task_id=linked_task.id,
            )
        )
        return item

    admin_rule = add_protected_rule(
        uuid="admin-quality-rule",
        tags=[
            "manual:V1.10",
            "quality-rule",
            "assistant:presales",
            "key:quality-rule-presales-ffffffffffffffff",
        ],
        created_by="admin-user",
    )
    older_rule = add_protected_rule(
        uuid="older-quality-rule",
        tags=[
            "manual:V1.09",
            "quality-rule",
            "assistant:presales",
            "key:quality-rule-presales-eeeeeeeeeeeeeeee",
        ],
        created_by="manual-v1.10-seed",
    )
    invalid_key_rule = add_protected_rule(
        uuid="invalid-key-quality-rule",
        tags=[
            "manual:V1.10",
            "quality-rule",
            "assistant:presales",
            "key:quality-rule-presales-not-a-seed-hash",
        ],
        created_by="manual-v1.10-seed",
    )
    generation_db.commit()

    reduced = deepcopy(manifest)
    reduced["quality_rules"] = reduced["quality_rules"][1:]
    await seed_catalog(
        generation_db,
        catalog,
        PublishedCatalogPrompts(),
        manual_manifest=reduced,
        cipher=cipher,
        key_version="v1",
    )

    generation_db.refresh(removed)
    generation_db.refresh(admin_rule)
    generation_db.refresh(older_rule)
    generation_db.refresh(invalid_key_rule)
    company = generation_db.scalar(
        select(KnowledgeItem).where(
            KnowledgeItem.title
            == "聚信得仁公司知识与官网口径 V1.10"
        )
    )
    assert removed.status == "INACTIVE"
    assert generation_db.scalar(
        select(func.count())
        .select_from(KnowledgeTaskLink)
        .where(KnowledgeTaskLink.knowledge_id == removed.id)
    ) == 0
    assert admin_rule.status == "ACTIVE"
    assert older_rule.status == "ACTIVE"
    assert invalid_key_rule.status == "ACTIVE"
    assert generation_db.scalar(
        select(func.count())
        .select_from(KnowledgeTaskLink)
        .where(KnowledgeTaskLink.knowledge_id == invalid_key_rule.id)
    ) == 1
    assert company is not None and company.status == "ACTIVE"


@pytest.mark.asyncio
async def test_quality_rule_seed_rejects_admin_key_occupancy_and_rolls_back(
    generation_db,
) -> None:
    from scripts.seed_catalog import load_catalog, quality_rule_key, seed_catalog

    catalog = load_catalog()
    manifest = load_json(MANIFEST_PATH)
    rule = manifest["quality_rules"][0]
    key_tag = f"key:{quality_rule_key(rule)}"
    cipher = ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"])
    assistant = Assistant(
        code="admin-protected",
        name="管理员保护助手",
        status="ACTIVE",
    )
    generation_db.add(assistant)
    generation_db.flush()
    task = Task(
        assistant_id=assistant.id,
        code="admin-protected-task",
        name="管理员保护任务",
        status="ACTIVE",
    )
    generation_db.add(task)
    generation_db.flush()
    encrypted = cipher.encrypt_json(
        {"content": "管理员原始内容"},
        b"admin-key-occupancy",
    )
    occupied = KnowledgeItem(
        uuid="admin-key-occupancy",
        title="管理员占用的 key",
        category="COMPANY",
        tags_json=[key_tag, "admin-owned"],
        keywords_json=[],
        content_ciphertext=encrypted.ciphertext,
        content_nonce=encrypted.nonce,
        key_version="v1",
        priority=7,
        status="ACTIVE",
        created_by="admin-user",
        updated_by="admin-user",
    )
    generation_db.add(occupied)
    generation_db.flush()
    generation_db.add(
        KnowledgeTaskLink(knowledge_id=occupied.id, task_id=task.id)
    )
    generation_db.commit()

    with pytest.raises(ValueError, match="非 seed"):
        await seed_catalog(
            generation_db,
            catalog,
            PublishedCatalogPrompts(),
            manual_manifest=manifest,
            cipher=cipher,
            key_version="v1",
        )

    generation_db.refresh(occupied)
    payload = cipher.decrypt_json(
        EncryptedPayload(
            occupied.content_ciphertext,
            occupied.content_nonce,
        ),
        occupied.uuid.encode(),
    )
    assert payload["content"] == "管理员原始内容"
    assert occupied.tags_json == [key_tag, "admin-owned"]
    assert occupied.created_by == occupied.updated_by == "admin-user"
    assert generation_db.scalar(
        select(func.count())
        .select_from(KnowledgeTaskLink)
        .where(KnowledgeTaskLink.knowledge_id == occupied.id)
    ) == 1


@pytest.mark.asyncio
async def test_quality_rule_seed_rejects_duplicate_key_rows_and_rolls_back(
    generation_db,
) -> None:
    from scripts.seed_catalog import load_catalog, quality_rule_key, seed_catalog

    catalog = load_catalog()
    manifest = load_json(MANIFEST_PATH)
    key_tag = f"key:{quality_rule_key(manifest['quality_rules'][0])}"
    cipher = ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"])
    rows = []
    for index in range(2):
        uuid = f"duplicate-quality-key-{index}"
        encrypted = cipher.encrypt_json(
            {"content": f"重复原始内容 {index}"},
            uuid.encode(),
        )
        row = KnowledgeItem(
            uuid=uuid,
            title=f"重复规则 {index}",
            category="COMPANY",
            tags_json=[
                "manual:V1.10",
                "quality-rule",
                "assistant:presales",
                key_tag,
            ],
            keywords_json=[],
            content_ciphertext=encrypted.ciphertext,
            content_nonce=encrypted.nonce,
            key_version="v1",
            priority=index,
            status="ACTIVE",
            created_by="manual-v1.10-seed",
            updated_by="manual-v1.10-seed",
        )
        generation_db.add(row)
        rows.append(row)
    generation_db.commit()

    with pytest.raises(ValueError, match="重复"):
        await seed_catalog(
            generation_db,
            catalog,
            PublishedCatalogPrompts(),
            manual_manifest=manifest,
            cipher=cipher,
            key_version="v1",
        )

    assert generation_db.scalar(
        select(func.count()).select_from(KnowledgeItem)
    ) == 2
    for index, row in enumerate(rows):
        generation_db.refresh(row)
        payload = cipher.decrypt_json(
            EncryptedPayload(
                row.content_ciphertext,
                row.content_nonce,
            ),
            row.uuid.encode(),
        )
        assert payload["content"] == f"重复原始内容 {index}"
        assert row.status == "ACTIVE"


@pytest.mark.asyncio
async def test_quality_rule_seed_restores_admin_updated_seed_row(
    generation_db,
) -> None:
    from app.admin.knowledge_admin import update_knowledge
    from app.admin.schemas import KnowledgeUpdateIn
    from scripts.seed_catalog import load_catalog, quality_rule_key, seed_catalog

    catalog = load_catalog()
    manifest = load_json(MANIFEST_PATH)
    rule = manifest["quality_rules"][0]
    cipher = ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"])
    await seed_catalog(
        generation_db,
        catalog,
        PublishedCatalogPrompts(),
        manual_manifest=manifest,
        cipher=cipher,
        key_version="v1",
    )
    key_tag = f"key:{quality_rule_key(rule)}"
    seeded = next(
        row
        for row in generation_db.scalars(select(KnowledgeItem)).all()
        if isinstance(row.tags_json, list) and key_tag in row.tags_json
    )
    original_uuid = seeded.uuid
    update_knowledge(
        generation_db,
        seeded.uuid,
        KnowledgeUpdateIn(content="管理员临时改写"),
        "admin-user",
        cipher,
        "v1",
    )
    generation_db.commit()
    assert seeded.updated_by == "admin-user"

    await seed_catalog(
        generation_db,
        catalog,
        PublishedCatalogPrompts(),
        manual_manifest=manifest,
        cipher=cipher,
        key_version="v1",
    )

    generation_db.refresh(seeded)
    payload = cipher.decrypt_json(
        EncryptedPayload(
            seeded.content_ciphertext,
            seeded.content_nonce,
        ),
        seeded.uuid.encode(),
    )
    assert seeded.uuid == original_uuid
    assert seeded.created_by == seeded.updated_by == "manual-v1.10-seed"
    assert payload["content"] == rule["prompt"].strip()
    assert generation_db.scalar(
        select(func.count())
        .select_from(KnowledgeTaskLink)
        .where(KnowledgeTaskLink.knowledge_id == seeded.id)
    ) > 0


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
    def __init__(
        self,
        published_versions: dict[int, int],
        staged_versions: dict[int, int] | None = None,
    ) -> None:
        self.published_versions = published_versions
        self.staged_versions = staged_versions or published_versions
        self.calls: list[tuple[int, int | None]] = []
        self.staged_calls: list[tuple[int, int]] = []

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
            "content": "处理 {{background}}",
        }

    async def get_staged(self, prompt_id: int, version: int) -> dict:
        self.staged_calls.append((prompt_id, version))
        staged = self.staged_versions[prompt_id]
        if version != staged:
            raise LookupError("暂存版本不存在")
        return {
            "prompt_id": prompt_id,
            "version_no": staged,
            "content": "处理 {{background}}",
        }


@pytest.mark.asyncio
async def test_staged_prompts_pin_validated_versions(generation_db) -> None:
    from scripts.seed_catalog import seed_catalog

    client = VersionedCatalogPrompts({7: 2}, staged_versions={7: 3})
    await seed_catalog(
        generation_db,
        single_task_catalog(),
        client,
        staged_prompts={7: 3},
    )
    binding = generation_db.scalar(select(TaskPromptBinding))

    assert client.calls == []
    assert client.staged_calls == [(7, 3)]
    assert binding.version_policy == "PINNED"
    assert binding.pinned_version == 3
    assert binding.status == "ACTIVE"


@pytest.mark.asyncio
async def test_staged_prompts_reject_remote_identity_mismatch(
    generation_db,
) -> None:
    from scripts.seed_catalog import seed_catalog

    class MismatchedStagedPrompt(VersionedCatalogPrompts):
        async def get_staged(self, prompt_id: int, version: int) -> dict:
            return {
                "prompt_id": prompt_id,
                "version_no": version,
                "content": "被替换的 Prompt",
            }

    with pytest.raises(ValueError, match="与目录不一致"):
        await seed_catalog(
            generation_db,
            single_task_catalog(),
            MismatchedStagedPrompt({7: 2}, staged_versions={7: 3}),
            staged_prompts={7: 3},
        )

    assert generation_db.scalar(
        select(func.count()).select_from(Assistant)
    ) == 0


@pytest.mark.asyncio
async def test_staged_prompt_identity_uses_seed_whitespace_normalization(
    generation_db,
) -> None:
    from scripts.seed_catalog import seed_catalog

    catalog = single_task_catalog()
    catalog["assistants"][0]["tasks"][0]["prompt_content"] += "\n\n"

    await seed_catalog(
        generation_db,
        catalog,
        VersionedCatalogPrompts({7: 2}, staged_versions={7: 3}),
        staged_prompts={7: 3},
    )

    binding = generation_db.scalar(select(TaskPromptBinding))
    assert binding.pinned_version == 3


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

    with pytest.raises(ValueError, match="不存在或不可用"):
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
