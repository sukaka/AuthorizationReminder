# 聊天 Markdown 表格渲染修复方案

## 目标

让聊天回答中的标准 Markdown 表格渲染为语义化 HTML 表格，避免把 `|` 分隔符直接显示给用户。

## 范围

- 仅修改桌面端聊天回答的 Markdown 渲染链路。
- 沿用现有自定义解析器，不新增第三方依赖。
- 支持带或不带首尾 `|` 的表格、表头分隔行和单元格内粗体。
- 宽表格在窄窗口中横向滚动，不挤压或撑破聊天区域。

## 验收标准

1. 表头使用 `th`，数据使用 `td`，分隔行不显示。
2. 中文和长文本保持可读，宽表格不会突破消息气泡。
3. 普通段落中的单个 `|` 不会被误判为表格。
4. 原有标题、列表、粗体和引用来源渲染测试保持通过。

## 验证命令

```bash
npm test -- --reporter=dot tests/chat-page.test.tsx -t "renders markdown tables"
npm test -- --reporter=dot tests/chat-page.test.tsx
npm run typecheck
git diff --check
```

## 发布边界

本项属于 Bug 修复。版本升级、提交和推送需在用户明确授权后执行。

## 执行结果

- RED：新增回归测试后，页面找不到“回答表格”，原始 Markdown 表格各行被确认为普通段落。
- GREEN：新增定向测试通过，标准 Markdown 表格渲染为 `table`、`th`、`td`，普通 `A | B` 文本未被误判。
- `npm run typecheck` 通过。
- `git diff --check` 通过。
- 桌面端全量测试为 318/320 通过；2 条失败来自工作区原有“助手模式默认值由 `normal` 改为 `auto`”并行改动的旧断言，与本次表格渲染无关，本次未越界修改。
- 当前版本仍为 `5.1.0`，未提交、未推送。
