# OIDC 升级工作记录

- 用户明确要求把现有统一登录升级为标准 OAuth2/OIDC 服务。
- 登录服务实际路径 `/Users/zhanglei/Documents/codex-new/auth`，与助手同属父目录 Git 仓库；该路径不在当前可写根中。
- 已使用 engineering-development-process 技能完成代码检查与方案；无生产操作、数据库迁移、版本升级或提交推送。
- 登录目前为自研 JWT + MySQL 会话，业务权限端点 `/api/auth/authorize` 必须保留，不能当成 OAuth 授权端点。
- 存在大量已有未提交修改，包括 auth/index.js、助手 config.py 和 client.ts；不可覆盖。
- 已经授权在 auth 增加 oidc-provider 9.12.2、oidc-config.js / oidc-adapter.js / oidc-service.js / oidc-schema.sql；修改 index.js、Dockerfile、package.json/lock；新增 4 个 oidc 测试文件。业务接口保持兼容，Node 24 镜像，数据库显式迁移未执行。
- 加密 Adapter 使用 AES-256-GCM 并绑定 model/id AAD；授权码原子消费；Grant 绑定原自研会话，账号 sub 保持用户 ID；仅授权码和 S256 PKCE，静态可信客户端。
- 新增助手目录部署覆盖文件及详细 docs/oidc-integration-guide.md。助手前后端客户端迁移尚未实施，已告知用户。
- 最终完整 auth 测试 179 项通过，新 OIDC 套件 10 项通过。权限撤销问题已修复为 access_denied；门户身份失配销毁 OIDC 会话并返回 login_required。明确 revocation allowedPolicy 只允许自己的客户端；公开原生客户端、服务端 Basic 密钥认证、跨客户端撤销隔离均通过。语法及差异检查通过。测试使用显式 Node 24 和授权本地随机端口，不访问真实服务/数据库。
- 后续部署前仍需提供 issuer/客户端/持久密钥、显式建表、HTTPS 代理、隔离环境 MySQL 与真实门户/MFA/客户端联调。没有版本升级、提交、推送或生产操作。助手客户端登录切换尚未实施。
- 后续用户明确授权提交推送：本次 auth 版本升级至 2.2.0，助手版本保持不变；发布仅包含 OIDC 相关文件和 index.js 的四个相关差异块。手动版本校验，避免自动 post-commit 钩子重复或跨系统升版；推送当前 codex/ai-assistant-5.0 分支。其他未提交工作必须保留；不执行真实迁移或部署。
- 发布复核以暂存隔离快照为准：179 项中 176 通过、3 项大屏失败；原 HEAD 对照 169 项中 166 通过、相同 3 项失败，确认非本次回归。OIDC 10 项单独通过；版本、语法和 git diff --cached --check 通过。此前工作区 179 全通过包含其他任务尚未提交的测试修正，未混入本次提交。
