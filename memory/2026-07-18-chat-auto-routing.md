# 2026-07-18 聊天自动路由减操作

## 用户目标

让同事只需要输入问题，系统自动判断合适的专业助手，减少进入聊天后的模式选择操作；手动助手仍作为异常或专业场景的兜底。

## 已完成

- 聊天页默认模式为 `auto`。
- 新会话、切换工作区、开始新会话都会恢复自动路由。
- 手动助手列表收进“切换助手”二级入口，保留原有模式值和接口契约。
- 服务端返回 `effective_mode`、`routing_reason`、`routing_confidence` 时仍记录路由结果；路由原因保留在“自动路由”控件的 `title` 中，不占用聊天顶部布局。
- 自动路由默认控件只展示“自动路由”和“切换助手”，不再显示“助手”、图标或“发送问题后自动识别”。
- 控件已压缩高度、内边距和最小宽度，避免背景框覆盖聊天窗口。
- 每次自动路由请求开始前清除上一次路由提示，避免提示残留。
- 修复“切换助手”菜单不可见：顶部操作条的横向滚动规则会裁剪纵向下拉菜单，已改为允许溢出显示。

## 修改文件

- `juxin-ai-assistant/apps/desktop/src/pages/ChatPage.tsx`
- `juxin-ai-assistant/apps/desktop/src/theme/tokens.css`
- `juxin-ai-assistant/apps/desktop/tests/chat-page.test.tsx`
- `juxin-ai-assistant/docs/plans/2026-07-18-chat-auto-routing-plan.md`
- `juxin-ai-assistant/docs/plans/2026-07-18-chat-assistant-menu-fix.md`

## 验证结果

- `npm run test -- tests/chat-page.test.tsx`：54 项通过。
- `npm run typecheck`：通过。
- `git diff --check`：通过。

本次菜单修复后，聊天页测试仍为 54 项通过，类型检查和差异检查通过。

## 当前限制与下一步

本次只改聊天入口交互，不改变后端路由算法或生产配置。下一步应使用真实业务问题做一轮路由命中率和低置信度统计，再决定是否调整规则；未获得明确授权前不提交、不推送。
