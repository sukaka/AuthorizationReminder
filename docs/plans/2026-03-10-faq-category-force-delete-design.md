# FAQ Category Force Delete Design

**Date:** 2026-03-10

## Goal

为 FAQ 分类管理增加“强制删除”能力，在保留普通删除规则不变的前提下，允许管理员对一个分类树执行递归删除，并同步处理关联 FAQ。

## Current State

当前分类管理已经支持：

- 普通单删
- 普通批量删除
- 阻止删除仍有关联 FAQ 的分类
- 阻止删除仍有子分类的父分类

但当前没有“强制删除”能力。管理员面对一个存在子分类和关联 FAQ 的分类时，只能手工先处理子分类和文章，再回头删除分类。

## User-Confirmed Behavior

本次“强制删除”已经确认以下口径：

1. 普通删除保持现状不变
2. 强制删除时，子分类也可以删除
3. 强制删除时，关联 FAQ 也可以一并处理
4. FAQ 不做物理删除，而是进入回收站
5. FAQ 进入回收站前要把 `category_id` 置空，避免以后恢复时引用一个已不存在的分类

## Recommendation

采用“单个强制删除入口 + 递归分类树处理 + FAQ 进回收站”的方案：

- 后端新增单个强制删除接口
- 前端仅在分类管理行内为管理员提供“强制删除”按钮
- 暂不引入“批量强制删除”

不推荐第一版就做批量强制删除，因为：

- 风险显著更高
- 一次误操作会影响更多文章
- 前端确认文案和失败回滚会更复杂

## Permission Model

- 普通删除：
  - 继续保持 `writer` 可用
- 强制删除：
  - 仅 `admin` 可用

原因：强制删除不仅影响分类，还会批量把 FAQ 放入回收站并释放编辑会话，属于更高风险的系统级操作。

## API Design

### Keep Existing APIs

- `DELETE /api/faq/categories/:id`
- `POST /api/faq/categories/batch-delete`

两者行为都保持不变。

### New Force Delete API

新增：

- `POST /api/faq/categories/:id/force-delete`

返回：

```json
{
  "ok": true,
  "deleted_category_count": 3,
  "deleted_category_ids": [12, 15, 19],
  "recycled_article_count": 8,
  "recycled_article_ids": [101, 102, 109]
}
```

约束：

- 仅 `admin`
- 分类不存在返回 `404`
- 已找到的子分类递归一并处理
- 不要求分类树“先清空后再删”

## Force Delete Execution Order

后端执行顺序：

1. 找到目标分类
2. 递归收集该分类及全部子分类
3. 查询这些分类下的所有未删除 FAQ
4. 将这些 FAQ 放入回收站：
   - `is_deleted = 1`
   - `deleted_at = NOW()`
   - `deleted_by_id / deleted_by_name`
   - `purge_after`
   - `status = 'archived'`
   - `category_id = NULL`
5. 释放这些 FAQ 的在线编辑会话
6. 按“子分类优先、父分类最后”的顺序删除分类记录
7. 写审计日志并返回摘要结果

## Frontend Design

分类管理页只增加一处入口：

- 管理员行内操作区：
  - `编辑`
  - `删除`
  - `强制删除`

交互要求：

- 点击“强制删除”必须二次确认
- 确认文案明确说明：
  - 会递归删除子分类
  - 会把关联 FAQ 放入回收站
  - FAQ 恢复后将变成“无分类”

第一版不加批量强制删除按钮。

## Audit and Data Safety

审计至少需要记录：

- 触发人
- 目标分类
- 实际删除的分类 ID 列表
- 实际进入回收站的文章 ID 列表

这样可以在误操作后快速追溯影响范围。

## Testing

### Backend Helper / Unit

补充纯逻辑测试：

- 递归分类树收集顺序正确
- 强制删除结果摘要结构正确

### Backend Smoke

新增一条 force delete smoke：

1. 创建父分类和子分类
2. 在子分类下创建 FAQ
3. 调用 `POST /api/faq/categories/:id/force-delete`
4. 断言：
   - 父分类不存在
   - 子分类不存在
   - FAQ 已进回收站
   - FAQ 的 `category_id = null`
   - FAQ 编辑会话已释放

### Frontend

前端当前无测试基建，本次通过：

- 构建验证
- 本地手工确认 admin 能看到“强制删除”，非 admin 看不到

## Files

- `faq/backend/src/index.js`
- `faq/backend/src/category-delete.js`
- `faq/backend/tests/category-delete.test.js`
- `faq/backend/tests/smoke.e2e.test.js`
- `faq/frontend/src/App.jsx`
- `faq/frontend/src/App.css`
