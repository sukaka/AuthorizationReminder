# 2026-03-14 Admin Center / Audit Center Checkpoint

## Context

- Branch: `codex/4.0.9`
- Time: `2026-03-14 15:24:03 CST`
- Goal: 在 `auth` 服务内落地独立的 `admin-center` 与 `audit-center`，让 `sysadmin` / `auditor` 不再依赖 `reminder` 作为后台入口。

## Completed

- 已确认设计与实施计划：
  - `/Users/zhanglei/Documents/codex-new/docs/plans/2026-03-14-auth-admin-audit-centers-design.md`
  - `/Users/zhanglei/Documents/codex-new/docs/plans/2026-03-14-auth-admin-audit-centers-implementation-plan.md`
- 已新增纯 helper：
  - `/Users/zhanglei/Documents/codex-new/auth/portal-routing.js`
- 已新增测试：
  - `/Users/zhanglei/Documents/codex-new/auth/tests/portal-routing.test.js`
- 已完成第一批行为：
  - `sysadmin` 默认系统改为 `admin-center`
  - `auditor` 默认系统改为 `audit-center`
  - `defaultAppAccessByRole('sysadmin') -> ['admin-center']`
  - `defaultAppAccessByRole('auditor') -> ['audit-center']`
  - `/api/auth/apps` 已加入 `admin-center` / `audit-center`
  - `auth` 新增独立页面壳：
    - `/admin-center`
    - `/audit-center`
- 已完成 `admin-center` 第一批后端 API：
  - `GET /api/admin-center/users`
  - `POST /api/admin-center/users`
  - `PUT /api/admin-center/users/:id`
  - `POST /api/admin-center/users/:id/unlock`
  - `POST /api/admin-center/users/:id/reset-password`
  - `DELETE /api/admin-center/users/:id`
  - `GET /api/admin-center/security`
  - `POST /api/admin-center/security`
- 已完成 `audit-center` 第一批后端 API：
  - `GET /api/audit-center/logs`
  - `GET /api/audit-center/logs/export`
  - `GET /api/audit-center/logs/verify`
- 独立页面已经接入第一版交互：
  - `/admin-center` 可执行：
    - 用户列表刷新
    - 新增用户
    - 启用 / 禁用用户
    - 解锁用户
    - 重置密码
    - 删除用户
    - 读取 / 保存安全配置
  - `/audit-center` 可执行：
    - 审计日志查询
    - 审计链校验
    - CSV 导出
- `auth` Dockerfile 已复制新 helper 文件：
  - `/Users/zhanglei/Documents/codex-new/auth/Dockerfile`

## Verification

- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/portal-routing.test.js`
- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/admin-center-users.test.js`
- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/admin-center-security.test.js`
- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/audit-center-logs.test.js`
- `node --check /Users/zhanglei/Documents/codex-new/auth/index.js`
- `node --check /Users/zhanglei/Documents/codex-new/auth/portal-routing.js`
- `node --check /Users/zhanglei/Documents/codex-new/auth/audit-center-logs.js`
- `docker compose build auth`

以上已通过。

## Not Done Yet

- `audit-center` 仍缺日志验签报告导出、更多筛选项和详情查看
- `admin-center` 仍缺编辑邮箱/手机号/角色/系统权限的页面入口
- 还没做端到端手工登录验证
- 本批改动还未提交、未推送

## Next Step

优先进入下一批：

- 手工跑 `auth`，验证：
  - `sysadmin` 登录默认进入 `/admin-center`
  - `auditor` 登录默认进入 `/audit-center`
  - `admin-center` 的用户动作按钮能真实落库
  - `audit-center` 的日志查询 / 导出能正常响应
- 然后再决定是否拆第二批：
  - 审计中心导出验签报告
  - 管理后台用户编辑表单

## 2026-03-14 Additional Updates

