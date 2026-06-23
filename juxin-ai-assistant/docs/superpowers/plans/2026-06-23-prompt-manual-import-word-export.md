# V1.10 Prompt Manual Import and Word Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge every executable Prompt from the V1.10 company manual into the existing assistant catalog without breaking task identity, apply company knowledge and document-control rules during generation, widen the output preview, and add authenticated server-side Word export.

**Architecture:** Compile the DOCX once into reviewed JSON artifacts, then use those artifacts as the only seed source for Prompt Center, assistant tasks, knowledge links, and document governance. Extend tasks with source/document metadata, inject governance rules at generation time, and render completed encrypted generation records to DOCX on the server. The desktop web UI remains a same-origin client that requests the export and downloads the response.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, Alembic, `python-docx`, Node.js, Express, MySQL, React 19, TypeScript, Vitest, Pytest.

---

**Command convention:** Run commands from the `juxin-ai-assistant` directory unless a step explicitly changes directory. Prompt Center is the sibling directory `../prompt-center`; the repository-level Compose file is `../docker-compose.yml`.

## File Structure

### New files

- `server/scripts/compile_prompt_manual.py` — parse DOCX XML and produce reviewed manual artifacts.
- `server/catalog/manual-v1.10.json` — normalized source entries, inclusion decisions, task mappings, knowledge records, and control rules.
- `server/catalog/manual-v1.10-report.json` — import audit summary with included, excluded, merged, and review items.
- `server/app/document_governance.py` — load and render the company output-control rules for a task.
- `server/app/word_export.py` — convert a completed generation record into the V1.10 DOCX template.
- `server/alembic/versions/0005_task_document_metadata.py` — add source and document metadata to tasks.
- `server/tests/test_manual_compiler.py` — compiler extraction, classification, and deterministic-output tests.
- `server/tests/test_document_governance.py` — control-rule selection and rendering tests.
- `server/tests/test_word_export.py` — DOCX structure and owner-only export tests.

### Modified files

- `server/catalog/assistants.json` — merged task catalog, explicit Prompt bodies, source metadata, and new assistants/tasks.
- `server/scripts/seed_catalog.py` — validate and seed task metadata plus manual knowledge links.
- `server/app/models.py` — task document/source columns.
- `server/app/generation_service.py` — append company knowledge and document-control instructions.
- `server/app/main.py` — register the Word export route.
- `server/requirements.txt` — add `python-docx`.
- `server/tests/test_catalog.py` — dynamic catalog expectations, merge preservation, metadata, and knowledge seeding.
- `server/tests/test_generation_flow.py` — formal/non-formal governance injection behavior.
- `server/tests/test_history.py` — owner-only Word endpoint and audit behavior.
- `../prompt-center/backend/scripts/seed-ai-assistant-prompts.js` — seed explicit V1.10 Prompt content and remove the hard-coded count.
- `../prompt-center/backend/tests/ai-assistant-seed.test.mjs` — verify explicit content, dynamic counts, and version upgrades.
- `apps/desktop/src/api/client.ts` — authenticated Word download helper.
- `apps/desktop/src/pages/TaskRunPage.tsx` — B layout markup and manual export action.
- `apps/desktop/src/theme/tokens.css` — top summary plus 43/57 desktop layout and single-column responsive layout.
- `apps/desktop/tests/task-run.test.tsx` — export button, error state, and action behavior.
- `apps/desktop/package.json` and `apps/desktop/src-tauri/tauri.conf.json` — feature version bump from `1.1.0` to `1.2.0`.
- `apps/desktop/src-tauri/Cargo.toml` and `server/app/config.py` — keep the desktop binary and assistant service version aligned at `1.2.0`.
- `../prompt-center/backend/package.json` — feature version bump from `5.20.0` to `5.21.0`.
- `../package.json` and `../package-lock.json` — platform feature version bump from `5.89.0` to `5.90.0`.
- `../.gitignore` — ignore local visual-companion session artifacts under `juxin-ai-assistant/.superpowers/`.

The temporary file `server/catalog/prompt-stage-v1.10.json` is generated during deployment, consumed by both services, and ignored by Git.

## Task 1: Build a deterministic DOCX compiler

**Files:**
- Create: `server/scripts/compile_prompt_manual.py`
- Create: `server/tests/test_manual_compiler.py`
- Create: `server/tests/fixtures/manual-mini.docx`

- [ ] **Step 1: Write the failing extraction test**

```python
def test_compile_extracts_sections_prompts_and_governance(tmp_path):
    result = compile_manual(
        Path("tests/fixtures/manual-mini.docx"),
        source_version="V1.10",
    )

    assert result["source"]["version"] == "V1.10"
    assert result["governance"]["title"] == "聚信得仁公司级统一输出总控要求"
    assert result["entries"][0] == {
        "section": "销售",
        "category": "客户拜访",
        "source_title": "生成拜访前客户简报",
        "scene": "客户拜访前快速准备",
        "prompt": "请为聚信得仁销售人员生成一份客户拜访前简报。",
    }
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
cd server
source .venv/bin/activate
pytest tests/test_manual_compiler.py::test_compile_extracts_sections_prompts_and_governance -v
```

Expected: FAIL because `scripts.compile_prompt_manual` does not exist.

- [ ] **Step 3: Implement the XML paragraph reader**

Use only Python standard-library ZIP/XML parsing so compiling the manual does not require Microsoft Word:

```python
from dataclasses import dataclass
from pathlib import Path
from zipfile import ZipFile
import hashlib
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

@dataclass(frozen=True)
class Paragraph:
    style: str
    text: str

def read_paragraphs(path: Path) -> list[Paragraph]:
    with ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    paragraphs = []
    for node in root.iter(f"{W}p"):
        text = "".join(part.text or "" for part in node.iter(f"{W}t")).strip()
        if not text:
            continue
        style_node = node.find(f"./{W}pPr/{W}pStyle")
        style = style_node.get(f"{W}val", "") if style_node is not None else ""
        paragraphs.append(Paragraph(style=style, text=text))
    return paragraphs
```

