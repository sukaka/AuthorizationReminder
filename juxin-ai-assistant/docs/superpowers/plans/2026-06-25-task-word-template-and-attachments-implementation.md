# Task Word Templates and Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Word exports task-template driven and add text attachment upload so users can generate formal documents from uploaded reference material without duplicate headings.

**Architecture:** Keep DOCX generation on the server. Add task-level template metadata, a focused document template registry, server-side structure validation, and an encrypted attachment pipeline. The desktop client only uploads files, passes attachment UUIDs during generation, and downloads the server-generated DOCX.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, Alembic, `python-docx`, React 19, TypeScript, Vitest, Pytest.

---

## Scope and sequencing

This plan implements the approved spec in two shippable phases:

1. **Phase 1 — Word rigor:** task template metadata, template registry, heading de-duplication, work-plan / meeting-minutes / project-report renderers, and export integration.
2. **Phase 2 — Attachments:** encrypted text attachment upload, text extraction, prepare-generation integration, and client upload UI.

Do not implement audio transcription, OCR for scanned PDFs, custom Word template upload, or online DOCX editing in this plan.

## File map

### Backend files

- Create: `server/app/document_templates/__init__.py` — public exports for template registry.
- Create: `server/app/document_templates/base.py` — shared dataclasses and template protocol.
- Create: `server/app/document_templates/company_style.py` — move/re-export company Word style constants.
- Create: `server/app/document_templates/structure_validator.py` — heading duplicate and final-check validation helpers.
- Create: `server/app/document_templates/registry.py` — template lookup with fallback.
- Create: `server/app/document_templates/templates.py` — first three templates.
- Modify: `server/app/word_export.py` — keep low-level DOCX helpers and route through templates.
- Modify: `server/app/models.py` — add task template fields and attachment model.
- Modify: `server/app/schemas.py` — add `attachment_uuids` to prepare input and attachment response schema.
- Modify: `server/app/generation_service.py` — load and wrap attachment text as untrusted reference material.
- Modify: `server/app/main.py` — add upload endpoint and pass template-aware export payload.
- Modify: `server/app/history_service.py` — include template metadata in export payload.
- Create: `server/app/attachments.py` — upload validation, text extraction, encryption, ownership checks.
- Create: `server/alembic/versions/0007_task_templates_and_attachments.py` — schema migration.
- Test: `server/tests/test_word_export.py`
- Test: `server/tests/test_generation_flow.py`
- Test: `server/tests/test_attachments.py`
- Test: `server/tests/test_migrations.py`

### Frontend files

- Modify: `apps/desktop/src/api/client.ts` — upload attachment API types and function.
- Create: `apps/desktop/src/components/AttachmentUpload.tsx` — reusable task attachment uploader.
- Modify: `apps/desktop/src/pages/TaskRunPage.tsx` — render uploader and pass attachment UUIDs.
- Modify: `apps/desktop/src/theme/tokens.css` — attachment upload styling.
- Test: `apps/desktop/tests/task-run.test.tsx`
- Test: `apps/desktop/tests/employee-flow.test.tsx`

---

## Task 1: Add task template metadata migration

**Files:**

- Modify: `server/app/models.py`
- Modify: `server/app/schemas.py`
- Create: `server/alembic/versions/0007_task_templates_and_attachments.py`
- Modify: `server/tests/test_models.py`
- Modify: `server/tests/test_migrations.py`

- [ ] **Step 1: Write failing model test for task template fields**

Add to `server/tests/test_models.py`:

```python
def test_task_model_has_document_template_metadata():
    columns = {
        column["name"]
        for column in inspector.get_columns("ai_tasks")
    }

    assert "document_template_code" in columns
    assert "output_schema_json" in columns
    assert "attachment_policy_json" in columns
```

- [ ] **Step 2: Run the model test and verify RED**

Run:

```bash
cd server
.venv/bin/python -m pytest tests/test_models.py::test_task_model_has_document_template_metadata -v
```

Expected: FAIL because at least one of the three columns is missing.

- [ ] **Step 3: Add fields to `Task` model**

In `server/app/models.py`, inside `class Task`, after `formal_document` add:

```python
    document_template_code: Mapped[str] = mapped_column(String(64), default="")
    output_schema_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    attachment_policy_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
```

- [ ] **Step 4: Update task payload schema**

In `server/app/schemas.py`, add optional fields to the task output schema used by the catalog response:

```python
    document_template_code: str = ""
    attachment_policy: dict[str, Any] | None = None
```

If the existing schema class name differs, search for `class TaskOut` or the model currently returned by `/api/ai/catalog`, and add the fields there.

- [ ] **Step 5: Create Alembic migration**

Create `server/alembic/versions/0007_task_templates_and_attachments.py`:

```python
"""task templates and attachments

Revision ID: 0007_task_templates_and_attachments
Revises: 0006_prompt_catalog_rollouts
Create Date: 2026-06-25
"""

from alembic import op
import sqlalchemy as sa


revision = "0007_task_templates_and_attachments"
down_revision = "0006_prompt_catalog_rollouts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("ai_tasks") as batch_op:
        batch_op.add_column(
            sa.Column(
                "document_template_code",
                sa.String(length=64),
                nullable=False,
                server_default="",
            )
        )
        batch_op.add_column(sa.Column("output_schema_json", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("attachment_policy_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("ai_tasks") as batch_op:
        batch_op.drop_column("attachment_policy_json")
        batch_op.drop_column("output_schema_json")
        batch_op.drop_column("document_template_code")
```

- [ ] **Step 6: Add migration test**

Add to `server/tests/test_migrations.py`:

```python
def test_0007_adds_task_template_metadata(tmp_path):
    config = alembic_config(tmp_path)
    command.upgrade(config, "0007_task_templates_and_attachments")
    engine = create_engine(config.attributes["sqlalchemy.url"])
    inspector = inspect(engine)
    task_columns = {column["name"] for column in inspector.get_columns("ai_tasks")}

    assert "document_template_code" in task_columns
    assert "output_schema_json" in task_columns
    assert "attachment_policy_json" in task_columns

    command.downgrade(config, "0006_prompt_catalog_rollouts")
    inspector = inspect(engine)
    task_columns = {column["name"] for column in inspector.get_columns("ai_tasks")}
    assert "document_template_code" not in task_columns
```

