# FAQ Article Row Number Design

**Date:** 2026-03-10

## Goal

为 FAQ 列表增加序号列，并按分页全局连续显示：

- 第 1 页：`1-20`
- 第 2 页：`21-40`

该规则同样适用于回收站列表。

## Current State

当前 FAQ 列表表格列为：

- 管理员：勾选框、标题、状态、分类、更新时间/删除时间、操作
- 非管理员：标题、状态、分类、更新时间/删除时间、操作

前端已经拿到分页信息：

- `articles.page`
- `articles.limit`

因此无需改动后端接口。

## Recommendation

采用纯前端计算方案：

- 起始序号：`((page - 1) * limit)`
- 当前行序号：`start + rowIndex + 1`

原因：

- 改动最小
- 不需要新增后端字段
- 与用户要求完全一致

## Display Rules

### FAQ 列表

- 管理员：`勾选框 / 序号 / 标题 / 状态 / 分类 / 时间 / 操作`
- 非管理员：`序号 / 标题 / 状态 / 分类 / 时间 / 操作`

### 回收站

- 保持同样的序号规则
- 时间列仍显示删除时间，不影响序号逻辑

### 骨架屏

- 加载态也补齐序号列占位，避免表头和数据列错位

## Implementation Scope

只改前端：

- `faq/frontend/src/App.jsx`
- `faq/frontend/src/App.css`

不改：

- `faq/backend/src/index.js`
- 任何 API 返回结构

## Validation

- `cd /Users/zhanglei/Documents/codex-new/faq/frontend && npm run build`
- 手工检查 FAQ 列表与回收站：
  - 第 1 页显示 `1-20`
  - 第 2 页显示 `21-40`
