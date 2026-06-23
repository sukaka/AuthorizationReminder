import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

CATALOG_PATH = ROOT_DIR / "catalog" / "assistants.json"
MANUAL_MANIFEST_PATH = ROOT_DIR / "catalog" / "manual-v1.10.json"
FIELD_TYPES = {
    "TEXT",
    "TEXTAREA",
    "NUMBER",
    "DATE",
    "DATETIME",
    "SELECT",
    "MULTISELECT",
    "CHECKBOX",
}
REQUIRED_TASK_FIELDS = (
    "prompt_content",
    "source_version",
    "source_ref",
    "document_type",
    "formal_document",
)


def load_catalog(path: Path = CATALOG_PATH) -> dict[str, Any]:
    catalog = json.loads(path.read_text(encoding="utf-8"))
    validate_catalog(catalog)
    return catalog


def validate_catalog(catalog: dict[str, Any]) -> None:
    assistants = catalog.get("assistants")
    templates = catalog.get("field_templates") or {}
    if not isinstance(assistants, list) or not assistants:
        raise ValueError("目录必须包含 assistants")
    assistant_codes: set[str] = set()
    task_codes: set[str] = set()
    prompt_ids: set[int] = set()
    for assistant in assistants:
        code = str(assistant.get("code") or "").strip()
        if not code or code in assistant_codes:
            raise ValueError(f"助手 code 缺失或重复：{code}")
        assistant_codes.add(code)
        tasks = assistant.get("tasks")
        if not isinstance(tasks, list) or not tasks:
            raise ValueError(f"助手 {code} 没有任务")
        for task in tasks:
            task_code = str(task.get("code") or "").strip()
            prompt_id = task.get("prompt_external_id")
            if not task_code or task_code in task_codes:
                raise ValueError(f"任务 code 缺失或重复：{task_code}")
            if not isinstance(prompt_id, int) or prompt_id <= 0:
                raise ValueError(f"任务 {task_code} 的 Prompt ID 无效")
            if prompt_id in prompt_ids:
                raise ValueError(f"Prompt ID 重复：{prompt_id}")
            task_codes.add(task_code)
            prompt_ids.add(prompt_id)
            for required_field in REQUIRED_TASK_FIELDS:
                if required_field not in task:
                    raise ValueError(
                        f"任务 {task_code} 缺少 {required_field}"
                    )
            if not str(task["prompt_content"]).strip():
                raise ValueError(f"任务 {task_code} 的 prompt_content 为空")
            if not str(task["document_type"]).strip():
                raise ValueError(f"任务 {task_code} 的 document_type 为空")
            if not isinstance(task["formal_document"], bool):
                raise ValueError(
                    f"任务 {task_code} 的 formal_document 必须为布尔值"
                )
            fields = task.get("fields")
            if not isinstance(fields, list):
                raise ValueError(f"任务 {task_code} 的动态字段格式无效")
            field_keys: set[str] = set()
            for field in fields:
                field_key = str(field.get("field_key") or "").strip()
                template_name = field.get("template")
                if not field_key or field_key in field_keys:
                    raise ValueError(
                        f"任务 {task_code} 的字段缺失或重复：{field_key}"
                    )
                if template_name and template_name not in templates:
                    raise ValueError(
                        f"任务 {task_code} 引用了未知字段模板：{template_name}"
                    )
                field_type = str(
                    field.get("field_type")
                    or (
                        templates.get(template_name, {})
                        if template_name
                        else {}
                    ).get("field_type")
                    or "TEXTAREA"
                ).upper()
                if field_type not in FIELD_TYPES:
                    raise ValueError(
                        f"任务 {task_code} 的字段类型无效：{field_type}"
                    )
                field_keys.add(field_key)


