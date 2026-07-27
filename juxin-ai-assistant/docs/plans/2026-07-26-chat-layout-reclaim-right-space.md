# 聊天页释放右侧空间

## 目标

删除旧任务进度栏后遗留的桌面端右侧固定占位，让用户问题、回答区域和任务详情面板重新利用完整聊天工作区。

## 范围

- 仅调整聊天页已有内容状态下的桌面端布局。
- 保持任务详情面板宽度、输入框宽度和窄屏单列行为不变。
- 增加 CSS 回归断言，防止再次引入旧进度栏的固定占位。

## 验收标准

- 聊天内容区不再保留 `236px` 的右侧空白。
- 用户问题和任务详情整体向右展开，左右使用一致的页面边距。
- `1280px` 以下的单列布局和 `760px` 以下的移动端布局不受影响。

## 验证命令

```bash
cd apps/desktop
npm test -- --reporter=dot tests/design-contrast.test.ts
npm run typecheck
npm test -- --reporter=dot
cd ../..
git diff --check
```

## 实施结果

- 将已有聊天内容时的工作区宽度从 `calc(100% - 284px)` 调整为正常的 `calc(100% - 48px)`。
- 删除旧任务进度栏遗留的 `margin-right: 236px`，改为桌面端左右自动居中。
- 用户问题随主内容列向右延展，任务详情面板使用释放后的右侧空间。
- 保持 `1280px` 以下单列和 `760px` 以下移动端规则不变。
- 新增 CSS 回归测试，明确禁止重新引入 `284px` / `236px` 旧占位。

## 验证结果

- `npm test -- --reporter=dot tests/design-contrast.test.ts`：通过，6 个用例。
- `npm run typecheck`：通过。
- `npm test -- --reporter=dot`：通过，44 个测试文件、349 个用例。
- 本地前端已启动于 `http://localhost:18093/`；当前 API 未启动，因此浏览器只能进入服务不可用页，未进行带真实聊天数据的页面截图验收。
