# 项目任务管理完善计划

## 目标

- 让项目任务支持编辑、删除和明确的状态切换，不再只有“标记完成”。
- 保持项目成员原有的任务访问权限与活动记录。

## 实施范围

1. 后端增加任务更新与删除接口，允许更新标题、说明和优先级；状态沿用现有状态接口。
2. 桌面端任务卡增加状态选择、编辑表单和删除入口。
3. 为编辑、状态切换和删除补充前端与后端测试。

## 验收标准

- 用户可把任务设为待处理、处理中、受阻、已完成或已取消。
- 用户可保存修改后的标题、说明和优先级。
- 用户可删除任务，且列表和统计立即同步。
- 非项目成员仍不能访问这些任务接口。

## 验证命令

```bash
cd apps/desktop && npm test -- --reporter=dot tests/project-workspace-page.test.tsx
cd apps/desktop && npm run typecheck
cd server && python3 -m pytest -q tests/test_project_task_routes.py
git diff --check
```

## 实施结果

- 已增加标题、说明、优先级的更新接口及删除接口；删除任务时会保留关联交付物，仅解除其任务关联。
- 任务卡支持待处理、处理中、受阻、已完成、已取消五种状态，并提供编辑与删除操作。
- 已补充后端任务更新/删除测试及桌面端任务管理交互测试。

## 验证结果

- `python3 -m pytest -q tests/test_project_task_routes.py`：2 passed。
- `npm run typecheck`：通过。
- `npm test -- --reporter=dot tests/project-workspace-page.test.tsx`：5 passed。
- `git diff --check`：通过。
