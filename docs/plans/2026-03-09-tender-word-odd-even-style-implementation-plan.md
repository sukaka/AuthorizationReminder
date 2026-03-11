# Tender Word Odd/Even Style Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Word 导出链路补齐奇偶页页眉页脚样式，且不改变现有业务 payload。

**Architecture:** 在 `word-layout.js` 的 header/footer 注入层扩展 `even` part、节引用和 `settings.xml` 开关。`index.js` 不新增业务字段，只继续复用现有 `headerText/footerText`。测试先覆盖最小 docx buffer 的结构变化，再做现有回归验证。

**Tech Stack:** Node.js, PizZip, Vitest, DOCX XML

---

### Task 1: 写失败测试

**Files:**
- Modify: `tender/backend/tests/word-layout.test.js`

**Step 1: 新增奇偶页样式测试**

- 断言 `word/settings.xml` 含 `w:evenAndOddHeaders`
- 断言 `document.xml` 含 `w:type="default"` 和 `w:type="even"` 的 `headerReference/footerReference`
- 断言 `header2.xml/footer2.xml` 已生成
- 断言奇偶页 XML 至少有对齐或内容镜像差异

**Step 2: 运行测试确认失败**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

Expected: 新增 odd/even 相关断言失败。

### Task 2: 实现最小 odd/even 样式

**Files:**
- Modify: `tender/backend/src/word-layout.js`

**Step 1: 扩展 settings helper**

- 增加 `w:evenAndOddHeaders` 注入 helper

**Step 2: 扩展 header/footer helper**

- 支持生成 `default` 与 `even` 两套 part
- 支持镜像对齐和镜像页脚内容
- 支持模板已有 part 时只做 token 替换

**Step 3: 扩展节引用兜底**

- 给每个 `sectPr` 补齐 `default/even` 引用
- 保持重复执行幂等

### Task 3: 验证与同步文档

**Files:**
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-09.md`

**Step 1: 跑验证**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`
Run: `node --check tender/backend/src/word-layout.js`
Run: `node --check tender/backend/src/index.js`
Run: `cd tender/backend && ADMIN_PASSWORD='***' ADMIN_LOGIN='admin' AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5187' npx vitest run tests/smoke.e2e.test.js -t 'should upload sample then analyze and create draft from generate job'`
Run: `cd tender/backend && ADMIN_PASSWORD='***' ADMIN_LOGIN='admin' AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5187' npx vitest run tests/smoke.e2e.test.js`

**Step 2: 更新状态**

- backlog 的 `3.8` Done 补充奇偶页样式
- memory 记录本轮设计、实现和验证结果