If the migration test helpers use a different function name than `alembic_config`, follow the existing helper pattern in `tests/test_migrations.py`.

- [ ] **Step 7: Run task metadata tests and verify GREEN**

Run:

```bash
cd server
.venv/bin/python -m pytest tests/test_models.py tests/test_migrations.py -q
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add server/app/models.py server/app/schemas.py server/alembic/versions/0007_task_templates_and_attachments.py server/tests/test_models.py server/tests/test_migrations.py
git commit -m "feat(ai-assistant): add task document template metadata"
```

---

## Task 2: Add template registry and structure validator

**Files:**

- Create: `server/app/document_templates/__init__.py`
- Create: `server/app/document_templates/base.py`
- Create: `server/app/document_templates/company_style.py`
- Create: `server/app/document_templates/structure_validator.py`
- Create: `server/app/document_templates/registry.py`
- Test: `server/tests/test_word_export.py`

- [ ] **Step 1: Write failing tests for registry and duplicate headings**

Add to `server/tests/test_word_export.py`:

```python
from app.document_templates.registry import get_document_template
from app.document_templates.structure_validator import strip_duplicate_template_headings


def test_document_template_registry_returns_fallback_for_unknown_code():
    template = get_document_template("")

    assert template.code == "generic_v1"
    assert template.name == "通用正式文档模板"


def test_structure_validator_strips_duplicate_company_headings():
    cleaned = strip_duplicate_template_headings(
        "# 一、任务说明\n\n正文\n\n# 二、基本信息\n\n重复内容\n\n# 三、背景说明\n\n重复背景",
        fixed_headings=("基本信息", "背景说明"),
    )

    assert "任务说明" in cleaned
    assert "# 二、基本信息" not in cleaned
    assert "# 三、背景说明" not in cleaned
    assert "重复内容" in cleaned
    assert "重复背景" in cleaned
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cd server
.venv/bin/python -m pytest tests/test_word_export.py::test_document_template_registry_returns_fallback_for_unknown_code tests/test_word_export.py::test_structure_validator_strips_duplicate_company_headings -v
```

Expected: FAIL because `app.document_templates` does not exist.

- [ ] **Step 3: Create base types**

Create `server/app/document_templates/base.py`:

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, Sequence


@dataclass(frozen=True)
class StructureIssue:
    code: str
    message: str
    severity: str = "warning"


@dataclass(frozen=True)
class DocumentRenderPayload:
    title: str
    task_name: str
    department: str
    author: str
    output: str
    version: str
    inputs: dict[str, object] = field(default_factory=dict)
    attachments: list[dict[str, object]] = field(default_factory=list)


class DocumentTemplate(Protocol):
    code: str
    name: str
    fixed_headings: Sequence[str]

    def normalize_output(self, output: str) -> str:
        raise NotImplementedError

    def render_docx(self, payload: DocumentRenderPayload) -> bytes:
        raise NotImplementedError
```

- [ ] **Step 4: Create company style module**

Create `server/app/document_templates/company_style.py`:

```python
FINAL_REVIEW_SECTIONS = (
    "待确认事项",
    "需人工复核事项",
    "不建议直接对外发送的内容",
    "可以直接落地执行的下一步动作",
)

COMPANY_REQUIRED_SECTIONS = (
    "基本信息",
    "背景说明",
    "目标与范围",
    "主要内容",
    "执行步骤或工作安排",
    "表格清单或结果统计",
    "风险与注意事项",
    "需确认事项",
    "交付物或附件",
    "结论与下一步计划",
)

FACT_RISK_CONTROL_ITEMS = (
    ("已知事实", "根据当前信息，建议进一步确认。"),
    ("合理判断", "根据当前信息，建议进一步确认。"),
    ("风险提醒", "涉及价格、合同、招投标、开票、回款、劳动关系、法律责任、测试结论、安全风险、交付周期、验收结论和对外承诺等内容，需人工复核。"),
)

COMPANY_WORD_STYLE = {
    "page": {
        "top_margin_cm": 2.5,
        "bottom_margin_cm": 2.5,
        "left_margin_cm": 2.8,
        "right_margin_cm": 2.8,
        "header_distance_cm": 1.3,
        "footer_distance_cm": 1.3,
    },
    "font": {
        "body": "宋体",
        "heading": "黑体",
    },
    "brand": {
        "name": "聚信得仁",
        "company": "北京聚信得仁科技有限公司",
        "header_line_color": "C00000",
        "table_header_fill": "D9EAF7",
        "confidentiality": "内部资料 注意保密",
    },
    "required_sections": COMPANY_REQUIRED_SECTIONS,
    "final_review_sections": FINAL_REVIEW_SECTIONS,
}
```

- [ ] **Step 5: Create structure validator**

Create `server/app/document_templates/structure_validator.py`:

```python
from __future__ import annotations

import re


HEADING_PATTERN = re.compile(r"^(#{1,3})\s+(.+?)\s*$")
NUMBER_PREFIX_PATTERN = re.compile(
    r"^[一二三四五六七八九十百千万零〇两]+、\s*|^\d+[.)]\s*|^（\d+）\s*"
)


def normalize_heading_text(text: str) -> str:
    cleaned = text.strip().replace("*", "").replace("`", "")
    return NUMBER_PREFIX_PATTERN.sub("", cleaned).strip()


def strip_duplicate_template_headings(
    markdown: str,
    *,
    fixed_headings: Sequence[str],
) -> str:
    fixed = {normalize_heading_text(heading) for heading in fixed_headings}
    output_lines: list[str] = []
    for line in markdown.splitlines():
        match = HEADING_PATTERN.match(line.strip())
        if match and normalize_heading_text(match.group(2)) in fixed:
            continue
        output_lines.append(line)
    return "\n".join(output_lines).strip()
```

- [ ] **Step 6: Create registry with generic fallback**

Create `server/app/document_templates/registry.py`:

```python
from __future__ import annotations

from dataclasses import dataclass

