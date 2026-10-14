# 2026-10-14 考试与 AI OIDC 接入

用户将所有系统迁移缩小为考试系统和 AI 助手，其他系统不做。统一登录 OP 已在提交 29681f0 完成；本次需新增 RP 客户端。计划见 docs/plans/2026-10-14-exam-ai-oidc.md。

已实现集中 BFF、考试与 AI 严格 OIDC 模式、前端入口、回调代理及显式客户端 Compose 覆盖。原有其他改动必须保留；未升级版本、提交推送、部署或真实迁移。

最终验证：Node 24 auth 全量 184/184 通过；AI 前端 46 文件 377/377 通过；AI typecheck/build、考试前端临时输出目录 build、考试后端 node --check、AI 改动 Python 文件 AST 语法检查、git diff --check 均通过。AI Python 定向测试未能启动：本机依赖缺失（最终缺 idna），临时安装又因 pyexpat 动态库符号缺失失败；不得声称后端测试已通过。早期考试构建更新了原有 dist 产物，最终构建输出到 /private/tmp，不应将生成物当作部署完成。

架构：auth 中集中 BFF、两个 origin 的回调由 Nginx 代理至 auth；独立应用会话 cookie、加密服务端令牌、PKCE/state/nonce、严格系统绑定、继承门户撤销。刷新仅开放给明确配置的两个 confidential 客户端。两套 API 与 BFF 交换/续期转发可信入口来源 IP；代理需覆盖 X-Real-IP，配置真实入口并阻止后端绕过。AI 桌面使用远程 WebView，需要验证导航策略允许 issuer 路径。

接入手册已完成：docs/exam-ai-oidc-guide.md，涵盖注册、配置、切换、回滚、来源 IP 与 TLS、桌面验收限制；原 docs/oidc-integration-guide.md 已同步更新。下一步是补齐 AI Python 测试环境和获授权后的 HTTPS/MySQL/浏览器与桌面联调；本轮不得自行部署、迁移、升版、提交推送。具体结果和未完成项已写入方案文件。

随后用户明确授权提交推送，解除此前源码升版和 Git 发布限制，但未授权部署或真实迁移。发布门禁：OIDC 15/15、版本自动化与桌面版本 62/62 通过。计划独立 feat 提交 auth 配套与共享代理（2.3.0），随后提交考试及 AI 接入（1.1.0、5.19.0），由钩子升版和推送；必须选择混合文件中的 OIDC hunk，不提交其他未完成工作。Python 回归和环境验收仍待完成，实际发布结果须从 Git 核实。

第一阶段最终提交为 44ecf1fb，auth 已升为 2.3.0，钩子确认推送 origin/codex/ai-assistant-5.0。第二阶段考试和 AI 的 OIDC 改动已选择性暂存，准备由钩子升版和推送；其他用户改动未暂存。
