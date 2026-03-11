# Tender Word Nonstandard Heading Heuristic Design

## 背景

当前正文占位符拆段的启发式已经支持：

- `目录`
- `第X章 ...`
- `附录X ...`
- `附件X ...`

但真实标书和模板里，正文结构标题经常不是“第X章”体系，而是：

- `一、项目概况`
- `（一）服务方案`
- `1.1 实施计划`

这些标题如果不在 `pageBreakTitles` 中，当前 helper 仍然会把它们当普通文本。

## 目标

在保持保守的前提下，再补一层常见非标准标题启发式：

1. `一、 / 二、 / 三、`
2. `（一） / （二） / （1）`
3. `1. / 1.1 / 1.1.1`

命中后允许：

- 多行正文拆成独立段落
- 标题提升为 `Heading1`

## 边界

- 不把纯日期/编号误判为标题
- 不处理超长自然语言句子
- 不做多级 Heading1/Heading2 区分，先统一提升为 `Heading1`

## 验证

- `word-layout.test.js` 新增非标准标题测试
- `npx vitest run tests/word-layout.test.js`
- `node --check tender/backend/src/word-layout.js`
- `node --check tender/backend/src/index.js`
- `npx vitest run tests/smoke.e2e.test.js`
