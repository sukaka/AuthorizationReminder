# AI 助手直接进入聊天窗口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除工作台生产入口，让用户登录后和从其他页面返回时都进入聊天窗口。

**Architecture:** 保留现有 `Workspace` 单页状态结构，但从 `WorkspacePage` 中移除 `home`，并让聊天成为唯一默认与返回目标。旧 `HomePage` 组件暂不物理删除，避免扩大变更范围。

**Tech Stack:** React, TypeScript, Vitest, Testing Library

## Global Constraints

- 不改变聊天、任务、历史记录及管理页面内部行为。
- 不提交无关未跟踪文件。
- 行为变更遵循 RED-GREEN-REFACTOR。

---

### Task 1: 固定直接聊天入口行为

**Files:**
- Modify: `juxin-ai-assistant/apps/desktop/tests/session.test.tsx`
- Modify: `juxin-ai-assistant/apps/desktop/tests/employee-flow.test.tsx`
- Modify: `juxin-ai-assistant/apps/desktop/tests/admin-navigation.test.tsx`
- Modify: `juxin-ai-assistant/apps/desktop/tests/web-mode.test.tsx`

- [x] 在会话测试中断言聊天首屏存在且“工作台”按钮不存在。
- [x] 在员工流程中打开其他页面，断言“返回聊天”可恢复聊天窗口。
- [x] 更新仍以“工作台”作为加载完成标志的测试。
- [x] 运行定向测试并确认因旧入口仍存在而失败。

### Task 2: 删除工作台生产入口

**Files:**
- Modify: `juxin-ai-assistant/apps/desktop/src/App.tsx`

- [x] 删除 `HomePage` 导入、`home` 页面状态、导航按钮和渲染分支。
- [x] 将受限页面回退目标改为 `chat`。
- [x] 仅在非聊天页面显示“返回聊天”，点击后设置 `chat`。
- [x] 运行定向测试并确认通过。
- [x] 运行 TypeScript 类型检查和相关主应用测试。

### Task 3: 发布

**Files:**
- Modify: AI 助手版本文件（由版本脚本统一更新）
- Modify: 平台版本文件（由提交钩子统一更新）

- [x] 按功能优化将 AI 助手次版本加一。
- [x] 检查差异和未跟踪文件边界。
- [x] 提交并推送当前功能分支。
