# 聊天前台流式与后台任务自动分流

## 目标

- PPT 生成、PPT 调整和长报告生成默认进入后台任务。
- 普通短问答继续使用前台逐字流式输出。
- 用户只描述问题，不再手动选择是否后台处理。
- 后台任务展示真实状态和进度；完成后通知用户，并可从通知或任务列表加载完整结果。

## 实现边界

- 复用现有长任务、聊天会话和任务状态契约，不新建旁路状态机。
- 服务端在聊天准备阶段返回 `execution_mode` 和可解释的 `execution_reason`，前端只执行服务端决策。
- 后台结果只通过任务状态和最终会话加载，不伪装成逐字流式响应。
- 说明、教程、简短摘要等短请求保持前台处理，避免误把普通问答送入后台。
- 使用服务器模型的 Web 运行时支持后台执行；依赖桌面本地密钥的本地运行时继续前台执行，避免后台 Worker 无法取得本地凭据。

## 验收标准

1. 明确的 PPT 创建或调整请求自动进入后台，并显示“已进入后台处理，可继续其他工作”。
2. 明确的长报告或正式材料生成请求自动进入后台；普通问答和简短总结保持流式输出。
3. 后台任务列表展示服务端返回的状态、阶段、进度、草稿和错误，不显示伪造的流式文字。
4. 任务从未完成变为完成时出现通知；点击“查看结果”加载对应聊天的完整结果。
5. 页面重新可见后立即刷新任务状态，降低断线或浏览器节流造成的状态滞后。
6. 用户界面不再提供“后台处理”复选框。

## 验证命令

```bash
cd server && python3 -m pytest tests/test_chat_execution_policy.py tests/test_chat_api.py::test_normal_chat_prepare_complete_and_detail tests/test_chat_api.py::test_long_report_prepare_selects_background_execution tests/test_chat_dashi_ppt.py::test_chat_generates_and_revises_real_dashi_ppt tests/test_long_tasks.py -q
cd apps/desktop && npm test -- chat-page.test.tsx design-contrast.test.ts
cd apps/desktop && npm run typecheck
git diff --check
```

## 实施结果

- 服务端已建立统一的聊天执行策略，并在全部聊天准备返回分支中输出执行模式和原因。
- 前端已按服务端决策自动提交后台任务，普通问题继续流式生成。
- 后台任务完成通知、真实进度刷新、页面恢复刷新和结果加载均已接入。
- 针对执行策略、真实聊天接口、PPT 工作流、长任务、页面交互和样式的回归测试通过。
