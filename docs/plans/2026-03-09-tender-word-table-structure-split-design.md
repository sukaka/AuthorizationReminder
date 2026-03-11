# Tender Word Table Structure Split Design

## 背景

当前 `ensureDocxLogicalParagraphsBuffer` 对正文占位符的拆段逻辑是：

1. 从 `word/document.xml` 里全局匹配所有 `<w:p>`
2. 把命中的多行段落拆成新的 `<w:p>`
3. 最后把所有段落重新 `join` 回 body

这个做法对纯段落文档可用，但在表格模板里有明显风险：

- `<w:tbl> / <w:tr> / <w:tc>` 容器会被平铺丢失
- 表格内正文占位符一旦触发拆段，整张表结构可能被破坏

## 目标

在不引入完整 XML 解析器的前提下，先把“表格容器不丢失”这个高价值缺口补上：

1. 表格单元格里的正文占位符段落可以安全拆段
2. `w:tbl / w:tr / w:tc` 包裹结构必须保留
3. 现有 plain body / page break / section helper 行为不回退

## 方案

把 `ensureDocxLogicalParagraphsBuffer` 从“全局抽取再重组 body”改成“按段落原位替换”：

- 仍然只处理 `<w:p>` 级别
- 但直接在原始 `contentXml` 上做 regex replace
- 单个段落若满足拆段条件，就把这个段落替换为多个新段落 XML
- 周围的表格/单元格标签保持原样

这样不需要理解整个表格结构，只要保证替换范围局限于当前段落即可。

## 非目标

- 不处理文本框中的嵌套 `<w:p>` 问题
- 不引入真正的 XML DOM 解析
- 不重写表格样式、单元格样式或段落样式继承

## 验证

- `word-layout.test.js` 新增表格单元格中的正文占位符拆段测试
- 断言拆段后仍保留 `w:tbl / w:tc`
- `npx vitest run tests/word-layout.test.js`
- `node --check tender/backend/src/word-layout.js`
- `node --check tender/backend/src/index.js`
- `npx vitest run tests/smoke.e2e.test.js`
