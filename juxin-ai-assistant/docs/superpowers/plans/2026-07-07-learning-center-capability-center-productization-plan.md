# 学习中心与能力中心产品化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“学习中心”从开发视角的记忆/经验/模板/纠错/反馈管理台，收口为普通员工能理解的“我的偏好 / 常用模板 / 改进记录”；同时把已有 Skills 能力中心升级为可真实使用的业务能力入口。

**Architecture:** 不重建底层学习闭环和 Skill Runtime，优先复用现有 `/api/learning/*`、`/api/skills/*`、`LearningPage`、`SkillsPage` 和 `agent-harness/skills/*`。前端做产品化映射，后端补齐最小字段和初始能力，管理员审核继续放在治理/管理侧，普通用户界面不暴露 Agent、Memory、RAG、Skill、Tool、MCP、Namespace 等技术词。

**Tech Stack:** React + TypeScript + Vitest/MSW；FastAPI + SQLAlchemy + Alembic；现有 `agent-harness/skills/*/skill.json` manifest；现有 `SkillRegistry` / `SkillRunner` / learning routes。

## Global Constraints

- 普通用户界面不要暴露 Agent、Memory、RAG、Skill、Tool、MCP、Namespace 等技术词。
- 普通用户上传的个人资料默认只进入个人资料区，不进入公司级正式知识库。
- 公司级知识库必须由管理员上传或审核通过。
- 本次不要只做静态页面，必须让现有接口、数据流、权限和测试跟上。
- 不要粗暴重建现有 learning 表；优先兼容现有 memories、experiences、templates、failure cases、feedback。
- 不要破坏现有任务执行、历史成果、收藏、Word 导出、反馈等功能。
- 版本升级按用户约定：功能优化升第二位，Bug 修复升第三位；提交信息与版本号一致。

---

## Scope Decision

### 本轮应该做

1. **P0：学习中心产品化**  
   只改普通用户可见结构和文案，把 6 个开发概念合并成 3 个用户概念。

2. **P1：能力中心产品化**  
   复用现有 Skills 架构，补齐 8 个初始能力，页面展示为“业务能力”，不是“Skill 配置”。

3. **P2：能力执行和学习闭环补齐**  
   增加详情页/执行页的最小可用交互，保证运行记录、反馈、偏好写入规则清晰。

### 本轮不应该做

1. 不引入 MCP、外部插件市场、多 Agent 自主协作。
2. 不把全部学习中心数据迁移到全新表。
3. 不把公司知识库审核、资料库治理、Agent 运行观测台塞进本次改造。
4. 不让模型自动写入长期记忆；必须用户确认。
5. 不把管理员模板审核暴露给普通用户。

---

## Current Code Map

### Frontend

- Modify: `apps/desktop/src/App.tsx`  
  负责侧边栏菜单和页面路由；当前已有 `skills` 与 `learning` 页面入口。

- Modify: `apps/desktop/src/pages/LearningPage.tsx`  
  当前直接展示“我的记忆 / 我的经验 / 我的模板 / 模板审核 / 错误修正记录 / 反馈记录”，需要映射为“我的偏好 / 常用模板 / 改进记录”。

- Modify: `apps/desktop/src/pages/SkillsPage.tsx`  
  当前已有“能力中心”雏形，但只显示基础卡片和一键运行；需要升级成业务能力卡片、详情/执行入口。

- Modify: `apps/desktop/src/api/client.ts`  
  现有 learning 与 skills API 类型基本够用；P1 可增加 `display_name` 等向后兼容字段，不能破坏现有响应。

- Test: `apps/desktop/tests/learning-page.test.tsx`  
  增加普通用户文案、Tab 映射、空状态和隐藏开发词测试。

- Test: `apps/desktop/tests/skills-page.test.tsx`  
  增加能力中心 8 个能力、业务文案、详情/运行入口测试。

- Optional Test: `apps/desktop/tests/app-navigation.test.tsx`  
  如果已有导航测试则更新；没有则在当前相关测试中覆盖菜单可见性。

### Backend

- Modify: `server/app/skill_definition.py`  
  现有 manifest 包含 `id/name/description/category/version/status/scope/owner/requires_attachment/allowed_tools/input_types/output_types/permissions/review/tags`。P1 如需前端显示名，优先把 `name` 当作展示名，不强制新增 `display_name`。

