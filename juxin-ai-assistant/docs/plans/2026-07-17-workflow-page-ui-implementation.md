# 工作流页面 UI 正式接入计划

## 目标

将已确认的工作流 HTML 原型接入正式 React 页面，重点解决左侧工作流列表文字不对齐、列表层级不清晰和右侧操作区信息密度不均的问题；保留现有工作流 API、运行、校验、发布和拖拽编排能力。

## 范围

- 修改 `apps/desktop/src/pages/WorkflowsPage.tsx` 的页面结构和展示状态。
- 修改 `apps/desktop/src/theme/tokens.css`，新增仅作用于工作流页面的样式。
- 更新 `apps/desktop/tests/workflows-page.test.tsx`，覆盖列表筛选和新版选择交互。
- 不修改后端接口、数据库、权限、生产配置和版本号。

## 验收标准

1. 左侧列表的序号、名称、元信息和状态使用固定栅格列，所有条目起始线一致。
2. 能按名称、ID、说明搜索，并按全部/预置/自定义筛选。
3. 选中工作流时右侧标题、步骤定义和运行配置保持现有 API 数据。
4. 现有运行、路由、拖拽编排、校验、发布和删除流程行为不回归。
5. 通过工作流页面测试、类型检查、构建和浏览器截图检查。

## 验证命令

```bash
cd apps/desktop
npm test -- --run tests/workflows-page.test.tsx --reporter=dot
npm test
npm run typecheck
npm run build
```

## 执行结果

- 工作流页面测试：4/4 通过。
- 桌面端完整测试：40 个测试文件、317 个测试全部通过。
- 类型检查与生产构建：通过；构建仅提示 bundle 体积偏大。
- 浏览器截图验收：待启动桌面开发服务并接入可用 API 后执行。
