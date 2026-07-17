# Workflow 静态校验与预览计划

## 目标

为 4.0 Workflow/AgentHub 增加可检测、fail-closed 的静态校验与预览契约，覆盖非法节点、重复/非法引用、越权项目字面量、无界循环和显式审批缺失；保存与发布复用同一校验器，前端可在保存前展示节点/边和诊断。

## 范围

- 服务端新增纯函数校验器与确定性预览图；不调用真实 provider，不连接共享数据库。
- `POST /api/ai/workflows/validate` 校验未保存草稿；`POST /api/ai/workflows/custom/{workflow_id}/validate` 校验已保存草稿。
- 自定义流程保存、发布前复用相同 fail-closed 校验；项目引用只允许当前用户拥有的项目字面量，动态上下文引用交给运行时项目访问契约。
- 桌面端在流程构建器提供“校验预览”，校验失败时禁止保存并展示诊断。

## 变更候选文件

- `server/app/workflow_static.py`
- `server/app/workflow_engine.py`
- `server/app/workflow_routes.py`
- `server/tests/test_workflow_static_validation.py`
- `apps/desktop/src/api/client.ts`
- `apps/desktop/src/pages/WorkflowsPage.tsx`

## 验证

- 运行静态校验单测及现有 workflow 路由测试。
- 运行桌面端 TypeScript 检查（若依赖可用）。
- `git diff --check`；不提交、不推送。