def normalize_staged_prompts(
    catalog: dict[str, Any],
    staged_prompts: dict[int | str, int] | None,
) -> dict[int, int] | None:
    if staged_prompts is None:
        return None
    if not isinstance(staged_prompts, dict):
        raise ValueError("staged prompts 必须是 Prompt ID 到版本号的映射")
    normalized: dict[int, int] = {}
    for raw_prompt_id, raw_version in staged_prompts.items():
        try:
            prompt_id = int(raw_prompt_id)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"非法 Prompt ID：{raw_prompt_id}") from exc
        if (
            isinstance(raw_version, bool)
            or not isinstance(raw_version, int)
            or raw_version <= 0
        ):
            raise ValueError(
                f"Prompt {prompt_id} 的 staged version 无效"
            )
        if prompt_id in normalized:
            raise ValueError(f"Prompt ID 重复：{prompt_id}")
        normalized[prompt_id] = raw_version

    catalog_prompt_ids = {
        int(task["prompt_external_id"])
        for assistant in catalog["assistants"]
        for task in assistant["tasks"]
    }
    staged_prompt_ids = set(normalized)
    missing = sorted(catalog_prompt_ids - staged_prompt_ids)
    unknown = sorted(staged_prompt_ids - catalog_prompt_ids)
    if missing or unknown:
        raise ValueError(
            "staged prompts 映射不完整"
            f"；缺失：{missing}；未知：{unknown}"
        )
    return normalized


def load_staged_prompts(path: Path) -> dict[int | str, int]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("staged prompts 文件必须是 JSON 对象")
    return payload


def load_manual_manifest(path: Path = MANUAL_MANIFEST_PATH) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def expand_field(
    catalog: dict[str, Any],
    raw_field: dict[str, Any],
) -> dict[str, Any]:
    template_name = raw_field.get("template")
    template = (
        dict(catalog["field_templates"][template_name])
        if template_name
        else {}
    )
    template.update(
        {
            key: value
            for key, value in raw_field.items()
            if key != "template"
        }
    )
    template.setdefault("label", template["field_key"])
    template.setdefault("field_type", "TEXTAREA")
    template.setdefault("required", False)
    template.setdefault("placeholder", "")
    template.setdefault("example", "")
    template.setdefault("options_json", [])
    template.setdefault("validation_json", {})
    template.setdefault("sort_order", 0)
    return template


def resolve_knowledge_tasks(
    item: dict[str, Any],
    catalog: dict[str, Any],
    tasks_by_code: dict[str, Any],
) -> list[Any]:
    scopes = item.get("task_scopes") or []
    if "*" in scopes:
        return list(tasks_by_code.values())

    resolved: list[Any] = []
    seen: set[int] = set()
    for scope in scopes:
        if isinstance(scope, str) and scope.startswith("assistant:"):
            assistant_code = scope.split(":", 1)[1]
            assistant = next(
                (
                    candidate
                    for candidate in catalog["assistants"]
                    if candidate["code"] == assistant_code
                ),
                None,
            )
            if assistant is None:
                continue
            task_codes = [task["code"] for task in assistant["tasks"]]
        else:
            task_codes = [str(scope)]
        for task_code in task_codes:
            task = tasks_by_code.get(task_code)
            if task is not None and task.id not in seen:
                resolved.append(task)
                seen.add(task.id)
    return resolved


def manual_knowledge_category(item: dict[str, Any]) -> str:
    assistant_code = str(item.get("assistant_code") or "")
    if assistant_code == "delivery":
        return "DELIVERY"
    if assistant_code == "tender":
        return "TENDER"
    if assistant_code == "presales":
        return "PRODUCT"
    if assistant_code == "software-testing":
        return "TECHNICAL"
    return "COMPANY"


