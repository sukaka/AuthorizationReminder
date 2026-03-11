# Tender Word 节级页码样式增量设计

## 背景

当前 tender 的 Word 导出已经具备：

- 原生目录域
- 章节级起新页分页
- 页眉页脚兜底

但页码样式仍然偏弱：

- 默认兜底页脚只有文本，没有 Word 原生页码域
- 有封面时，正文页码不能稳定从 1 重启
- 分页虽然已做，但“封面不显示页码、目录/正文重新编号”还没有独立能力

## 目标

在不引入完整排版引擎的前提下，补一层最小可用的节级页码样式：

1. 默认 footer 自动带 PAGE 域
2. 有封面时，封面页默认不显示页码
3. 目录/正文所在节从 1 开始重新编号
4. 基础导出和“无正文占位符模板”导出都能复用这层能力

## 非目标

- 不实现奇偶页不同页脚
- 不实现罗马数字目录页码
- 不实现复杂模板正文内部的节拆分
- 不处理已有自定义 footer 模板的深度重写

## 方案

### 1. 默认 footer 增加 Word PAGE 域

在 `word-layout.js` 中把默认 footer XML 改为：

- `FOOTER_CONTENT`
- `第 PAGE 页`

只对“模板缺少 footer part”的兜底路径生效，不覆盖已有模板 footer。

### 2. 新增 section 级页码 helper

新增 `ensureDocxSectionPageNumberBuffer(buffer, options)`：

- 若文档中存在封面和目录边界：
  - 在目录前的上一段落插入 section break
  - 第一节开启 `titlePg`，使封面第一页不显示页码
  - 第二节在最终 `sectPr` 中补 `w:pgNumType w:start="1"`
- 若无封面：
  - 只保证最终节的 `pgNumType start=1`

### 3. 与已有分页 helper 的配合

执行顺序：

1. header/footer 兜底
2. TOC 注入
3. 章节分页注入
4. section 级页码样式注入

其中第 4 步会在“封面 -> 目录”边界发现已插入的 page break 时，将其吸收为 section break，避免空白页。

## 风险与取舍

- 仅对系统可控的默认 footer 与追加章节场景增强，不重写用户已有复杂模板页脚
- 节拆分只锚定“封面 -> 目录”边界，不对正文内部章节做多节分页，避免 XML 复杂度失控
- 目录页和正文当前共享同一节编号，先保证“封面无页码 + 目录/正文从 1 开始”

## 验收

- `word-layout.test.js` 覆盖：
  - 默认 footer 含 PAGE 域
  - 有封面时文档含两个 `sectPr`
  - 第一节有 `titlePg`
  - 最终节有 `pgNumType start=1`
  - 重复执行不重复插入
- 目标 smoke 与全量 smoke 通过