Track `Heading1`, `Heading2`, `Heading3`, `Prompt标题`, `Prompt正文`, and `正文`. Preserve the complete source text; do not rewrite Prompt content in the compiler.

- [ ] **Step 4: Implement section-aware entry extraction**

```python
BUSINESS_SECTIONS = {
    "第四部分": "销售",
    "第五部分": "售前",
    "第六部分": "产品交付与实施",
    "第七部分": "软件测试",
    "第八部分": "行政与人力",
    "第九部分": "商务与投标支持",
    "第十部分": "渗透测试与安全服务",
}

def compile_manual(path: Path, source_version: str) -> dict:
    paragraphs = read_paragraphs(path)
    return {
        "source": {
            "version": source_version,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        },
        "governance": extract_governance(paragraphs),
        "entries": extract_business_entries(paragraphs),
    }
```

For sales/delivery/testing/HR/business/security sections, treat a `Heading3` as a candidate entry and collect following body paragraphs until the next heading. For presales, also treat `Heading2` names ending in `提示词` as candidates because that section uses a different hierarchy.

- [ ] **Step 5: Add deterministic classification rules**

Define explicit classification constants:

```python
NON_TASK_TITLE_FRAGMENTS = {
    "手册定位", "使用原则", "使用规范", "使用方法", "结束语",
    "输入模板", "输出格式引用说明", "注意事项", "使用场景",
}

INDEPENDENT_CHECK_TASKS = {
    "技术标书自查提示词",
    "标书用印流程与盖章检查清单",
    "检查测试用例是否合格",
    "商务全流程风险检查清单",
    "文档遗漏检查",
}
```

Return one of `TASK`, `KNOWLEDGE`, `QUALITY_RULE`, or `EXCLUDED`. Never use fuzzy semantic matching in this stage.

- [ ] **Step 6: Extract candidate input fields without rewriting Prompt semantics**

For each task candidate:

- Detect labeled input blocks such as `【客户信息】`, `客户名称：[填写]`, and `以下是客户名单：[粘贴客户名单]`.
- Generate stable snake-case field keys from a reviewed mapping table, for example `客户名称` → `customer_name`, `客户沟通记录` → `communication_record`.
- Keep the original Prompt body unchanged except for replacing the specific input placeholder with `{{field_key}}`.
- If the compiler cannot map a placeholder uniquely, add the entry to `unresolved`; never silently fall back to an English field key as the user-visible label.

The compiled field shape is:

```json
{
  "field_key": "customer_name",
  "label": "客户名称",
  "field_type": "TEXT",
  "required": true,
  "placeholder": "请输入真实客户名称",
  "example": "",
  "options_json": [],
  "validation_json": {},
  "sort_order": 10
}
```

- [ ] **Step 7: Run compiler tests**

Run:

```bash
cd server
source .venv/bin/activate
pytest tests/test_manual_compiler.py -v
```

Expected: PASS, including stable ordering and identical JSON from two runs.

- [ ] **Step 8: Commit**

```bash
git add server/scripts/compile_prompt_manual.py server/tests/test_manual_compiler.py server/tests/fixtures/manual-mini.docx
git commit -m "feat(ai-assistant): compile V1.10 prompt manual"
```

## Task 2: Produce and review the V1.10 manifest

**Files:**
- Create: `server/catalog/manual-v1.10.json`
- Create: `server/catalog/manual-v1.10-report.json`
- Modify: `server/tests/test_manual_compiler.py`

- [ ] **Step 1: Add the failing real-manual integrity test**

```python
def test_v110_manifest_has_no_unresolved_executable_entries():
    manifest = json.loads(Path("catalog/manual-v1.10.json").read_text())
    report = json.loads(Path("catalog/manual-v1.10-report.json").read_text())

    assert manifest["source"]["version"] == "V1.10"
    assert len(manifest["tasks"]) > 88
    assert not report["unresolved"]
    assert all(task["prompt"].strip() for task in manifest["tasks"])
    assert all(task["source_ref"].startswith("V1.10｜") for task in manifest["tasks"])
```

- [ ] **Step 2: Run the compiler against the provided manual**

Run:

```bash
cd server
source .venv/bin/activate
python scripts/compile_prompt_manual.py \
  --input "/Users/zhanglei/Downloads/聚信得仁公司级AI提示词手册_统一格式版_V1.10.docx" \
  --output catalog/manual-v1.10.json \
  --report catalog/manual-v1.10-report.json
```

Expected: JSON report with `tasks`, `knowledge`, `quality_rules`, `excluded`, and `unresolved` counts.

- [ ] **Step 3: Add explicit merge decisions**

In `manual-v1.10.json`, every task must contain:

```json
{
  "assistant_code": "sales",
  "code": "customer-visit-brief",
  "name": "客户拜访前简报",
  "aliases": ["生成拜访前客户简报"],
  "merge_existing_code": null,
  "prompt_external_id": 1089,
  "document_type": "REPORT",
  "formal_document": true,
  "source_ref": "V1.10｜第四部分｜三、客户拜访｜1. 生成拜访前客户简报",
  "scene": "客户拜访、视频会议或电话沟通前快速准备。",
  "prompt": "请为聚信得仁销售人员生成一份“客户拜访前简报”……",
  "fields": []
}
```

For each of the existing 88 tasks matched by name or approved alias, set `merge_existing_code` to the old code. Allocate new Prompt IDs sequentially from `1089` and never reuse an existing ID.

- [ ] **Step 4: Verify exclusions**

`manual-v1.10-report.json` must list every non-task title with a reason:

```json
{
  "source_title": "售前AI使用定位",
  "classification": "EXCLUDED",
  "reason": "说明性章节，不是可执行 Prompt"
}
```

