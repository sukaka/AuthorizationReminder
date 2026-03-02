# FAQ 系统功能测试用例（详细版）

## 1. 文档信息
- 文档名称：FAQ 系统功能测试用例（详细版）
- 适用系统：`faq-api` + `web-faq` + `auth`
- 文档版本：v2.0
- 更新日期：2026-02-27
- 测试类型：功能测试（API 主导，覆盖核心业务流程）

## 2. 测试目标
- 验证 FAQ 系统在角色权限、内容维护、发布审批、协作编辑、审计与运维方面的功能正确性。
- 验证关键流程在真实角色下可闭环执行（editor -> reviewer -> auditor）。
- 输出可复测、可追溯的用例库与执行证据。

## 3. 测试范围
- 鉴权与权限：未登录拦截、四角色权限边界、接口级 RBAC。
- 业务主流程：分类、文章创建、版本上传、预览下载、发布审批。
- 体验闭环：反馈、收藏、浏览、近期访问、统计指标。
- 在线协作：会话、分段锁、释放、放弃草稿、发布草稿。
- 运维能力：智能置顶、日志审计、出站队列、重建索引、回收站管理。

## 4. 测试环境与依赖
- 时间：2026-02-27
- FAQ API：`http://localhost:5186`
- Auth：`http://localhost:5180`
- MySQL：`codex-new-mysql-1`（Docker）
- OnlyOffice：`codex-new-onlyoffice-1`（Docker）
- 服务启动命令：
```bash
docker compose up -d --build auth faq-api
docker compose up -d --force-recreate auth faq-api
```

## 5. 测试账号与角色
- `editor / 123456`：FAQ 写入角色
- `reviewer / 123456`：FAQ 审批角色
- `auditor / 123456`：FAQ 审计角色
- `qa_admin(18800000013) / Qa#Faq2026`：管理员角色

## 6. 详细测试用例
说明：
- 优先级：`P0` 核心主流程，`P1` 重要功能，`P2` 增强与边界。
- 本次结果来自 2026-02-27 自动化执行。

### 6.1 认证与权限（AUTH）
| 用例ID | 优先级 | 前置条件 | 测试步骤 | 预期结果 | 本次结果 |
|---|---|---|---|---|---|
| AUTH-001 | P0 | 服务可用 | 未携带 token 调用 `GET /api/faq/articles` | 返回 401，拒绝匿名访问 | PASS |
| AUTH-002 | P0 | 角色账号可登录 | 分别登录 editor/reviewer/auditor/admin，调用 `GET /api/auth/me` | 返回 200，权限字段与角色匹配 | PASS |
| AUTH-003 | P0 | editor 已登录 | editor 调用 `POST /api/faq/reindex/search-text` | 返回 403，admin-only 生效 | PASS |
| AUTH-004 | P0 | reviewer 已登录 | reviewer 调用 `POST /api/faq/articles` | 返回 403，reviewer 无写权限 | PASS |
| AUTH-005 | P0 | auditor 已登录 | auditor 调用 `GET /api/faq/publish-requests` | 返回 403，auditor 无审批权限 | PASS |
| AUTH-006 | P0 | admin 已登录 | admin 调用 `GET /api/faq/logs` | 返回 403，admin 不可查看审计 | PASS |

### 6.2 分类管理（CAT）
| 用例ID | 优先级 | 前置条件 | 测试步骤 | 预期结果 | 本次结果 |
|---|---|---|---|---|---|
| CAT-001 | P1 | editor 已登录 | `POST /api/faq/categories` 新建分类 | 返回 201，生成分类ID | PASS |
| CAT-002 | P1 | 分类已创建 | `PUT /api/faq/categories/:id` 更新名称排序 | 返回 200，字段更新生效 | PASS |
| CAT-003 | P1 | reviewer 已登录 | `POST /api/faq/categories` | 返回 403 | PASS |
| CAT-004 | P1 | 分类下仍有关联 FAQ | `DELETE /api/faq/categories/:id` | 返回 409，触发删除保护 | PASS |