def upsert_manual_knowledge(
    db,
    item: dict[str, Any],
    catalog: dict[str, Any],
    tasks_by_code: dict[str, Any],
    cipher,
    key_version: str,
) -> int:
    from sqlalchemy import delete, select

    from app.models import KnowledgeItem, KnowledgeTaskLink

    key = str(item.get("key") or "").strip()
    if not key:
        raise ValueError("手册知识缺少稳定 key")
    content = str(item.get("content") or item.get("prompt") or "").strip()
    if not content:
        raise ValueError(f"手册知识 {key} 内容为空")
    key_tag = f"key:{key}"
    original_category = item.get("category")
    tags = [
        f"manual:{catalog.get('source_version', 'V1.10')}",
        key_tag,
    ]
    if original_category:
        tags.append(f"manual-category:{original_category}")
    category = manual_knowledge_category(item)
    existing = next(
        (
            row
            for row in db.scalars(select(KnowledgeItem)).all()
            if key_tag in (row.tags_json or [])
        ),
        None,
    )
    if existing is None:
        import uuid as uuid_lib

        item_uuid = str(uuid_lib.uuid4())
        encrypted = cipher.encrypt_json(
            {"content": content},
            item_uuid.encode(),
        )
        knowledge = KnowledgeItem(
            uuid=item_uuid,
            title=item["title"],
            category=category,
            tags_json=tags,
            keywords_json=[
                item.get("title"),
                original_category,
                item.get("source_title"),
            ],
            content_ciphertext=encrypted.ciphertext,
            content_nonce=encrypted.nonce,
            key_version=key_version,
            priority=int(item.get("priority") or 0),
            status="ACTIVE",
            created_by="manual-v1.10-seed",
            updated_by="manual-v1.10-seed",
        )
        db.add(knowledge)
        db.flush()
    else:
        knowledge = existing
        encrypted = cipher.encrypt_json(
            {"content": content},
            knowledge.uuid.encode(),
        )
        knowledge.title = item["title"]
        knowledge.category = category
        knowledge.tags_json = tags
        knowledge.keywords_json = [
            item.get("title"),
            original_category,
            item.get("source_title"),
        ]
        knowledge.content_ciphertext = encrypted.ciphertext
        knowledge.content_nonce = encrypted.nonce
        knowledge.key_version = key_version
        knowledge.priority = int(item.get("priority") or 0)
        knowledge.status = "ACTIVE"
        knowledge.updated_by = "manual-v1.10-seed"

    linked_tasks = resolve_knowledge_tasks(item, catalog, tasks_by_code)
    db.execute(
        delete(KnowledgeTaskLink).where(
            KnowledgeTaskLink.knowledge_id == knowledge.id
        )
    )
    db.add_all(
        [
            KnowledgeTaskLink(knowledge_id=knowledge.id, task_id=task.id)
            for task in linked_tasks
        ]
    )
    return 1


