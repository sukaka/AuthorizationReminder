# Tender Word TOC Placeholder Pagination Design

## 背景

当前 `3.8 Word 装配与导出器` 已支持：

- 原生 TOC field
- 章节级分页
- 封面/目录/正文的节级页码样式

但还有一个明确残缺点：模板如果显式使用 `{{TOC_CONTENT}}`，同时模板本身没有单独写出“目录”标题段落，当前分页和节样式 helper 就无法识别“目录边界”。

原因是：

- `ensureDocxNativeTocBuffer` 会把 marker 段落替换成 TOC field 段落
- `ensureDocxPageBreakBeforeHeadingsBuffer` 和 `ensureDocxSectionPageNumberBuffer` 仍主要靠文字标题 `目录` 做边界识别

这样会导致：

- `封面 -> TOC` 可能不自动起新页
- `cover -> toc -> body` 的 section 拆分不完整
- `titlePg` / `lowerRoman` / 正文重新编号在这类模板上不稳定

## 目标

在不强改模板可见文案的前提下，让显式 `{{TOC_CONTENT}}` 模板也能稳定复用现有分页与节样式链路：

1. TOC field 段落可以被当作“目录边界”
2. `封面 -> TOC field -> 第一章` 能形成稳定分页
3. `ensureDocxSectionPageNumberBuffer` 能把 TOC field 当作前置节边界

## 方案

在 `word-layout.js` 增加一个轻量识别：

- 判断某段落是否为 TOC field 段落：包含 `DOCX_NATIVE_TOC_INSTRUCTION`

然后扩展两个 helper：

- `ensureDocxPageBreakBeforeHeadingsBuffer`
  - 当 `headings` 中包含 `目录` 时，TOC field 段落也视为命中
- `ensureDocxSectionPageNumberBuffer`
  - 当找不到文字 `目录` 时，回退到 TOC field 段落作为 `restartHeading` 边界

## 边界

- 不自动补“目录”可见标题文本
- 不改 TOC field XML 结构
- 不处理没有 `TOC_CONTENT`、也没有 `目录` 标题、同时没有 TOC field 的模板

## 验证

- `word-layout.test.js` 新增：
  - cover + TOC field + body 场景
  - 确认分页 helper 会在 TOC field 前插 page break
  - 确认 section helper 仍能产出 3 个 `sectPr`
- `npx vitest run tests/word-layout.test.js`
- `node --check tender/backend/src/word-layout.js`
- `node --check tender/backend/src/index.js`
- `npx vitest run tests/smoke.e2e.test.js`