Manually inspect every `unresolved` entry. Move it to `TASK`, `KNOWLEDGE`, `QUALITY_RULE`, or `EXCLUDED` with a reason until `unresolved` is empty.

- [ ] **Step 5: Run integrity tests**

Run:

```bash
cd server
source .venv/bin/activate
pytest tests/test_manual_compiler.py -v
```

Expected: PASS and no unresolved executable entry.

- [ ] **Step 6: Commit**

```bash
git add server/catalog/manual-v1.10.json server/catalog/manual-v1.10-report.json server/tests/test_manual_compiler.py
git commit -m "data(ai-assistant): review V1.10 prompt manifest"
```

## Task 3: Add task source and document metadata

**Files:**
- Create: `server/alembic/versions/0005_task_document_metadata.py`
- Modify: `server/app/models.py`
- Modify: `server/tests/test_migrations.py`
- Modify: `server/tests/test_models.py`

- [ ] **Step 1: Write failing model tests**

```python
def test_task_supports_manual_source_and_document_metadata(generation_db):
    assistant = Assistant(code="formal", name="正式文档助手")
    generation_db.add(assistant)
    generation_db.flush()
    task = Task(
        assistant_id=assistant.id,
        code="formal-report",
        name="正式报告",
        source_version="V1.10",
        source_ref="V1.10｜第六部分｜实施报告",
        document_type="REPORT",
        formal_document=True,
    )
    generation_db.add(task)
    generation_db.flush()

    assert task.formal_document is True
    assert task.document_type == "REPORT"
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
cd server
source .venv/bin/activate
pytest tests/test_models.py::test_task_supports_manual_source_and_document_metadata -v
```

Expected: FAIL because the columns do not exist.

- [ ] **Step 3: Add the model columns**

```python
source_version: Mapped[str] = mapped_column(String(32), default="")
source_ref: Mapped[str] = mapped_column(String(512), default="")
document_type: Mapped[str] = mapped_column(String(32), default="PLAIN_TEXT")
formal_document: Mapped[bool] = mapped_column(Boolean, default=False)
```

- [ ] **Step 4: Add migration `0005_task_document_metadata`**

The migration must add non-null columns with safe defaults and remove server defaults after backfill:

```python
revision = "0005_task_document_metadata"
down_revision = "0004_desktop_updates"

def upgrade() -> None:
    op.add_column("ai_tasks", sa.Column("source_version", sa.String(32), server_default="", nullable=False))
    op.add_column("ai_tasks", sa.Column("source_ref", sa.String(512), server_default="", nullable=False))
    op.add_column("ai_tasks", sa.Column("document_type", sa.String(32), server_default="PLAIN_TEXT", nullable=False))
    op.add_column("ai_tasks", sa.Column("formal_document", sa.Boolean(), server_default=sa.false(), nullable=False))
```

- [ ] **Step 5: Run migration and model tests**

Run:

```bash
cd server
source .venv/bin/activate
pytest tests/test_models.py tests/test_migrations.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/app/models.py server/alembic/versions/0005_task_document_metadata.py server/tests/test_models.py server/tests/test_migrations.py
git commit -m "feat(ai-assistant): store task document metadata"
```

## Task 4: Merge the reviewed manifest into the assistant catalog

**Files:**
- Modify: `server/catalog/assistants.json`
- Modify: `server/scripts/seed_catalog.py`
- Modify: `server/tests/test_catalog.py`

- [ ] **Step 1: Replace fixed-count catalog assertions**

Write tests that derive expectations from the reviewed manifest:

```python
def test_catalog_covers_reviewed_manual_tasks():
    catalog = load_catalog()
    manifest = json.loads(Path("catalog/manual-v1.10.json").read_text())
    tasks = {
        task["code"]: task
        for assistant in catalog["assistants"]
        for task in assistant["tasks"]
    }

    assert len(tasks) >= 88
    for manual_task in manifest["tasks"]:
        code = manual_task["merge_existing_code"] or manual_task["code"]
        assert tasks[code]["prompt_content"] == manual_task["prompt"]
        assert tasks[code]["source_ref"] == manual_task["source_ref"]
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
cd server
source .venv/bin/activate
pytest tests/test_catalog.py::test_catalog_covers_reviewed_manual_tasks -v
```

Expected: FAIL because the catalog lacks reviewed Prompt content and metadata.

- [ ] **Step 3: Update catalog validation**

Require these task fields:

```python
for required in (
    "prompt_content",
    "source_version",
    "source_ref",
    "document_type",
    "formal_document",
):
    if required not in task:
        raise ValueError(f"任务 {task_code} 缺少 {required}")
```

Allow a dynamic task count and continue enforcing unique task codes and Prompt IDs.

- [ ] **Step 4: Merge tasks without changing existing identity**

Generate `assistants.json` from the reviewed manifest and current catalog:

- Use `merge_existing_code` as the output code when present.
- Keep the existing `prompt_external_id` for merged tasks.
- Replace name, description, fields, Prompt content, output format, safety notice, and source metadata with V1.10 values.
- Add presales and software-testing assistants.
- Keep unmatched old tasks unchanged, with `source_version` and `source_ref` empty.

- [ ] **Step 5: Seed metadata**

In `seed_catalog`, assign:

```python
task.source_version = task_definition.get("source_version", "")
task.source_ref = task_definition.get("source_ref", "")
task.document_type = task_definition.get("document_type", "PLAIN_TEXT")
task.formal_document = bool(task_definition.get("formal_document", False))
```

Only apply catalog-controlled values when the task is new or `--force-config` is used, matching existing admin-edit preservation behavior.

- [ ] **Step 6: Support staged Prompt versions**

Add `--staged-prompts PATH` to `seed_catalog.py`. The JSON maps Prompt IDs to staged version numbers:

```json
{
  "1002": 4,
  "1089": 1
}
```

When supplied, seed each binding as:

```python
binding.version_policy = "PINNED"
binding.pinned_version = staged_versions[str(prompt_id)]
binding.status = "ACTIVE"
```

