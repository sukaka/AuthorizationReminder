# Tender Final Draft Check And Score Optimize Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有 `tender` 系统上补齐“成稿级校验 + 评分优化”能力，并保证要求、证据、章节、校验结果、优化建议全链路可审计。

**Architecture:** 保留现有 `analyze -> create -> docx export` 主链路，在分析后新增 requirement 落库、生成前新增 evidence 快照、生成中新增章节来源链、生成后新增结构化校验与 Word 成稿校验、最后按评分矩阵做定点补强。AI 仅负责评分项定向补写，程序负责匹配、落库、校验、装配和审计。

**Tech Stack:** Node.js 20, Express, MySQL (`mysql2`), Vitest, React 18, Vite, Mammoth, PizZip, Docxtemplater

---

### Task 1: 建 requirement / evidence / section 纯函数映射层

**Files:**
- Create: `tender/backend/src/final-draft-registry.js`
- Test: `tender/backend/tests/final-draft-registry.test.js`
- Modify: `tender/backend/src/index.js`

**Step 1: 写失败用例，固定注册表输出形状**

```js
import {
  buildRequirementRows,
  buildEvidenceRows,
  buildDraftSectionRows,
} from '../src/final-draft-registry.js';

describe('final draft registry mappers', () => {
  it('maps scoring/risk/business requirements into normalized requirement rows', () => {
    const rows = buildRequirementRows({
      jobId: 11,
      bidCategory: 'SERVICE',
      finalJson: {
        business_performance_rules: {
          payment_terms: '付款方式按季度结算',
        },
      },
      scoringItems: [
        { title: '项目经理经验', section_title: '评标办法', evidence: '同类项目经验', suggestion: '补强案例' },
      ],
      stage1RiskClauses: [
        {
          clause_type: 'QUALIFICATION_INVALID',
          clause_content: '未提供营业执照复印件作无效投标处理',
          source_reference: { chapter: '投标人须知', page_number: '12', line_number: '233' },
        },
      ],
    });

    expect(rows.some((row) => row.requirement_type === 'SCORING')).toBe(true);
    expect(rows.some((row) => row.requirement_type === 'INVALID_BID')).toBe(true);
    expect(rows.some((row) => row.requirement_type === 'BUSINESS')).toBe(true);
  });
});
```

**Step 2: 运行测试，确认先红**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/tender/backend
npx vitest run tests/final-draft-registry.test.js
```

Expected: FAIL，提示 `final-draft-registry.js` 或导出函数不存在。

**Step 3: 写最小实现**

实现以下函数：

- `buildRequirementRows({ jobId, bidCategory, finalJson, scoringItems, stage1RiskClauses, tableSummaries })`
- `buildEvidenceRows({ bidId, librarySnapshot })`
- `buildDraftSectionRows({ bidId, versionId, chapters, templateSlotMap, sectionLinks })`

最小接口示例：

```js
export const buildRequirementRows = (input) => {
  return [
    {
      job_id: input.jobId,
      requirement_code: 'REQ-SCORE-0001',
      requirement_type: 'SCORING',
      title: '项目经理经验',
      requirement_text: '项目经理经验',
      chapter: '评标办法',
      page_number: '未明确',
      line_number: '未明确',
      is_mandatory: 0,
      risk_level: 'MEDIUM',
      full_score: null,
      source_json: {},
    },
  ];
};
```

**Step 4: 重新运行测试，确认变绿**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/tender/backend
npx vitest run tests/final-draft-registry.test.js
```

Expected: PASS。

**Step 5: Commit**

```bash
git add tender/backend/src/final-draft-registry.js tender/backend/tests/final-draft-registry.test.js tender/backend/src/index.js
git commit -m "feat: add final draft registry mappers"
```

### Task 2: 扩展数据库 schema，并把注册表接入 analyze/create 主链路

**Files:**
- Modify: `tender/backend/src/db.js`
- Modify: `tender/backend/src/index.js`
- Test: `tender/backend/tests/smoke.e2e.test.js`

**Step 1: 先写 smoke 断言，要求 analyze/create 后有注册表数据**

在现有 smoke 用例基础上补断言：

```js
expect(Array.isArray(analyzeResp.json?.requirement_registry || [])).toBe(true);
expect(Array.isArray(createResp.json?.evidence_registry || [])).toBe(true);
expect(Array.isArray(createResp.json?.draft_sections || [])).toBe(true);
```

**Step 2: 跑 smoke，确认先红**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/tender/backend
npx vitest run tests/smoke.e2e.test.js
```

Expected: FAIL，响应缺少新字段。

**Step 3: 在 `db.js` 新增表，并在 `index.js` 主链路落库**

新增表：

- `tender_requirement_registry`
- `tender_evidence_registry`
- `tender_draft_section_registry`
- `tender_template_slot_links`（如需要，可合并进 section registry 的 `template_slot` 字段）

接入点：

- `analyze` 成功后：写 requirement rows
- `create` 前：写 evidence rows
- `chapters` 最终确定后：写 section rows

新增响应字段：

- `requirement_registry`
- `evidence_registry`
- `draft_sections`

**Step 4: 重跑 smoke，确认变绿**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/tender/backend
npx vitest run tests/smoke.e2e.test.js
```

