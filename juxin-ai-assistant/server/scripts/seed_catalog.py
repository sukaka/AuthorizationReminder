import argparse
import asyncio
import hashlib
import json
import sys
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.quality_rules import (
    QUALITY_RULE_SEED_ACTOR,
    parse_quality_rule_tags,
    strict_string_tags,
)

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
CATALOG_SEED_ACTOR = "catalog-seed"


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


def rollout_token(
    catalog: dict[str, Any],
    staged_prompts: dict[int, int],
    manual_manifest: dict[str, Any],
    *,
    force_config: bool,
) -> str:
    payload = {
        "catalog": catalog,
        "staged_prompts": staged_prompts,
        "manual_manifest": manual_manifest,
        "force_config": force_config,
    }
    return hashlib.sha256(
        json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()


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


def quality_rule_key(item: dict[str, Any]) -> str:
    assistant_code = str(item.get("assistant_code") or "").strip()
    source_ref = str(item.get("source_ref") or "").strip()
    identity = "\n".join((assistant_code, source_ref))
    digest = hashlib.sha256(identity.encode()).hexdigest()[:16]
    return f"quality-rule-{assistant_code}-{digest}"


def _is_seed_owned_quality_rule(
    item,
    *,
    assistant_codes: set[str],
) -> bool:
    parsed = parse_quality_rule_tags(item.tags_json)
    return (
        parsed is not None
        and parsed.assistant_code in assistant_codes
        and item.created_by == QUALITY_RULE_SEED_ACTOR
    )


def upsert_manual_knowledge(
    db,
    item: dict[str, Any],
    catalog: dict[str, Any],
    tasks_by_code: dict[str, Any],
    cipher,
    key_version: str,
    *,
    require_seed_owned_key: bool = False,
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
    tags.extend(str(tag) for tag in item.get("tags", []) if str(tag))
    category = manual_knowledge_category(item)
    matches = [
        row
        for row in db.scalars(select(KnowledgeItem)).all()
        if (
            (row_tags := strict_string_tags(row.tags_json)) is not None
            and key_tag in row_tags
        )
    ]
    if require_seed_owned_key:
        if len(matches) > 1:
            raise ValueError(f"质量规则 key 重复：{key}")
        if matches and matches[0].created_by != QUALITY_RULE_SEED_ACTOR:
            raise ValueError(f"质量规则 key 已被非 seed 知识占用：{key}")
    existing = matches[0] if matches else None
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
            created_by=QUALITY_RULE_SEED_ACTOR,
            updated_by=QUALITY_RULE_SEED_ACTOR,
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
        knowledge.updated_by = QUALITY_RULE_SEED_ACTOR

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


def upsert_manual_quality_rules(
    db,
    rules: list[dict[str, Any]],
    catalog: dict[str, Any],
    tasks_by_code: dict[str, Any],
    cipher,
    key_version: str,
) -> int:
    from sqlalchemy import delete, select

    from app.models import KnowledgeItem, KnowledgeTaskLink

    assistant_codes = {
        assistant["code"] for assistant in catalog["assistants"]
    }
    known_assistant_codes = {
        assistant["code"] for assistant in load_catalog()["assistants"]
    }
    upserted = 0
    desired_keys: set[str] = set()
    for item in rules:
        if item.get("classification") != "QUALITY_RULE":
            continue
        assistant_code = str(item.get("assistant_code") or "").strip()
        if assistant_code not in known_assistant_codes:
            raise ValueError(
                f"质量规则引用未知助手：{assistant_code or '<empty>'}"
            )
        if assistant_code not in assistant_codes:
            continue
        normalized_rule = {
            **item,
            "key": quality_rule_key(item),
            "title": item.get("source_title") or item.get("title"),
            "content": item.get("prompt"),
            "task_scopes": [f"assistant:{assistant_code}"],
            "tags": [
                "quality-rule",
                f"assistant:{assistant_code}",
            ],
        }
        desired_keys.add(normalized_rule["key"])
        upserted += upsert_manual_knowledge(
            db,
            normalized_rule,
            catalog,
            tasks_by_code,
            cipher,
            key_version,
            require_seed_owned_key=True,
        )
    for knowledge in db.scalars(select(KnowledgeItem)).all():
        if not _is_seed_owned_quality_rule(
            knowledge,
            assistant_codes=assistant_codes,
        ):
            continue
        parsed = parse_quality_rule_tags(knowledge.tags_json)
        assert parsed is not None
        if parsed.key in desired_keys:
            continue
        knowledge.status = "INACTIVE"
        knowledge.updated_by = QUALITY_RULE_SEED_ACTOR
        db.execute(
            delete(KnowledgeTaskLink).where(
                KnowledgeTaskLink.knowledge_id == knowledge.id
            )
        )
    return upserted


def _rollout_report(**extra: Any) -> dict[str, Any]:
    return {
        "assistants_created": 0,
        "tasks_created": 0,
        "fields_created": 0,
        "bindings_created": 0,
        "missing_prompts": [],
        "knowledge_upserted": 0,
        "quality_rules_upserted": 0,
        "bindings_frozen": 0,
        **extra,
    }


def _binding_snapshot(binding) -> dict[str, Any] | None:
    if binding is None:
        return None
    return {
        "id": binding.id,
        "task_id": binding.task_id,
        "prompt_external_id": binding.prompt_external_id,
        "version_policy": binding.version_policy,
        "pinned_version": binding.pinned_version,
        "status": binding.status,
        "updated_by": binding.updated_by,
        "rollout_token": binding.rollout_token,
    }


def _binding_matches(binding, snapshot: dict[str, Any] | None) -> bool:
    if snapshot is None:
        return binding is None
    return binding is not None and all(
        getattr(binding, key) == value
        for key, value in snapshot.items()
    )


def _load_rollout(db, token: str):
    from sqlalchemy import select

    from app.models import PromptCatalogRollout

    return db.scalar(
        select(PromptCatalogRollout)
        .where(PromptCatalogRollout.token == token)
        .execution_options(populate_existing=True)
    )


def _verify_staged_rollout(db, rollout) -> None:
    from sqlalchemy import select

    from app.models import Task, TaskPromptBinding

    target_codes = set(rollout.target_json["task_codes"])
    expected_codes = {
        snapshot["task_code"]
        for snapshot in rollout.frozen_tasks_json
    }
    current_codes = set(
        db.scalars(
            select(Task.code).where(Task.code.in_(target_codes))
        ).all()
    )
    if current_codes != expected_codes:
        raise ValueError("发布窗口任务集合已被管理员修改")
    for snapshot in rollout.frozen_tasks_json:
        task = db.scalar(
            select(Task)
            .where(Task.id == snapshot["task_id"])
            .execution_options(populate_existing=True)
        )
        if (
            task is None
            or task.code != snapshot["task_code"]
            or task.status != snapshot["task_status"]
            or task.updated_by != snapshot["task_updated_by"]
        ):
            raise ValueError(
                f"任务 {snapshot['task_code']} 的发布窗口状态已被管理员修改"
            )
        binding = db.scalar(
            select(TaskPromptBinding)
            .where(TaskPromptBinding.task_id == task.id)
            .execution_options(populate_existing=True)
        )
        if snapshot["was_active"]:
            expected = {
                **snapshot["binding"],
                "version_policy": "ROLLOUT",
                "pinned_version": snapshot["frozen_version"],
                "updated_by": CATALOG_SEED_ACTOR,
                "rollout_token": rollout.token,
            }
        else:
            expected = snapshot["binding"]
        if not _binding_matches(binding, expected):
            raise ValueError(
                f"任务 {snapshot['task_code']} 的发布窗口绑定已被管理员修改"
            )


async def _validate_rollout_targets(
    catalog: dict[str, Any],
    staged_prompts: dict[int, int],
    prompt_client,
    *,
    staged: bool,
) -> list[tuple[dict, dict, int, bool]]:
    entries: list[tuple[dict, dict, int, bool]] = []
    missing: list[str] = []
    for assistant_definition in catalog["assistants"]:
        for task_definition in assistant_definition["tasks"]:
            prompt_id = int(task_definition["prompt_external_id"])
            version = staged_prompts[prompt_id]
            try:
                if staged:
                    prompt = await prompt_client.get_staged(
                        prompt_id,
                        version=version,
                    )
                else:
                    prompt = await prompt_client.get_published(
                        prompt_id,
                        version=version,
                    )
            except (LookupError, ValueError):
                missing.append(f"{prompt_id}@{version}")
                continue
            if (
                prompt.get("prompt_id") != prompt_id
                or prompt.get("version_no") != version
                or prompt.get("content")
                != str(task_definition["prompt_content"]).strip()
            ):
                raise ValueError(
                    "staged Prompt 版本与目录不一致："
                    f"{prompt_id}@{version}"
                )
            entries.append(
                (
                    assistant_definition,
                    task_definition,
                    prompt_id,
                    True,
                )
            )
    if missing:
        raise ValueError(
            "staged Prompt 版本不存在或不可用：" + "、".join(missing)
        )
    return entries


async def stage_catalog_rollout(
    db,
    catalog: dict[str, Any],
    staged_prompts: dict[int, int],
    manual_manifest: dict[str, Any],
    prompt_client,
    *,
    token: str,
    force_config: bool,
) -> dict[str, Any]:
    from sqlalchemy import select, update
    from sqlalchemy.exc import IntegrityError

    from app.models import (
        PromptCatalogRollout,
        Task,
        TaskPromptBinding,
    )

    existing_rollout = _load_rollout(db, token)
    if existing_rollout is not None:
        try:
            if existing_rollout.status == "FINALIZED":
                return _rollout_report(already_finalized=True)
            if existing_rollout.status != "STAGED":
                raise ValueError("发布窗口正在处理中，请稍后重试")
            _verify_staged_rollout(db, existing_rollout)
            return _rollout_report(already_staged=True)
        finally:
            db.rollback()

    snapshots: list[dict[str, Any]] = []
    target_codes = [
        task["code"]
        for assistant in catalog["assistants"]
        for task in assistant["tasks"]
    ]
    definitions = {
        task["code"]: task
        for assistant in catalog["assistants"]
        for task in assistant["tasks"]
    }
    tasks = db.scalars(
        select(Task)
        .where(Task.code.in_(target_codes))
        .execution_options(populate_existing=True)
    ).all()
    for task in tasks:
        binding = db.scalar(
            select(TaskPromptBinding)
            .where(TaskPromptBinding.task_id == task.id)
            .execution_options(populate_existing=True)
        )
        if binding is not None and binding.rollout_token is not None:
            db.rollback()
            raise ValueError(
                f"任务 {task.code} 已处于其他发布窗口"
            )
        if (
            task.status == "ACTIVE"
            and (binding is None or binding.status != "ACTIVE")
        ):
            db.rollback()
            raise ValueError(
                f"任务 {task.code} 没有可冻结的 ACTIVE Prompt 绑定"
            )
        if (
            task.status == "ACTIVE"
            and binding.version_policy == "PINNED"
            and not force_config
        ):
            db.rollback()
            raise ValueError(
                f"任务 {task.code} 使用管理员 PINNED 绑定；"
                "请确认并传入 --force-config"
            )
        target_prompt_id = int(
            definitions[task.code]["prompt_external_id"]
        )
        if (
            task.status == "ACTIVE"
            and binding.prompt_external_id != target_prompt_id
            and not force_config
        ):
            db.rollback()
            raise ValueError(
                f"任务 {task.code} 已绑定管理员自定义 Prompt "
                f"{binding.prompt_external_id}；"
                "请确认并传入 --force-config"
            )
        if (
            task.status == "ACTIVE"
            and binding.version_policy not in {"PUBLISHED", "PINNED"}
        ):
            db.rollback()
            raise ValueError(
                f"任务 {task.code} 已处于其他发布窗口或绑定被管理员修改"
            )
        definition = definitions[task.code]
        snapshots.append(
            {
                "task_id": task.id,
                "task_code": task.code,
                "task_status": task.status,
                "task_updated_by": task.updated_by,
                "was_active": task.status == "ACTIVE",
                "binding": _binding_snapshot(binding),
                "target_prompt_external_id": int(
                    definition["prompt_external_id"]
                ),
                "target_version": staged_prompts[
                    int(definition["prompt_external_id"])
                ],
                "frozen_version": None,
            }
        )
    db.rollback()

    await _validate_rollout_targets(
        catalog,
        staged_prompts,
        prompt_client,
        staged=True,
    )
    for snapshot in snapshots:
        if not snapshot["was_active"]:
            continue
        binding = snapshot["binding"]
        try:
            if binding["version_policy"] == "PINNED":
                frozen_version = binding["pinned_version"]
                if frozen_version is None:
                    raise ValueError("固定版本为空")
                prompt = await prompt_client.get_published(
                    binding["prompt_external_id"],
                    version=frozen_version,
                )
            else:
                prompt = await prompt_client.get_published(
                    binding["prompt_external_id"],
                )
                frozen_version = int(prompt["version_no"])
            if (
                prompt.get("prompt_id")
                != binding["prompt_external_id"]
                or int(prompt["version_no"]) != frozen_version
                or frozen_version <= 0
            ):
                raise ValueError("Prompt 身份不一致")
        except (KeyError, LookupError, TypeError, ValueError) as exc:
            raise ValueError(
                f"任务 {snapshot['task_code']} 的当前已发布 Prompt 不可冻结"
            ) from exc
        snapshot["frozen_version"] = frozen_version

    rollout = PromptCatalogRollout(
        token=token,
        status="STAGED",
        force_config=force_config,
        target_json={
            "staged_prompts": {
                str(key): value
                for key, value in staged_prompts.items()
            },
            "task_codes": target_codes,
        },
        frozen_tasks_json=snapshots,
    )
    try:
        db.add(rollout)
        db.flush()
        frozen_count = 0
        for snapshot in snapshots:
            task = db.scalar(
                select(Task)
                .where(Task.id == snapshot["task_id"])
                .execution_options(populate_existing=True)
            )
            if (
                task is None
                or task.code != snapshot["task_code"]
                or task.status != snapshot["task_status"]
                or task.updated_by != snapshot["task_updated_by"]
            ):
                raise ValueError(
                    f"任务 {snapshot['task_code']} 的发布窗口状态已被管理员修改"
                )
            current_binding = db.scalar(
                select(TaskPromptBinding)
                .where(TaskPromptBinding.task_id == task.id)
                .execution_options(populate_existing=True)
            )
            if not _binding_matches(
                current_binding,
                snapshot["binding"],
            ):
                raise ValueError(
                    f"任务 {snapshot['task_code']} 的发布窗口绑定已被管理员修改"
                )
            if not snapshot["was_active"]:
                continue
            binding = snapshot["binding"]
            conditions = [
                TaskPromptBinding.id == binding["id"],
                TaskPromptBinding.task_id == binding["task_id"],
                TaskPromptBinding.prompt_external_id
                == binding["prompt_external_id"],
                TaskPromptBinding.version_policy
                == binding["version_policy"],
                TaskPromptBinding.pinned_version
                == binding["pinned_version"],
                TaskPromptBinding.status == binding["status"],
                TaskPromptBinding.updated_by == binding["updated_by"],
                TaskPromptBinding.rollout_token
                == binding["rollout_token"],
            ]
            result = db.execute(
                update(TaskPromptBinding)
                .where(*conditions)
                .values(
                    version_policy="ROLLOUT",
                    pinned_version=snapshot["frozen_version"],
                    rollout_token=token,
                    updated_by=CATALOG_SEED_ACTOR,
                ),
                execution_options={"synchronize_session": False},
            )
            if result.rowcount != 1:
                raise ValueError(
                    f"任务 {snapshot['task_code']} 的发布窗口绑定已被管理员修改"
                )
            frozen_count += 1
        db.commit()
        return _rollout_report(bindings_frozen=frozen_count)
    except IntegrityError:
        db.rollback()
        retry = _load_rollout(db, token)
        try:
            if retry is None or retry.status != "STAGED":
                raise ValueError("发布窗口并发创建失败")
            _verify_staged_rollout(db, retry)
            return _rollout_report(already_staged=True)
        finally:
            db.rollback()
    except Exception:
        db.rollback()
        raise


def load_finalize_rollout(
    db,
    token: str,
    staged_prompts: dict[int, int],
    target_codes: list[str],
    *,
    force_config: bool,
):
    from sqlalchemy import select

    from app.models import PromptCatalogRollout

    rollout = _load_rollout(db, token)
    try:
        if rollout is None:
            expected_prompts = {
                str(key): value
                for key, value in staged_prompts.items()
            }
            candidates = db.scalars(
                select(PromptCatalogRollout).where(
                    PromptCatalogRollout.status.in_(
                        {"STAGED", "FINALIZED"}
                    )
                )
            ).all()
            if any(
                candidate.target_json.get("staged_prompts")
                == expected_prompts
                and candidate.target_json.get("task_codes")
                == target_codes
                and candidate.force_config != force_config
                for candidate in candidates
            ):
                raise ValueError(
                    "--force-config 必须与 stage 时的授权保持一致"
                )
            raise ValueError("Prompt 目录尚未暂存，不能直接 finalize")
        if rollout.status == "FINALIZED":
            return None, _rollout_report(already_finalized=True)
        if rollout.status != "STAGED":
            raise ValueError("发布窗口正在处理中，请稍后重试")
        payload = {
            "token": rollout.token,
            "force_config": rollout.force_config,
            "target_json": rollout.target_json,
            "frozen_tasks_json": rollout.frozen_tasks_json,
        }
        return payload, None
    finally:
        db.rollback()


def claim_finalize_rollout(db, rollout_payload: dict[str, Any]) -> None:
    from sqlalchemy import select, update

    from app.models import (
        PromptCatalogRollout,
        Task,
        TaskPromptBinding,
    )

    token = rollout_payload["token"]
    result = db.execute(
        update(PromptCatalogRollout)
        .where(
            PromptCatalogRollout.token == token,
            PromptCatalogRollout.status == "STAGED",
        )
        .values(status="FINALIZING"),
        execution_options={"synchronize_session": False},
    )
    if result.rowcount != 1:
        raise ValueError("发布窗口已被其他进程处理")

    expected_codes = {
        snapshot["task_code"]
        for snapshot in rollout_payload["frozen_tasks_json"]
    }
    target_codes = set(rollout_payload["target_json"]["task_codes"])
    current_codes = set(
        db.scalars(
            select(Task.code).where(Task.code.in_(target_codes))
        ).all()
    )
    if current_codes != expected_codes:
        raise ValueError("发布窗口任务集合已被管理员修改")

    for snapshot in rollout_payload["frozen_tasks_json"]:
        task = db.scalar(
            select(Task)
            .where(Task.id == snapshot["task_id"])
            .execution_options(populate_existing=True)
        )
        if (
            task is None
            or task.code != snapshot["task_code"]
            or task.status != snapshot["task_status"]
            or task.updated_by != snapshot["task_updated_by"]
        ):
            raise ValueError(
                f"任务 {snapshot['task_code']} 的发布窗口状态已被管理员修改"
            )
        binding = db.scalar(
            select(TaskPromptBinding)
            .where(TaskPromptBinding.task_id == task.id)
            .execution_options(populate_existing=True)
        )
        if snapshot["was_active"]:
            old_binding = snapshot["binding"]
            result = db.execute(
                update(TaskPromptBinding)
                .where(
                    TaskPromptBinding.id == old_binding["id"],
                    TaskPromptBinding.task_id == task.id,
                    TaskPromptBinding.prompt_external_id
                    == old_binding["prompt_external_id"],
                    TaskPromptBinding.version_policy == "ROLLOUT",
                    TaskPromptBinding.pinned_version
                    == snapshot["frozen_version"],
                    TaskPromptBinding.status == "ACTIVE",
                    TaskPromptBinding.updated_by == CATALOG_SEED_ACTOR,
                    TaskPromptBinding.rollout_token == token,
                )
                .values(
                    prompt_external_id=snapshot[
                        "target_prompt_external_id"
                    ],
                    version_policy="PUBLISHED",
                    pinned_version=None,
                    rollout_token=None,
                    updated_by=CATALOG_SEED_ACTOR,
                ),
                execution_options={"synchronize_session": False},
            )
            if result.rowcount != 1:
                raise ValueError(
                    f"任务 {snapshot['task_code']} 的发布窗口绑定已被管理员修改"
                )
        elif not _binding_matches(binding, snapshot["binding"]):
            raise ValueError(
                f"任务 {snapshot['task_code']} 的发布窗口绑定已被管理员修改"
            )
    db.expire_all()


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
    from sqlalchemy import select, update

    from app.crypto import ContentCipher
    from app.models import (
        Assistant,
        PromptCatalogRollout,
        Task,
        TaskField,
        TaskPromptBinding,
    )

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
    finalize_rollout = None
    if normalized_staged is not None:
        token = rollout_token(
            catalog,
            normalized_staged,
            manual_manifest,
            force_config=force_config,
        )
        if not finalize_published:
            return await stage_catalog_rollout(
                db,
                catalog,
                normalized_staged,
                manual_manifest,
                prompt_client,
                token=token,
                force_config=force_config,
            )
        finalize_rollout, finalized_report = load_finalize_rollout(
            db,
            token,
            normalized_staged,
            [
                task["code"]
                for assistant in catalog["assistants"]
                for task in assistant["tasks"]
            ],
            force_config=force_config,
        )
        if finalized_report is not None:
            return finalized_report
        try:
            entries = await _validate_rollout_targets(
                catalog,
                normalized_staged,
                prompt_client,
                staged=False,
            )
        except Exception:
            db.rollback()
            raise
    else:
        try:
            for assistant_definition in catalog["assistants"]:
                for task_definition in assistant_definition["tasks"]:
                    existing_task = db.scalar(
                        select(Task).where(
                            Task.code == task_definition["code"]
                        )
                    )
                    existing_binding = None
                    if existing_task is not None:
                        existing_binding = db.scalar(
                            select(TaskPromptBinding).where(
                                TaskPromptBinding.task_id
                                == existing_task.id
                            )
                        )
                    prompt_id = int(
                        task_definition["prompt_external_id"]
                    )
                    if existing_binding is not None and not force_config:
                        prompt_id = existing_binding.prompt_external_id
                    try:
                        await prompt_client.get_published(prompt_id)
                    except (LookupError, ValueError):
                        published = False
                        missing_prompts.append(
                            {
                                "task_code": task_definition["code"],
                                "prompt_external_id": prompt_id,
                                "prompt_version": None,
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
        except Exception:
            db.rollback()
            raise

    report: dict[str, Any] = {
        "assistants_created": 0,
        "tasks_created": 0,
        "fields_created": 0,
        "bindings_created": 0,
        "missing_prompts": missing_prompts,
        "knowledge_upserted": 0,
        "quality_rules_upserted": 0,
    }
    assistants_by_code: dict[str, Assistant] = {}
    try:
        if finalize_rollout is not None:
            claim_finalize_rollout(db, finalize_rollout)
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
            if binding is None:
                binding = TaskPromptBinding(
                    task_id=task.id,
                    prompt_external_id=prompt_id,
                    version_policy="PUBLISHED",
                    pinned_version=None,
                    rollout_token=None,
                    status="ACTIVE" if published else "DISABLED",
                    updated_by=(
                        CATALOG_SEED_ACTOR
                        if finalize_rollout is not None
                        else "system"
                    ),
                )
                db.add(binding)
                report["bindings_created"] += 1
            else:
                if finalize_published and normalized_staged is not None:
                    binding.prompt_external_id = prompt_id
                    binding.status = "ACTIVE" if published else "DISABLED"
                    binding.version_policy = "PUBLISHED"
                    binding.pinned_version = None
                    binding.rollout_token = None
                    binding.updated_by = CATALOG_SEED_ACTOR
                else:
                    if force_config:
                        binding.prompt_external_id = prompt_id
                    binding.status = "ACTIVE" if published else "DISABLED"
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
        report["quality_rules_upserted"] += upsert_manual_quality_rules(
            db,
            manual_manifest.get("quality_rules", []),
            catalog,
            tasks_by_code,
            cipher,
            key_version,
        )
        if finalize_rollout is not None:
            finalized = db.execute(
                update(PromptCatalogRollout)
                .where(
                    PromptCatalogRollout.token
                    == finalize_rollout["token"],
                    PromptCatalogRollout.status == "FINALIZING",
                )
                .values(status="FINALIZED"),
                execution_options={"synchronize_session": False},
            )
            if finalized.rowcount != 1:
                raise ValueError("发布窗口完成状态写入失败")
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