Validate every pinned version through `get_published(prompt_id, version)` before committing the assistant DB transaction. Add `--finalize-published` to switch matching bindings back to `PUBLISHED` and clear `pinned_version` only after Prompt Center activation succeeds.

- [ ] **Step 7: Verify UUID preservation**

Add a test that seeds the old catalog, records the UUID for `meeting-minutes`, seeds the V1.10 catalog with force, and asserts the UUID and task ID remain unchanged while Prompt metadata changes.

- [ ] **Step 8: Run catalog tests**

Run:

```bash
cd server
source .venv/bin/activate
pytest tests/test_catalog.py tests/test_catalog_api.py -v
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/catalog/assistants.json server/scripts/seed_catalog.py server/tests/test_catalog.py
git commit -m "feat(ai-assistant): merge V1.10 task catalog"
```

## Task 5: Seed explicit V1.10 Prompt bodies into Prompt Center

**Files:**
- Modify: `../prompt-center/backend/scripts/seed-ai-assistant-prompts.js`
- Modify: `../prompt-center/backend/tests/ai-assistant-seed.test.mjs`

- [ ] **Step 1: Write failing tests for explicit Prompt content**

```javascript
test('uses reviewed prompt content and supports dynamic task counts', () => {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const prompts = seed.buildPromptDefinitions(catalog);
  const taskCount = catalog.assistants.flatMap((item) => item.tasks).length;

  expect(prompts).toHaveLength(taskCount);
  expect(prompts.find((item) => item.id === 1002).content)
    .toBe(catalog.assistants
      .flatMap((item) => item.tasks)
      .find((item) => item.prompt_external_id === 1002)
      .prompt_content);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
(cd ../prompt-center/backend && npm test -- --run tests/ai-assistant-seed.test.mjs)
```

Expected: FAIL because the seed builds generic content and enforces 88.

- [ ] **Step 3: Use catalog Prompt content**

```javascript
const buildPromptDefinitions = (catalog) =>
  (catalog.assistants || []).flatMap((assistant) =>
    (assistant.tasks || []).map((task) => ({
      id: Number(task.prompt_external_id),
      assistantCode: assistant.code,
      assistantName: assistant.name,
      title: task.name,
      summary: task.description,
      content: String(task.prompt_content || '').trim(),
      tags: ['聚信 AI 助手', assistant.name, task.name, task.source_version]
        .filter(Boolean),
      status: 'published',
      variables: extractVariables(task.prompt_content),
    }))
  );

const extractVariables = (content) =>
  [...String(content || '').matchAll(/\{\{\s*([a-zA-Z0-9_\u4e00-\u9fa5-]{1,64})\s*\}\}/g)]
    .map((match) => match[1])
    .filter((value, index, values) => values.indexOf(value) === index);
```

Reject empty Prompt content before opening a DB transaction.

- [ ] **Step 4: Remove the fixed 88 count**

Replace the count check with:

```javascript
if (!prompts.length) throw new Error('AI 助手 Prompt 目录不能为空');
if (new Set(prompts.map((item) => item.id)).size !== prompts.length) {
  throw new Error('AI 助手 Prompt ID 存在重复');
}
```

- [ ] **Step 5: Verify version upgrade behavior**

Keep the current Prompt ID and add a new version only when content differs and `--force` is supplied. Extend the test to assert `current_version_id` changes but Prompt ID remains `1002`.

- [ ] **Step 6: Add two-phase stage and activation**

Support:

```bash
node scripts/seed-ai-assistant-prompts.js \
  --force \
  --stage-output /workspace/server/catalog/prompt-stage-v1.10.json

node scripts/seed-ai-assistant-prompts.js \
  --activate /workspace/server/catalog/prompt-stage-v1.10.json
```

Stage mode must:

- Create missing prompts and new version rows.
- Leave existing prompts' `current_version_id`, title, content, tags, and published version unchanged.
- Emit a JSON mapping from Prompt ID to staged version number.
- Be idempotent by reusing an identical staged version instead of creating another row.

Activation mode must:

- Validate that every staged version still exists.
- Update all current pointers and Prompt metadata in one Prompt Center transaction.
- Publish new prompts.
- Refuse partial activation if any staged row is missing.

Add tests that prove runtime reads the old version after staging and the new version only after activation.

- [ ] **Step 7: Run Prompt Center tests**

Run:

```bash
(cd ../prompt-center/backend && npm test)
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add ../prompt-center/backend/scripts/seed-ai-assistant-prompts.js ../prompt-center/backend/tests/ai-assistant-seed.test.mjs
git commit -m "feat(prompt-center): publish V1.10 assistant prompts"
```

## Task 6: Seed company knowledge and quality rules

**Files:**
- Modify: `server/scripts/seed_catalog.py`
- Modify: `server/catalog/manual-v1.10.json`
- Modify: `server/tests/test_catalog.py`

- [ ] **Step 1: Write failing knowledge seed tests**

```python
@pytest.mark.asyncio
async def test_catalog_seed_upserts_manual_knowledge_and_task_links(generation_db):
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
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
cd server
source .venv/bin/activate
pytest tests/test_catalog.py::test_catalog_seed_upserts_manual_knowledge_and_task_links -v
```

Expected: FAIL because catalog seeding does not create knowledge.

- [ ] **Step 3: Add stable knowledge keys to the manifest**

Each knowledge item must have a stable key:

```json
{
  "key": "company-knowledge-v1-10",
  "title": "聚信得仁公司知识与官网口径 V1.10",
  "category": "COMPANY",
  "priority": 100,
  "task_scopes": ["*"],
  "content": "公司名称：北京聚信得仁科技有限公司……"
}
```

Use `tags_json` to store `["manual:V1.10", "key:company-knowledge-v1-10"]`; lookup by the stable key tag during upsert.

- [ ] **Step 4: Implement encrypted upsert and link replacement**

