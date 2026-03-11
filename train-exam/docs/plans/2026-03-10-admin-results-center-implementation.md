# 管理员结果中心 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把当前“成绩证书”后台页改造成管理员可用的“考试结果中心”，支持按考生/试卷筛选、分页查看结果、打开单次卷面详情、查看考生历史记录，并保留普通用户的个人成绩与证书能力。

**Architecture:** 后端新增管理员结果列表与卷面详情聚合接口，列表只返回轻量摘要并内嵌统计摘要；前端把管理员结果视图从考试作答状态中拆出，使用独立的结果列表、卷面详情、考生记录状态和页面块。个人用户继续走现有 `/my/results` 与证书中心。结果详情不再复用答题页，而是直接渲染独立报表与逐题卷面。

**Tech Stack:** Node.js + Express + MySQL, React + Vite 单文件前端, Jest 单元测试, Docker Compose

---

### Task 1: 后端结果中心工具与测试

**Files:**
- Create: `/Users/zhanglei/Documents/codex-new/train-exam/backend/src/result-center-utils.js`
- Test: `/Users/zhanglei/Documents/codex-new/train-exam/backend/tests/result-center-utils.test.js`

**Step 1: Write the failing test**

- 覆盖管理员结果筛选参数归一化
- 覆盖列表分页返回和摘要统计映射
- 覆盖卷面详情题型正确率、错题数、用时格式所需的聚合结构

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/result-center-utils.test.js`

**Step 3: Write minimal implementation**

- 提供筛选规范化、列表行/摘要规范化、卷面统计聚合函数

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/result-center-utils.test.js`

### Task 2: 管理员结果列表与详情接口

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/train-exam/backend/src/index.js`
- Reuse: `/Users/zhanglei/Documents/codex-new/train-exam/backend/src/result-center-utils.js`

**Step 1: Write the failing test**

- 先用 Task 1 的工具测试锁住接口返回所依赖的数据结构，避免直接从 HTTP 层起步

**Step 2: Write minimal implementation**

- 新增管理员结果列表接口，支持考生、试卷、通过状态、最终成绩、时间范围、分页
- 列表响应附带筛选摘要、试卷选项、考生选项
- 新增卷面详情聚合接口，返回考试摘要、题型报表、逐题卷面
- 新增考生记录接口，按考生查看历史考试结果
- 保持 `ensureResultAccess` / `ensureExamSessionAccess` 权限边界，管理员/审计员可查看，普通用户只能看自己的

**Step 3: Run focused tests**

Run: `npm test -- tests/result-center-utils.test.js`

### Task 3: 前端管理员结果中心状态与数据流

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/train-exam/frontend/src/App.jsx`

**Step 1: Add state and fetchers**

- 新增管理员结果列表、分页、筛选、详情、考生记录状态
- 新增 `fetchAdminResults`、`fetchAdminResultDetail`、`fetchCandidateResults`
- 进入管理员结果中心时只加载结果列表，不再同时拉证书模板和个人证书

**Step 2: Replace navigation and copy**

- 管理员菜单改为 `考试结果`
- 普通用户菜单改为 `成绩与证书`
- 管理员结果入口和按钮文案统一成 `查看卷面`、`查看考生记录`、`查看结果报表`

### Task 4: 前端结果列表、详情页和个人页拆分

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/train-exam/frontend/src/App.jsx`
- Modify: `/Users/zhanglei/Documents/codex-new/train-exam/frontend/src/App.css`

**Step 1: 管理员结果列表**

- 顶部筛选区
- 摘要卡
- 结果表格或移动端卡片
- 行操作：查看卷面、查看考生记录

**Step 2: 卷面详情**

- 顶部概览
- 题型报表
- 逐题卷面
- 打印按钮与打印友好布局

**Step 3: 考生记录**

- 当前考生信息
- 历史考试记录列表
- 支持从考生记录再次打开卷面详情

**Step 4: 普通用户个人结果页**

- 个人用户保留证书模板无关能力
- 个人用户仍可查看自己的成绩与证书、续证任务

### Task 5: 验证、构建与镜像重建

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/train-exam/frontend/dist/index.html`
- Modify: `/Users/zhanglei/Documents/codex-new/train-exam/frontend/dist/assets/*`

**Step 1: Run backend tests**

Run: `npm test -- tests/result-center-utils.test.js tests/question-filter-utils.test.js tests/question-category-utils.test.js tests/paper-rule-utils.test.js tests/question-import-utils.test.js`

**Step 2: Run frontend build**

Run: `npm run build`

**Step 3: Rebuild images**

Run: `docker compose -f /Users/zhanglei/Documents/codex-new/docker-compose.yml build train-exam-api web-train-exam`

**Step 4: Restart services**

Run: `docker compose -f /Users/zhanglei/Documents/codex-new/docker-compose.yml up -d train-exam-api web-train-exam`