from .base import DocumentRenderPayload
from .company_style import COMPANY_REQUIRED_SECTIONS, FINAL_REVIEW_SECTIONS
from .structure_validator import strip_duplicate_template_headings
from app.word_export import render_generation_docx


@dataclass(frozen=True)
class GenericDocumentTemplate:
    code: str = "generic_v1"
    name: str = "通用正式文档模板"
    fixed_headings: Sequence[str] = COMPANY_REQUIRED_SECTIONS + FINAL_REVIEW_SECTIONS

    def normalize_output(self, output: str) -> str:
        return strip_duplicate_template_headings(
            output,
            fixed_headings=self.fixed_headings,
        )

    def render_docx(self, payload: DocumentRenderPayload) -> bytes:
        return render_generation_docx(
            title=payload.title,
            task_name=payload.task_name,
            department=payload.department,
            author=payload.author,
            output=self.normalize_output(payload.output),
            version=payload.version,
        )


GENERIC_TEMPLATE = GenericDocumentTemplate()
DOCUMENT_TEMPLATES = {
    GENERIC_TEMPLATE.code: GENERIC_TEMPLATE,
}


def get_document_template(template_code: str | None):
    return DOCUMENT_TEMPLATES.get(template_code or "", GENERIC_TEMPLATE)
```

Create `server/app/document_templates/__init__.py`:

```python
from .registry import get_document_template

__all__ = ["get_document_template"]
```

- [ ] **Step 7: Run tests and verify GREEN**

Run:

```bash
cd server
.venv/bin/python -m pytest tests/test_word_export.py::test_document_template_registry_returns_fallback_for_unknown_code tests/test_word_export.py::test_structure_validator_strips_duplicate_company_headings -v
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add server/app/document_templates server/tests/test_word_export.py
git commit -m "feat(ai-assistant): add document template registry"
```

---

## Task 3: Add first task-specific Word templates

**Files:**

- Create: `server/app/document_templates/templates.py`
- Modify: `server/app/document_templates/registry.py`
- Test: `server/tests/test_word_export.py`

- [ ] **Step 1: Write failing tests for work plan and meeting minutes templates**

Add to `server/tests/test_word_export.py`:

```python
from app.document_templates.base import DocumentRenderPayload


def test_work_plan_template_renders_without_duplicate_fixed_headings():
    template = get_document_template("work_plan_v1")
    payload = DocumentRenderPayload(
        title="阶段工作计划",
        task_name="工作计划",
        department="产品交付部",
        author="张三",
        version="1.0.0",
        output="# 一、任务说明\n\n正文\n\n# 二、基本信息\n\n重复基本信息",
    )

    document = Document(BytesIO(template.render_docx(payload)))
    headings = [
        paragraph.text
        for paragraph in document.paragraphs
        if paragraph.style.name in {"Heading 1", "Heading 2", "Heading 3"}
    ]
    basic_info_headings = [heading for heading in headings if heading.endswith("基本信息")]

    assert template.name == "阶段工作计划模板"
    assert len(basic_info_headings) == 1
    assert any(heading.endswith("工作目标与范围") for heading in headings)


def test_meeting_minutes_template_renders_action_item_table():
    template = get_document_template("meeting_minutes_v1")
    payload = DocumentRenderPayload(
        title="会议纪要",
        task_name="会议纪要",
        department="产品交付部",
        author="张三",
        version="1.0.0",
        output="会议讨论了项目进度。",
    )

    document = Document(BytesIO(template.render_docx(payload)))
    table_texts = [
        [cell.text for cell in row.cells]
        for table in document.tables
        for row in table.rows
    ]

    assert ["序号", "事项", "责任人", "截止时间", "状态", "备注"] in table_texts
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cd server
.venv/bin/python -m pytest tests/test_word_export.py::test_work_plan_template_renders_without_duplicate_fixed_headings tests/test_word_export.py::test_meeting_minutes_template_renders_action_item_table -v
```

Expected: FAIL because task-specific templates are not registered.

- [ ] **Step 3: Implement first templates**

Create `server/app/document_templates/templates.py`:

```python
from __future__ import annotations

from dataclasses import dataclass

from .base import DocumentRenderPayload
from .registry import GenericDocumentTemplate
from .structure_validator import strip_duplicate_template_headings


@dataclass(frozen=True)
class FixedStructureTemplate(GenericDocumentTemplate):
    code: str
    name: str
    fixed_headings: Sequence[str]

    def normalize_output(self, output: str) -> str:
        cleaned = strip_duplicate_template_headings(
            output,
            fixed_headings=self.fixed_headings,
        )
        missing_sections = [
            f"# {heading}\n\n待确认"
            for heading in self.fixed_headings
            if heading not in cleaned
        ]
        return "\n\n".join([cleaned, *missing_sections]).strip()


WORK_PLAN_TEMPLATE = FixedStructureTemplate(
    code="work_plan_v1",
    name="阶段工作计划模板",
    fixed_headings=(
        "基本信息",
        "背景说明",
        "工作目标与范围",
        "阶段划分与时间安排",
        "任务分工与责任人",
        "交付物清单",
        "风险与依赖条件",
        "需确认事项",
        "需人工复核事项",
        "下一步动作",
    ),
)

PROJECT_REPORT_TEMPLATE = FixedStructureTemplate(
    code="project_report_v1",
    name="项目汇报模板",
    fixed_headings=(
        "基本信息",
        "项目背景",
        "当前进展",
        "已完成工作",
        "关键数据或结果统计",
        "存在问题",
        "风险与影响",
        "需协调事项",
        "下一步计划",
        "需人工复核事项",
    ),
)


@dataclass(frozen=True)
class MeetingMinutesTemplate(FixedStructureTemplate):
    def normalize_output(self, output: str) -> str:
        normalized = super().normalize_output(output)
        if "| 序号 | 事项 | 责任人 | 截止时间 | 状态 | 备注 |" not in normalized:
            normalized = "\n\n".join([
                normalized,
                "| 序号 | 事项 | 责任人 | 截止时间 | 状态 | 备注 |",
                "|---|---|---|---|---|---|",
                "| 1 | 待确认 | 待确认 | 待确认 | 待确认 | 待确认 |",
            ])
        return normalized