Add a focused helper in `seed_catalog.py`:

```python
def upsert_manual_knowledge(db, item, tasks_by_code, cipher, key_version):
    existing = next(
        (
            row for row in db.scalars(select(KnowledgeItem)).all()
            if f"key:{item['key']}" in (row.tags_json or [])
        ),
        None,
    )
    # Create or re-encrypt content, then replace links deterministically.
```

Pass `ContentCipher` and key version from `async_main`; tests construct the test cipher explicitly.

- [ ] **Step 5: Keep quality rules out of the task list**

Store quality rules under `manual-v1.10.json["quality_rules"]` and associate them by task code or document type. Do not create `Task` rows for rules unless their manifest classification is `TASK`.

- [ ] **Step 6: Run knowledge and catalog tests**

Run:

```bash
cd server
source .venv/bin/activate
pytest tests/test_catalog.py tests/test_knowledge.py tests/test_knowledge_admin.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/scripts/seed_catalog.py server/catalog/manual-v1.10.json server/tests/test_catalog.py
git commit -m "feat(ai-assistant): seed V1.10 company knowledge"
```

## Task 7: Inject document governance during generation

**Files:**
- Create: `server/app/document_governance.py`
- Create: `server/tests/test_document_governance.py`
- Modify: `server/app/generation_service.py`
- Modify: `server/tests/test_generation_flow.py`

- [ ] **Step 1: Write failing governance selection tests**

```python
def test_formal_report_gets_general_and_report_rules():
    rendered = render_document_governance(
        formal_document=True,
        document_type="REPORT",
    )
    assert "聚信得仁公司级统一输出总控要求" in rendered
    assert "工作概述、执行过程、结果统计" in rendered

def test_plain_text_task_gets_no_document_template():
    assert render_document_governance(
        formal_document=False,
        document_type="PLAIN_TEXT",
    ) == ""
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
cd server
source .venv/bin/activate
pytest tests/test_document_governance.py -v
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement governance loading**

Load the reviewed governance object from `catalog/manual-v1.10.json` with `functools.lru_cache`. Return:

```python
def render_document_governance(
    *,
    formal_document: bool,
    document_type: str,
) -> str:
    if not formal_document:
        return ""
    rules = load_governance()
    structure = rules["document_types"][document_type]
    return f"{rules['control_prompt']}\n\n【当前文档类型固定结构】\n{structure}"
```

- [ ] **Step 4: Append governance to the system message**

In `prepare_generation`:

```python
governance = render_document_governance(
    formal_document=task.formal_document,
    document_type=task.document_type,
)
system_parts = [
    "公司安全规则：不得编造事实，不得泄露秘密，输出必须由员工复核。",
    f"任务 Prompt：\n{rendered_prompt}",
    f"输出格式：{task.output_format}。{task.safety_notice}",
]
if governance:
    system_parts.append(governance)
```

- [ ] **Step 5: Add formal and non-formal generation tests**

Assert formal report messages include the control module exactly once. Assert a WeChat/script task does not include cover, header, or table requirements.

- [ ] **Step 6: Run generation tests**

Run:

```bash
cd server
source .venv/bin/activate
pytest tests/test_document_governance.py tests/test_generation_flow.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/app/document_governance.py server/app/generation_service.py server/tests/test_document_governance.py server/tests/test_generation_flow.py
git commit -m "feat(ai-assistant): apply company document governance"
```

## Task 8: Implement V1.10 DOCX rendering

**Files:**
- Create: `server/app/word_export.py`
- Create: `server/tests/test_word_export.py`
- Modify: `server/requirements.txt`

- [ ] **Step 1: Add `python-docx`**

Append:

```text
python-docx==1.1.2
```

Install:

```bash
cd server
source .venv/bin/activate
pip install -r requirements.txt
```

- [ ] **Step 2: Write failing DOCX structure tests**

```python
def test_render_word_uses_v110_page_and_brand_rules():
    payload = render_generation_docx(
        title="项目实施报告",
        task_name="实施报告",
        department="产品交付部",
        author="张三",
        output="# 一、项目背景\n\n正文\n\n| 项目 | 内容 |\n|---|---|\n| 状态 | 已完成 |",
        version="V1.0",
    )
    document = Document(BytesIO(payload))

    section = document.sections[0]
    assert round(section.top_margin.cm, 1) == 2.5
    assert round(section.left_margin.cm, 1) == 2.8
    assert "聚信得仁" in section.header.paragraphs[0].text
    assert any(table.cell(0, 0).text == "项目" for table in document.tables)
```

- [ ] **Step 3: Run the test and verify failure**

Run:

```bash
cd server
source .venv/bin/activate
pytest tests/test_word_export.py::test_render_word_uses_v110_page_and_brand_rules -v
```

Expected: FAIL because `word_export` does not exist.

- [ ] **Step 4: Implement a focused Markdown block parser**

Support:

- `#`, `##`, `###` headings.
- Blank-line separated paragraphs.
- Ordered and unordered lists.
- Pipe tables.
- Fenced code as monospaced paragraphs.

Unknown syntax remains plain text. Do not add a full Markdown dependency.

- [ ] **Step 5: Implement the V1.10 template**

`render_generation_docx` must:

- Create A4 portrait sections with 2.5/2.8 cm margins.
- Add a cover page.
- Add a one-row revision table.
- Add document title and converted output.
- Add header text and bottom border.
- Add company/confidentiality footer and page fields.
- Apply Chinese fonts and heading sizes.
- Add the four final review headings if the generated content omitted them, with `待确认` bodies rather than invented content.

- [ ] **Step 6: Test malformed Markdown preservation**

Add:

```python
def test_render_word_preserves_unrecognized_text():
    payload = render_generation_docx(..., output="未闭合 **文本")
    assert "未闭合 **文本" in "\n".join(
        paragraph.text for paragraph in Document(BytesIO(payload)).paragraphs
    )
```

