# Tender Word Body Placeholder Split Design

## 背景

当前复杂正文占位符模板（如 `{{BID_BODY}}` / `{{CHAPTERS_CONTENT}}`）仍是 `3.8` 剩余缺口。实验结果表明，`docxtemplater` 在 `linebreaks: true` 下会把多行正文渲染成“单段落 + 多个 `<w:br/>`”，而不是多个 Word 段落。

这会直接导致：

- 原生 TOC 无法稳定识别正文标题
- 章节起新页 helper 无法命中标题段落
- 节级页码样式无法把“目录 -> 正文”边界提升为 section break

## 目标

为复杂正文占位符模板增加“安全拆段”能力：

- 只在段内存在章节标题命中时拆段
- 拆段后把章节标题提升为 `Heading1`
- 成功拆段后复用现有 native TOC / page break / section page number 链路

## 方案

在 `word-layout.js` 增加一个 docx helper，扫描 `word/document.xml` 中带 `<w:br/>` 的段落：

- 若该段落包含已知章节标题（来自 `pageBreakTitles`），则按逻辑行拆成多个 `<w:p>`
- 空行转为 `<w:p/>`
- 命中的章节标题行转为 `Heading1`
- 普通正文行转为普通段落

只有当 helper 真正拆出了独立段落时，`index.js` 才继续把该模板正文接入分页和节样式链路。

## 边界

- 不尝试保留原占位符段落的复杂 run-level 样式
- 不处理任意模板中的嵌套表格/文本框占位符
- 不主动重写没有命中章节标题的多行普通段落

## 验证

- `word-layout.test.js` 新增 body placeholder 拆段测试
- `npx vitest run tests/word-layout.test.js`
- `node --check tender/backend/src/word-layout.js`
- `node --check tender/backend/src/index.js`
- `npx vitest run tests/smoke.e2e.test.js -t 'should upload sample then analyze and create draft from generate job'`