MEETING_MINUTES_TEMPLATE = MeetingMinutesTemplate(
    code="meeting_minutes_v1",
    name="会议纪要模板",
    fixed_headings=(
        "会议基本信息",
        "会议背景",
        "讨论议题",
        "关键结论",
        "决议事项",
        "待办事项表",
        "风险与分歧",
        "待确认事项",
        "需人工复核事项",
        "下一步安排",
    ),
)
```

- [ ] **Step 4: Register templates**

Modify `server/app/document_templates/registry.py` after `GENERIC_TEMPLATE`:

```python
from .templates import (
    MEETING_MINUTES_TEMPLATE,
    PROJECT_REPORT_TEMPLATE,
    WORK_PLAN_TEMPLATE,
)

DOCUMENT_TEMPLATES = {
    GENERIC_TEMPLATE.code: GENERIC_TEMPLATE,
    WORK_PLAN_TEMPLATE.code: WORK_PLAN_TEMPLATE,
    MEETING_MINUTES_TEMPLATE.code: MEETING_MINUTES_TEMPLATE,
    PROJECT_REPORT_TEMPLATE.code: PROJECT_REPORT_TEMPLATE,
}
```

If this causes a circular import because `templates.py` imports `GenericDocumentTemplate`, move `GenericDocumentTemplate` from `registry.py` into `base.py` and import it from both files.

- [ ] **Step 5: Run template tests and verify GREEN**

Run:

```bash
cd server
.venv/bin/python -m pytest tests/test_word_export.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add server/app/document_templates server/tests/test_word_export.py
git commit -m "feat(ai-assistant): add task-specific word templates"
```

---

## Task 4: Integrate templates into Word export

**Files:**

- Modify: `server/app/history_service.py`
- Modify: `server/app/main.py`
- Modify: `server/tests/test_history.py`
- Modify: `server/tests/test_word_export.py`

- [ ] **Step 1: Write failing export integration test**

Add to `server/tests/test_history.py` or the existing export-owner test file:

```python
def test_export_uses_task_document_template(client_for_user, records, generation_db, monkeypatch):
    records.task.document_template_code = "meeting_minutes_v1"
    generation_db.commit()
    captured = {}

    def fake_get_template(template_code):
        captured["template_code"] = template_code
        class FakeTemplate:
            code = template_code
            name = "Fake"
            def render_docx(self, payload):
                captured["title"] = payload.title
                return b"docx"
        return FakeTemplate()

    monkeypatch.setattr("app.main.get_document_template", fake_get_template)

    response = client_for_user("u1").get(
        f"/api/ai/generations/{records.u1.uuid}/export.docx"
    )

    assert response.status_code == 200
    assert captured["template_code"] == "meeting_minutes_v1"
```

Adjust fixture names to match the existing `test_history.py` records fixture.

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
cd server
.venv/bin/python -m pytest tests/test_history.py::test_export_uses_task_document_template -v
```

Expected: FAIL because export still directly calls `render_generation_docx`.

- [ ] **Step 3: Include template code in export payload**

In `server/app/history_service.py`, update `load_generation_export_payload()` to include:

```python
        "document_template_code": task.document_template_code,
```

- [ ] **Step 4: Route export through template registry**

In `server/app/main.py`, import:

```python
from .document_templates.base import DocumentRenderPayload
from .document_templates.registry import get_document_template
```

Then replace the direct `render_generation_docx` call in `export_generation_word()` with:

```python
        template = get_document_template(str(payload.get("document_template_code") or ""))
        document = template.render_docx(
            DocumentRenderPayload(
                title=str(payload["task_name"]),
                task_name=str(payload["task_name"]),
                department=str(payload["department"]),
                author=str(payload["author"]),
                output=str(payload["output"]),
                version=str(payload["version"]),
                inputs=dict(payload.get("input") or {}),
            )
        )
```

- [ ] **Step 5: Run export tests and verify GREEN**

Run:

```bash
cd server
.venv/bin/python -m pytest tests/test_history.py tests/test_word_export.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add server/app/history_service.py server/app/main.py server/tests/test_history.py server/tests/test_word_export.py
git commit -m "feat(ai-assistant): render exports with task templates"
```

---

## Task 5: Add encrypted attachment model and upload endpoint

**Files:**

- Modify: `server/app/models.py`
- Modify: `server/app/schemas.py`
- Create: `server/app/attachments.py`
- Modify: `server/app/main.py`
- Modify: `server/alembic/versions/0007_task_templates_and_attachments.py`
- Create: `server/tests/test_attachments.py`

- [ ] **Step 1: Write failing attachment upload test**

Create `server/tests/test_attachments.py`:

```python
from io import BytesIO
from sqlalchemy import select

from app.models import GenerationAttachment


def test_upload_txt_attachment_extracts_and_encrypts_text(generation_client, generation_db, seeded_task):
    response = generation_client.post(
        "/api/ai/attachments",
        data={"task_uuid": seeded_task.uuid},
        files={"file": ("meeting.txt", BytesIO("会议内容".encode("utf-8")), "text/plain")},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["file_name"] == "meeting.txt"
    assert payload["status"] == "READY"
    assert payload["extracted_characters"] == 4

    record = generation_db.scalar(select(GenerationAttachment))
    assert record is not None
    assert b"会议内容" not in record.extracted_text_ciphertext
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
cd server
.venv/bin/python -m pytest tests/test_attachments.py::test_upload_txt_attachment_extracts_and_encrypts_text -v
```

Expected: FAIL because model and endpoint do not exist.

- [ ] **Step 3: Add attachment model**

In `server/app/models.py`, after `GenerationRecord`, add:

```python
class GenerationAttachment(TimestampMixin, Base):
    __tablename__ = "ai_generation_attachments"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    sso_user_id: Mapped[str] = mapped_column(String(64), index=True)
    task_id: Mapped[int] = mapped_column(foreign_key_type, ForeignKey("ai_tasks.id"), index=True)
    generation_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_generation_records.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    file_name: Mapped[str] = mapped_column(String(255))
    file_type: Mapped[str] = mapped_column(String(128))
    file_size: Mapped[int] = mapped_column(Integer)
    content_sha256: Mapped[str] = mapped_column(String(64), index=True)
    extracted_text_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    extracted_text_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(24), default="READY", index=True)
    error_code: Mapped[str] = mapped_column(String(64), default="")
```