- [ ] **Step 7: Run renderer tests**

Run:

```bash
cd server
source .venv/bin/activate
pytest tests/test_word_export.py -v
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/requirements.txt server/app/word_export.py server/tests/test_word_export.py
git commit -m "feat(ai-assistant): render V1.10 Word documents"
```

## Task 9: Add authenticated generation export API and audit

**Files:**
- Modify: `server/app/main.py`
- Modify: `server/app/history_service.py`
- Modify: `server/tests/test_history.py`
- Modify: `server/tests/test_word_export.py`

- [ ] **Step 1: Write owner-only endpoint tests**

```python
def test_owner_downloads_completed_generation_word(client_for_user, records):
    response = client_for_user("u-1").get(
        f"/api/ai/generations/{records.u1.uuid}/export.docx"
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    assert response.content.startswith(b"PK")

def test_other_user_cannot_export_generation(client_for_user, records):
    response = client_for_user("u-2").get(
        f"/api/ai/generations/{records.u1.uuid}/export.docx"
    )
    assert response.status_code == 404
```

- [ ] **Step 2: Run endpoint tests and verify failure**

Run:

```bash
cd server
source .venv/bin/activate
pytest tests/test_word_export.py -v
```

Expected: FAIL with 404 route not found.

- [ ] **Step 3: Add an export payload loader**

In `history_service.py`, add a function that:

- Uses `get_owned_record`.
- Requires `record.status == "COMPLETED"`.
- Requires encrypted output and nonce.
- Loads task and assistant.
- Decrypts output.
- Returns task name, department snapshot, username snapshot, output, and Prompt version.

- [ ] **Step 4: Add the route**

```python
@app.get("/api/ai/generations/{generation_uuid}/export.docx")
async def export_generation_word(...):
    await require_action("ai_assistant:use", request, session_payload, current_settings)
    payload = load_word_export_payload(...)
    body = render_generation_docx(...)
    write_request_audit(
        db,
        session_payload,
        request,
        current_settings,
        action="generation.export_word",
        entity_type="generation",
        entity_uuid=generation_uuid,
        metadata={
            "generation_uuid": generation_uuid,
            "task_uuid": payload.task_uuid,
            "status": "COMPLETED",
        },
    )
    db.commit()
    return Response(
        body,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": build_content_disposition(payload.file_name)},
    )
```

Sanitize CR/LF, slashes, colons, and control characters from the filename. Include an RFC 5987 `filename*` UTF-8 value.

- [ ] **Step 5: Permit only safe audit metadata**

No new content-bearing keys are needed. Reuse `generation_uuid`, `task_uuid`, and `status`. Add a test asserting the audit row does not contain output or filename.

- [ ] **Step 6: Run history and export tests**

Run:

```bash
cd server
source .venv/bin/activate
pytest tests/test_history.py tests/test_word_export.py tests/test_audit.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/app/main.py server/app/history_service.py server/tests/test_history.py server/tests/test_word_export.py
git commit -m "feat(ai-assistant): download generated Word documents"
```

## Task 10: Add the desktop Word download action

**Files:**
- Modify: `apps/desktop/src/api/client.ts`
- Modify: `apps/desktop/src/pages/TaskRunPage.tsx`
- Modify: `apps/desktop/tests/task-run.test.tsx`

- [ ] **Step 1: Write the failing UI test**

```tsx
it('downloads Word only after the result is synchronized', async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => undefined);
  server.use(
    http.get('/api/ai/generations/gen-1/export.docx', () =>
      new HttpResponse(new Blob(['docx']), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': "attachment; filename*=UTF-8''work.docx",
        },
      })),
  );

  // Generate and complete gen-1 using the existing test setup.
  expect(await screen.findByRole('button', { name: '导出 Word' }))
    .toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: '导出 Word' }));
  await waitFor(() => expect(click).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
cd apps/desktop
npm test -- --run tests/task-run.test.tsx
```

Expected: FAIL because no export action exists.

- [ ] **Step 3: Add the API helper**

```typescript
export async function downloadGenerationWord(
  generationUuid: string,
): Promise<void> {
  const response = await fetch(
    `/api/ai/generations/${encodeURIComponent(generationUuid)}/export.docx`,
    { credentials: 'include' },
  );
  if (!response.ok) throw new ApiError(response.status, 'WORD_EXPORT_FAILED');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = readAttachmentFileName(response.headers) || '聚信得仁文档.docx';
  anchor.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Add UI state and button**

Add `exporting` state and:

```tsx
<button
  className="secondary-action"
  disabled={status !== 'done' || exporting || syncMessage !== '结果已同步'}
  onClick={() => void exportWord()}
  type="button"
>
  {exporting ? '正在导出…' : '导出 Word'}
