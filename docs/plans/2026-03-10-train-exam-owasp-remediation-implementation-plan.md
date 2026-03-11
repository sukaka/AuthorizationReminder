# Train-Exam OWASP Remediation Implementation Plan

**Date:** 2026-03-10

## Goal

按 2026-03-10 的 OWASP 审计报告完成 `train-exam` 的实际修复，不停留在报告和短期建议层面。

## Remediation Order

1. 修复认证与弱口令遗留
2. 为 `train-exam` 增加 CSRF 防护并收紧文档预览 token
3. 收紧课程/资源/试卷的读取边界
4. 增加高成本接口速率限制与拒绝访问审计
5. 限制 AI 出站地址，降低 SSRF 面
6. 替换高危依赖并升级上传组件
7. 拆分 `train-exam` 的 OnlyOffice 密钥与实例
8. 清理 Compose 中与本次范围直接相关的硬编码敏感配置

## Verification Targets

- `train-exam/backend` 单元测试与 smoke 通过
- 新增的安全工具测试通过
- `auth` 新增安全测试通过
- 前端构建通过
- 容器重建后：
  - 弱口令不再可登录高权限内建账号
  - 无 CSRF token 的 Cookie-only 写请求被拒绝
  - 文档预览文件接口不能再通过替换外部 Host 脱离登录态取文件
  - 非高权限用户不能读取草稿课程/草稿试卷

