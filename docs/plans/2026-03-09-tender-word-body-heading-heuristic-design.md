# Tender Word Body Heading Heuristic Design

## 背景

当前 `ensureDocxLogicalParagraphsBuffer` 已能在正文占位符段内命中 `pageBreakTitles` 时，把多行 `<w:br/>` 内容拆成独立段落，并把命中的标题提升成 `Heading1`。

但还剩一个清晰缺口：

- 如果正文里出现了看起来像章节标题的逻辑行
- 但这行文字不在 `pageBreakTitles` 里

helper 仍会保持整段不拆，导致：

- 章节分页无法命中
- native TOC 无法覆盖这类标题
- 模板正文仍可能保持成“单段多行”

## 目标

在不引入激进 NLP 分类的前提下，增加一层保守启发式：

1. `第X章 ...`
2. `附录X ...`
3. `附件X ...`
4. 单独的 `目录`

这类逻辑行即使不在 `pageBreakTitles` 中，也可被视为章节边界，允许拆段并提升为 `Heading1`。

## 方案

在 `word-layout.js` 中新增章节样式启发式判断：

- 基于已有命名规则做正则识别
- 只用于正文占位符拆段 helper
- 识别到“至少一条启发式标题 + 至少一个换行”时，允许拆段

拆段后：

- 命中启发式标题的段落提升为 `Heading1`
- 普通行仍保持普通段落
- 空行保持 `<w:p/>`

## 边界

- 不处理普通长句里的误判风险较高模式
- 不处理表格、文本框、页眉页脚中的占位符
- 不把任意数字编号文本都视为标题

## 验证

- `word-layout.test.js` 新增未命中 `pageBreakTitles` 但匹配启发式标题的拆段测试
- `npx vitest run tests/word-layout.test.js`
- `node --check tender/backend/src/word-layout.js`
- `node --check tender/backend/src/index.js`
- `npx vitest run tests/smoke.e2e.test.js`
