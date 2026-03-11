# Tender Word 前置页码样式增量设计

## 背景

当前 tender Word 导出已经支持：

- 默认 footer 的 `PAGE` 域
- 封面隐藏页码
- 目录/正文节从 1 开始

但前置页码样式还不完整：目录与正文仍共用同一节的阿拉伯数字页码，没有形成更常见的“前置页码 + 正文页码”分离。

## 目标

在当前 section helper 的基础上，再向前推进一小步：

1. 封面仍不显示页码
2. 目录所在前置节使用 `lowerRoman`
3. 正文/附录所在主体节用阿拉伯数字，并从 1 重新开始
4. 仅在系统可控的导出链路启用，不强改复杂模板正文

## 非目标

- 不实现奇偶页不同页脚
- 不实现多级前置页码体系
- 不对复杂 `{{BID_BODY}}` / `{{CHAPTERS_CONTENT}}` 模板强拆正文节

## 方案

### 1. 扩展 section helper

将现有 `ensureDocxSectionPageNumberBuffer` 扩展为三节模型：

- 节 1：封面
  - `titlePg`
  - 不显示页码
- 节 2：目录/前置部分
  - `pgNumType start=1 fmt=lowerRoman`
- 节 3：正文/附录
  - `pgNumType start=1`

### 2. 边界识别

使用系统已知标题：

- `coverHeading`: `封面`
- `restartHeading`: `目录`
- `bodyStartHeading`: 第一条非目录的正文/附录标题

helper 会吸收原本的 page break 段落，把：

- `封面 -> 目录`
- `目录 -> 第一章/附录`

转成真正的 section break。

### 3. 接入点

- `buildSimpleDocxBuffer`
  - 根据 `pageBreakTitles` 派生 `bodyStartHeading`
- `writeDocxWithTemplate`
  - 仅对 `!hasBodyPlaceholder` 模板启用

## 验收

- `word-layout.test.js` 覆盖：
  - 三个 `sectPr`
  - `titlePg`
  - `lowerRoman`
  - 正文 `start=1`
  - 重复执行不重复注入
- 目标 smoke 与全量 smoke 通过
