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
            fields = task.get("fields")
            if not isinstance(fields, list) or not fields:
                raise ValueError(f"任务 {task_code} 没有动态字段")
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
                field_keys.add(field_key)


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


async def seed_catalog(
    db,
    catalog: dict[str, Any],
    prompt_client,
    *,
    force_config: bool = False,
) -> dict[str, Any]:
    from sqlalchemy import select

    from app.models import Assistant, Task, TaskField, TaskPromptBinding

    validate_catalog(catalog)
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

    report: dict[str, Any] = {
        "assistants_created": 0,
        "tasks_created": 0,
        "fields_created": 0,
        "bindings_created": 0,
        "missing_prompts": missing_prompts,
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
                    status="ACTIVE" if published else "DISABLED",
                )
                db.add(binding)
                report["bindings_created"] += 1
            else:
                if force_config:
                    binding.prompt_external_id = prompt_id
                binding.status = "ACTIVE" if published else "DISABLED"
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
        report = await seed_catalog(
            db,
            catalog,
            client,
            force_config=args.force_config,
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
    raise SystemExit(asyncio.run(async_main(parser.parse_args())))


if __name__ == "__main__":
    main()