- [ ] **Step 4: Extend migration with attachment table**

In `server/alembic/versions/0007_task_templates_and_attachments.py`, add to `upgrade()` after task columns:

```python
    op.create_table(
        "ai_generation_attachments",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(length=36), nullable=False, unique=True),
        sa.Column("sso_user_id", sa.String(length=64), nullable=False),
        sa.Column("task_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), sa.ForeignKey("ai_tasks.id"), nullable=False),
        sa.Column("generation_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), sa.ForeignKey("ai_generation_records.id", ondelete="SET NULL"), nullable=True),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_type", sa.String(length=128), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("content_sha256", sa.String(length=64), nullable=False),
        sa.Column("extracted_text_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("extracted_text_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("key_version", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="READY"),
        sa.Column("error_code", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_ai_generation_attachments_sso_user_id", "ai_generation_attachments", ["sso_user_id"])
    op.create_index("ix_ai_generation_attachments_task_id", "ai_generation_attachments", ["task_id"])
    op.create_index("ix_ai_generation_attachments_generation_id", "ai_generation_attachments", ["generation_id"])
    op.create_index("ix_ai_generation_attachments_status", "ai_generation_attachments", ["status"])
```

Add to `downgrade()` before dropping task columns:

```python
    op.drop_index("ix_ai_generation_attachments_status", table_name="ai_generation_attachments")
    op.drop_index("ix_ai_generation_attachments_generation_id", table_name="ai_generation_attachments")
    op.drop_index("ix_ai_generation_attachments_task_id", table_name="ai_generation_attachments")
    op.drop_index("ix_ai_generation_attachments_sso_user_id", table_name="ai_generation_attachments")
    op.drop_table("ai_generation_attachments")
```

- [ ] **Step 5: Add schemas**

In `server/app/schemas.py`, add:

```python
class AttachmentOut(BaseModel):
    attachment_uuid: str
    file_name: str
    file_type: str
    file_size: int
    status: str
    extracted_characters: int
```

- [ ] **Step 6: Implement text attachment service**

Create `server/app/attachments.py`:

```python
from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from .crypto import ContentCipher
from .models import GenerationAttachment, Task


MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
SUPPORTED_SUFFIXES = {".txt", ".md"}


def _safe_file_name(name: str) -> str:
    cleaned = Path(name or "attachment.txt").name.replace("\x00", "")
    return cleaned or "attachment.txt"


async def read_supported_text(upload: UploadFile) -> tuple[str, bytes, str]:
    file_name = _safe_file_name(upload.filename or "")
    suffix = Path(file_name).suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise HTTPException(status_code=400, detail="当前仅支持 txt、md、docx、pdf 文件")
    data = await upload.read(MAX_ATTACHMENT_BYTES + 1)
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail="文件不能超过 20 MB")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=422, detail="文件编码暂不支持，请使用 UTF-8 文本") from exc
    return file_name, data, text


async def create_attachment(
    db: Session,
    *,
    sso_user_id: str,
    task_uuid: str,
    upload: UploadFile,
    cipher: ContentCipher,
    key_version: str,
) -> tuple[GenerationAttachment, int]:
    task = db.scalar(select(Task).where(Task.uuid == task_uuid, Task.status == "ACTIVE"))
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    file_name, data, text = await read_supported_text(upload)
    attachment = GenerationAttachment(
        sso_user_id=sso_user_id,
        task_id=task.id,
        file_name=file_name,
        file_type=upload.content_type or "application/octet-stream",
        file_size=len(data),
        content_sha256=hashlib.sha256(data).hexdigest(),
        key_version=key_version,
        status="READY",
    )
    encrypted = cipher.encrypt_json({"text": text}, attachment.uuid.encode())
    attachment.extracted_text_ciphertext = encrypted.ciphertext
    attachment.extracted_text_nonce = encrypted.nonce
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return attachment, len(text)
```

- [ ] **Step 7: Add upload endpoint**

In `server/app/main.py`, import `UploadFile`, `File`, `Form`, `AttachmentOut`, and `create_attachment`.

Add route:

```python
@app.post("/api/ai/attachments", response_model=AttachmentOut, status_code=201)
async def upload_ai_attachment(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_content_cipher)],
    task_uuid: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
) -> AttachmentOut:
    await require_action("ai_assistant:use", request, session_payload, current_settings)
    attachment, characters = await create_attachment(
        db,
        sso_user_id=str(session_payload.user.id),
        task_uuid=task_uuid,
        upload=file,
        cipher=cipher,
        key_version=current_settings.content_encryption_key_version,
    )
    write_request_audit(
        db,
        session_payload,
        request,
        current_settings,
        action="generation_attachment.upload",
        entity_type="generation_attachment",
        entity_uuid=attachment.uuid,
        metadata={
            "attachment_uuid": attachment.uuid,
            "task_uuid": task_uuid,
            "file_name": attachment.file_name,
            "file_type": attachment.file_type,
            "file_size": attachment.file_size,
            "status": attachment.status,
        },
    )
    db.commit()
    return AttachmentOut(
        attachment_uuid=attachment.uuid,
        file_name=attachment.file_name,
        file_type=attachment.file_type,
        file_size=attachment.file_size,
        status=attachment.status,
        extracted_characters=characters,
    )
```

- [ ] **Step 8: Run attachment tests and verify GREEN**

Run:

```bash
cd server
.venv/bin/python -m pytest tests/test_attachments.py tests/test_migrations.py -q
```

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

```bash
git add server/app/models.py server/app/schemas.py server/app/attachments.py server/app/main.py server/alembic/versions/0007_task_templates_and_attachments.py server/tests/test_attachments.py server/tests/test_migrations.py
git commit -m "feat(ai-assistant): add encrypted text attachments"
```

---

## Task 6: Use attachments during generation prepare

**Files:**

