# 2026-07-26 聊天页释放右侧空间

## 用户目标

删除重复任务进度框后，让“我的问题”和“任务详情”使用原最右侧空出来的区域，避免聊天工作区中间拥挤、右侧大面积留白。

## 根因

`.chat-page.has-chat-content .chat-content-grid` 仍保留旧任务进度栏对应的 `margin-right: 236px`，并通过 `calc(100% - 284px)` 缩窄主内容区。旧进度栏删除后，这段固定占位没有同步移除。

## 实施决定

- 桌面端内容宽度改为 `min(1320px, calc(100% - 48px))`。
- 使用 `margin-inline: auto` 保持正常左右边距。
- 不改变任务详情面板本身的宽度，不修改输入框和窄屏布局。
- 用 CSS 测试锁定新契约，防止旧占位回归。

## 修改文件

- `apps/desktop/src/theme/tokens.css`
- `apps/desktop/tests/design-contrast.test.ts`
- `docs/plans/2026-07-26-chat-layout-reclaim-right-space.md`

## 验证

- 目标测试：6/6 通过。
- TypeScript 类型检查：通过。
- 前端完整测试：44 个文件、349 个用例通过。
- 本地前端：`http://localhost:18093/` 已启动；API 未启动，真实聊天状态需在服务恢复后刷新查看。