async def seed_catalog(
    db,
    catalog: dict[str, Any],
    prompt_client,
    *,
    force_config: bool = False,
    staged_prompts: dict[int | str, int] | None = None,
    finalize_published: bool = False,
    manual_manifest: dict[str, Any] | None = None,
    cipher=None,
    key_version: str | None = None,
) -> dict[str, Any]:
    from sqlalchemy import select

    from app.crypto import ContentCipher
    from app.models import Assistant, Task, TaskField, TaskPromptBinding

    validate_catalog(catalog)
    if manual_manifest is None:
        manual_manifest = load_manual_manifest()
    if cipher is None:
        from app.config import get_settings

        settings = get_settings()
        cipher = ContentCipher(settings.content_encryption_key)
        key_version = settings.content_encryption_key_version
    if key_version is None:
        key_version = "v1"
    normalized_staged = normalize_staged_prompts(catalog, staged_prompts)
    if finalize_published and normalized_staged is None:
        raise ValueError("--finalize-published 必须配合 --staged-prompts")
    entries: list[tuple[dict, dict, int, bool]] = []
    missing_prompts: list[dict[str, Any]] = []
    for assistant_definition in catalog["assistants"]:
        for task_definition in assistant_definition["tasks"]:
            existing_task = db.scalar(
                select(Task).where(Task.code == task_definition["code"])
            )
            existing_binding = None
            if existing_task is not None:
                existing_binding = db.scalar(
                    select(TaskPromptBinding).where(
                        TaskPromptBinding.task_id == existing_task.id
                    )
                )
            prompt_id = int(task_definition["prompt_external_id"])
            if (
                normalized_staged is not None
                and existing_binding is not None
                and not force_config
                and existing_binding.prompt_external_id != prompt_id
            ):
                raise ValueError(
                    "任务 "
                    f"{task_definition['code']} 已绑定管理员自定义 Prompt "
                    f"{existing_binding.prompt_external_id}；"
                    "使用 --staged-prompts 前请先确认并传入 --force-config"
                )
            if (
                existing_binding is not None
                and not force_config
                and normalized_staged is None
            ):
                prompt_id = existing_binding.prompt_external_id
            prompt_version = (
                normalized_staged[prompt_id]
                if normalized_staged is not None
                else None
            )
            try:
                await prompt_client.get_published(
                    prompt_id,
                    version=prompt_version,
                )
            except (LookupError, ValueError):
                published = False
                missing_prompts.append(
                    {
                        "task_code": task_definition["code"],
                        "prompt_external_id": prompt_id,
                        "prompt_version": prompt_version,
                    }
                )
            else:
                published = True
            entries.append(
                (
                    assistant_definition,
                    task_definition,
                    prompt_id,
                    published,
                )
            )
    if normalized_staged is not None and missing_prompts:
        raise ValueError(
            "staged Prompt 版本尚未发布："
            + "、".join(
                f"{item['prompt_external_id']}@{item['prompt_version']}"
                for item in missing_prompts
            )
        )

    report: dict[str, Any] = {
        "assistants_created": 0,
        "tasks_created": 0,
        "fields_created": 0,
        "bindings_created": 0,
        "missing_prompts": missing_prompts,
        "knowledge_upserted": 0,
    }
    assistants_by_code: dict[str, Assistant] = {}
    try:
        for assistant_definition in catalog["assistants"]:
            assistant = db.scalar(
                select(Assistant).where(
                    Assistant.code == assistant_definition["code"]
                )
            )
            if assistant is None:
                assistant = Assistant(
                    code=assistant_definition["code"],
                    name=assistant_definition["name"],
                    description=assistant_definition["description"],
                    icon=assistant_definition["icon"],
                    sort_order=assistant_definition["sort_order"],
                    status="ACTIVE",
                )
                db.add(assistant)
                db.flush()
                report["assistants_created"] += 1
            elif force_config:
                assistant.name = assistant_definition["name"]
                assistant.description = assistant_definition["description"]
                assistant.icon = assistant_definition["icon"]
                assistant.sort_order = assistant_definition["sort_order"]
            assistants_by_code[assistant.code] = assistant

        for (
            assistant_definition,
            task_definition,
            prompt_id,
            published,
        ) in entries:
            task = db.scalar(
                select(Task).where(Task.code == task_definition["code"])
            )
            is_new_task = task is None
            if task is None:
                task_sort_order = (
                    assistant_definition["tasks"].index(task_definition) + 1
                ) * 10
                task = Task(
                    assistant_id=assistants_by_code[
                        assistant_definition["code"]
                    ].id,
                    code=task_definition["code"],
                    name=task_definition["name"],
                    description=task_definition["description"],
                    output_format=task_definition["output_format"],
                    safety_notice=task_definition["safety_notice"],
                    source_version=task_definition["source_version"],
                    source_ref=task_definition["source_ref"],
                    document_type=task_definition["document_type"],
                    formal_document=task_definition["formal_document"],
                    sort_order=task_sort_order,
                    status="ACTIVE" if published else "DRAFT",
                )
                db.add(task)
                db.flush()
                report["tasks_created"] += 1
            else:
                task.status = "ACTIVE" if published else "DRAFT"
                if force_config:
                    task.assistant_id = assistants_by_code[
                        assistant_definition["code"]
                    ].id
                    task.name = task_definition["name"]
                    task.description = task_definition["description"]
                    task.output_format = task_definition["output_format"]
                    task.safety_notice = task_definition["safety_notice"]
                    task.source_version = task_definition["source_version"]
                    task.source_ref = task_definition["source_ref"]
                    task.document_type = task_definition["document_type"]
                    task.formal_document = task_definition[
                        "formal_document"
                    ]
                    task.sort_order = (
                        assistant_definition["tasks"].index(task_definition) + 1
                    ) * 10

            existing_fields = {
                field.field_key: field
                for field in db.scalars(
                    select(TaskField).where(TaskField.task_id == task.id)
                ).all()
            }
            for raw_field in task_definition["fields"]:
                definition = expand_field(catalog, raw_field)
                field = existing_fields.get(definition["field_key"])
                if field is None:
                    field = TaskField(
                        task_id=task.id,
                        field_key=definition["field_key"],
                    )
                    db.add(field)
                    report["fields_created"] += 1
                if is_new_task or force_config:
                    for key in (
                        "label",
                        "field_type",
                        "required",
                        "placeholder",
                        "example",
                        "options_json",
                        "validation_json",
                        "sort_order",
                    ):
                        setattr(field, key, definition[key])
            if force_config:
                configured_field_keys = {
                    raw_field["field_key"]
                    for raw_field in task_definition["fields"]
                }
                for field_key, field in existing_fields.items():
                    if field_key not in configured_field_keys:
                        db.delete(field)

            binding = db.scalar(
                select(TaskPromptBinding).where(
                    TaskPromptBinding.task_id == task.id
                )
            )
            should_finalize_binding = False
            if binding is None:
                binding = TaskPromptBinding(
                    task_id=task.id,
                    prompt_external_id=prompt_id,
                    version_policy=(
                        "PINNED"
                        if normalized_staged is not None
                        else "PUBLISHED"
                    ),
                    pinned_version=(
                        normalized_staged[prompt_id]
                        if normalized_staged is not None
                        else None
                    ),
                    status="ACTIVE" if published else "DISABLED",
                )
                db.add(binding)
                report["bindings_created"] += 1
            else:
                should_finalize_binding = (
                    finalize_published
                    and normalized_staged is not None
                    and binding.status == "ACTIVE"
                    and binding.prompt_external_id == prompt_id
                    and binding.version_policy == "PINNED"
                    and binding.pinned_version == normalized_staged[prompt_id]
                )
                if should_finalize_binding:
                    binding.status = "ACTIVE" if published else "DISABLED"
                    binding.version_policy = "PUBLISHED"
                    binding.pinned_version = None
                elif not finalize_published:
                    if force_config:
                        binding.prompt_external_id = prompt_id
                    binding.status = "ACTIVE" if published else "DISABLED"
                    if normalized_staged is not None:
                        binding.prompt_external_id = prompt_id
                        binding.version_policy = "PINNED"
                        binding.pinned_version = normalized_staged[prompt_id]
                elif force_config:
                    binding.prompt_external_id = prompt_id
        tasks_by_code = {
            task.code: task
            for task in db.scalars(select(Task)).all()
        }
        for item in manual_manifest.get("knowledge", []):
            if item.get("classification") != "KNOWLEDGE":
                continue
            report["knowledge_upserted"] += upsert_manual_knowledge(
                db,
                item,
                catalog,
                tasks_by_code,
                cipher,
                key_version,
            )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return report