- Modify: `server/app/schemas.py`
- Modify: `server/app/attachments.py`
- Modify: `server/app/generation_service.py`
- Test: `server/tests/test_generation_flow.py`
- Test: `server/tests/test_attachments.py`

- [ ] **Step 1: Add failing prepare test with attachment**

Add to `server/tests/test_generation_flow.py`:

```python
def test_prepare_appends_owned_attachment_as_untrusted_material(
    generation_client,
    generation_db,
    seeded_task,
    respx_mock,
):
    upload = generation_client.post(
        "/api/ai/attachments",
        data={"task_uuid": seeded_task.uuid},
        files={"file": ("meeting.txt", b"会议讨论了交付计划", "text/plain")},
    )
    attachment_uuid = upload.json()["attachment_uuid"]
    mock_published_prompt(respx_mock)

    response = generation_client.post(
        "/api/ai/generations/prepare",
        json={
            "task_uuid": seeded_task.uuid,
            "inputs": {"work_content": "整理会议纪要"},
            "attachment_uuids": [attachment_uuid],
        },
    )

    assert response.status_code == 201
    user_content = response.json()["messages"][1]["content"]
    assert "【不可信资料区开始：上传材料】" in user_content
    assert "会议讨论了交付计划" in user_content
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
cd server
.venv/bin/python -m pytest tests/test_generation_flow.py::test_prepare_appends_owned_attachment_as_untrusted_material -v
```

Expected: FAIL because `attachment_uuids` is forbidden or ignored.

- [ ] **Step 3: Extend prepare schema**

In `server/app/schemas.py`, add to `PrepareGenerationIn`:

```python
    attachment_uuids: list[str] = Field(default_factory=list, max_length=5)
```

- [ ] **Step 4: Add attachment loader**

In `server/app/attachments.py`, add:

```python
from .crypto import EncryptedPayload


def load_owned_attachment_texts(
    db: Session,
    *,
    sso_user_id: str,
    task_id: int,
    attachment_uuids: list[str],
    cipher: ContentCipher,
) -> list[dict[str, object]]:
    if not attachment_uuids:
        return []
    records = list(
        db.scalars(
            select(GenerationAttachment).where(
                GenerationAttachment.uuid.in_(attachment_uuids),
                GenerationAttachment.sso_user_id == sso_user_id,
                GenerationAttachment.task_id == task_id,
                GenerationAttachment.status == "READY",
            )
        )
    )
    if len(records) != len(set(attachment_uuids)):
        raise HTTPException(status_code=404, detail="附件不存在")
    result = []
    for record in records:
        payload = cipher.decrypt_json(
            EncryptedPayload(record.extracted_text_ciphertext, record.extracted_text_nonce),
            record.uuid.encode(),
        )
        result.append({
            "uuid": record.uuid,
            "file_name": record.file_name,
            "text": str(payload.get("text") or ""),
        })
    return result
```

- [ ] **Step 5: Append attachments as untrusted material**

In `server/app/generation_service.py`, after normalized inputs are built and before `build_messages(sections)`, load attachments using the current task ID:

```python
attachment_refs = load_owned_attachment_texts(
    db,
    sso_user_id=str(session_payload.user.id),
    task_id=task.id,
    attachment_uuids=body.attachment_uuids,
    cipher=cipher,
)
if attachment_refs:
    attachment_text = "\n\n".join(
        f"文件名：{item['file_name']}\n内容：{item['text']}"
        for item in attachment_refs
    )
    sections.append(
        ContextSection(
            kind="user",
            title="上传材料",
            content=wrap_untrusted_material(
                "上传材料",
                attachment_text,
            ),
        )
    )
```

Use the existing untrusted wrapper helper name in `generation_service.py`; if it is not `wrap_untrusted_material`, reuse the helper currently wrapping employee inputs and knowledge.

- [ ] **Step 6: Bind attachments to generation record**

After the `GenerationRecord` instance is created in `prepare_generation`, update attachment rows:

```python
for attachment_uuid in body.attachment_uuids:
    attachment = db.scalar(
        select(GenerationAttachment).where(
            GenerationAttachment.uuid == attachment_uuid,
            GenerationAttachment.sso_user_id == str(session_payload.user.id),
        )
    )
    if attachment is not None:
        attachment.generation_id = record.id
```

If `record.id` is not available before flush, call `db.flush()` after adding the record and before binding attachments.

- [ ] **Step 7: Run generation tests and verify GREEN**

Run:

```bash
cd server
.venv/bin/python -m pytest tests/test_generation_flow.py tests/test_attachments.py -q
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

```bash
git add server/app/schemas.py server/app/attachments.py server/app/generation_service.py server/tests/test_generation_flow.py server/tests/test_attachments.py
git commit -m "feat(ai-assistant): include attachments in generation context"
```

---

## Task 7: Add desktop attachment upload UI

**Files:**

- Modify: `apps/desktop/src/api/client.ts`
- Create: `apps/desktop/src/components/AttachmentUpload.tsx`
- Modify: `apps/desktop/src/pages/TaskRunPage.tsx`
- Modify: `apps/desktop/src/theme/tokens.css`
- Test: `apps/desktop/tests/task-run.test.tsx`

- [ ] **Step 1: Write failing frontend test**

Add to `apps/desktop/tests/task-run.test.tsx`:

```tsx
it('uploads reference material and includes attachment ids in prepare request', async () => {
  const prepareRequest = vi.fn();
  server.use(
    http.post('/api/ai/attachments', async () => HttpResponse.json({
      attachment_uuid: 'att-1',
      file_name: 'meeting.txt',
      file_type: 'text/plain',
      file_size: 12,
      status: 'READY',
      extracted_characters: 6,
    }, { status: 201 })),
    http.post('/api/ai/generations/prepare', async ({ request }) => {
      prepareRequest(await request.json());
      return HttpResponse.json({
        generation_uuid: 'gen-attachment',
        completion_token: 'complete-attachment',
        messages: [{ role: 'user', content: '生成会议纪要' }],
        temperature: 0.3,
        safety_notice: '需人工复核',
        context_usage: { characters: 10, estimated_tokens: 3, estimator: 'rough_chars_div_4' },
      }, { status: 201 });
    }),
    http.post('/api/ai/generations/gen-attachment/complete', () =>
      HttpResponse.json({ generation_uuid: 'gen-attachment', status: 'COMPLETED' })),
  );
  invokeMock
    .mockResolvedValueOnce([{
      id: 'profile-1',
      displayName: '公司模型',
      baseUrl: 'https://model.example/v1/',
      modelId: 'example-model',
      temperature: 0.3,
      timeoutSeconds: 60,
      isDefault: true,
      hasApiKey: true,
    }])
    .mockResolvedValueOnce({ output: '会议纪要', latencyMs: 10, usage: {} });

  render(<TaskRunPage task={workSummaryTask} />);
  await userEvent.type(screen.getByLabelText('工作内容'), '生成会议纪要');
  const file = new File(['会议内容'], 'meeting.txt', { type: 'text/plain' });
  await userEvent.upload(screen.getByLabelText('上传参考材料'), file);
  expect(await screen.findByText('meeting.txt')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '开始生成' }));

  await waitFor(() => expect(prepareRequest).toHaveBeenCalled());
  expect(prepareRequest).toHaveBeenCalledWith(expect.objectContaining({
    attachment_uuids: ['att-1'],
  }));
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
cd apps/desktop
npm test -- tests/task-run.test.tsx --run
```

Expected: FAIL because upload UI/API does not exist.

- [ ] **Step 3: Add client API**

In `apps/desktop/src/api/client.ts`, add:

```ts
export type AttachmentPayload = {
  attachment_uuid: string;
  file_name: string;
  file_type: string;
  file_size: number;
  status: string;
  extracted_characters: number;
};

