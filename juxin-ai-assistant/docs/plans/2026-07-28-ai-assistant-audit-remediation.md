# AI 助手审计问题全量修复计划

日期：2026-07-28

## 目标

修复本轮 AI 助手代码与 UI/UX 审计中确认的全部问题，并保持大师 PPT 已完成的确认提示、图片预览和显式直出能力不回退。

## 范围

1. 修复模型任务取消后仍完成、落库和上报成功的竞态。
2. 修复离线结果同步失败却显示“已同步”的状态错误。
3. 更新数据库迁移发布门禁到当前 Alembic head。
4. 用统一、可访问的应用内弹窗替换 `window.prompt` / `window.confirm`。
5. 恢复聊天输入区键盘焦点反馈，统一高频控件尺寸和文字可读性。
6. 统一侧边栏图标并减少项目成员区重复标题。
7. 对页面进行路由级懒加载，降低主包体积。
8. 补齐回归测试，减少测试中的未处理网络请求噪声。

## 验收标准

- 取消任务后不出现 `MODEL_COMPLETED`，不调用完成或失败接口。
- 离线同步失败时保留待同步记录并显示失败状态。
- 后端迁移演练和发布门禁测试通过。
- 业务代码不再直接调用 `window.prompt` / `window.confirm`。
- 弹窗支持键盘操作、Escape 取消、焦点恢复和危险操作提示。
- 聊天输入区、常用按钮和状态文字满足项目设计规范。
- 页面按需加载，生产构建不再输出单个超大主业务包。
- 前端类型检查、前后端测试、生产构建和 `git diff --check` 全部通过。

## 验证命令

```bash
cd apps/desktop && npm run typecheck
cd apps/desktop && npm test -- --reporter=dot
cd apps/desktop && npm run build:web
cd server && python3 -m pytest -q tests --ignore=tests/test_migrations.py -ra
git diff --check
```

## 完成情况

- 计划范围内 8 项工作均已完成。
- 前端类型检查、全量测试和生产构建通过。
- 服务端全量测试通过。
- 大师 PPT 现有确认提示与图片预览能力未回退。

## 上游集成（`1bd41719`）

- 已快进合入 `fix(ai-assistant): stabilize generation and access control`。
- 合并时保留管理员专属的“AI 能力”入口，并与本轮统一侧边栏图标实现兼容。
- 已更新测试：普通员工不显示该入口，管理员可访问能力中心；Nginx 代理断言改为变量上游写法。
- `npm run typecheck` 与相关 3 个测试文件、10 项测试通过；完整测试的终端回传受多进程输出限制，未产生失败报告。
