# FAQ 功能测试执行报告（2026-02-27）

## 1. 执行概览
- 执行时间（UTC）: 2026-02-27T03:32:16.150Z
- 执行人: Codex 自动化测试
- API 地址: `http://localhost:5186`
- Auth 地址: `http://localhost:5180`
- 总用例数: **67**
- 通过: **67**
- 失败: **0**
- 跳过: **0**

## 2. 结论
- 本轮功能用例全部通过，未发现阻塞级功能缺陷。
- 重点覆盖了：权限模型、文章生命周期、审批流、反馈与收藏、协作编辑、审计日志、运维接口。

## 3. 用例执行明细

| 用例ID | 标题 | 结果 | 说明 | 耗时(ms) |
|---|---|---|---|---:|
| AUTH-001 | 未登录访问 FAQ 列表返回 401 | PASS | 匿名访问被拦截 | 187 |
| AUTH-002 | 四类角色登录并读取 /api/auth/me | PASS | {"editor":{"can_write_faq":true,"can_review_publish":false,"can_view_audit":false},"reviewer":{"can_write_faq":false,"can_review_publish":true,"can_view_audit":false},"auditor":{"can_write_faq":false,"can_review_publish":false,"can_view_audit":true},"admin":{"can_write_faq":true,"can_review_publish":true,"can_view_audit":true}} | 1350 |
| AUTH-003 | editor 访问管理员接口 /reindex/search-text 返回 403 | PASS | 权限控制生效 | 16 |
| AUTH-004 | reviewer 新建文章返回 403 | PASS | reviewer 无写权限符合预期 | 10 |
| AUTH-005 | auditor 访问审批列表返回 403 | PASS | auditor 无审批权限符合预期 | 10 |
| AUTH-006 | admin 可访问审计日志 | PASS | 日志条数=5 | 16 |
| CAT-001 | editor 创建分类成功 | PASS | categoryId=6 | 20 |
| CAT-002 | editor 更新分类成功 | PASS | name=QA-分类-1772163133542-UPD | 22 |
| CAT-003 | reviewer 创建分类返回 403 | PASS | 权限符合预期 | 9 |
| ASSET-001 | editor 创建模板成功 | PASS | templateId=2 | 19 |
| ASSET-002 | 模板列表包含新建模板 | PASS | 模板总数=1 | 10 |
| ASSET-003 | editor 更新模板成功 | PASS | updatedName=QA-模板-1772163133542-UPD | 15 |
| ASSET-004 | editor 创建片段成功 | PASS | snippetId=2 | 13 |
| ASSET-005 | 片段 use 成功且 usage_count 增长 | PASS | usage_count 0 -> 1 | 29 |
| ASSET-006 | reviewer 创建片段返回 403 | PASS | 权限符合预期 | 8 |
| ART-001 | editor 创建文章成功 | PASS | articleId=4 | 15 |
| ART-002 | 空标题创建文章返回 400 | PASS | 参数校验生效 | 7 |
| ART-003 | 按关键字可检索到新建文章 | PASS | 命中条数=2 | 12 |
| ART-004 | 上传非法 txt 文件返回 400 | PASS | 扩展名校验生效 | 13 |
| ART-005 | 上传 PDF 版本 v1 成功 | PASS | v1=9 | 30 |
| ART-006 | 上传 DOCX 版本 v2 成功 | PASS | v2=10 | 60 |
| ART-007 | 版本列表可见 v1/v2 | PASS | versions=2 | 8 |
| ART-008 | 文章详情读取成功 | PASS | status=draft, current=10 | 12 |
| ART-009 | 预览接口返回 200 (v1) | PASS | contentType=application/pdf | 8 |
| ART-010 | 下载接口返回 200 (v1) | PASS | contentType=application/pdf | 11 |
| ART-011 | 版本对比接口返回 200 | PASS | comparable=true | 12 |
| PUB-001 | editor 发布前校验返回检查项 | PASS | checks=10, requires_review=true | 10 |
| PUB-002 | editor 直接发布被转为提审(201) | PASS | requestId=2, mode=review | 28 |
| PUB-003 | reviewer 可查看待审批列表并命中提审单 | PASS | pending=1 | 7 |
| PUB-004 | reviewer 审批通过提审单成功 | PASS | status=approved | 32 |
| PUB-005 | 文章审批记录可查且包含 approved | PASS | items=1 | 18 |
| PUB-006 | 上传 v3(PDF) 触发发布前校验拦截(409) | PASS | v3=11, blocked_checks=10 | 29 |
| PUB-007 | 上传 v4(PDF) 提审被发布校验拦截(409) | PASS | v4=12, blocked_checks=10 | 38 |
| FB-001 | 提交“未解决”反馈成功 | PASS | 反馈提交成功 | 18 |
| FB-002 | 反馈汇总返回 total>=1 | PASS | total=1, solved=0 | 11 |
| FAV-001 | 收藏文章成功 | PASS | 收藏成功 | 12 |
| FAV-002 | 收藏列表包含目标文章 | PASS | favorites=1 | 7 |
| FAV-003 | 取消收藏成功 | PASS | 取消收藏成功 | 10 |
| VIEW-001 | 记录浏览事件成功 | PASS | view 记录成功 | 16 |
| VIEW-002 | 最近访问列表可读 | PASS | recent=2 | 8 |
| STAT-001 | 总览统计接口可读 | PASS | article_total=4, pending=0 | 12 |
| STAT-002 | 趋势统计接口可读 | PASS | trend_points=3 | 11 |
| STAT-003 | 热门统计接口可读 | PASS | top_items=3 | 9 |
| STAT-004 | 内容健康接口可读 | PASS | summary_keys=4 | 9 |
| COLLAB-001 | 创建协作测试文章 | PASS | collabArticleId=5 | 13 |
| COLLAB-002 | 协作文章上传 DOCX 版本成功 | PASS | collabV1=13 | 31 |
| COLLAB-003 | 创建在线编辑会话成功 | PASS | session=5009d087d325..., mode=section | 24 |
| COLLAB-004 | 查询在线编辑状态成功 | PASS | active_sessions=1 | 12 |
| COLLAB-005 | 查询分段信息成功 | PASS | collab_mode=section, sections=4 | 7 |
| COLLAB-006 | 分段锁定与释放（仅 section 模式） | PASS | section=technical | 38 |
| COLLAB-007 | 释放在线编辑锁成功 | PASS | released | 15 |
| COLLAB-008 | 重建会话后放弃草稿成功 | PASS | discarded | 34 |
| COLLAB-009 | 重建会话后发布草稿成功 | PASS | newVersionId=14 | 58 |
| PIN-001 | editor 获取智能置顶建议成功 | PASS | candidates=3 | 8 |
| PIN-002 | admin 应用智能置顶建议成功 | PASS | applied=3 | 19 |
| AUDIT-001 | auditor 读取审计日志成功 | PASS | items=20 | 10 |
| AUDIT-002 | auditor 读取 outbox 成功 | PASS | outbox=8 | 7 |
| AUDIT-003 | editor 读取审计日志返回 403 | PASS | 权限符合预期 | 6 |
| ADMIN-001 | admin 重建搜索文本成功 | PASS | scanned=0, updated=0 | 8 |
| ADMIN-002 | admin 将主文章移入回收站成功 | PASS | purge_after=2026-03-06 03:32:16 | 18 |
| ADMIN-003 | 回收站列表可命中主文章 | PASS | recycle_items=1 | 7 |
| ADMIN-004 | 恢复主文章成功 | PASS | restored | 19 |
| ADMIN-005 | 批量删除/恢复协作文章成功 | PASS | batch delete/restore ok | 25 |
| ADMIN-006 | 回收站清理接口可执行 | PASS | purged=0 | 8 |
| ASSET-007 | 删除片段成功 | PASS | snippet deleted | 14 |
| ASSET-008 | 删除模板成功 | PASS | template deleted | 11 |
| CAT-004 | 分类仍被文章引用时删除返回 409 | PASS | 删除保护生效 | 7 |

## 4. 执行命令
```bash
docker compose up -d --build auth faq-api
docker compose up -d --force-recreate auth faq-api
node /tmp/faq-functional-run-20260227.js
```

## 5. 测试数据说明
- 创建测试分类: `QA-分类-*`
- 创建测试文章: `QA-文章-*`、`QA-协作文章-*`
- 上传版本类型: PDF、DOCX
- 使用角色账号: `editor`、`reviewer`、`auditor`、`qa_admin`

## 6. 附件
- 原始结果 JSON: `/tmp/faq-functional-results-20260227.json`