export async function uploadTaskAttachment(
  taskUuid: string,
  file: File,
): Promise<AttachmentPayload> {
  const form = new FormData();
  form.append('task_uuid', taskUuid);
  form.append('file', file);
  return readJson(
    await fetch('/api/ai/attachments', {
      method: 'POST',
      credentials: 'include',
      body: form,
    }),
    'ATTACHMENT_UPLOAD_FAILED',
  );
}
```

- [ ] **Step 4: Create upload component**

Create `apps/desktop/src/components/AttachmentUpload.tsx`:

```tsx
import { useState } from 'react';

import { uploadTaskAttachment, type AttachmentPayload } from '../api/client';

type AttachmentUploadProps = {
  taskUuid: string;
  onChange: (attachments: AttachmentPayload[]) => void;
};

export function AttachmentUpload({ taskUuid, onChange }: AttachmentUploadProps) {
  const [items, setItems] = useState<AttachmentPayload[]>([]);
  const [error, setError] = useState('');

  const upload = async (file: File) => {
    setError('');
    try {
      const item = await uploadTaskAttachment(taskUuid, file);
      const next = items.concat(item);
      setItems(next);
      onChange(next);
    } catch {
      setError('文件上传失败，请确认文件类型和大小后重试');
    }
  };

  return (
    <section className="attachment-upload">
      <label>
        <span>参考材料（可选）</span>
        <small>支持 txt、md、docx、pdf。文件内容会作为参考材料参与生成。</small>
        <input
          aria-label="上传参考材料"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.currentTarget.value = '';
          }}
          type="file"
        />
      </label>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.attachment_uuid}>
              <strong>{item.file_name}</strong>
              <span>{item.status === 'READY' ? '已解析' : item.status}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}
```

- [ ] **Step 5: Wire component into task page**

In `apps/desktop/src/pages/TaskRunPage.tsx`, import:

```ts
import { AttachmentUpload } from '../components/AttachmentUpload';
import type { AttachmentPayload } from '../api/client';
```

Add state:

```ts
const [attachments, setAttachments] = useState<AttachmentPayload[]>([]);
```

Render after `DynamicTaskForm`:

```tsx
<AttachmentUpload taskUuid={task.uuid} onChange={setAttachments} />
```

Add to prepare request body:

```ts
attachment_uuids: attachments.map((attachment) => attachment.attachment_uuid),
```

- [ ] **Step 6: Add minimal styles**

In `apps/desktop/src/theme/tokens.css`, add:

```css
.attachment-upload {
  border: 1px solid var(--border-subtle);
  border-radius: 18px;
  padding: 16px;
  display: grid;
  gap: 12px;
}

.attachment-upload label {
  display: grid;
  gap: 8px;
}

.attachment-upload small {
  color: var(--text-muted);
}

.attachment-upload ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 8px;
}

.attachment-upload li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border-radius: 12px;
  background: var(--surface-muted);
  padding: 10px 12px;
}
```

Use existing token names from `tokens.css`; if `--border-subtle` or `--surface-muted` does not exist, use the closest existing border and surface variables in that file.

- [ ] **Step 7: Run frontend tests and verify GREEN**

Run:

```bash
cd apps/desktop
npm test -- tests/task-run.test.tsx --run
```

Expected: PASS.

- [ ] **Step 8: Commit Task 7**

```bash
git add apps/desktop/src/api/client.ts apps/desktop/src/components/AttachmentUpload.tsx apps/desktop/src/pages/TaskRunPage.tsx apps/desktop/src/theme/tokens.css apps/desktop/tests/task-run.test.tsx
git commit -m "feat(ai-assistant): upload task reference attachments"
```

---

## Task 8: Support DOCX and PDF text extraction

**Files:**

- Modify: `server/requirements.txt`
- Modify: `server/app/attachments.py`
- Modify: `server/tests/test_attachments.py`

- [ ] **Step 1: Add failing DOCX and PDF tests**

Add to `server/tests/test_attachments.py`:

```python
from docx import Document


def build_docx_bytes(text: str) -> bytes:
    buffer = BytesIO()
    doc = Document()
    doc.add_paragraph(text)
    doc.save(buffer)
    return buffer.getvalue()


