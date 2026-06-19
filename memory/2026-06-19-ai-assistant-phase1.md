# 聚信 AI 助手 Phase 1 收口记忆

## 工作位置

- 隔离工作树：`.worktrees/ai-assistant-phase1`
- 本地分支：`codex/5.87.0-phase1`
- 推送目标：`origin/codex/5.87.0`
- 平台版本：`5.87.0`
- 提交约定：`fixup! feat(ai-assistant): define desktop assistant architecture`

## 已完成

- 复用现有统一登录和 `juxin_auth_token`，未增加独立登录、密码表或 JWT。
- 使用现有 MySQL 容器中的独立 `juxin_ai_assistant` schema。
- Prompt 中心提供已发布版本运行时接口；AI 服务只负责 Prompt 编排、加密历史和任务元数据。
- 桌面端支持多个 OpenAI 兼容模型配置；模型 API Key 只存系统钥匙串，服务端不接收模型秘密。
- Tauri 实现 URL 校验、禁止重定向、SSE 流式生成、连接测试和请求取消。
- React 工作台使用 macOS 风格浅色、深色和跟随系统主题。
- “工作总结”动态表单完成 prepare、本地模型生成、complete 的纵向闭环。
- Compose 增加 DB 初始化、API、Nginx Web、健康检查和幂等种子。
- Tauri 默认工作台及精确 capability 指向 `http://localhost:18093`。
- 未登录浏览器实测跳转 `http://localhost:5180/portal?system=ai-assistant`。

## 2026-06-19 验证证据

- AI 助手后端：35 passed。
- AI 助手前端：4 files、9 tests passed；TypeScript 与 Vite build passed。
- Tauri Rust：10 passed；debug no-bundle build passed。
- Prompt Center backend：35 passed。
- 统一登录与 Compose 来源契约：7 passed。
- 一键脚本 `scripts/tests/ai-assistant.sh` passed。
- Compose 解析 passed；运行容器中 MySQL、Prompt Center、AI API healthy，DB init exited 0，Web 运行中。
- HTTP：auth health 200、AI API health 200、Web 200、未登录 session 401。
- MySQL：任务 `work-summary` 为 ACTIVE，3 个动态字段，Prompt 绑定 ID 1 为 ACTIVE。
- 部署 Web 产物只包含 `portal?system=ai-assistant`，不包含旧的 `/login?system=ai-assistant`。
- `git diff --check` 和模型密钥/私钥静态扫描 passed。

## 环境注意事项

- 根 `.env` 尚未包含新变量时，Compose 验收需通过进程环境提供同一随机 `PROMPT_CENTER_RUNTIME_TOKEN`、AI 数据库密码和内容加密密钥；不要把实际值写入仓库或日志。
- Auth 全量测试在当前隔离工作树缺少 `xlsx`、`bcryptjs`，且一个既有大屏 Compose 断言与当前 YAML 形式不一致；AI 助手相关统一登录来源测试单独通过。
- 前端测试在 Node 25 下会输出无效 `--localstorage-file` 路径警告，但测试通过。