async def async_main(args: argparse.Namespace) -> int:
    catalog = load_catalog()
    if args.validate_only:
        task_count = sum(
            len(assistant["tasks"])
            for assistant in catalog["assistants"]
        )
        print(
            json.dumps(
                {
                    "valid": True,
                    "assistants": len(catalog["assistants"]),
                    "tasks": task_count,
                },
                ensure_ascii=False,
            )
        )
        return 0

    from app.config import get_settings
    from app.database import SessionLocal
    from app.prompt_client import PromptCenterClient

    settings = get_settings()
    client = PromptCenterClient(
        settings.prompt_center_url,
        settings.prompt_center_runtime_token,
        settings.auth_fetch_timeout_ms / 1000,
    )
    with SessionLocal() as db:
        staged_prompts = (
            load_staged_prompts(Path(args.staged_prompts))
            if args.staged_prompts
            else None
        )
        report = await seed_catalog(
            db,
            catalog,
            client,
            force_config=args.force_config,
            staged_prompts=staged_prompts,
            finalize_published=args.finalize_published,
        )
    print(json.dumps(report, ensure_ascii=False))
    if args.require_all_published and report["missing_prompts"]:
        return 1
    return 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--force-config", action="store_true")
    parser.add_argument("--require-all-published", action="store_true")
    parser.add_argument("--staged-prompts")
    parser.add_argument("--finalize-published", action="store_true")
    raise SystemExit(asyncio.run(async_main(parser.parse_args())))


if __name__ == "__main__":
    main()
