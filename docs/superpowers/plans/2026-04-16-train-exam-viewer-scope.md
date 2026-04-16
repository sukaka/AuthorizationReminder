# 培训考试普通用户边界收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让培训考试系统普通用户只看到课程列表、试卷列表、考试结果，并且考试结果只能查看自己的数据。

**Architecture:** 保持现有 `viewer` 角色判定不变，在前端用更细的菜单与视图分流收口普通用户入口；后端继续依赖既有 `ensureResultAccess` 做单条结果校验，并为普通用户结果链路补回归测试，确保管理员结果中心与普通用户自有结果链路分离。

**Tech Stack:** React、Express、Node.js、Jest 风格 node:test 单测

---

### Task 1: 写结果中心辅助逻辑失败测试

**Files:**
- Modify: `train-exam/backend/tests/result-center-utils.test.js`
- Test: `train-exam/backend/tests/result-center-utils.test.js`

- [ ] **Step 1: 写失败测试**

```js
it('normalizes viewer result list rows for self-only result list rendering', () => {
  expect(normalizeViewerResultListRow({
    id: '18',
    session_id: '33',
    user_id: '12',
    paper_id: '7',
    score: '88.5',
    total_score: '100',
    passed: '1',
    attempt_no: '2',
    is_final: '1',
  })).toMatchObject({
    id: 18,
    session_id: 33,
    user_id: 12,
    paper_id: 7,
    score: 88.5,
    total_score: 100,
    passed: 1,
    attempt_no: 2,
    is_final: 1,
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test train-exam/backend/tests/result-center-utils.test.js`

Expected: FAIL，提示 `normalizeViewerResultListRow is not a function` 或未导出。

- [ ] **Step 3: 写最小实现**

在 `train-exam/backend/src/result-center-utils.js` 中增加一个只负责普通用户结果列表归一化的导出函数，复用现有数字归一化逻辑，不新增不必要字段。

- [ ] **Step 4: 再跑测试确认通过**

Run: `node --test train-exam/backend/tests/result-center-utils.test.js`

Expected: PASS

### Task 2: 收紧普通用户菜单与视图入口

**Files:**
- Modify: `train-exam/frontend/src/App.jsx`

- [ ] **Step 1: 写失败测试替代检查**

先用源码断言方式约束普通用户菜单文案：

Run:
`rg -n "课程列表|试卷列表|考试结果|仪表盘|题库管理|考试中心|错题复训" train-exam/frontend/src/App.jsx`

Expected: 看到旧文案仍在普通用户菜单分支中，和目标不一致。

- [ ] **Step 2: 做最小实现**

在 `train-exam/frontend/src/App.jsx` 中：

1. 把普通用户菜单从：
   - 培训管理
   - 考试中心
   - 成绩与证书
   - 错题复训

   改成：
   - 课程列表
   - 试卷列表
   - 考试结果

2. 普通用户 `试卷列表` 直接进入现有 `papers` 视图，只展示列表与开始考试能力。
3. 普通用户 `考试结果` 直接进入现有 `results` 视图里的 `myResults` 列表，不触发管理员结果中心逻辑。
4. 普通用户不再显示管理员才有的提示语，例如“请在试卷管理中选择已发布试卷并开始考试”。

- [ ] **Step 3: 运行最小检查**

Run:
`rg -n "仪表盘|题库管理" train-exam/frontend/src/App.jsx`

Expected: 这些文案只出现在非普通用户分支。

### Task 3: 收紧普通用户考试结果视图

**Files:**
- Modify: `train-exam/frontend/src/App.jsx`

- [ ] **Step 1: 写失败测试替代检查**

Run:
`rg -n "fetchAdminResults|fetchCandidateRecord|resultCenterTab === 'certificates'" train-exam/frontend/src/App.jsx`

Expected: 普通用户相关分支仍可能触达管理员结果中心或证书中心逻辑。

- [ ] **Step 2: 做最小实现**

在 `train-exam/frontend/src/App.jsx` 中：

1. 普通用户点击 `考试结果` 时只执行 `fetchMyResults(true)`，不再拉管理员结果中心数据。
2. 普通用户 `results` 页面只渲染：
   - 自己的考试结果列表
   - 自己的卷面详情
   - 自己相关的证书/续证信息（如果现有页面已在该分支内显示）
3. 管理员结果中心的筛选、统计、考生记录分支保持在 `!isBasicUser` 条件下。

- [ ] **Step 3: 运行最小检查**

Run:
`npm --prefix train-exam/frontend run build`

Expected: build 成功

### Task 4: 全量验证并提交

**Files:**
- Modify: `docs/releases/5.9.0.md`
- Modify: `package.json`
- Modify: `web/package.json`
- Modify: `auth/package.json`

- [ ] **Step 1: 跑相关测试**

Run:
`node --test train-exam/backend/tests/result-center-utils.test.js`

Expected: PASS

- [ ] **Step 2: 跑前端构建**

Run:
`npm --prefix train-exam/frontend run build`

Expected: build 成功

- [ ] **Step 3: 写版本说明**

新增 `docs/releases/5.9.0.md`，说明普通用户菜单和考试结果范围收口。

- [ ] **Step 4: 提交**

```bash
git add train-exam/frontend/src/App.jsx train-exam/backend/src/result-center-utils.js train-exam/backend/tests/result-center-utils.test.js docs/superpowers/specs/2026-04-16-train-exam-viewer-scope-design.md docs/superpowers/plans/2026-04-16-train-exam-viewer-scope.md docs/releases/5.9.0.md package.json web/package.json auth/package.json
git commit -m "feat(train-exam): narrow viewer menus and result access"
```
