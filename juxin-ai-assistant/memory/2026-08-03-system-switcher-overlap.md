# 2026-08-03 AI 助手系统切换菜单遮挡修复

## 用户问题

AI 助手 Web 端点击“切换”后，系统列表向侧栏右侧展开，被侧栏边界裁剪，部分系统名称和链接无法看到或点击。

## 根因

`apps/desktop/src/theme/styles/15-app-shell.css` 中 `.sidebar` 使用 `overflow: hidden`，而 `.system-switch-menu` 使用绝对定位并以 `left: 0` 对齐切换器。切换器靠近侧栏右侧时，菜单会越过侧栏边界并被裁掉；侧栏自身还是 sticky stacking context，主内容区也可能覆盖浮层。

## 修改

- `.sidebar` 使用 `overflow: visible` 和 `z-index: 20`，允许浮层显示并提升到主内容区之上。
- `.system-switcher` 增加 `z-index: 40`。
- `.system-switch-menu` 改为 `right: 0; left: auto`，向左展开并贴合侧栏右边缘。
- 系统菜单增加 `max-height: min(70vh, 520px)`、`overflow-y: auto`，系统较多时在菜单内部滚动。
- `apps/desktop/tests/proxy-config.test.ts` 增加 CSS 回归断言。

## 验证

- `npm run typecheck`：通过。
- CSS 静态断言：通过。
- `git diff --check`：通过。
- Vitest 启动被本机缺失 `@rolldown/binding-darwin-x64` 阻断；未删除 `node_modules`、未重装依赖、未修改锁文件。

## 约束

本轮只修复系统切换菜单显示和交互可达性，不改系统授权或跳转 URL。提交前同步了既有 AI 助手版本声明漂移，根仓库 post-commit 钩子会按 `fix` 规则将 5.17.0 自动升为 5.17.1 并推送。
