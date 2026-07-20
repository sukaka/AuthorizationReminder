# “我的资料”统一入口实施计划

## 目标

- 用户只需要理解“我的资料”一个入口。
- 管理员上传时只选择“公司共享”或“仅自己使用”。
- 普通用户上传的资料固定为仅本人可见，不提供转公司资料、提交审核等入口。
- 页面查找同时覆盖当前用户有权访问的公司共享资料和个人资料。
- 保留后端现有资料库、审核、检索索引和权限字段，不在本次修改中重构数据模型。

## 实施范围

- `apps/desktop/src/pages/KnowledgePage.tsx`
  - 简化页面文案、查找范围和上传用途。
  - 公司共享上传自动使用现有公司级资料库；没有时自动创建默认公司共享区。
  - 隐藏面向普通使用者的资料库、审核和检索治理概念。
- `apps/desktop/tests/admin-navigation.test.tsx`
  - 覆盖统一搜索、管理员公司/个人上传、普通用户私有上传。
- `apps/desktop/tests/knowledge-page.test.tsx`
  - 调整搜索结果操作测试，使其适配统一搜索。

## 验收标准

1. “我的资料”主页不要求用户选择正式资料或个人资料后再查找。
2. 同一次查找会请求公司共享资料与个人资料，并合并展示有权限的结果。
3. 管理员选择“公司共享”时，上传请求仍使用公司级权限和正式资料字段。
4. 管理员选择“仅自己使用”时，上传请求不携带资料库 ID，且权限为 `private`。
5. 普通用户看不到公司共享、提交审核、当前任务等上传用途，上传始终为个人私有资料。
6. AI 对话继续默认检索公司共享资料与当前用户个人资料；本次不改变既有聊天协议。

## 验证命令

```bash
cd apps/desktop
npm test -- --reporter=dot tests/admin-navigation.test.tsx tests/knowledge-page.test.tsx tests/chat-page.test.tsx
npm run typecheck
git diff --check -- apps/desktop/src/pages/KnowledgePage.tsx apps/desktop/tests/admin-navigation.test.tsx apps/desktop/tests/knowledge-page.test.tsx docs/plans/2026-07-20-unified-my-materials.md
```

## 状态

- [x] 完成现状与权限链路确认
- [x] 先补失败测试
- [x] 实现统一搜索和简化上传
- [x] 完成定向测试与类型检查
- [x] 更新当天记忆文件

## 验证结果

- `npm test -- --reporter=dot tests/admin-navigation.test.tsx tests/knowledge-page.test.tsx`：通过（2 个文件，39 个测试）。
- `npm run typecheck`：通过。
- `npm test -- --reporter=dot tests/chat-page.test.tsx`：通过（54 个测试）；聊天协议未改动。
- `git diff --check`：通过。
- 未改动后端权限与检索协议；既有服务端继续限制只有管理员可上传公司共享资料，个人资料仅本人可用。
