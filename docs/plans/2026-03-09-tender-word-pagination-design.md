# Tender Word 章节级分页增量设计

## 背景

当前 tender 的 Word 导出已经具备：

- 章节重排与统一编号
- 原生目录域与 `updateFields`
- 页眉页脚兜底

但导出的分页仍然过于平铺，主要问题是：

- 目录、正文第一章、后续章节、附录之间缺少稳定起新页
- 无正文占位符模板在追加章节时，章节边界仍然依赖连续段落堆叠
- 分页规则没有独立 helper，后续继续增强会越来越难测

## 目标

在不引入复杂节级版式引擎的前提下，补一层稳定的章节级分页规则：

1. 除首章外，后续章节默认起新页
2. 有封面时，目录自动起新页
3. 正文各章、附录各章都按章节边界起新页
4. 支持基础导出和“无正文占位符模板”的追加章节导出
5. 分页注入保持幂等，不重复插入 page break

## 非目标

- 不实现节级页码样式切换
- 不实现奇偶页、装订边、章首页不同页眉
- 不强拆复杂 `{{BID_BODY}}` / `{{CHAPTERS_CONTENT}}` 模板正文

## 方案

### 1. 在 `buildWordLayoutPlan` 中补分页计划

基于归一化后的 `normalizedChapters` 输出：

- `page_break_titles`

规则：

- 第一章之前不插分页
- 从第二个归一化章节开始，凡是章节标题都列入 `page_break_titles`

这样天然覆盖：

- `封面 -> 目录`
- `目录 -> 第一章`
- `第一章 -> 第二章`
- `正文末章 -> 附录一`

### 2. 新增 docx 分页 helper

在 `tender/backend/src/word-layout.js` 新增：

- `ensureDocxPageBreakBeforeHeadingsBuffer(buffer, { headings })`

行为：

- 扫描 `word/document.xml` 的段落序列
- 在命中的章节标题段落前补 `<w:br w:type="page"/>`
- 如果前一段已经是 page break，则跳过，保证幂等

### 3. 接入导出链路

#### 基础导出

`writeSimpleDocx` / `buildSimpleDocxBuffer` 接收：

- `pageBreakTitles`

执行顺序：

1. 页眉页脚兜底
2. 原生目录域注入
3. 章节分页注入

#### 模板导出

仅对“系统追加章节正文”的模板启用分页注入：

- `!hasBodyPlaceholder`

原因是这类模板的章节标题和内容由系统控制，能稳定匹配标题文本。

对复杂正文占位符模板继续保守，不强行重写已有正文结构。

## 验收

- `word-layout.test.js` 覆盖：
  - `page_break_titles` 生成
  - page break 注入位置
  - 重复执行不重复插入
- 目标 smoke 与全量 smoke 回归通过
