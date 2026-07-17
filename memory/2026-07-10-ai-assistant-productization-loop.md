# 聚信 AI 助手产品化闭环续做记忆

## 目标

完成 `juxin-ai-assistant/docs/superpowers/plans/2026-07-09-codex-like-ai-assistant-productization-loop-plan.md`。

## 已完成

- Phase 1：任务执行闭环，提交 `87be9979`。
- Phase 2：引用来源治理，提交 `2255e4b8`。
- Phase 3：工作成果中心，版本 `1.22.0`，提交 `a7c95730`。
- Phase 7：HTTPS/IP Web 部署闭环，版本 `1.23.0`，提交 `1063fa4a`，已推送。
- Phase 4：长任务队列与失败恢复，版本 `1.24.0`，提交 `25d4e721`，已推送。
- Phase 5：质量看板与运行回放，版本 `1.25.0`，提交 `6a7c18f4`，已推送。
- Phase 6：助手模式治理，版本 `1.26.0`，提交 `83ddff8b`，已推送。
- 最终验收补强：版本 `1.27.0`，提交 `0210052a`，已推送。

## Phase 7 关键改动

- Web 未配置登录地址时使用当前 Origin；桌面端保留本地开发回退。
- Docker Web 构建注入 `VITE_AUTH_PUBLIC_URL`。
- 新增 `docker-compose.ai-assistant-https.yml`，统一 Web、API、Auth Origin，只开放 443。
- 新增 TLS Nginx 网关，代理 `/portal`、`/api/auth/*` 和 Web/API。
- 新增 `/api/ai/health`。
- 部署文档包含 IP SAN 自签证书、Windows/macOS/Linux 信任步骤。

## 验证

- 后端 32 个相关测试通过。
- 前端 24 个相关测试通过。
- TypeScript typecheck、Web build、Docker Compose config、`nginx -t` 通过。
- 临时 TLS 网关：主页 200、登录页 200、未登录 session 401；容器已删除。

## Phase 4 关键改动

- `ai_long_tasks` 持久化任务；请求和草稿加密。
- 创建、列表、详情、取消、重试 API，严格用户隔离和消息归属校验。
- 流式草稿恢复点、失败保留、重试续写、进程重启恢复。
- 运行中取消会取消外部模型协程。
- Web 聊天页“后台处理”与右下任务浮层。
- 验证：后端 69、前端 48、typecheck、Web build 通过。

## 最终验收补强

- 工作成果新增类型和起止日期 API/页面筛选。
- 质量看板新增引用准确率、用户负反馈率。
- 内测评估集从 10 条扩到 20 条，并为新增场景配置非空上下文断言。
- 任务页和聊天页检测敏感内容后必须显式确认；审计只记录 `risk_confirmation`。
- 新助手模式、桌面更新加入普通员工越权矩阵。
- OpenAPI 密钥边界更新：仅用户模型配置请求允许接收 `api_key`，响应永不返回密钥。
- 方案所有检查项和完成定义已勾选。

## 最终验证

- 后端：`566 passed`，零警告。
- 前端：`239 passed`。
- Rust/Tauri：`126 passed`。
- TypeScript typecheck、Web build、HTTPS Docker Compose config 通过。
- 当前版本：AI 助手 `1.27.0`；根版本 `5.153.0`。

## 剩余

- 方案目标已完成；远端 `origin/codex/task-execution-loop-phase1` 与本地 HEAD 均为 `0210052a`。
- 等待用户选择合并、创建 PR 或保留分支。