### 6.3 文章与版本（ART）
| 用例ID | 优先级 | 前置条件 | 测试步骤 | 预期结果 | 本次结果 |
|---|---|---|---|---|---|
| ART-001 | P0 | editor 已登录 | `POST /api/faq/articles` 创建文章 | 返回 201，得到 articleId | PASS |
| ART-002 | P0 | editor 已登录 | 空标题调用 `POST /api/faq/articles` | 返回 400，参数校验生效 | PASS |
| ART-003 | P1 | 文章已创建 | 关键字调用 `GET /api/faq/articles` | 返回 200，命中文章 | PASS |
| ART-004 | P0 | 文章已创建 | 上传 `.txt` 到 `POST /upload` | 返回 400，非法类型拦截 | PASS |
| ART-005 | P0 | 文章已创建 | 上传 PDF 版本 | 返回 201，生成 v1 | PASS |
| ART-006 | P0 | 文章已创建 | 上传 DOCX 版本 | 返回 201，生成 v2 | PASS |
| ART-007 | P1 | 至少两版本 | `GET /versions` | 返回 v1/v2 均可见 | PASS |
| ART-008 | P1 | 文章存在 | `GET /api/faq/articles/:id` | 返回 200，详情正确 | PASS |
| ART-009 | P1 | v1 存在 | `GET /versions/:v1/preview` | 返回 200，可预览 | PASS |
| ART-010 | P1 | v1 存在 | `GET /versions/:v1/download` | 返回 200，可下载 | PASS |
| ART-011 | P1 | v1/v2 存在 | `GET /versions/compare` 对比版本 | 返回 200，含 comparable 字段 | PASS |

### 6.4 发布与审批（PUB）
| 用例ID | 优先级 | 前置条件 | 测试步骤 | 预期结果 | 本次结果 |
|---|---|---|---|---|---|
| PUB-001 | P0 | editor + v2 | `POST /publish/check` | 返回 checks，`requires_review=true` | PASS |
| PUB-002 | P0 | editor + v2 | editor `mode=direct` 发布 | 返回 201，转为提审单 | PASS |
| PUB-003 | P0 | 提审单已创建 | reviewer `GET /publish-requests` | 返回 200，命中待审单 | PASS |
| PUB-004 | P0 | reviewer 有待审单 | reviewer `POST /publish-requests/:id/review` approve | 返回 200，状态 approved | PASS |
| PUB-005 | P1 | 审批完成 | `GET /articles/:id/publish-requests` | 返回审批历史且含 approved | PASS |
| PUB-006 | P1 | 上传 v3(PDF) | admin 直发 `POST /publish` | 返回 409，发布校验拦截并返回 checks | PASS |
| PUB-007 | P1 | 上传 v4(PDF) | editor 提审 `mode=review` | 返回 409，发布校验拦截并返回 checks | PASS |

### 6.5 反馈、收藏、浏览、统计（FB/FAV/VIEW/STAT）
| 用例ID | 优先级 | 前置条件 | 测试步骤 | 预期结果 | 本次结果 |
|---|---|---|---|---|---|
| FB-001 | P1 | 文章存在 | `POST /articles/:id/feedback` 提交未解决反馈 | 返回 200 | PASS |
| FB-002 | P1 | 已有反馈 | `GET /articles/:id/feedback/summary` | 返回 total>=1 | PASS |
| FAV-001 | P1 | 文章存在 | `POST /articles/:id/favorite` | 返回 200 | PASS |
| FAV-002 | P1 | 已收藏 | `GET /favorites` | 列表命中文章 | PASS |
| FAV-003 | P1 | 已收藏 | `DELETE /articles/:id/favorite` | 返回 200 | PASS |
| VIEW-001 | P2 | 文章存在 | `POST /articles/:id/view` | 返回 200 | PASS |
| VIEW-002 | P2 | 有浏览记录 | `GET /recent` | 返回数组且可读 | PASS |
| STAT-001 | P1 | 有测试数据 | `GET /stats/overview` | 返回总览统计字段 | PASS |
| STAT-002 | P1 | 有测试数据 | `GET /stats/trend` | 返回趋势数组 | PASS |
| STAT-003 | P1 | 有测试数据 | `GET /stats/top` | 返回热门数组 | PASS |
| STAT-004 | P1 | 有测试数据 | `GET /stats/content-health` | 返回 summary + 明细 | PASS |

