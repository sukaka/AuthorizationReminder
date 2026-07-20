# 2026-07-18 安全审查修复记忆

- 任务：按照 `juxin-ai-assistant/docs/code-review-2026-07-17-security-bugs-ui.md` 修复安全与 UI 问题。
- 约束：保持版本号，不 commit/push；保留审查文档和既有未跟踪记忆文件。
- 已完成：模型端点 HTTPS/精确白名单/私网解析拒绝、飞书/企微密钥与签名校验、机器入站 Origin 例外、知识库范围过滤、出域 fail-closed、调试端点保护、桌面 SSO 清理、同源下载与 CORS 收紧。
- 已完成的低风险修复：统一管理员角色别名、模型配置失败回滚孤儿气泡、H5 文档弹层焦点/关闭/错误/Enter 交互、空状态示例按钮、contentEditable 光标稳定。
- 验证：后端重点回归 `123 passed`；桌面端与微信 H5 `npm run typecheck` 通过；`git diff --check` 通过；版本号未改变，未 commit/push。
- 本轮专项已完成：auth_dev_bypass 生产/预发布与非 loopback 应用地址拒绝；DOCX 压缩包炸弹预算；Agent Hub HTTPS/精确白名单/DNS 私网拒绝（路由与注册表双校验）；桌面更新 key 校验与固定块 Range 流式；桌面 SSO token 改为内存态并清理 sessionStorage 旧 token。
- 验证补充：专项后端回归 `62 passed`，附件/更新/Agent/认证重点回归 `60 passed`；桌面 typecheck 与 session 测试 `15 passed`；`git diff --check` 通过；版本号未改变，未 commit/push。
- 按 `server/` 工作目录补跑目录测试 `36 passed`；全量其余 4 个失败为既有的 Agent runtime、企业查询计划和网页搜索基线失败，未改动。
- 仍需后续：私有更新包的短时签名/登录态下载鉴权，以及全量管理路由权限审计。