Expected: PASS，且新字段存在。

**Step 5: Commit**

```bash
git add tender/backend/src/db.js tender/backend/src/index.js tender/backend/tests/smoke.e2e.test.js
git commit -m "feat: persist tender requirements evidence and draft sections"
```

### Task 3: 实现结构化校验引擎和 `/api/tender/bids/:id/check`

**Files:**
- Create: `tender/backend/src/final-draft-checks.js`
- Modify: `tender/backend/src/db.js`
- Modify: `tender/backend/src/index.js`
- Test: `tender/backend/tests/final-draft-checks.test.js`
- Test: `tender/backend/tests/smoke.e2e.test.js`

**Step 1: 写失败用例，固定 issue 输出结构**

```js
import { runStructuredChecks } from '../src/final-draft-checks.js';

it('emits fatal issue when qualification requirement has no section coverage', () => {
  const result = runStructuredChecks({
    requirements: [
      { id: 1, requirement_type: 'QUALIFICATION', title: '营业执照', requirement_text: '需提供营业执照' },
    ],
    sections: [],
    evidences: [],
  });

  expect(result.summary.fatal_count).toBe(1);
  expect(result.issues[0].type).toBe('missing_requirement');
});
```

**Step 2: 跑测试，确认先红**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/tender/backend
npx vitest run tests/final-draft-checks.test.js
```

Expected: FAIL。

**Step 3: 写最小实现并新增校验表与接口**

最小实现范围：

- `runStructuredChecks()`
- `buildCheckSummary()`
- `POST /api/tender/bids/:id/check`

第一期规则：

- `missing_requirement`
- `missing_evidence`
- `field_conflict`
- `invalid_bid_risk`
- `score_gap`
- `placeholder_risk`

新增表：

- `tender_draft_check_runs`
- `tender_draft_check_issues`

**Step 4: 增加 smoke 接口回归**

在 smoke 中新增：

```js
const checkResp = await request({
  base: apiBase,
  path: `/api/tender/bids/${createdBidId}/check`,
  method: 'POST',
  token: authToken,
});
ensureStatus(checkResp, 200);
expect(Number(checkResp.json?.summary?.fatal_count || 0)).toBeGreaterThanOrEqual(0);
```

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/tender/backend
npx vitest run tests/final-draft-checks.test.js tests/smoke.e2e.test.js
```

Expected: PASS。

**Step 5: Commit**

```bash
git add tender/backend/src/final-draft-checks.js tender/backend/src/db.js tender/backend/src/index.js tender/backend/tests/final-draft-checks.test.js tender/backend/tests/smoke.e2e.test.js
git commit -m "feat: add structured draft checks"
```

### Task 4: 实现 Word 成稿校验器，并把成稿问题并入同一校验结果

**Files:**
- Modify: `tender/backend/src/final-draft-checks.js`
- Modify: `tender/backend/src/index.js`
- Test: `tender/backend/tests/final-draft-checks.test.js`

**Step 1: 写失败用例，覆盖占位符与章节顺序风险**

```js
it('detects docx draft placeholder and section order issues', async () => {
  const result = await runDocxChecks({
    paragraphs: [
      '封面',
      '{{PROJECT_NAME}}',
      '第三章 商务条款响应',
      '第二章 技术偏离表',
    ],
  });

  expect(result.issues.some((issue) => issue.type === 'placeholder_risk')).toBe(true);
  expect(result.issues.some((issue) => issue.type === 'section_order_risk')).toBe(true);
});
```

**Step 2: 跑测试，确认先红**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/tender/backend
npx vitest run tests/final-draft-checks.test.js
```

Expected: FAIL。

**Step 3: 写最小实现**

新增或扩展函数：

- `extractParagraphsFromDocx()`
- `runDocxChecks()`
- `mergeCheckResults()`

第一期规则：

- `section_order_risk`
- `heading_hierarchy_risk`
- `placeholder_risk`
- `signature_slot_missing`
- `toc_missing`
- `field_consistency_risk`

并将 Word 校验挂到 `/api/tender/bids/:id/check`。

**Step 4: 重跑测试**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/tender/backend
npx vitest run tests/final-draft-checks.test.js
```

Expected: PASS。

**Step 5: Commit**

```bash
git add tender/backend/src/final-draft-checks.js tender/backend/src/index.js tender/backend/tests/final-draft-checks.test.js
git commit -m "feat: add docx-level draft checks"
```

### Task 5: 实现评分覆盖矩阵和 `/api/tender/bids/:id/score-optimize`

**Files:**
- Create: `tender/backend/src/score-optimization.js`
- Modify: `tender/backend/src/db.js`
- Modify: `tender/backend/src/index.js`
- Test: `tender/backend/tests/score-optimization.test.js`
- Test: `tender/backend/tests/smoke.e2e.test.js`

