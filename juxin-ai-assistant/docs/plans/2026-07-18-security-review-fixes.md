# 2026-07-18 安全/UI审查修复计划

## 目标

按照 `docs/code-review-2026-07-17-security-bugs-ui.md` 修复当前分支中可安全落地的 P0/P1，并处理低风险的 P2 鉴权与同源边界问题；保持现有版本号，不提交、不推送。

## 实施范围

- P0：收紧用户自定义模型端点；声明并校验飞书/企微 Webhook 密钥；为机器入站路径建立 Origin 例外并保留路由签名校验；修复飞书空 token 校验。
- P1：知识库文件按公司/部门/项目/管理员范围真实过滤；出域策略故障时 fail-closed；保护调试端点；桌面 SSO logout 清理 token 并使用统一请求封装。
- P2：下载与出站 URL 同源校验、知识库下载携带认证、CORS 请求头补齐；保护 H5 文档弹层键盘焦点、错误展示和 Enter 提交；把空状态示例改为可点击按钮。
- 低风险 P3：统一管理员角色别名判断、避免模型配置失败后残留用户气泡、降低 contentEditable 重渲染导致的光标跳动。

## 已完成与验证

- 新增自定义模型端点安全校验、管理员角色别名和管理员范围文件 owner 绕过回归覆盖；复用现有渠道、知识库、会话和出域测试。
- 后端重点回归：`123 passed`；桌面端 `npm run typecheck` 通过；微信 H5 `npm run typecheck` 通过；`git diff --check` 通过。
- 未修改 `VERSION`，未执行 commit/push。

## 本轮专项收尾（2026-07-18）

- `auth_dev_bypass`：增加生产/预发布与非 loopback 应用公开地址的启动拒绝，并在认证路径保留运行时 fail-closed 检查。
- 压缩包炸弹：DOCX 解析复用知识库归档预算，限制条目数、单条目大小、总解压大小和压缩比。
- Agent Hub 出站 URL：HTTP Agent 默认关闭；启用时要求 HTTPS、精确域名白名单，并在 DNS 解析后拒绝私网、回环、链路本地和元数据地址；路由与注册表双重校验。
- 更新流：限制 storage key 格式，Range 下载改为固定块流式响应，避免一次性把大文件读入内存。
- sessionStorage 会话加固：桌面 SSO token 改为 URL 回调后仅保存在内存，401/logout 会清理，不再从 `sessionStorage` 恢复。
- 验证：专项后端回归 `62 passed`；附件/更新/Agent/认证相关重点回归 `60 passed`；桌面 `npm run typecheck` 与 session 测试 `15 passed`；`git diff --check` 通过；版本号未改变，未 commit/push。按 `server/` 工作目录补跑目录测试 `36 passed`；其余 4 个失败为既有的 Agent runtime、企业查询计划和网页搜索基线失败，未改动。

## 仍需后续专项

- 更新下载接口目前仍保留公开下载模型，后续如需私有更新包，应增加短时签名 URL 或登录态鉴权；本轮先完成 key/range/流式内存边界。
- 全量管理路由权限审计已在本地完成；生产发布前仍需在真实授权环境复核统一登录授权、目标库范围和审计留痕，不能以本地静态门禁替代。
- 生产启用自定义模型端点前，必须配置 HTTPS 精确域名白名单；启用飞书/企微渠道前，必须配置对应正式密钥，不能依赖开发旁路。

## 2026-07-19 管理路由权限审计收尾

- 统一 `admin`、`superadmin`、`sys_admin`、`platform_admin` 四种平台管理员角色别名；管理路由不再使用精确 `role == "admin"` 判断。
- 逐一核对 `server/app/admin/*_routes.py` 及运营、学习、知识库、技能、Agent Hub、渠道任务等敏感路由；管理处理器均经过 `require_action("ai_assistant:admin")` 或受其保护的本地管理员 helper。
- 新增 `tests/test_admin_route_auth_audit.py` 静态审计门禁，覆盖管理路由 guard 和所有 AST 可识别的精确角色比较回归；权限定向回归 `92 passed`，静态审计与认证回归 `16 passed`。
- 本专项仅完成代码、测试和本地证据；真实 staging/production 登录、授权服务、迁移、密钥、灰度与正式发布仍按外部发布边界执行。
