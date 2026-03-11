# Tender Word 自动精排设计

## 背景

当前 tender 已具备模板套版、OnlyOffice 编辑和导出能力，但 `GAP-0012` 仍未完成，因为 Word 生成结果还依赖上游章节顺序和模板是否自带页眉页脚，缺少稳定的自动精排层。

现状问题：

- 章节标题不统一，可能缺少稳定编号
- 目录内容依赖上游草稿，缺少最终装配前的统一重算
- 附录/附件类章节没有强制后置
- 无模板或模板未配置 header/footer 时，导出文档缺少统一页眉页脚

## 目标

在不引入重型 Word 引擎的前提下，为现有 docx 输出链路增加一层 deterministic layout：

1. 正文主章节自动编号
2. 自动目录按最终章节顺序重建
3. 附录/附件/资格文件统一后置
4. 模板缺失页眉页脚时自动补默认件
5. 模板存在页眉页脚时支持新 token 透传

## 非目标

- 不实现 Word 原生域目录刷新
- 不做复杂分页控制或节级页码格式
- 不重写 OnlyOffice 协同编辑链路
- 不改变现有模板字段/片段/模板包模型

## 方案

新增后端 helper `word-layout.js`，负责两类事情：

### 1. 章节装配规划

输入：

- `chapters`
- `bidNo`
- `projectName`
- `projectTitle`
- `generatedAt`

输出：

- `chapters`：已重排并补编号后的章节
- `toc_lines / toc_content`
- `appendix_index_lines / appendix_index_content`
- `chapter_outline`
- `header_text / footer_text`

分类规则：

- `COVER`：封面
- `TOC`：目录
- `BODY`：普通正文
- `APPENDIX`：附录、附件、投标文件格式、资格审查资料等

编号规则：

- 正文：`第一章 ...`
- 附录：`附录一 ...`

### 2. docx header/footer 兜底

对已生成的 docx buffer 做结构补齐：

- 模板无 header/footer part 时，自动补 `word/header1.xml` 和 `word/footer1.xml`
- 自动补 `document.xml.rels` 关系
- 自动补 `[Content_Types].xml` override
- 自动在 `sectPr` 中插入 header/footer 引用

如果模板已带 header/footer，则保留原结构；若其中包含：

- `{{HEADER_CONTENT}}`
- `{{FOOTER_CONTENT}}`

则进行替换。

## 接入点

### 分析生成主链路

在 `executeClauseRoutes` 之后、写 docx 之前执行 layout plan：

- 重排章节
- 重写目录内容
- 计算 appendix index
- 生成 header/footer 文案

### 简单 docx 生成

`writeSimpleDocx` 默认调用 header/footer 兜底逻辑。

### 模板 docx 生成

`writeDocxWithTemplate` 在正文渲染后执行 header/footer 兜底逻辑。

## 风险与取舍

- 不强制覆盖已有模板页眉页脚，避免破坏用户模板样式
- 目录仍为文本目录，不依赖 Word 域刷新，稳定性更高
- 附录识别采用规则法，优先满足稳定性，后续再补更复杂语义分类

## 验收

- 章节装配 helper 测试覆盖目录、正文编号、附录后置
- docx 结构测试覆盖 header/footer part 自动补齐
- 生成 smoke 不回退
