# 统一登录 OAuth2/OIDC 升级

## 目标和边界

把同仓库 `auth/` 统一登录升级为 OIDC Provider，沿用账号、MFA、会话和应用授权。OAuth 授权端点与现有业务 `/api/auth/authorize` 分离。采用成熟协议库、授权码和 PKCE，禁止隐式流程及密码授权。

保留旧客户端兼容；不得自动迁移真实数据库或访问生产。2026-10-14 用户明确授权提交推送，本次仅升级 auth 版本到 2.2.0；助手版本不变。已有未提交改动必须保留。聚信助手客户端接入需独立验证，不能以协议端点上线代替登录闭环验收。

## 实施范围

- `../auth/`：依赖、配置、持久化、交互、协议测试和部署配置。
- 后续客户端阶段（本次未实施）：助手后端/前端标准授权码登录、state/nonce/PKCE、可信 issuer 校验、HttpOnly 会话。
- 文档：安装步骤、密钥管理、客户端注册、回滚和验证证据。

## 验收与验证命令

- `node --test tests/oidc*.test.js`（auth 目录）：发现、JWKS、授权码、PKCE、重放和安全配置。
- `python3 -m pytest -q tests/test_auth.py tests/test_oidc.py`（server 目录）：客户端回调和权限兼容。
- `npm run typecheck`、相关 Vitest（apps/desktop）：登录跳转与 URL Token 清理。
- `git diff --check`：差异格式校验。

## 当前状态

2026-10-14：已通过授权操作实现 auth Provider：oidc-provider 9.12.2、严格配置、加密 MySQL Adapter、授权码/S256 PKCE、会话和应用授权绑定、发现/JWKS/UserInfo/撤销端点、Node 24 镜像及显式建表 SQL。保留旧接口；未执行真实迁移、部署、版本升级或 Git 发布。

最终完整 auth 测试 179 项通过，其中新增 OIDC 10 项通过；index.js、oidc-service.js 语法检查通过，git diff --check 通过。通过 RED/GREEN 修复了权限撤销和失效门户会话：分别返回 access_denied / login_required，避免缺失账号导致协议库访问空 Grant。补验服务端 Basic 认证、错误密钥拒绝和跨客户端撤销隔离，均通过。

已新增 docs/oidc-integration-guide.md 和 deploy/oidc/compose.override.yml。助手客户端登录切换尚未实施，不属于本次 Provider 完成声明；真实 MySQL、反向代理 HTTPS、门户交互和客户端联调仍待部署环境验收。

## 授权发布

- 版本：auth/VERSION、package.json 和 package-lock.json 同步 2.1.0 → 2.2.0。
- 仅提交 OIDC 实现、测试、部署覆盖和说明；index.js 仅暂存四个 OIDC 相关差异块，保留已有管理页面改动。
- 发布验证：暂存快照 auth 全量 Node 测试、语法、版本一致性、git diff --cached --check。
- 本次手动同步并校验版本，以 CODEX_VERSIONING_BYPASS=1 避免 post-commit 自动重复升版和跨系统升版；保留 commit-msg、pre-push 检查，显式提交推送当前分支。
- 不执行数据库建表、部署或助手客户端登录切换。
- 发布复核结果：待提交隔离快照 179 项中 176 项通过、3 项失败；原 HEAD 隔离快照 169 项中 166 项通过，同样 3 项大屏历史失败（权限预期两项、Compose 构建参数预期一项），无新增失败。OIDC 10 项单独通过。最初快照缺少 server 的 xlsx 依赖导致导入测试失败，补齐本地依赖路径后该项通过。版本 2.2.0 一致性、minor 递增、语法和暂存差异检查通过。
