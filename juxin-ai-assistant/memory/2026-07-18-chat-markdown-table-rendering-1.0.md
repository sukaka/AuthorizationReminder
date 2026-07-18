# 2026-07-18：1.0 分支移植 Markdown 表格渲染

## 背景

用户要求参考会话 `019f6b16-2b47-7a12-8294-7a16e0ec9ef1` 的发布方式，将 Markdown 表格显示修复推送到 1.0。

## 处理

- 从 AI 助手 1.1.2 基线 `cf82ec36` 创建隔离分支 `codex/ai-assistant-1.0`。
- 只移植 `ChatPage.tsx` 的表格解析与语义化渲染、`tokens.css` 样式及回归测试。
- 保留普通含 `|` 文本的段落渲染，表格支持反斜杠转义竖线和行内代码竖线。
- 不修改 `VERSION` 与 `apps/desktop/package.json`，因为参考会话的 1.0 分支方式要求以基线版本提交并独立推送。

## 验证

- `npm test -- --reporter=dot tests/chat-page.test.tsx -t "renders markdown tables"`：通过（1 passed）。
- `npm run typecheck`：通过。
- `git diff --check`：通过。
- 版本文件仍为 `1.1.2`，未改动主工作树中的其他未提交文件。