- 对独立后台做了第二轮界面 polish：
  - `admin-center` 增加职责卡片，强化“默认入口 / 核心职责”的首页说明
  - `audit-center` 增加职责卡片和“筛选范围”说明，页面更接近审计控制台而不是普通表单页
  - 页面壳层改成更深、更硬朗的控制台风格，按钮、表单、焦点态、状态条和表格交互已统一
- 新增整套系统版本规范文档：
  - `/Users/zhanglei/Documents/codex-new/docs/versioning.md`
  - 规则固定为：`主版本.次版本.修订号`
  - 大改版升第一位，功能优化升第二位，Bug 修复升第三位
- `README.md` 已增加版本规范文档入口

## 2026-03-14 Additional Verification

- `node --check /Users/zhanglei/Documents/codex-new/auth/index.js`
- `docker compose build auth`

## 2026-03-14 Style Rollback Target

- 用户确认独立后台不要继续走上一轮偏硬朗的控制台视觉。
- 新目标是回到 reminder 现有“管理中心”样式语言：
  - 左侧圆角侧栏
  - 顶部渐变 hero 卡片
  - 次级说明卡
  - 大面积白底卡片 + 轻渐变内容区
- 本次只回退页面样式和前端交互组织方式，不回退独立后台能力本身：
  - `sysadmin -> /admin-center`
  - `auditor -> /audit-center`
  - `admin-center` / `audit-center` 相关 API 继续保留

## 2026-03-14 Style Rollback Implementation

- `/Users/zhanglei/Documents/codex-new/auth/index.js`
  - `admin-center` / `audit-center` 的页面壳层已改成与 reminder 管理中心一致的布局语言
  - `admin-center` 新增当前账号安全面板，复用 `auth` 自身接口：
    - MFA 设置读取
    - TOTP 密钥生成 / 启用
    - 当前账号密码修改
    - MFA 方式保存
  - 页面请求已补齐 CSRF 获取与自动重试，避免独立后台提交类操作被 `auth` 的 CSRF 校验拦截
  - `audit-center` 统计卡、筛选区、日志区、验签/导出区已统一到同一套管理中心外观

## 2026-03-14 Style Rollback Verification

- `node --check /Users/zhanglei/Documents/codex-new/auth/index.js`
- `docker compose build auth`
- `docker compose up -d mysql auth`
- `curl -I http://127.0.0.1:5180/admin-center`
- `curl -s http://127.0.0.1:5180/admin-center | rg -n "用户安全管理中心|账号安全|安全配置|用户管理|返回门户"`

## 2026-03-14 Admin Center User Import Restored

- 用户指出按旧管理中心样式恢复后，`admin-center` 缺失了：
  - 用户批量上传（Excel）
  - 上传模板下载
- 本次已将用户导入链路落到 `auth` 独立后台，而不是重新依赖 `reminder`：
  - 新增 `auth` 侧 Excel 解析 helper：
    - `/Users/zhanglei/Documents/codex-new/auth/admin-center-user-import.js`
  - `auth` 新增接口：
    - `POST /api/admin-center/users/import`
    - `GET /api/admin-center/users/template.xlsx`
  - 页面恢复导入入口：
    - “批量导入（Excel）”
    - “下载模板”
    - 最近一次导入摘要
- 导入逻辑仍复用现有用户模板与结果文件规范：
  - 初始密码自动生成
  - 结果 Excel 返回成功/跳过明细
  - 模板列保持：`username/role/is_active/app_access/email/phone/wecom_id`

## 2026-03-14 Admin Center User Import Verification

- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/admin-center-user-import.test.js`
- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/admin-center-users.test.js`
- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/admin-center-security.test.js`
- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/audit-center-logs.test.js`
- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/portal-routing.test.js`
- `node --check /Users/zhanglei/Documents/codex-new/auth/index.js`
- `node --check /Users/zhanglei/Documents/codex-new/auth/admin-center-user-import.js`
- `node --check /Users/zhanglei/Documents/codex-new/auth/portal-routing.js`
- `docker compose build auth`
- `curl -s http://127.0.0.1:5180/admin-center | rg -n "批量导入（Excel）|下载模板"`
