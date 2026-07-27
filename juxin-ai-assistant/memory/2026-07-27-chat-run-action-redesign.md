# 2026-07-27 任务详情操作区重设计

## 用户目标

重新设计任务详情中的“重新运行”“继续普通回答”“打开任务中心”三个按钮，解决按钮高而窄、层级不清的问题。

## 根因

`ChatRunContext` 实际只有页头、页签、正文、页脚四个区块，但 `.chat-run-context` 声明了五行网格。页脚落入可伸缩行，被纵向拉满，三个按钮因此呈现为高大的胶囊形。

## 已完成

- 将任务详情网格修正为四行，页脚恢复内容高度。
- “重新运行”调整为强调色主按钮。
- “继续普通回答”调整为次按钮。
- “任务中心”调整为轻量的三级入口，保留“打开任务中心”的无障碍名称。
- 操作按钮使用自适应网格，窄栏空间不足时自动换行。
- 保留原有回调、任务状态和后端契约。
- 增加组件交互与样式契约测试。

## 相关文件

- `apps/desktop/src/components/ChatRunContext.tsx`
- `apps/desktop/src/theme/tokens.css`
- `apps/desktop/tests/chat-run-context.test.tsx`
- `apps/desktop/tests/design-contrast.test.ts`
- `docs/plans/2026-07-27-chat-run-action-redesign.md`

## 验证结果

- 定向测试：2 个测试文件、11 个测试通过。
- TypeScript：`npm run typecheck` 通过。
- 完整前端测试：44 个测试文件、351 个测试通过。
- `git diff --check` 通过。
- Playwright 本地页面截图成功；当前 API 未连接，截图只能验证应用加载和总体布局，失败任务状态由组件测试验证。

## 发布记录

- 用户已授权按功能优化发布，版本由 5.14.1 升级为 5.15.0。
- 提交范围仅包含本次任务操作区改动、测试、方案、记忆与版本发布文件。
- 工作区中用户之前留下的其他未跟踪文件不纳入本次提交。
