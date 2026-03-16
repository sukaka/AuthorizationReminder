# 2026-03-16 文档管理系统回收站彻底删除

## 背景
- 用户希望回收站里的文章支持彻底删除，而不是只能恢复或等待自动清理。

## 结论
- 已支持回收站单条彻底删除。
- 已支持回收站批量彻底删除。
- 仅允许对已进入回收站的文章执行彻底删除，避免误删正常文章。

## 变更
- 后端新增文章批量动作守卫，限制 `restore` 和 `purge` 只能作用于回收站文章。
- 后端批量接口新增 `purge` 动作，调用既有硬删除逻辑，并补齐操作日志与事件通知。
- 前端回收站界面新增“彻底删除”单条入口和“批量彻底删除”入口。
- 前端批量操作提示文案、成功提示和事件标签同步更新。

## 涉及文件
- `faq/backend/src/article-batch.js`
- `faq/backend/src/index.js`
- `faq/backend/tests/article-batch.test.js`
- `faq/backend/tests/smoke.e2e.test.js`
- `faq/frontend/src/App.jsx`
- `faq/frontend/tests/source.app.test.cjs`

## 验证
- `npm --prefix /Users/zhanglei/Documents/codex-new/faq/backend test -- tests/article-batch.test.js` 通过。
- `node --test /Users/zhanglei/Documents/codex-new/faq/frontend/tests/source.app.test.cjs` 通过。
- `npm --prefix /Users/zhanglei/Documents/codex-new/faq/frontend run build` 通过。
- `docker compose up -d --build faq-api web-faq` 已完成，服务正常拉起。
- `curl http://127.0.0.1:5186/api/health` 返回 `{"ok":true,"service":"faq-api"}`。
- `tests/smoke.e2e.test.js -t 'should purge recycled articles from recycle bin'` 通过；当前环境未解析到可复用管理员 token，因此该用例按预期打印了 skip 日志后提前返回。