def test_upload_docx_attachment_extracts_paragraph_text(generation_client, seeded_task):
    response = generation_client.post(
        "/api/ai/attachments",
        data={"task_uuid": seeded_task.uuid},
        files={"file": ("meeting.docx", BytesIO(build_docx_bytes("会议段落")), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )

    assert response.status_code == 201
    assert response.json()["extracted_characters"] >= len("会议段落")


def test_upload_unsupported_attachment_type_returns_clear_error(generation_client, seeded_task):
    response = generation_client.post(
        "/api/ai/attachments",
        data={"task_uuid": seeded_task.uuid},
        files={"file": ("image.png", BytesIO(b"png"), "image/png")},
    )

    assert response.status_code == 400
    assert "当前仅支持" in response.text
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cd server
.venv/bin/python -m pytest tests/test_attachments.py::test_upload_docx_attachment_extracts_paragraph_text tests/test_attachments.py::test_upload_unsupported_attachment_type_returns_clear_error -v
```

Expected: DOCX test fails because only txt/md are implemented.

- [ ] **Step 3: Implement DOCX extraction**

In `server/app/attachments.py`, import:

```python
from io import BytesIO
from docx import Document
```

Replace text decoding in `read_supported_text()` with:

```python
    if suffix in {".txt", ".md"}:
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(status_code=422, detail="文件编码暂不支持，请使用 UTF-8 文本") from exc
        return file_name, data, text

    if suffix == ".docx":
        document = Document(BytesIO(data))
        parts: list[str] = []
        parts.extend(paragraph.text for paragraph in document.paragraphs if paragraph.text.strip())
        for table in document.tables:
            for row in table.rows:
                parts.append(" | ".join(cell.text.strip() or "待确认" for cell in row.cells))
        return file_name, data, "\n".join(parts).strip()
```

Update `SUPPORTED_SUFFIXES`:

```python
SUPPORTED_SUFFIXES = {".txt", ".md", ".docx", ".pdf"}
```

For `.pdf`, return 422 until extraction is implemented:

```python
    if suffix == ".pdf":
        raise HTTPException(status_code=422, detail="PDF 文本提取将在下一步启用；扫描件暂不支持 OCR")
```

- [ ] **Step 4: Run attachment tests**

Run:

```bash
cd server
.venv/bin/python -m pytest tests/test_attachments.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit Task 8**

```bash
git add server/app/attachments.py server/tests/test_attachments.py
git commit -m "feat(ai-assistant): extract docx attachment text"
```

---

## Task 9: End-to-end verification and version bump

**Files:**

- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/package-lock.json`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Optional docs update if implementation notes are needed.

- [ ] **Step 1: Run backend focused tests**

Run:

```bash
cd server
.venv/bin/python -m pytest \
  tests/test_word_export.py \
  tests/test_generation_flow.py \
  tests/test_attachments.py \
  tests/test_history.py \
  tests/test_migrations.py \
  -q
```

Expected: PASS.

- [ ] **Step 2: Run frontend tests**

Run:

```bash
cd apps/desktop
npm test -- --run
```

Expected: PASS.

- [ ] **Step 3: Build frontend**

Run:

```bash
cd apps/desktop
npm run build
```

Expected: PASS.

- [ ] **Step 4: Run Rust tests if desktop Rust files changed**

Run:

```bash
cd apps/desktop/src-tauri
cargo test --lib
```

Expected: PASS.

- [ ] **Step 5: Bump Agent version**

This is a feature optimization, so bump `Agent 1.2.1 -> 1.3.0`.

Update:

- `apps/desktop/package.json`
- `apps/desktop/package-lock.json` root package entries only.
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/Cargo.toml`

Set each app version value to:

```text
1.3.0
```

Do not stage unrelated dirty hunks such as dependency upgrades unless the current task intentionally changed them.

- [ ] **Step 6: Run final checks**

Run:

```bash
git diff --check
cd apps/desktop && npm test -- --run && npm run build
cd ../.. && cd server && .venv/bin/python -m pytest tests/test_word_export.py tests/test_generation_flow.py tests/test_attachments.py tests/test_history.py tests/test_migrations.py -q
```

Expected: all commands pass.

- [ ] **Step 7: Commit implementation**

Stage only files touched by this plan:

```bash
git add \
  server/app/document_templates \
  server/app/word_export.py \
  server/app/models.py \
  server/app/schemas.py \
  server/app/generation_service.py \
  server/app/main.py \
  server/app/history_service.py \
  server/app/attachments.py \
  server/alembic/versions/0007_task_templates_and_attachments.py \
  server/tests/test_word_export.py \
  server/tests/test_generation_flow.py \
  server/tests/test_attachments.py \
  server/tests/test_history.py \
  server/tests/test_migrations.py \
  apps/desktop/src/api/client.ts \
  apps/desktop/src/components/AttachmentUpload.tsx \
  apps/desktop/src/pages/TaskRunPage.tsx \
  apps/desktop/src/theme/tokens.css \
  apps/desktop/tests/task-run.test.tsx \
  apps/desktop/package.json \
  apps/desktop/package-lock.json \
  apps/desktop/src-tauri/tauri.conf.json \
  apps/desktop/src-tauri/Cargo.toml
git commit -m "[agent-v1.3.0] feat(ai-assistant): add task templates and attachments"
```

- [ ] **Step 8: Push**

Run:

```bash
git push --set-upstream origin "$(git branch --show-current)"
```

Expected: push succeeds. If GitHub rejects workflow-file updates because the PAT lacks `workflow` scope, stop and report the exact rejection without rewriting history.

---

## Self-review

- Spec coverage:
  - Service-side Word generation: Tasks 2–4.
  - Task-specific templates: Tasks 1, 3, 4.
  - Duplicate heading prevention: Tasks 2–4.
  - Text attachments: Tasks 5–8.
  - Attachment security and ownership: Tasks 5–6.
  - Client upload UI: Task 7.
  - Version and validation: Task 9.
- Out of scope by design:
  - Audio transcription.
  - OCR for scanned PDFs.
  - User-uploaded Word templates.
  - Online DOCX editor.
- Placeholder scan:
  - No unresolved placeholders or unspecified “add tests” steps remain.
- Type consistency:
  - `attachment_uuids` is added to `PrepareGenerationIn` and passed from `TaskRunPage`.
  - `AttachmentOut` response maps to `AttachmentPayload`.
  - `document_template_code` is stored on `Task` and read during export.
