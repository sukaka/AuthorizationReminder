# 统一登录（Auth/SSO）测试用例

## 前置条件
- 服务可访问：`http://localhost:5180`
- 已存在账号：`admin`、`sysadmin`、`auditor`
- 浏览器允许 Cookie

## 用例清单
| 用例ID | 场景 | 步骤 | 预期结果 |
|---|---|---|---|
| AUTH-001 | 获取 CSRF Token | `GET /api/auth/csrf` | 返回 200，包含 `token` 字段 |
| AUTH-002 | 登录成功 | `POST /api/auth/login` 传入正确账号密码 | 返回 200，返回 `token`，设置会话 Cookie |
| AUTH-003 | 登录失败（错误密码） | 使用错误密码登录 | 返回 400，提示账号或密码错误 |
| AUTH-004 | 内置账号用户名登录规则 | 使用 `admin/sysadmin/auditor` 用户名登录 | 可正常登录 |
| AUTH-005 | 非内置账号手机号登录规则 | 非内置账号用非手机号作为 `username` 登录 | 返回 400，提示请使用手机号登录 |
| AUTH-006 | 个人信息查询 | 携带 Bearer Token 调 `GET /api/auth/me` | 返回 200，包含 `id/username/role/app_access` |
| AUTH-007 | 系统应用列表 | 调 `GET /api/auth/apps` | 返回 200，仅返回当前用户有权限的应用 |
| AUTH-008 | 授权判断 | 调 `POST /api/auth/authorize`，分别测 allow/deny | 返回 `allow=true/false` 与原因 |
| AUTH-009 | Token 过期/无效 | 用无效 token 调 `GET /api/auth/me` | 返回 401 |
| AUTH-010 | 退出登录 | 调 `POST /api/auth/logout` | 返回 200，会话失效 |
| AUTH-011 | 登录页密码显隐 | 在门户登录页点击密码框“眼睛”按钮 | 密码可在明文/密文间切换 |
| AUTH-012 | 关闭浏览器后重新登录 | 登录成功后关闭浏览器，再次访问门户 | 需要重新输入账号密码 |

## 建议执行命令
```bash
curl -sS http://localhost:5180/api/auth/csrf
```
