# 2026-07-18 聊天 Run 正式化

## 目标

在 5.0 正式聊天页接入 Run 上下文侧栏，承接已完成的 `?prototype=chat` 原型，但不改变现有聊天发送链路。

## 已知边界

- 现有 `ChatPage` 已有真实的 `taskProgress`、`lastRunId`、生成指标、引用和生成文件。
- 目前没有稳定的 Queue/Steer 后端契约，因此本轮只做可观察性，不伪造并发控制能力。
- 原型路由保留用于对照；正式能力通过默认聊天页使用。

## 计划文件

- `juxin-ai-assistant/docs/plans/chat-run-formalization.md`

## 已完成改动

- 新增 `apps/desktop/src/components/ChatRunContext.tsx`。
- 在 `apps/desktop/src/theme/tokens.css` 增加正式聊天 Run 上下文布局和响应式样式。
- 在 `ChatPage.tsx` 传入真实 Run 数据：任务阶段、会话/Run 标识、工具活动、引用来源、生成文件和生成指标。
- 新增组件测试。
- `ChatTaskStateOut` 增加可选 `run_id`；聊天准备和历史会话详情沿用同一字段。
- 历史会话详情按用户和会话恢复最新统一 Run；即使旧会话没有 `AgentTaskState`，也不会丢失 Run 上下文。
- `GET /api/ai/runs` 支持 `conversation_id` 过滤，服务层按所有者和会话双重隔离。
- 正式聊天页停止生成时同时取消本地模型请求和统一 Run；切换、新建、彻底删除会话时清理旧 Run ID。
- 新增服务层恢复测试和聊天页停止请求测试。

## 验证结果

- `npm run typecheck`：通过。
- `npm run test -- --run tests/chat-page.test.tsx tests/chat-run-context.test.tsx`：57/57 通过。
- `python3 -m pytest -q tests/test_chat_api.py tests/test_agent_run_service.py`：50/50 通过。
- `git diff --check`：通过。
- `npm run build`：已通过（仅有 Vite 大 chunk 提示）。

## 当前状态

- 正式聊天页已经接入 Run 上下文，不再只是 `?prototype=chat` 原型。
- 原型路由仍保留用于对照和演示。
- 当前未新增后端 Queue/Steer；恢复已采用“会话范围内最新 Run + 统一取消入口”的最小稳定语义。Queue/Steer 仍需先锁定服务端契约后再实现。
