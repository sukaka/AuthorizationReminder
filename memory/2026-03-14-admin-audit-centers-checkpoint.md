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

## 2026-03-14 Admin Center Edit Modal + Version Alignment

- 用户要求继续将 `admin-center` 的用户管理区对齐到旧版管理中心体验：
  - 恢复“编辑用户”弹层
  - “可访问系统”统一使用中文名称展示
  - 保留用户导入、模板下载、结果文件下载
- 当前 `auth` 前端模板内已补齐：
  - 新增用户表单中的“状态”“可访问系统（中文）”“清空”
  - 用户列表中的中文系统标签、二次验证列、创建时间列
  - “编辑用户”弹层，支持角色/状态/可访问系统更新
- 后端同步修正：
  - `reviewer` 已纳入 `auth/admin-center-users.js` 的可用角色集合，避免编辑用户时后端拒绝合法旧角色
- 版本判定按统一规则执行：
  - 从 `4.0.9` 升到 `4.1.0`
  - 原因：本次属于独立后台能力增强与用户管理体验完善，属于“功能优化”，不是整套系统大改版，也不只是修 Bug
- 下一步需要完成：
  - 将 `4.1.0` 同步到页面角标、README、部署文档、bootstrap 脚本、发布说明
  - 创建并推送 `codex/4.1.0` 分支，使 Git 与版本号一致

## 2026-03-14 Release Line Promotion

- 已从当前工作树切出新分支：`codex/4.1.0`
- 当前版本对齐目标：
  - 页面版本角标：`v4.1.3`
  - 仓库分支：`codex/4.1.3`
  - Git 标签：`v4.1.3`
  - 发布说明：`/Users/zhanglei/Documents/codex-new/docs/releases/4.1.3.md`

## 2026-03-14 Modal Position Fix

- 用户反馈：点击“编辑用户”后，弹层贴在页面顶部，视觉上像被截断，不符合旧管理中心的居中弹层体验。
- 根因：
  - `.modal-shell` 只有 `position: fixed`，没有任何居中布局
  - `.modal-panel` 依赖 `margin: 24px auto`，导致始终顶部对齐
- 修复方式：
  - 将 `.modal-shell` 改为 `display: grid; place-items: center; padding: 24px; overflow: auto`
  - 将 `.modal-panel` 改为 `width:min(1180px,100%)`、`margin:0`
  - 移动端把容器 padding 下调到 `8px`，保留可滚动能力
- 版本处理：
  - 因为 `v4.1.0` 已经发布并打标签，这次弹层定位修复按规则升级为 `4.1.1`

## 2026-03-14 Access Column Tightening

- 用户反馈：`admin-center` 用户表里的“可访问系统”列过宽，长中文系统标签和多项权限一起展开后，列表可读性变差。
- 处理方式：
  - 新增 `/Users/zhanglei/Documents/codex-new/auth/system-access-display.js`
  - 统一系统中文展示名，补齐 `admin-center` -> `管理中心`、`audit-center` -> `审计中心`
  - 用户列表里的权限列改成“前 2 个标签 + `+N` 摘要”
  - 审计日志系统列也统一走这套中文展示 helper
- 版本处理：
  - 本次属于缺陷修复与展示一致性修正，版本从 `4.1.1` 升到 `4.1.2`
  - Git 对齐目标：分支 `codex/4.1.2`，标签 `v4.1.2`

## 2026-03-14 Portal Recovery

- 用户反馈：本地 `http://localhost:5180/portal?system=reminder` 无法打开，浏览器报 `ERR_CONNECTION_REFUSED`。
- 根因：
  - `auth/index.js` 新增了 `require('./system-access-display')`
  - 但 `/Users/zhanglei/Documents/codex-new/auth/Dockerfile` 没有复制这个文件，导致容器启动时报 `Cannot find module './system-access-display'`
- 处理方式：
  - 在 `auth/Dockerfile` 补 `COPY auth/system-access-display.js ./auth/system-access-display.js`
  - 在登录页标题区增加版本号角标，和独立后台统一显示当前版本
- 版本处理：
  - 本次属于已发布 `4.1.2` 之后的修订版 Bug 修复，版本从 `4.1.2` 升到 `4.1.3`
  - Git 对齐目标：分支 `codex/4.1.3`，标签 `v4.1.3`
