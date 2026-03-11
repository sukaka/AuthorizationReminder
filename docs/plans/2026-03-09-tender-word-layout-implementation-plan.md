# Tender Word 自动精排实现计划

## 目标

完成 `GAP-0012`，让生成与导出链路具备稳定的目录、章节编号、附录后置和页眉页脚兜底能力。

## 实施步骤

1. 先补测试
- 新增 `tender/backend/tests/word-layout.test.js`
- 覆盖：
  - 章节重排与编号
  - 目录内容重建
  - 附录索引生成
  - docx header/footer 自动补齐

2. 新增 helper
- 新增 `tender/backend/src/word-layout.js`
- 输出：
  - `buildWordLayoutPlan`
  - `ensureDocxHeaderFooterBuffer`

3. 接入生成链路
- 在 `tender/backend/src/index.js` 的分析生成主链路中：
  - clause route 后执行 layout plan
  - 用 layout 输出覆盖 `toc_content / appendix_index_content`
  - 透传 `header_content / footer_content / chapter_outline`

4. 接入 docx 写入
- `writeSimpleDocx` 默认补 header/footer
- `writeDocxWithTemplate` 在渲染后补 header/footer
- 模板页眉页脚新增支持：
  - `{{HEADER_CONTENT}}`
  - `{{FOOTER_CONTENT}}`

5. 补前端说明
- 在模板中心提示新增 token
- 说明无 header/footer 时系统会自动兜底

6. 回填状态与回归
- 更新 `tender-gap-backlog.md`
- 更新 `memory/2026-03-09.md`
- 跑：
  - `tests/word-layout.test.js`
  - 目标 smoke
  - `tender.sh`

## 风险控制

- 不覆盖已有模板 header/footer 内容，只在缺失时兜底
- smoke 只验证链路稳定性，不把 AI 文案细节当成强断言
