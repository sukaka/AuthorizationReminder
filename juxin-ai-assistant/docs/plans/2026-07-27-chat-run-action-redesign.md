# 任务详情操作区重设计

## 目标

- 修复任务详情底部操作区被纵向拉伸的问题。
- 明确失败后的主操作、次操作和任务中心入口层级。
- 保持现有点击行为、系统配色和窄栏响应式能力。

## 根因

`ChatRunContext` 当前只有“页头、页签、正文、页脚”四个区块，但容器声明了五行网格。页脚因此落入 `minmax(0, 1fr)` 行并被拉伸，三个按钮随之变成高而窄的胶囊形状。

## 改动范围

- `apps/desktop/src/components/ChatRunContext.tsx`
- `apps/desktop/src/theme/tokens.css`
- `apps/desktop/tests/chat-run-context.test.tsx`
- `apps/desktop/tests/design-contrast.test.ts`

## 设计决定

- “重新运行”使用主按钮层级。
- “继续普通回答”使用次按钮层级。
- “打开任务中心”保留完整无障碍名称，界面显示缩短为“任务中心”，使用轻量入口样式。
- 执行操作使用自适应双列，任务中心独占下一行；空间不足时自动换行。
- 不修改回调、任务状态和后端接口。

## 验证命令

```bash
npm test -- --reporter=dot tests/chat-run-context.test.tsx tests/design-contrast.test.ts
npm run typecheck
npm test -- --reporter=dot
git diff --check
```