</button>
```

On failure, show `Word 导出失败，请稍后重试` without clearing output.

- [ ] **Step 5: Test unsynced results**

Extend the offline-sync test to assert the button is disabled while the server does not have the completed output.

- [ ] **Step 6: Run desktop tests**

Run:

```bash
cd apps/desktop
npm test -- --run tests/task-run.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/api/client.ts apps/desktop/src/pages/TaskRunPage.tsx apps/desktop/tests/task-run.test.tsx
git commit -m "feat(ai-assistant): add manual Word export"
```

## Task 11: Implement the approved B layout

**Files:**
- Modify: `apps/desktop/src/pages/TaskRunPage.tsx`
- Modify: `apps/desktop/src/theme/tokens.css`
- Modify: `apps/desktop/tests/task-run.test.tsx`
- Modify: `apps/desktop/tests/design-contrast.test.ts`

- [ ] **Step 1: Write a structural layout test**

```tsx
it('renders a top task summary and two-column work area', () => {
  const { container } = render(<TaskRunPage task={workSummaryTask} />);
  expect(container.querySelector('.task-summary')).toBeInTheDocument();
  expect(container.querySelector('.task-workspace')).toBeInTheDocument();
  expect(container.querySelector('.task-workspace > .task-form')).toBeInTheDocument();
  expect(container.querySelector('.task-workspace > .result-panel')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
cd apps/desktop
npm test -- --run tests/task-run.test.tsx
```

Expected: FAIL because the summary/workspace structure does not exist.

- [ ] **Step 3: Refactor markup**

```tsx
<section className="task-run-layout">
  <header className="task-summary">
    <div>
      <span className="eyebrow">当前任务</span>
      <h2>{task.name}</h2>
      <p>{task.description}</p>
    </div>
    <div className="safety-note">{task.safety_notice}</div>
  </header>
  <div className="task-workspace">
    <form className="task-form">...</form>
    <article className="result-panel">...</article>
  </div>
</section>
```

- [ ] **Step 4: Apply 43/57 CSS**

```css
.task-run-layout {
  display: grid;
  gap: 16px;
}

.task-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, .45fr);
  gap: 24px;
}

.task-workspace {
  display: grid;
  grid-template-columns: minmax(360px, 43fr) minmax(480px, 57fr);
  gap: 16px;
}

.result-panel {
  min-width: 0;
  overflow: hidden;
}
```

At the existing responsive breakpoint, set both `.task-summary` and `.task-workspace` to one column.

- [ ] **Step 5: Run layout and contrast tests**

Run:

```bash
cd apps/desktop
npm test -- --run tests/task-run.test.tsx tests/design-contrast.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/pages/TaskRunPage.tsx apps/desktop/src/theme/tokens.css apps/desktop/tests/task-run.test.tsx apps/desktop/tests/design-contrast.test.ts
git commit -m "feat(ai-assistant): widen task output preview"
```

## Task 12: Run the real import and verify the catalog

**Files:**
- Modify generated data only if the import report identifies a reviewed correction:
  - `server/catalog/manual-v1.10.json`
  - `server/catalog/manual-v1.10-report.json`
  - `server/catalog/assistants.json`

- [ ] **Step 1: Back up current local databases**

Run:

```bash
cp server/juxin-ai-assistant-dev.db \
  "/tmp/juxin-ai-assistant-dev-before-v1.10-$(date +%Y%m%d%H%M%S).db"
docker compose -f ../docker-compose.yml exec -T mysql mysqldump \
  -u root -p"$MYSQL_ROOT_PASSWORD" juxin_prompt_center \
  > "/tmp/juxin-prompt-center-before-v1.10-$(date +%Y%m%d%H%M%S).sql"
```

Expected: both backup files exist and are non-empty.

- [ ] **Step 2: Rebuild Prompt Center seed data**

Run:

```bash
docker compose -f ../docker-compose.yml run --rm \
  -v "$PWD:/workspace" \
  prompt-center-seed \
  node scripts/seed-ai-assistant-prompts.js \
  --force \
  --stage-output /workspace/server/catalog/prompt-stage-v1.10.json
```

Expected: report shows the dynamic Prompt count and staged versions; existing runtime Prompt content remains unchanged.

- [ ] **Step 3: Migrate and pin assistant tasks to staged versions**

Run:

```bash
cd server
source .venv/bin/activate
alembic upgrade head
python scripts/seed_catalog.py \
  --force-config \
  --require-all-published \
  --staged-prompts catalog/prompt-stage-v1.10.json
```

Expected:

- `missing_prompts` is empty.
- Existing task UUIDs remain unchanged.
- New presales and software-testing assistants are active.
- Knowledge items and links are created.
- Updated task bindings use `PINNED` with the staged version.

- [ ] **Step 4: Activate Prompt Center versions**

Run:

```bash
docker compose -f ../docker-compose.yml run --rm \
  -v "$PWD:/workspace" \
  prompt-center-seed \
  node scripts/seed-ai-assistant-prompts.js \
  --activate /workspace/server/catalog/prompt-stage-v1.10.json
```

Expected: activation completes in one Prompt Center transaction.

- [ ] **Step 5: Finalize assistant bindings**

Run:

```bash
cd server
source .venv/bin/activate
python scripts/seed_catalog.py \
  --finalize-published \
  --staged-prompts catalog/prompt-stage-v1.10.json
```

Expected: matching bindings use `PUBLISHED` and have `pinned_version = NULL`.

- [ ] **Step 6: Run integrity queries**

Run:

```bash
sqlite3 server/juxin-ai-assistant-dev.db "
SELECT COUNT(*) FROM ai_tasks WHERE status='ACTIVE';
SELECT COUNT(*) FROM ai_task_prompt_bindings WHERE status='ACTIVE';
SELECT COUNT(*) FROM ai_tasks WHERE source_version='V1.10';
SELECT COUNT(*) FROM ai_knowledge_items WHERE tags_json LIKE '%manual:V1.10%';
SELECT COUNT(*) FROM ai_task_prompt_bindings
 WHERE version_policy <> 'PUBLISHED' OR pinned_version IS NOT NULL;
"
```

Expected: active task and active binding counts match; V1.10 tasks and knowledge counts are non-zero; the final query returns `0`.

- [ ] **Step 7: Smoke test API**

Run:

```bash
curl -sS http://127.0.0.1:5193/health
curl -sS http://127.0.0.1:5193/api/ai/catalog \
  -H "X-Test-User-ID: dev" \
  | jq '.assistants | map({name, tasks: (.tasks | length)})'
```

Expected: health is `ok`; catalog includes the new assistants and tasks.

- [ ] **Step 8: Remove the deployment stage file**

```bash
rm server/catalog/prompt-stage-v1.10.json
```

Expected: only committed catalog/report artifacts remain.

- [ ] **Step 9: Commit reviewed generated corrections**

```bash
git add server/catalog/manual-v1.10.json server/catalog/manual-v1.10-report.json server/catalog/assistants.json
git commit -m "data(ai-assistant): finalize V1.10 prompt mappings"
```

## Task 13: Full verification, versioning, and release-aligned Git history

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `server/app/config.py`
- Modify: `server/tests/test_health.py`
- Modify: `../prompt-center/backend/package.json`
- Modify: `../package.json`
- Modify: `../package-lock.json`
- Modify lock files generated by package managers
- Modify: `../.gitignore`

- [ ] **Step 1: Run focused backend checks**

```bash
cd server
source .venv/bin/activate
pytest \
  tests/test_manual_compiler.py \
  tests/test_catalog.py \
  tests/test_document_governance.py \
  tests/test_generation_flow.py \
  tests/test_history.py \
  tests/test_word_export.py -v
```

Expected: PASS.

- [ ] **Step 2: Run the complete backend suite**

```bash
cd server
source .venv/bin/activate
pytest -q
```

Expected: PASS. Do not fix unrelated failures; report them separately.

- [ ] **Step 3: Run Prompt Center tests**

```bash
(cd ../prompt-center/backend && npm test)
```

Expected: PASS.

- [ ] **Step 4: Run desktop checks using native ARM Node**

```bash
(cd apps/desktop && PATH="/opt/homebrew/bin:$PATH" npm test)
(cd apps/desktop && PATH="/opt/homebrew/bin:$PATH" npm run typecheck)
(cd apps/desktop && PATH="/opt/homebrew/bin:$PATH" npm run build)
```

Expected: PASS. The explicit PATH avoids the previously diagnosed x64 Node/Tauri native-module mismatch.

- [ ] **Step 5: Bump feature versions**

Apply the agreed feature-version rule:

- Platform: `5.89.0` → `5.90.0`.
- Agent: `1.1.0` → `1.2.0`.
- Assistant server: `1.0.0` → `1.2.0`.
- Prompt Center: `5.20.0` → `5.21.0`.

Use the existing version helper for the agent so package, Tauri, and Cargo metadata stay aligned:

```bash
(cd apps/desktop && PATH="/opt/homebrew/bin:$PATH" npm run agent:version -- --set 1.2.0)
(cd ../prompt-center/backend && npm install --package-lock-only)
(cd .. && npm install --package-lock-only)
```

Update `server/app/config.py` and `server/tests/test_health.py` to `1.2.0`.

- [ ] **Step 6: Ignore local visual-companion artifacts**

Add this repository-root ignore rule to `../.gitignore`:

```gitignore
juxin-ai-assistant/.superpowers/
juxin-ai-assistant/server/catalog/prompt-stage-v1.10.json
```

- [ ] **Step 7: Verify the actual user flow**

1. Start Prompt Center, auth, FastAPI, Vite, and Tauri.
2. Open an existing merged task and confirm its UUID/history remain present.
3. Open a newly imported task.
4. Generate a formal document and confirm the result follows the V1.10 structure.
5. Click `导出 Word`.
6. Open the DOCX and verify cover, margins, headings, table, header, footer, confidentiality text, and final review sections.
7. Confirm a second user cannot download the first user's generation.

- [ ] **Step 8: Review Git diff and secrets**

Run:

```bash
git diff --check
git status --short
git diff --stat
rg -n 'sk-[A-Za-z0-9_-]{16,}|API_KEY=|PASSWORD=' \
  server ../prompt-center apps/desktop \
  -g '!*.lock' -g '!server/.env'
```

Expected: no whitespace errors and no committed credentials.

- [ ] **Step 9: Create the release branch**

```bash
git switch -c codex/5.90.0
```

Expected: the worktree is on `codex/5.90.0`.

- [ ] **Step 10: Create the release-aligned commit**

```bash
git add \
  server/app/document_governance.py \
  server/app/word_export.py \
  server/app/generation_service.py \
  server/app/history_service.py \
  server/app/main.py \
  server/app/models.py \
  server/app/config.py \
  server/scripts/compile_prompt_manual.py \
  server/scripts/seed_catalog.py \
  server/catalog/assistants.json \
  server/catalog/manual-v1.10.json \
  server/catalog/manual-v1.10-report.json \
  server/alembic/versions/0005_task_document_metadata.py \
  server/tests/test_manual_compiler.py \
  server/tests/fixtures/manual-mini.docx \
  server/tests/test_catalog.py \
  server/tests/test_catalog_api.py \
  server/tests/test_document_governance.py \
  server/tests/test_generation_flow.py \
  server/tests/test_history.py \
  server/tests/test_word_export.py \
  server/tests/test_health.py \
  server/tests/test_migrations.py \
  server/tests/test_models.py \
  server/requirements.txt \
  ../prompt-center/backend/scripts/seed-ai-assistant-prompts.js \
  ../prompt-center/backend/tests/ai-assistant-seed.test.mjs \
  ../prompt-center/backend/package.json \
  ../prompt-center/backend/package-lock.json \
  apps/desktop/src/api/client.ts \
  apps/desktop/src/pages/TaskRunPage.tsx \
  apps/desktop/src/theme/tokens.css \
  apps/desktop/tests/task-run.test.tsx \
  apps/desktop/tests/design-contrast.test.ts \
  apps/desktop/package.json \
  apps/desktop/package-lock.json \
  apps/desktop/src-tauri/Cargo.toml \
  apps/desktop/src-tauri/Cargo.lock \
  apps/desktop/src-tauri/tauri.conf.json \
  ../package.json \
  ../package-lock.json \
  ../.gitignore \
  docs/superpowers/specs/2026-06-23-prompt-manual-import-word-export-design.md \
  docs/superpowers/plans/2026-06-23-prompt-manual-import-word-export.md
git commit -m "[agent-v1.2.0] feat(ai-assistant): import V1.10 prompts and export Word"
```

- [ ] **Step 11: Push the matching branch**

```bash
git push -u origin codex/5.90.0
```

Expected: push succeeds. If the remote rejects workflow-file changes or credentials lack scope, stop and report the exact rejection without rewriting history.