- Modify: `server/app/skill_routes.py`  
  现有 `/api/skills`、`/api/skills/{skill_id}`、`/api/skills/{skill_id}/run`、`/api/skills/runs` 可继续使用；不改成 `/execute`，避免破坏兼容。

- Modify: `server/app/skill_runner.py`  
  当前只对 3 个内置能力有定制 summary；P1 新增能力时补齐最小 summary 和 artifacts。

- Create/Modify: `agent-harness/skills/<skill-id>/skill.json` and prompt files  
  现有 3 个 published ability，需要补齐 5 个初始能力 manifest。

- Test: `server/tests/test_skills.py`  
  覆盖能力列表、普通用户只看已发布能力、运行记录、附件类型限制。

- Test: `server/tests/test_learning_routes.py`  
  复用现有接口，补充“普通用户不能看到审核列表 / 用户隔离 / 公司模板审核”的断言。

---

## Product Mapping

| 现有工程概念 | 普通用户看到 | 数据来源 |
| --- | --- | --- |
| `memories` / `user_preference` | 我的偏好 | `/api/learning/memories` |
| `templates` | 常用模板 | `/api/learning/templates` |
| `experiences` | 改进记录中的“可复用经验” | `/api/learning/experiences` |
| `failure-cases` | 改进记录中的“纠正记录” | `/api/learning/failure-cases` |
| `feedback` | 改进记录中的“反馈记录” | `/api/learning/feedback` |
| `template-reviews` | 管理后台：模板审核 | `/api/learning/templates/review` |
| `skills` | 能力中心 | `/api/skills` |

---

## P0 Tasks：学习中心产品化

### Task 1: Learning Center Copy and Tabs

**Files:**
- Modify: `apps/desktop/src/pages/LearningPage.tsx`
- Test: `apps/desktop/tests/learning-page.test.tsx`

**Interfaces:**
- Consumes: existing `listLearningMemories`, `listLearningExperiences`, `listLearningTemplates`, `listLearningFailureCases`, `listLearningFeedback`.
- Produces: `LearningPage` only exposes three user-facing tabs: `我的偏好`, `常用模板`, `改进记录`.

- [ ] **Step 1: Write failing frontend test for user-facing tabs**

Add this test to `apps/desktop/tests/learning-page.test.tsx`:

```tsx
it('shows productized learning center tabs and hides developer-facing labels for employees', async () => {
  server.use(
    http.get('/api/learning/memories', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/experiences', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/templates', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/failure-cases', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/feedback', () => HttpResponse.json({ items: [], total: 0 })),
  );

  render(<LearningPage />);

  expect(await screen.findByRole('heading', { name: '学习中心' })).toBeInTheDocument();
  expect(screen.getByText('管理小聚记住的偏好、常用格式和纠正记录，让它越用越懂你。')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '我的偏好' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '常用模板' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '改进记录' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '我的记忆' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '我的经验' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '我的模板' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '模板审核' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '错误修正记录' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '反馈记录' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm test -- learning-page.test.tsx
```

Expected: FAIL because current page still shows old tabs and old subtitle.

- [ ] **Step 3: Implement minimal tab mapping**

In `apps/desktop/src/pages/LearningPage.tsx`:

```tsx
type LearningTab = 'preferences' | 'templates' | 'improvements';
```

Replace old tab buttons with:

```tsx
<div className="learning-tabs" role="tablist" aria-label="学习中心分类">
  <button className={tab === 'preferences' ? 'is-active' : ''} onClick={() => setTab('preferences')} type="button">我的偏好</button>
  <button className={tab === 'templates' ? 'is-active' : ''} onClick={() => setTab('templates')} type="button">常用模板</button>
  <button className={tab === 'improvements' ? 'is-active' : ''} onClick={() => setTab('improvements')} type="button">改进记录</button>
</div>
```

Change subtitle to:

```tsx
<p>管理小聚记住的偏好、常用格式和纠正记录，让它越用越懂你。</p>
```

- [ ] **Step 4: Run test**

Run:

```bash
npm test -- learning-page.test.tsx
```

