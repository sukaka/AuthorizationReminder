# 考试系统与 AI 助手 OIDC 接入

## 目标与范围

仅接入 train-exam、ai-assistant；投标、工单、大屏、提示词中心、FAQ、库存、实施管理、CMDB、设备流程、提醒、交付不改。现有统一登录为 OP，两个应用使用授权码 + S256 PKCE。集中式 BFF 保存加密令牌，浏览器只持有 HttpOnly 会话句柄。保留全局门户会话撤销、MFA、权限和 IP 检查。

## 实施

1. auth 客户端配置、交易状态、回调验证、应用隔离、会话续期及退出。
2. 两个 API 的 OIDC 严格模式、前端登录入口与反向代理。
3. 定向协议测试、Python 测试、前端类型检查与构建。

## 验证命令

- 仓库根：Node 24 `node --test auth/tests/oidc-*.test.js`
- assistant/server：`python3 -m pytest -q tests/test_auth.py`
- assistant/apps/desktop：`npm run typecheck`
- train-exam/frontend：`npm run build`
- 仓库根：`git diff --check`

## 边界与当前状态

源码已实施，部署环境验收待完成。已有未提交改动已保留。本次未执行真实数据库迁移、staging/生产访问、部署、升级版本或提交推送。

## 实施结果

- auth 新增集中式 OIDC BFF，完成 PKCE/state/nonce、ID Token 校验、应用隔离、加密会话、刷新和退出；保留门户撤销、MFA、权限和 IP 检查。客户端交换及续期转发可信入口来源 IP。
- 考试与 AI API 新增显式 OIDC 严格模式；前端切换入口、回调代理和独立 Cookie 配套完成。其他系统不启用该模式。
- 新增 `deploy/oidc/compose.clients.override.yml`，仅显式启用两个应用；配置缺失时拒绝启动。接入、切换和回滚说明见 `docs/exam-ai-oidc-guide.md`。

## 验证结果

- auth：Node 24 `node --test tests/*.test.js`，184/184 通过。
- AI 前端：`npm test -- --reporter=dot`，46 个文件、377/377 通过；`npm run typecheck` 和 `npm run build` 通过。
- 考试前端：`npm run build -- --outDir /private/tmp/juxin-exam-oidc-final-build` 通过；考试后端 `node --check src/index.js` 通过。
- AI 改动的 Python 文件 AST 语法检查通过；`pytest -q tests/test_auth.py tests/test_project_routes.py` 未能启动，本机缺失依赖（最终为 idna），临时安装还遇到 pyexpat 动态库问题。不能视为后端测试通过。
- `git diff --check` 通过。

## 未完成项与下一步

1. 补齐隔离 Python 测试环境，运行 AI 后端定向回归。
2. 在获授权的部署环境配置两个客户端、精确 HTTPS 回调、签名及加密密钥和持久化表，验证代理来源 IP、防止绕过入口直接访问后端。
3. 验证 HTTPS/MySQL、浏览器跨应用登录、续期、权限拒绝、全局退出，以及桌面 WebView 导航和 Cookie。源码测试不替代这些验收。
4. 部署须单独授权；源码提交推送不代表环境验收或部署完成。

## 源码发布授权与门禁

用户随后明确授权「提交推送」。本次仅发布上述源码，不部署或真实迁移。按仓库独立版本规则分两次 feat 提交：auth 预计 2.3.0，考试预计 1.1.0，AI 助手预计 5.19.0；由 post-commit 钩子同步版本并推送。按 hunk 暂存，保留同文件中无关修改及考试 dist 产物。

发布前再次验证：OIDC 定向回归 15/15；版本自动化及桌面版本门禁 62/62。AI Python 回归与部署环境验收限制仍未解除。实际提交及远端结果以 Git 输出为准。

第一阶段已由钩子升至 auth 2.3.0 并推送，最终提交 `44ecf1fb`。第二阶段仅暂存考试与 AI 的 OIDC 源码、测试和接入文档，无关改动仍留在工作区。
