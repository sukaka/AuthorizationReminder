# Tender Word Odd/Even Style Design

## 背景

当前 `3.8 Word 装配与导出器` 已完成：

- 原生目录域与 `updateFields`
- 章节级分页
- 封面隐藏页码
- 目录前置节 `lowerRoman`
- 正文重新从 1 开始编号

剩余缺口之一是 Word 奇偶页样式。现状只有默认 `header/footer`，没有偶数页独立样式，也没有启用 `w:evenAndOddHeaders`。

## 目标

在不改业务 payload、不重写复杂正文占位符模板的前提下，为默认导出链路和“无正文占位符模板”导出链路补齐最小可用的奇偶页样式能力：

- 启用 `word/settings.xml` 的 `w:evenAndOddHeaders`
- 为文档补齐 `default` 和 `even` 两套 `header/footer` part
- 为所有节补齐 `w:type="default"` 与 `w:type="even"` 的引用
- 默认采用镜像样式，保证奇偶页在 Word 中可区分

## 方案

采用“保守镜像样式”：

- 奇数页页眉：右对齐，内容为现有 `headerText`
- 偶数页页眉：左对齐，内容为现有 `headerText`
- 奇数页页脚：右侧保持“文本 + 页码”
- 偶数页页脚：镜像为“页码 + 文本”

这样不需要新增模板变量，也不需要业务层传入奇偶页独立文案。

## 边界

- 不处理复杂 `{{BID_BODY}}` / `{{CHAPTERS_CONTENT}}` 模板中的节拆分增强
- 不引入 `first` 页专属 header/footer；封面仍依赖 `titlePg` 达到首页不显示页码
- 若模板已自带 `header2.xml/footer2.xml`，只做 token 替换与引用兜底，不主动重写已有设计

## 验证

- `word-layout.test.js` 新增奇偶页样式测试
- `npx vitest run tests/word-layout.test.js`
- `node --check tender/backend/src/word-layout.js`
- `node --check tender/backend/src/index.js`
- `npx vitest run tests/smoke.e2e.test.js -t 'should upload sample then analyze and create draft from generate job'`