Expected: PASS for the new tab test; existing old-tab tests may fail and must be updated in later steps of this task.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/pages/LearningPage.tsx apps/desktop/tests/learning-page.test.tsx
git commit -m "feat(ai-assistant): productize learning center tabs"
```

### Task 2: Learning Center Summary and Empty States

**Files:**
- Modify: `apps/desktop/src/pages/LearningPage.tsx`
- Test: `apps/desktop/tests/learning-page.test.tsx`

**Interfaces:**
- Consumes: arrays already loaded by `refresh()`.
- Produces: summary cards: `已记住偏好`, `常用模板`, `改进记录`.

- [ ] **Step 1: Write failing summary test**

Add:

```tsx
it('summarizes learning content as preferences templates and improvements', async () => {
  server.use(
    http.get('/api/learning/memories', () => HttpResponse.json({
      items: [{
        uuid: 'mem-1',
        memory_type: 'user_preference',
        title: 'Word 输出格式',
        content: '导出 Word 使用聚信格式',
        source: 'user',
        priority: 'high',
        tags: ['Word'],
        status: 'active',
        created_at: '2026-07-07T08:00:00Z',
        updated_at: '2026-07-07T08:00:00Z',
      }],
      total: 1,
    })),
    http.get('/api/learning/experiences', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/templates', () => HttpResponse.json({
      items: [{
        uuid: 'tpl-1',
        template_name: '安全运维报告模板',
        task_type: '安全运维',
        template_content: '一、概述\n二、风险',
        variables: {},
        scope: 'personal',
        review_status: 'draft',
        status: 'active',
        created_at: '2026-07-07T08:00:00Z',
        updated_at: '2026-07-07T08:00:00Z',
      }],
      total: 1,
    })),
    http.get('/api/learning/failure-cases', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/feedback', () => HttpResponse.json({ items: [], total: 0 })),
  );

  render(<LearningPage />);

  expect(await screen.findByText('已记住偏好')).toBeInTheDocument();
  expect(screen.getByText('常用模板')).toBeInTheDocument();
  expect(screen.getByText('改进记录')).toBeInTheDocument();
  expect(screen.queryByText('启用记忆')).not.toBeInTheDocument();
  expect(screen.queryByText('待审模板')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm test -- learning-page.test.tsx
```

Expected: FAIL because old summary cards still show `启用记忆/经验/模板/错误修正/反馈记录`.

- [ ] **Step 3: Implement summary counts**

Use:

```tsx
const preferenceCount = memories.filter((item) => item.status === 'active').length;
const templateCount = templates.filter((item) => item.status === 'active').length;
const improvementCount = experiences.length + failures.length + feedbackLogs.length;
```

Render only:

```tsx
<div className="learning-summary-grid" aria-label="学习中心概览">
  <article><strong>{preferenceCount}</strong><span>已记住偏好</span></article>
  <article><strong>{templateCount}</strong><span>常用模板</span></article>
  <article><strong>{improvementCount}</strong><span>改进记录</span></article>
</div>
```

- [ ] **Step 4: Run test**

Run:

```bash
npm test -- learning-page.test.tsx
```

Expected: PASS for summary tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/pages/LearningPage.tsx apps/desktop/tests/learning-page.test.tsx
git commit -m "feat(ai-assistant): simplify learning center summary"
```

### Task 3: Learning Forms and Improvement Record Merge

**Files:**
- Modify: `apps/desktop/src/pages/LearningPage.tsx`
- Test: `apps/desktop/tests/learning-page.test.tsx`

**Interfaces:**
- Consumes: existing create/update/delete memory/template/experience/failure endpoints.
- Produces: user-facing form titles `新增偏好`, `新增模板`, `新增改进记录`.

- [ ] **Step 1: Write failing form title test**

Add:

```tsx
it('uses user-facing form titles for each learning tab', async () => {
  server.use(
    http.get('/api/learning/memories', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/experiences', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/templates', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/failure-cases', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/feedback', () => HttpResponse.json({ items: [], total: 0 })),
  );

  render(<LearningPage />);

  expect(await screen.findByRole('heading', { name: '新增偏好' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '常用模板' }));
  expect(screen.getByRole('heading', { name: '新增模板' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '改进记录' }));
  expect(screen.getByRole('heading', { name: '新增改进记录' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm test -- learning-page.test.tsx
```

Expected: FAIL because current form title is `新增长期记忆`.

- [ ] **Step 3: Implement productized type options**

Replace memory options with:

```tsx
const PREFERENCE_TYPE_OPTIONS = [
  ['output_format', '输出格式要求'],
  ['tone', '称呼与语气'],
  ['company_info', '常用公司信息'],
  ['document_structure', '常用文档结构'],
  ['work_habit', '个人工作习惯'],
  ['other', '其他'],
] as const;
```

Add template type options:

```tsx
const TEMPLATE_TYPE_OPTIONS = [
  ['report', '报告模板'],
  ['proposal', '方案模板'],
  ['meeting_minutes', '纪要模板'],
  ['bidding', '投标模板'],
  ['risk_assessment', '风险评估模板'],
  ['security_operation', '安全运维模板'],
  ['after_sales', '售后排查模板'],
  ['other', '其他'],
] as const;
```

Add improvement type options:

```tsx
const IMPROVEMENT_TYPE_OPTIONS = [
  ['answer_correction', '回答错误纠正'],
  ['format_correction', '格式纠正'],
  ['term_correction', '术语纠正'],
  ['source_correction', '资料引用纠正'],
  ['style_correction', '输出风格纠正'],
  ['other', '其他'],
] as const;
```

- [ ] **Step 4: Merge improvements view**

In `tab === 'improvements'`, render sections in this order:

```tsx
<section aria-label="纠正记录">...</section>
<section aria-label="用户反馈">...</section>
<section aria-label="可复用经验">...</section>
```

Keep existing edit/delete behavior for experiences and failure cases.

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- learning-page.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/pages/LearningPage.tsx apps/desktop/tests/learning-page.test.tsx
git commit -m "feat(ai-assistant): align learning forms with user language"
```

---

## P1 Tasks：能力中心产品化

### Task 4: Add Missing Initial Capabilities

**Files:**
- Create: `agent-harness/skills/document-generation/skill.json`
- Create: `agent-harness/skills/security-operation-report/skill.json`
- Create: `agent-harness/skills/delivery-implementation-assistant/skill.json`
- Create: `agent-harness/skills/after-sales-troubleshooting/skill.json`
- Create: `agent-harness/skills/bidding-material-organizer/skill.json`
- Create: `agent-harness/skills/invoice-extraction/skill.json`
- Create: `agent-harness/skills/web-research-ingestion/skill.json`
- Modify: `server/app/skill_runner.py`
- Test: `server/tests/test_skills.py`

**Interfaces:**
- Consumes: `SkillRegistry.default().list_skills(include_unpublished=False)`.
- Produces: at least 8 user-facing capabilities from `/api/skills`.

- [ ] **Step 1: Write failing backend test**

Add to `server/tests/test_skills.py`:

```python
def test_builtin_capability_center_lists_expected_user_capabilities(client_for_user):
    client = client_for_user("employee-capabilities")
    payload = client.get("/api/skills").json()
    names = {item["name"] for item in payload["items"]}
    assert "文档生成" in names
    assert "风险评估过程文档审查" in names
    assert "安全运维报告生成" in names
    assert "产品实施助手" in names
    assert "售后问题排查" in names
    assert "投标资料整理" in names
    assert "发票/票据识别" in names
    assert "网页调研与资料入库" in names
```

- [ ] **Step 2: Run failing test**

Run:

```bash
PYTHONPATH=. .venv/bin/python -m pytest tests/test_skills.py::test_builtin_capability_center_lists_expected_user_capabilities -q
```

Expected: FAIL because current project only has 3 skill manifests.

- [ ] **Step 3: Add skill manifests**

Example for `agent-harness/skills/document-generation/skill.json`:

```json
{
  "id": "document-generation",
  "name": "文档生成",
  "description": "根据你的要求生成方案、报告、纪要、说明文档等内容。",
  "category": "document",
  "version": "1.0.0",
  "status": "published",
  "scope": "company",
  "owner": "product-team",
  "requires_attachment": false,
  "allowed_tools": ["document_generator", "personal_memory"],
  "input_types": ["text", "docx", "pdf", "xlsx", "pptx"],
  "output_types": ["markdown", "docx"],
  "permissions": {
    "allow_web": false,
    "allow_company_knowledge": true,
    "allow_personal_memory": true,
    "allow_write_company_kb": false
  },
  "review": {
    "required_for_publish": true,
    "reviewer_role": "admin"
  },
  "tags": ["文档生成", "报告", "方案"]
}
```

Use the same schema for the other 6 manifests. Published user-facing abilities should use `status: "published"`; unstable abilities can start as `status: "draft"` if they must not appear to ordinary users. If the requirement says users must see 8 cards now, use `published` for all 8 and label beta in tags/category copy on the frontend rather than manifest status.

- [ ] **Step 4: Add skill runner summaries**

In `server/app/skill_runner.py`, extend `_build_summary`:

```python
if skill.id == "document-generation":
    return "已生成文档草稿：包含结构化标题、正文要点和后续可导出 Word 的内容。"
if skill.id == "security-operation-report":
    return "已生成安全运维报告草稿：包含巡检概况、风险问题、整改建议和运维结论。"
if skill.id == "delivery-implementation-assistant":
    return "已生成产品实施支持内容：包含实施步骤、配置记录、验证方式和交付注意事项。"
if skill.id == "after-sales-troubleshooting":
    return "已生成售后问题排查建议：包含现象确认、可能原因、排查步骤和客户沟通口径。"
if skill.id == "bidding-material-organizer":
    return "已整理投标资料：包含技术响应、参数响应、偏离说明和需补充材料。"
if skill.id == "invoice-extraction":
    return "已整理票据信息：包含票据类型、关键字段和台账草稿。"
if skill.id == "web-research-ingestion":
    return "已生成网页调研摘要：包含资料来源、关键内容、结构化信息和入库建议。"
```

- [ ] **Step 5: Run backend tests**

Run:

```bash
PYTHONPATH=. .venv/bin/python -m pytest tests/test_skills.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent-harness/skills server/app/skill_runner.py server/tests/test_skills.py
git commit -m "feat(ai-assistant): add initial capability center skills"
```

### Task 5: Capability Center Cards and Product Copy

**Files:**
- Modify: `apps/desktop/src/pages/SkillsPage.tsx`
- Test: `apps/desktop/tests/skills-page.test.tsx`

**Interfaces:**
- Consumes: existing `SkillPayload`.
- Produces: user-facing “能力中心” with cards containing icon, capability name, explanation, scenario tags, status, and primary action.

- [ ] **Step 1: Write failing frontend test**

Add to `apps/desktop/tests/skills-page.test.tsx`:

```tsx
it('uses ordinary employee language in the capability center', async () => {
  server.use(
    http.get('/api/skills', () => HttpResponse.json({
      items: [{
        id: 'document-generation',
        name: '文档生成',
        description: '根据你的要求生成方案、报告、纪要、说明文档等内容。',
        category: 'document',
        version: '1.0.0',
        status: 'published',
        scope: 'company',
        owner: 'product-team',
        requires_attachment: false,
        allowed_tools: ['document_generator'],
        input_types: ['text'],
        output_types: ['markdown', 'docx'],
        permissions: {
          allow_web: false,
          allow_company_knowledge: true,
          allow_personal_memory: true,
          allow_write_company_kb: false,
        },
        review: { required_for_publish: true, reviewer_role: 'admin' },
        tags: ['方案编写', '报告草稿', '会议纪要'],
      }],
      total: 1,
    })),
    http.get('/api/skills/runs', () => HttpResponse.json({ items: [], total: 0 })),
  );

  render(<SkillsPage />);

  expect(await screen.findByRole('heading', { name: '能力中心' })).toBeInTheDocument();
  expect(screen.getByText('选择小聚可以帮你完成的工作能力，快速生成文档、审查材料、排查问题和整理资料。')).toBeInTheDocument();
  expect(screen.getByText('文档生成')).toBeInTheDocument();
  expect(screen.getByText('方案编写')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '开始使用 文档生成' })).toBeInTheDocument();
  expect(screen.queryByText(/Skill/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Tool/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm test -- skills-page.test.tsx
```

Expected: FAIL because existing page subtitle and card structure are too basic.

- [ ] **Step 3: Implement card copy**

Use `skill.tags` as scenario tags. Use status copy:

```tsx
function statusLabel(status: string): string {
  if (status === 'published') return '可用';
  if (status === 'draft') return '内测';
  if (status === 'disabled') return '已停用';
  return '内测';
}
```

Render each card with:

```tsx
<article key={skill.id} className="capability-card">
  <span className="capability-icon" aria-hidden="true">{iconForCategory(skill.category)}</span>
  <span className="knowledge-source-badge">{statusLabel(skill.status)}</span>
  <h2>{skill.name}</h2>
  <p>{skill.description}</p>
  <div className="capability-tags">
    {skill.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}
  </div>
  <button aria-label={`开始使用 ${skill.name}`} className="primary-action" onClick={() => void start(skill)} type="button">
    {actionText(skill)}
  </button>
</article>
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- skills-page.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/pages/SkillsPage.tsx apps/desktop/tests/skills-page.test.tsx
git commit -m "feat(ai-assistant): productize capability center cards"
```

### Task 6: Capability Detail and Minimum Execution Form

**Files:**
- Modify: `apps/desktop/src/pages/SkillsPage.tsx`
- Test: `apps/desktop/tests/skills-page.test.tsx`

**Interfaces:**
- Consumes: `runSkill(skill.id, { task_id, input })`.
- Produces: selected ability panel with `这个能力能做什么 / 需要你提供什么 / 会生成什么 / 是否会使用你的资料 / 是否会保存偏好`.

- [ ] **Step 1: Write failing selected ability test**

Add:

```tsx
it('opens a capability detail panel before running the capability', async () => {
  const run = vi.fn();
  server.use(
    http.get('/api/skills', () => HttpResponse.json({
      items: [{
        id: 'risk-assessment-review',
        name: '风险评估过程文档审查',
        description: '检查风险评估过程文档是否缺少关键环节、证据或记录。',
        category: 'security',
        version: '1.0.0',
        status: 'published',
        scope: 'company',
        owner: 'security-team',
        requires_attachment: true,
        allowed_tools: ['file_parser', 'knowledge_retrieval'],
        input_types: ['docx', 'pdf'],
        output_types: ['markdown', 'docx'],
        permissions: {
          allow_web: false,
          allow_company_knowledge: true,
          allow_personal_memory: true,
          allow_write_company_kb: false,
        },
        review: { required_for_publish: true, reviewer_role: 'admin' },
        tags: ['风险评估报告', '实施方案', '过程记录'],
      }],
      total: 1,
    })),
    http.get('/api/skills/runs', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/skills/risk-assessment-review/run', async ({ request }) => {
      run(await request.json());
      return HttpResponse.json({
        run_id: 'run-1',
        skill_id: 'risk-assessment-review',
        skill_version: '1.0.0',
        status: 'completed',
        tools_used: [],
        result: { summary: '已完成审查' },
        artifacts: [{ kind: 'markdown', title: '审查结果', content: '已完成审查' }],
      });
    }),
  );

  render(<SkillsPage />);

  await userEvent.click(await screen.findByRole('button', { name: '开始使用 风险评估过程文档审查' }));
  expect(screen.getByText('这个能力能做什么')).toBeInTheDocument();
  expect(screen.getByText('需要你提供什么')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('工作说明'), '检查风险评估材料');
  await userEvent.click(screen.getByRole('button', { name: '开始执行' }));

  expect(run).toHaveBeenCalledWith(expect.objectContaining({
    input: expect.objectContaining({ question: '检查风险评估材料' }),
  }));
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm test -- skills-page.test.tsx
```

Expected: FAIL because the current page immediately runs ability without a detail form.

- [ ] **Step 3: Implement selected skill state**

Add:

```tsx
const [selectedSkill, setSelectedSkill] = useState<SkillPayload | null>(null);
const [taskText, setTaskText] = useState('');
```

Change card button to:

```tsx
onClick={() => setSelectedSkill(skill)}
```

Render detail panel:

```tsx
{selectedSkill ? (
  <section className="capability-detail" aria-label="能力详情">
    <h2>{selectedSkill.name}</h2>
    <h3>这个能力能做什么</h3>
    <p>{selectedSkill.description}</p>
    <h3>需要你提供什么</h3>
    <p>{materialText(selectedSkill)}</p>
    <h3>会生成什么</h3>
    <p>{selectedSkill.output_types.join('、')}</p>
    <h3>是否会使用你的资料</h3>
    <p>{selectedSkill.permissions.allow_company_knowledge ? '可按权限参考正式资料和你选择的资料。' : '默认不使用资料库。'}</p>
    <label>
      工作说明
      <textarea value={taskText} onChange={(event) => setTaskText(event.target.value)} placeholder="告诉小聚这次要完成什么工作" />
    </label>
    <button className="primary-action" onClick={() => void start(selectedSkill, taskText)} type="button">开始执行</button>
  </section>
) : null}
```

- [ ] **Step 4: Update start signature**

Change:

```tsx
const start = async (skill: SkillPayload, question = `请执行${skill.name}`) => {
```

Payload:

```tsx
input: {
  question,
  attachments: defaultAttachment(skill),
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- skills-page.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/pages/SkillsPage.tsx apps/desktop/tests/skills-page.test.tsx
git commit -m "feat(ai-assistant): add capability detail execution flow"
```

---

## P2 Tasks：权限、记忆规则与回归

### Task 7: Confirmed Memory Write Rule

**Files:**
- Modify: `apps/desktop/src/pages/ChatPage.tsx`
- Modify: `apps/desktop/src/pages/LearningPage.tsx`
- Test: `apps/desktop/tests/chat-page.test.tsx`
- Test: `apps/desktop/tests/learning-page.test.tsx`

**Interfaces:**
- Consumes: existing `createLearningMemory` and feedback handlers.
- Produces: long-term preference writes only after user action such as `记住这个偏好`.

- [ ] **Step 1: Write regression test**

In `apps/desktop/tests/chat-page.test.tsx`, add or update a test so normal chat completion does not call `/api/learning/memories` POST unless the user clicks an explicit save/remember action.

```tsx
it('does not write user preference memory without explicit confirmation', async () => {
  const createMemory = vi.fn();
  server.use(
    http.post('/api/learning/memories', async ({ request }) => {
      createMemory(await request.json());
      return HttpResponse.json({});
    }),
  );

  render(<ChatPage />);

  await userEvent.type(screen.getByPlaceholderText('告诉我你想完成什么工作...'), '写一份运维报告');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(createMemory).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run failing or confirming test**

Run:

```bash
npm test -- chat-page.test.tsx
```

Expected: PASS if current behavior is already safe; FAIL if hidden writes exist.

- [ ] **Step 3: Fix only if needed**

If failing, guard memory writes behind explicit user action:

```tsx
const rememberPreference = async () => {
  await createLearningMemory({
    memory_type: 'user_preference',
    title: '用户确认的偏好',
    content: selectedPreferenceText,
    priority: 'medium',
    tags: ['用户确认'],
  });
};
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- chat-page.test.tsx learning-page.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/pages/ChatPage.tsx apps/desktop/src/pages/LearningPage.tsx apps/desktop/tests/chat-page.test.tsx apps/desktop/tests/learning-page.test.tsx
git commit -m "fix(ai-assistant): require confirmation before saving preferences"
```

### Task 8: Permission Boundary Tests

**Files:**
- Test: `server/tests/test_learning_routes.py`
- Test: `server/tests/test_skills.py`
- Modify only if failing: `server/app/learning_routes.py`
- Modify only if failing: `server/app/skill_routes.py`

**Interfaces:**
- Consumes: existing `require_action`, `get_session`, user role checks.
- Produces: ordinary users cannot access other users’ learning data or admin review endpoints.

- [ ] **Step 1: Add learning permission test**

Add:

```python
def test_employee_cannot_access_template_review_queue(client_for_user):
    employee = client_for_user("employee-learning-review")
    response = employee.get("/api/learning/templates/review")
    assert response.status_code == 403
```

- [ ] **Step 2: Add skill admin permission test**

Add:

```python
def test_employee_cannot_access_admin_skill_governance(client_for_user):
    employee = client_for_user("employee-skill-admin")
    response = employee.get("/api/admin/skills")
    assert response.status_code == 403
```

- [ ] **Step 3: Run tests**

Run:

```bash
PYTHONPATH=. .venv/bin/python -m pytest tests/test_learning_routes.py tests/test_skills.py -q
```

Expected: PASS if current permissions already protect these endpoints.

- [ ] **Step 4: Fix only if needed**

If ordinary user receives 200, add or tighten admin guard in the route:

```python
await require_action("ai_assistant:admin", request, session_payload, current_settings)
```

- [ ] **Step 5: Commit**

```bash
git add server/app/learning_routes.py server/app/skill_routes.py server/tests/test_learning_routes.py server/tests/test_skills.py
git commit -m "test(ai-assistant): protect learning and skill governance endpoints"
```

### Task 9: Integration Regression and Release Bump

**Files:**
- Modify: version files used by current project release process
- Test: frontend and backend regression suites

**Interfaces:**
- Consumes: all P0/P1/P2 changes.
- Produces: verified release commit and optional push.

- [ ] **Step 1: Run frontend regression**

Run:

```bash
npm test -- learning-page.test.tsx skills-page.test.tsx chat-page.test.tsx
npm run typecheck
```

Expected: all tests pass.

- [ ] **Step 2: Run backend regression**

Run:

```bash
PYTHONPATH=. .venv/bin/python -m pytest tests/test_learning_routes.py tests/test_skills.py tests/test_chat_api.py tests/test_context_builder.py -q
```

Expected: all tests pass.

- [ ] **Step 3: Build web frontend**

Run:

```bash
npm run build:web
```

Expected: build succeeds; chunk-size warnings are acceptable if unchanged.

- [ ] **Step 4: Bump version**

Because this is a product feature optimization, bump the minor version according to the user rule. If current platform version is `5.144.6`, target `5.145.0`; if current version changed, apply the same minor-bump rule.

- [ ] **Step 5: Commit release**

```bash
git add .
git commit -m "feat(ai-assistant): v5.145.0 productize learning and capability centers"
```

- [ ] **Step 6: Push branch**

```bash
git push
```

Expected: push succeeds to the current `codex/*` branch.

---

## Acceptance Criteria

1. 左侧菜单或导航中保留“学习中心”，并出现“能力中心”。
2. 普通用户进入学习中心只看到：
   - 我的偏好
   - 常用模板
   - 改进记录
3. 普通用户看不到：
   - 我的记忆
   - 我的经验
   - 我的模板
   - 模板审核
   - 错误修正记录
   - 反馈记录
4. 学习中心统计只显示：
   - 已记住偏好
   - 常用模板
   - 改进记录
5. 能力中心至少展示 8 个初始能力。
6. 能力中心页面文案不出现 Skill、Tool、Memory、RAG、MCP、Namespace。
7. 点击能力可以先进入详情/执行区域，再开始执行。
8. 能力执行记录仍写入现有 `/api/skills/runs`。
9. 普通用户新增公司级模板或偏好不能直接生效，必须进入审核。
10. 普通用户不能访问其他用户的偏好、模板、资料和管理员审核入口。
11. 普通对话默认不自动写长期记忆；写入偏好必须经过用户确认。
12. 现有任务执行、历史成果、收藏、Word 导出、反馈功能不被破坏。

---

## Known Gaps After This Plan

1. “能力中心”的复杂多步骤工作流仍然是轻量版，不做全自动 Agent 编排。
2. 发票/票据识别如果缺少 OCR 或 Excel 输出工具，本轮只做入口和受控运行记录，不承诺完整识别质量。
3. 网页调研与资料入库只做可见能力和权限边界，正式入库审核可复用后续资料库治理计划。
4. 管理后台模板审核 UI 如果现有治理中心没有入口，需要后续单独做治理页面优化。

---

## Self-Review

### Spec Coverage

- 学习中心 3 Tab：Covered by Tasks 1-3。
- 能力中心新增：Covered by Tasks 4-6。
- 普通用户不暴露技术词：Covered by Tasks 1 and 5 tests。
- 记忆写入确认：Covered by Task 7。
- 权限边界：Covered by Task 8。
- 8 个初始能力：Covered by Task 4。
- 不重建数据库：Covered by Scope Decision and Current Code Map。

### Placeholder Scan

No `TBD`, `TODO`, `implement later`, or unspecified commands remain in this plan.

### Type Consistency

- Frontend tests use existing `SkillPayload`, `LearningMemoryPayload`, `LearningTemplatePayload`, and MSW route shapes.
- Backend tests use existing `/api/skills`, `/api/skills/{id}/run`, `/api/learning/templates/review` routes.
- New manifests use the current `SkillManifest` schema from `server/app/skill_definition.py`.

