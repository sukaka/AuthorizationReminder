# Tender Word Textbox Split Design

## 背景

上一轮已经把正文占位符拆段改成“按段落原位替换”，表格单元格结构可以保住。但文本框仍然保守跳过，因为 `w:txbxContent` 会带来嵌套 `<w:p>`：

- 外层正文段落里包着 Drawing / VML
- 文本框内容里又有自己的 `<w:p>`

如果直接在整份 `contentXml` 上跑段落 regex，很容易把外层 `<w:p>` 和文本框里的内层 `<w:p>` 匹配串掉。

## 目标

在不引入 XML DOM 解析器的前提下，补一个最小安全支持：

1. 文本框里的多行正文占位符也能拆段
2. 外层段落和文本框容器结构不被打平
3. 继续复用现有章节标题识别与 `Heading1` 提升

## 方案

采用“两段处理”：

### 1. 先抽离 `w:txbxContent`

- 在 `contentXml` 中找到每个 `<w:txbxContent>...</w:txbxContent>`
- 用内部 token 先替换成占位符
- 这样正文层面的段落 regex 不会再看到嵌套 `<w:p>`

### 2. 分别处理

- 对每个 textbox block 的内部 XML，单独跑同一套 paragraph replace 逻辑
- 对去掉 textbox block 之后的正文 XML，再跑正文层 replace
- 最后把处理后的 textbox block 按 token 填回

## 边界

- 只处理 `w:txbxContent`
- 不保证所有 VML/Shape 变体都支持
- 不处理 header/footer 里的 textbox 占位符

## 验证

- `word-layout.test.js` 新增 textbox 场景
- 断言 `w:txbxContent` 保留
- 断言 textbox 内部标题被提升为 `Heading1`
- `npx vitest run tests/word-layout.test.js`
- `node --check tender/backend/src/word-layout.js`
- `node --check tender/backend/src/index.js`
- `npx vitest run tests/smoke.e2e.test.js`