### 6.6 在线协作编辑（COLLAB）
| 用例ID | 优先级 | 前置条件 | 测试步骤 | 预期结果 | 本次结果 |
|---|---|---|---|---|---|
| COLLAB-001 | P0 | editor 已登录 | 创建协作测试文章 | 返回 201 | PASS |
| COLLAB-002 | P0 | 协作文章存在 | 上传 DOCX 版本 | 返回 201 | PASS |
| COLLAB-003 | P0 | DOCX 当前版本 | `POST /editor/session` | 返回 200，含 session/editor 配置 | PASS |
| COLLAB-004 | P0 | 会话已创建 | `GET /editor/status` | 返回 active_sessions | PASS |
| COLLAB-005 | P1 | 会话已创建 | `GET /editor/sections` | 返回 sections 与 collab_mode | PASS |
| COLLAB-006 | P1 | `collab_mode=section` | 锁定 + 释放 section | 均返回 200 | PASS |
| COLLAB-007 | P0 | 会话存在 | `POST /editor/release` | 返回 200 | PASS |
| COLLAB-008 | P1 | 会话可重建 | 重建会话后 `POST /editor/discard` | 返回 200，草稿可放弃 | PASS |
| COLLAB-009 | P0 | 会话存在 | `POST /editor/publish` 发布草稿 | 返回 201，生成新版本 | PASS |

### 6.7 审计与运维（PIN/AUDIT/ADMIN）
| 用例ID | 优先级 | 前置条件 | 测试步骤 | 预期结果 | 本次结果 |
|---|---|---|---|---|---|
| PIN-001 | P1 | editor 已登录 | `GET /pin/recommendations` | 返回 candidates | PASS |
| PIN-002 | P1 | admin 已登录 | `POST /pin/recommendations/apply` | 返回 200，含 `applied` | PASS |
| AUDIT-001 | P0 | auditor 已登录 | `GET /logs` | 返回 200，items 数组 | PASS |
| AUDIT-002 | P0 | auditor 已登录 | `GET /events/outbox` | 返回 200，数组 | PASS |
| AUDIT-003 | P0 | editor 已登录 | `GET /logs` | 返回 403，越权拦截 | PASS |
| ADMIN-001 | P1 | admin 已登录 | `POST /reindex/search-text` | 返回 scanned/updated | PASS |
| ADMIN-002 | P0 | admin 已登录 | `DELETE /articles/:id?retention_days=7` | 返回 200，进入回收站 | PASS |
| ADMIN-003 | P0 | 回收站有数据 | `GET /articles?recycle=1` | 命中已删除文章 | PASS |
| ADMIN-004 | P0 | 文章在回收站 | `POST /articles/:id/restore` | 返回 200，恢复成功 | PASS |
| ADMIN-005 | P1 | 协作文章存在 | `POST /articles/batch` delete + restore | 两步均返回 200 | PASS |
| ADMIN-006 | P1 | admin 已登录 | `POST /recycle/purge` | 返回 200，含 purged 数值 | PASS |

## 7. 执行结果汇总（2026-02-27）
- 总用例：59
- 通过：59
- 失败：0
- 跳过：0

详细执行证据见：
- `/Users/zhanglei/Documents/codex-new/docs/testcases/faq-test-run-2026-02-27.md`

## 8. 缺陷与风险说明
- 本轮功能测试未发现阻塞级功能缺陷。
- 已验证权限边界覆盖到 editor/reviewer/auditor/admin 四角色。
- 需要另行补充的专项测试（本轮未覆盖）：
  - 前端视觉与交互细节（跨浏览器 UI/UX）
  - 压力与并发（长时并发会话、批量上传）
  - 安全专项（SQL 注入、XSS、越权组合攻击）

## 9. 回归建议
- 每次改动 `auth/index.js` 或 `faq/backend/src/index.js` 的权限逻辑后，优先回归 `AUTH-*`、`PUB-*`、`AUDIT-*`。
- 每次改动编辑器相关逻辑后，优先回归 `COLLAB-*` 全套用例。
- 每次改动统计/审计数据结构后，优先回归 `STAT-*`、`PIN-*`、`ADMIN-*`。