**Step 1: 先写失败用例，固定 coverage 状态与优化建议输出**

```js
import { buildScoreCoverageMatrix, buildScoreOptimizationPrompt } from '../src/score-optimization.js';

it('marks uncovered high-score item as optimization-needed', () => {
  const rows = buildScoreCoverageMatrix({
    requirements: [
      { id: 9, requirement_type: 'SCORING', title: '项目团队实力', full_score: 8 },
    ],
    sections: [],
    evidences: [],
  });

  expect(rows[0].coverage_status).toBe('NONE');
  expect(rows[0].optimization_needed_flag).toBe(1);
});
```

**Step 2: 跑测试，确认先红**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/tender/backend
npx vitest run tests/score-optimization.test.js
```

Expected: FAIL。

**Step 3: 写最小实现并新增落库与接口**

新增表：

- `tender_score_coverage_matrix`
- `tender_score_optimization_records`

新增函数：

- `buildScoreCoverageMatrix()`
- `pickOptimizationCandidates()`
- `normalizeOptimizationResponse()`

新增接口：

- `POST /api/tender/bids/:id/score-optimize`

接口行为：

- 先基于 requirement / evidence / section 构建矩阵
- 只处理 `NONE` / `WEAK`
- AI 只返回结构化建议
- 结果落 `optimization_records`

**Step 4: 增加 smoke 回归**

```js
const optimizeResp = await request({
  base: apiBase,
  path: `/api/tender/bids/${createdBidId}/score-optimize`,
  method: 'POST',
  token: authToken,
});
ensureStatus(optimizeResp, 200);
expect(Array.isArray(optimizeResp.json?.items)).toBe(true);
```

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/tender/backend
npx vitest run tests/score-optimization.test.js tests/smoke.e2e.test.js
```

Expected: PASS。

**Step 5: Commit**

```bash
git add tender/backend/src/score-optimization.js tender/backend/src/db.js tender/backend/src/index.js tender/backend/tests/score-optimization.test.js tender/backend/tests/smoke.e2e.test.js
git commit -m "feat: add score coverage matrix and optimization API"
```

### Task 6: 前端接入校验结果与评分优化建议

**Files:**
- Modify: `tender/frontend/src/App.jsx`
- Modify: `tender/frontend/src/App.css`

**Step 1: 先写最小 UI 验收清单**

在实现前固定页面行为：

- 生成成功后可以触发“成稿校验”
- 能看到 `FATAL` / `WARN` 汇总
- 能按问题类型筛选 issue
- 能看到评分优化候选项
- 能对优化建议执行“接受/忽略”

将这份清单作为实现验收标准写进代码注释附近的临时 TODO 或开发说明块，完成后删除。

**Step 2: 先接只读展示，确认接口数据能走通**

在 `App.jsx` 中新增状态：

```js
const [draftCheckResult, setDraftCheckResult] = useState(null);
const [scoreOptimizeResult, setScoreOptimizeResult] = useState(null);
```

并新增按钮与接口调用：

- `onRunDraftCheck`
- `onRunScoreOptimize`

**Step 3: 增加问题面板与建议面板**

最小 UI：

- 校验汇总卡
- issue 列表
- 优化建议列表
- “接受建议 / 忽略建议”按钮占位

先不做复杂弹窗，不拆组件，保持与当前 `App.jsx` 风格一致。

**Step 4: 跑前端构建验证**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/tender/frontend
npm run build
```

Expected: `vite build` 成功，无编译错误。

**Step 5: Commit**

```bash
git add tender/frontend/src/App.jsx tender/frontend/src/App.css
git commit -m "feat: surface draft checks and score optimization in tender UI"
```

### Task 7: 全链路回归与交付收口

**Files:**
- Modify: `tender/backend/tests/smoke.e2e.test.js`
- Modify: `docs/plans/2026-03-07-tender-final-draft-check-and-score-optimize-design.md`
- Modify: `docs/plans/2026-03-07-tender-final-draft-check-and-score-optimize.md`

**Step 1: 补齐 smoke 场景**

覆盖顺序：

1. analyze
2. create
3. check
4. score-optimize

并至少断言：

- 注册表存在
- 校验结果存在
- 优化建议存在
- 没有结构崩坏

**Step 2: 跑后端回归**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/tender/backend
npx vitest run tests/smoke.e2e.test.js
```

Expected: PASS。

**Step 3: 跑前端构建**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/tender/frontend
npm run build
```

Expected: PASS。

**Step 4: 更新设计文档状态说明**

在设计文档末尾新增“已落地范围 / 未落地范围 / 后续 P1-P2”三段，确保文档与实际实现一致。

**Step 5: Commit**

```bash
git add tender/backend/tests/smoke.e2e.test.js tender/frontend/src/App.jsx tender/frontend/src/App.css docs/plans/2026-03-07-tender-final-draft-check-and-score-optimize-design.md docs/plans/2026-03-07-tender-final-draft-check-and-score-optimize.md
git commit -m "chore: verify tender final draft checks and score optimization flow"
```
