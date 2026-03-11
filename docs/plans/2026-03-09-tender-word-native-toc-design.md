# Tender Word 原生目录域增量设计

## 背景

现有 `word-layout.js` 已经解决了章节重排、文本目录重算、附录后置，以及 docx 页眉页脚兜底，但导出的 Word 文档仍然只有静态目录文本，用户打开后不能直接依赖 Word 原生目录功能进行刷新。

上一版设计在 [2026-03-09-tender-word-layout-design.md](./2026-03-09-tender-word-layout-design.md) 中明确把“Word 原生域目录刷新”列为非目标。本次只做这一块的增量收口，不扩展到复杂分页和节级页码控制。

## 目标

在当前导出链路上新增可控的原生目录域能力：

1. 生成的 docx 在打开时可提示或自动刷新目录域
2. 基础导出路径可以把“目录”章节输出为 Word TOC field，而不是纯静态文本
3. 模板导出路径在满足条件时支持目录域注入，不破坏已有模板样式
4. 保持现有文本目录数据和章节重排逻辑不回退

## 非目标

- 不实现复杂分页控制
- 不实现不同节的页码格式切换
- 不做 OnlyOffice 协同编辑内的目录刷新
- 不保证所有历史模板都自动升级为原生目录域

## 方案

### 1. 新增 docx 原生 TOC helper

在 `tender/backend/src/word-layout.js` 新增两类 helper：

- `ensureDocxSettingsUpdateFieldsBuffer`
  - 给 `word/settings.xml` 注入 `<w:updateFields w:val="true"/>`
  - 若 settings part 不存在，则自动补齐 part、relationship 和 content type
- `ensureDocxNativeTocBuffer`
  - 在 `word/document.xml` 中把目录 marker 或目录章节位置替换为标准 TOC field XML
  - Word field 使用 `TOC \\o "1-3" \\h \\z \\u`

### 2. 基础 docx 导出改为章节感知

`writeSimpleDocx` / `buildSimpleDocxBuffer` 保留原有 `paragraphs` 兼容能力，同时新增 `chapters` 输入：

- 当传入 `chapters` 时，使用章节级 XML 生成正文
- 遇到 `TOC` 章节时只输出目录标题和 TOC field，不再落静态目录行
- 其他章节继续按 Heading1 + 正文段落输出

这样基础导出路径可以稳定生成原生目录，而且不需要再从平铺文本中回推目录位置。

### 3. 模板 docx 的最小兼容策略

模板路径分两类：

- 模板没有正文占位符，系统在渲染后追加章节正文
  - 复用章节级 XML 输出，因此天然支持原生目录域
- 模板显式使用 `{{TOC_CONTENT}}`
  - 渲染时先注入一个内部 marker
  - 渲染后把 marker 所在段落替换为 TOC field XML

暂不覆盖以下高耦合情况：

- 模板只使用 `{{BID_BODY}}` / `{{CHAPTERS_CONTENT}}` 承载全文，且希望在其中自动拆出 TOC 域

这类情况仍然保持文本目录，不做激进 XML 重写，避免误删正文。

## 接入点

- `tender/backend/src/index.js`
  - `buildSimpleDocxBuffer`
  - `writeSimpleDocx`
  - `writeDocxWithTemplate`
- `tender/backend/src/word-layout.js`
  - 原生 TOC 与 settings helper
- `tender/backend/tests/word-layout.test.js`
  - 增加 docx 结构测试

## 风险与取舍

- 只对“基础导出”和“显式 TOC 占位符模板”兜底，避免对复杂模板做不可靠的 XML 猜测
- 继续保留 `toc_content` 等文本能力，便于前端展示、校验和非 Word 场景复用
- 通过 `updateFields` 提高打开后刷新概率，但不同 Word 客户端的实际刷新提示仍可能有差异

## 验收

- `word-layout.test.js` 覆盖：
  - `word/settings.xml` 自动补齐和 `updateFields` 注入
  - 原生 TOC field 注入到 `document.xml`
  - 已存在 TOC field 时不重复注入
- 后端导出链路仍可通过 smoke 回归
