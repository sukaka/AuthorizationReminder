# Agent 市场页面重设计实施计划

## 目标

将 Agent 市场从复用历史记录样式的技术信息页，重构为清晰的“状态概览 + Agent 目录 + 试调工作台”。用户应能快速判断 Agent 总体可用性，按名称、ID、说明或能力查找，并在同一上下文完成健康诊断、出域确认和试调。

## 范围

- 重构 `apps/desktop/src/pages/AgentHubPage.tsx` 的展示结构与本地筛选状态。
- 新增 Agent 市场专属响应式样式，沿用现有主题变量和按钮体系。
- 更新 Agent Hub 组件测试，覆盖新版信息架构、搜索、来源筛选和现有调用流程。
- 必要时更新现有 Agent Hub Playwright 定位器，但不改变测试所代表的业务流程。
- 保留现有 Agent Hub API、管理员权限、市场状态变更和出域确认逻辑。

## 非目标

- 不新增或修改后端接口、数据模型和 Agent 注册机制。
- 不引入推荐、评分、付费结算等新的市场业务。
- 不修改侧栏和 AI 能力页签的信息架构。
- 不升级版本号，不提交或推送 Git。

## 验收标准

1. 页首以紧凑方式展示已注册、运行正常、本地和外部 Agent 数量。
2. Agent 目录支持按名称、ID、说明和能力搜索，并支持全部、本地、外部来源筛选。
3. 每个目录条目能直接辨认名称、ID、来源、健康状态和主要能力。
4. 详情区将身份、运行状态、能力连接和试调操作分层展示，原始诊断数据采用渐进披露。
5. 外部 Agent 继续要求出域确认；管理员继续拥有授权、安装和停用操作。
6. 空列表、无搜索结果、加载错误、调用结果和窄屏布局均有明确反馈。
7. Agent Hub 定向测试、类型检查、生产构建、端到端测试及 `git diff --check` 通过。

## 验证命令

```bash
cd apps/desktop
npm test -- --run tests/agent-hub-page.test.tsx --reporter=dot
npm run typecheck
npm run build
npm run test:e2e -- e2e/agent-hub-workflows.spec.ts --project=chromium
git diff --check
```

## 执行结果

- 已完成“市场概览 + 可搜索目录 + Agent 工作台”重构，并补齐空状态、调用结果、诊断渐进披露和窄屏布局。
- 保留现有 Agent Hub API、管理员市场操作与外部 Agent 出域确认，没有修改后端和数据模型。
- `npm test -- --run tests/agent-hub-page.test.tsx --reporter=dot`：3 条测试通过。
- `npm run typecheck`：通过。
- `npm run build`：通过；仅有现存的大体积 chunk 提示。
- `npm run test:e2e -- e2e/agent-hub-workflows.spec.ts --project=chromium`：2 条流程通过。
- `npm test -- --reporter=dot`：40 个测试文件、320 条测试全部通过；保留现有 MSW 未处理请求提示。
- `git diff --check`：通过。
- 未升级版本号，未提交或推送 Git。
