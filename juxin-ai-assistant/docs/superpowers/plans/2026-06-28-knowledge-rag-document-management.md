# 知识库、文档管理与 RAG 问答实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有聚信 AI 助手中增量实现正式知识库、个人参考资料、当前会话附件、RAG 问答、审核流和 Word 来源导出，不破坏现有聊天、历史会话、会话归档删除、长期记忆、助手模式和 Word 导出。

**Architecture:** 复用当前 FastAPI + SQLAlchemy + Alembic + React/Tauri 架构，保留已有 `ai_knowledge_files` / `ai_knowledge_chunks` / ChatPage / ContextBuilder，只在现有表基础上迁移扩展。第一版以关键词检索和加密 chunk 为基础，先实现权限、来源类型、审核和可追溯引用边界，向量检索、重排序、版本管理和相似文档检测留到第二版。

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, MySQL/SQLite tests, Pydantic, React, TypeScript, Vitest, Tauri, python-docx template renderer.

---

## 第一阶段：当前结构分析

### 1. 项目入口

- 后端入口：`server/app/main.py`
  - 现有主业务接口、附件上传、知识文件上传、任务生成、AI 对话质量检查都在这里。
  - 新聊天路由已拆到 `server/app/chat_routes.py`，并在 `main.py` 中挂载。
  - Word 导出路由已拆到 `server/app/export_routes.py`。
- 桌面端入口：`apps/desktop/src/App.tsx`
  - 左侧菜单、角色菜单权限、ChatPage、治理中心都从这里分发。
  - 当前普通用户菜单：工作台、全部助手、历史记录、个人模型。
  - 当前管理员菜单：额外显示部门数据、提交建议、治理中心。
- 桌面聊天窗口：`apps/desktop/src/pages/ChatPage.tsx`
  - 已支持 11 个聊天模式、知识库问答模式、文件上传、引用展示、导出 Word、会话归档/删除/恢复。

### 2. 现有后端知识库与 RAG

- 旧治理知识库：`KnowledgeItem` / `KnowledgeTaskLink`
  - 文件：`server/app/models.py`
  - 管理接口：`/api/ai/admin/knowledge`
  - 作用：给任务生成注入治理知识和质量规则。
  - 局限：不是文件级知识库，不支持文档生命周期、审核、个人资料、正式 RAG 来源区分。
- 新聊天知识文件雏形：`KnowledgeFile` / `KnowledgeChunk`
  - 文件：`server/app/models.py`
  - 创建逻辑：`server/app/knowledge_files.py`
  - 检索逻辑：`server/app/knowledge_search.py`
  - API：`POST /api/ai/knowledge/files`、`GET /api/ai/knowledge/files`、`DELETE /api/ai/knowledge/files/{file_uuid}`
  - 当前只支持 `txt` / `md` / `docx`，状态是 `READY` / `DELETED`，可见性是 `PRIVATE` / `PUBLIC`。
  - 当前检索规则：检索 `PUBLIC` 或当前用户自己的文件；没有 `usage_type`、`review_status`、`rag_enabled`、`permission_scope` 等硬边界。

### 3. 现有聊天与 ContextBuilder

- 聊天服务：`server/app/chat_service.py`
  - `prepare_chat()` 使用 `LoopRunner`。
  - 通过 `LoopRunner.run_chat()` 获取知识检索结果和最终 LLM messages。
  - 已检查 active / archived / deleted 会话状态。
- 聚信化上下文：`server/app/context/context_builder.py`
  - 当前拼接：base_system_prompt + company_profile + role_prompt + conversation_summary + knowledge_retrieval_context + knowledge_policy + recent_messages + current_user_message。
  - 当前只有一个 `knowledge_retrieval_context`，没有分开 `official_knowledge_context` 和 `personal_reference_context`。
- 聊天引用来源：`ChatMessageSource`
  - 当前 `source_type` 基本是 `knowledge_file`，还不能展示 official / personal / session_attachment 的业务语义。

### 4. 现有模型调用边界

- 桌面端本地模型调用：`apps/desktop/src/local/modelStream.ts`
- 个人模型配置：`apps/desktop/src-tauri/src/model_profiles.rs`、`model_profile_store.rs`、`model_client.rs`
- 服务端只负责准备上下文和持久化消息，不托管用户模型 API Key。
- 这个边界必须保留：知识库检索和上下文构造在服务端，最终 LLM 调用仍由客户端本地模型完成。

### 5. 现有 Word 导出

- 聊天 Word 导出：`server/app/chat_word_export.py`
- 导出路由：`server/app/export_routes.py`
- 导出记录：`ExportRecord`
- 当前可以导出单条回答、选中消息、完整会话、正式文档。
- 当前不足：没有把 `ChatMessageSource` 的引用来源整理进 Word 末尾“参考来源”，也没有区分“正式知识来源”和“个人参考资料”。

### 6. 现有权限和角色

- 登录态：`server/app/auth.py`
- 后端权限校验：`require_action()`
- 开发绕过：`auth_dev_bypass` 时默认 admin。
- 前端角色判断：`apps/desktop/src/App.tsx` 中 `session.user.role === 'admin'`。
- 当前不足：知识文件上传只要求 `ai_assistant:use`，没有后端强制阻止普通用户启用 company RAG 或设为 official。

### 7. 数据库存储现状

已存在：

- `ai_knowledge_items`
- `ai_knowledge_task_links`
- `ai_knowledge_files`
- `ai_knowledge_chunks`
- `ai_chat_sessions`
- `ai_chat_messages`
- `ai_chat_message_sources`
- `export_records`
- `ai_generation_attachments`

需要扩展或新增：

- 新增 `ai_knowledge_bases`
- 扩展 `ai_knowledge_files`
- 扩展 `ai_knowledge_chunks`
- 新增 `ai_knowledge_search_logs`
- 新增 `ai_knowledge_review_logs`

### 8. 当前风险

1. 现有 `KnowledgeFile.visibility = PUBLIC` 会让普通用户上传的 PUBLIC 文件被其他用户搜索，和新需求冲突。
2. 当前 RAG 没有区分正式知识库与个人资料，容易把个人资料当正式依据。
3. 当前知识文件删除只是 `status = DELETED`，没有 archived / deleted / hard_deleted 生命周期。
4. 当前上传只支持 txt、md、docx，不满足 pdf、xlsx、csv。
5. 当前知识文件没有真实文件落盘路径，仅保存加密 chunk，不满足下载/预览/重解析/彻底删除原始文件要求。
6. 当前 Word 导出没有附带引用来源。

---

## 最小侵入式改造原则

1. 不推翻已有 `KnowledgeFile` / `KnowledgeChunk`，用 migration 扩展字段。
2. 新 API 使用 `/api/knowledge/*` 和 `/api/personal-reference/*`，保留 `/api/ai/knowledge/files` 兼容旧 ChatPage 上传。
3. 检索层新增三条服务边界：
   - `OfficialRAGService`
   - `PersonalReferenceService`
   - `SessionAttachmentService`
4. 第一版仍用现有关键词检索，不引入向量库，避免一次性引入额外基础设施。
5. 后端权限是硬边界，前端隐藏只是体验优化。
6. 个人资料和当前会话附件默认只能 `reference_enabled = true`，`rag_enabled = false`。
7. 正式 RAG 检索必须满足 `usage_type = official_knowledge`、`rag_enabled = true`、`review_status in approved/official`、`parse_status = parsed`、`index_status = indexed`。
8. Word 导出只追加来源摘要，不把服务器真实路径或敏感内容写入文档。

---

## 分阶段实施任务

### Task 1: 数据库迁移与模型扩展

**Files:**
- Create: `server/alembic/versions/0011_knowledge_document_management.py`
- Modify: `server/app/models.py`
- Modify: `server/tests/test_migrations.py`
- Test: `server/tests/test_knowledge_document_models.py`

- [x] 新增 `ai_knowledge_bases`。
- [x] 扩展 `ai_knowledge_files`：知识库、文件路径、分类、文档类型、标签、摘要、解析状态、索引状态、来源类型、用途类型、审核状态、RAG 开关、参考开关、权限范围、版本、审核人、生命周期时间等字段。
- [x] 扩展 `ai_knowledge_chunks`：`knowledge_base_id`、`token_count`、`metadata_json`、`embedding_id`、`deleted_at`。
- [x] 新增 `ai_knowledge_search_logs`。
- [x] 新增 `ai_knowledge_review_logs`。
- [x] 历史 `ai_knowledge_files` 默认迁移为 `personal_reference`、`private`、`draft`、`rag_enabled = false`，避免旧 PUBLIC 误进入正式 RAG。

### Task 2: 文档上传服务

**Files:**
- Create: `server/app/knowledge_document_service.py`
- Create: `server/app/knowledge_routes.py`
- Modify: `server/app/main.py`
- Test: `server/tests/test_knowledge_document_upload.py`

- [x] 实现安全文件名和存储文件名。
- [x] 支持 txt、md、docx、pdf、xlsx、csv。
- [x] 普通用户上传当前会话附件。
- [x] 普通用户保存到我的资料。
- [x] 普通用户提交审核。
- [x] 管理员上传 official_knowledge。
- [x] 普通用户接口绕过 official / rag_enabled 时后端拒绝。

### Task 3: 解析与切片

**Files:**
- Modify: `server/app/knowledge_files.py`
- Create: `server/app/knowledge_parser.py`
- Create: `server/app/knowledge_chunker.py`
- Test: `server/tests/test_knowledge_parser.py`
- Test: `server/tests/test_knowledge_chunker.py`

- [x] 把当前同步解析抽成 parser。
- [x] 保留表格文本。
- [x] chunk 约 500-1000 中文字，100-150 字重叠。
- [x] 记录 file_id、file_name、page_number、section_title、chunk_index。
- [x] 重新解析时清理旧 chunks，再写入新 chunks。

### Task 4: 文档列表、生命周期和审核

**Files:**
- Modify: `server/app/knowledge_routes.py`
- Test: `server/tests/test_knowledge_document_lifecycle.py`
- Test: `server/tests/test_knowledge_review_flow.py`

- [x] GET /api/knowledge/files。
- [x] GET /api/knowledge/files/trash。
- [x] PATCH /api/knowledge/files/{file_id}。
- [x] archive / restore / soft delete / hard delete。
- [x] submit-review / approve / reject。
- [x] 审核写入 `ai_knowledge_review_logs`。

### Task 5: 检索服务边界

**Files:**
- Create: `server/app/rag_services.py`
- Modify: `server/app/knowledge_search.py`
- Test: `server/tests/test_rag_services.py`

- [x] OfficialRAGService 只检索 official_knowledge。
- [x] PersonalReferenceService 只检索当前用户 personal_reference。
- [x] SessionAttachmentService 只检索当前 conversation 的 session_attachment。
- [x] 检索记录写入 `ai_knowledge_search_logs`。

### Task 6: 聊天 ContextBuilder 接入

**Files:**
- Modify: `server/app/context/context_builder.py`
- Modify: `server/app/chat_service.py`
- Modify: `server/app/agent_loop/*`
- Test: `server/tests/test_chat_api.py`
- Test: `server/tests/test_context_builder.py`

- [x] 拆分 `official_knowledge_context` 和 `personal_reference_context`。
- [x] 知识库问答模式优先 official。
- [x] 明确“参考我的资料/附件”时才使用 personal/session。
- [x] sources 返回 source_kind。

### Task 7: Word 导出来源

**Files:**
- Modify: `server/app/chat_word_export.py`
- Test: `server/tests/test_chat_word_export.py`

- [x] 导出时追加“参考来源”。
- [x] official 显示为正式知识来源。
- [x] personal/session 显示为个人参考资料/当前会话附件。
- [x] 不展示服务器路径，不过度展示 chunk_id。

### Task 8: 桌面端知识库页面和上传弹窗

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Create: `apps/desktop/src/api/knowledge.ts`
- Create: `apps/desktop/src/pages/KnowledgePage.tsx`
- Create: `apps/desktop/src/pages/admin/KnowledgeReviewPage.tsx`
- Modify: `apps/desktop/src/pages/ChatPage.tsx`
- Test: `apps/desktop/tests/knowledge-page.test.tsx`
- Test: `apps/desktop/tests/chat-page.test.tsx`

- [x] 左侧新增“知识库”入口。
- [x] 普通用户显示我的资料、当前附件、提交审核记录、正式知识库只读。
- [x] 管理员显示正式知识库、审核、回收站、上传、分类标签。
- [x] 聊天输入旁增加上传附件、我的资料、知识库入口。

---

## 第一版验收映射

第一版完成后必须证明：

1. 普通用户上传默认 `rag_enabled = false`。
2. 普通用户文件只用于 session/personal，不进入 official RAG。
3. 他人不能检索用户 private 文件。
4. 管理员上传/审核通过后才能进入 official RAG。
5. official RAG 只检索 official_knowledge。
6. personal_reference 不污染 official 回答。
7. docx、pdf、xlsx、txt、md、csv 至少能上传；解析失败要有状态。
8. chunks 能生成并带来源。
9. 聊天知识库问答带来源。
10. Word 导出带参考来源。
11. 不破坏现有聊天、长期记忆、Word 导出、会话归档删除。

---

## 运行和测试

后端快速验证：

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
.venv/bin/python -m pytest tests/test_knowledge_files.py tests/test_knowledge_search.py tests/test_chat_api.py tests/test_chat_word_export.py tests/test_migrations.py -q
```

前端快速验证：

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npx vitest run tests/chat-page.test.tsx
npm run typecheck
```

---

## 当前限制

1. 现有实现没有向量检索；第一版继续关键词检索。
2. 新上传的知识文件已持久化原始文件并支持基于原始文件 `reparse`；历史无 `file_path` 记录仍会回退到已解析 chunks 重建。
3. 现有管理员知识库页面是文本知识治理，不是文件知识库；需要新增产品级知识库页面，不直接替换旧治理页。
4. 现有 `PUBLIC` 可见性需要迁移降权，避免历史普通用户上传资料被当成正式知识。

---

## 2026-06-28 执行进展

### 已完成

1. Stage 2 数据库骨架：
   - 新增 `0011_knowledge_document_management` migration。
   - 新增/扩展知识库、知识文件、知识切片、检索日志、审核日志模型字段。
   - 已验证 migration/model/现有知识文件/检索/聊天/Word 导出核心回归。

2. Stage 3 上传来源与权限边界：
   - `/api/ai/knowledge/files` 支持 `usage_type`、`review_status`、`rag_enabled`、`reference_enabled`、`rag_scope`、`permission_scope`、`category`、`document_type`、`tags` 等字段。
   - 普通用户上传默认落为 `personal_reference`、`draft`、`rag_enabled=false`、`permission_scope=private`。
   - 普通用户不能通过接口伪造 `official_knowledge`、`PUBLIC`、`approved/official` 或启用公司级 RAG。
   - 管理员上传 `official_knowledge` 时落为 `admin_upload`、`official`、`PUBLIC`、`rag_enabled=true`。

3. Stage 9/10 检索边界基础：
   - `search_knowledge_chunks` 已收紧为正式 RAG 检索，只返回 `official_knowledge + rag_enabled + approved/official + parsed/indexed + 未归档/未删除` 的 chunks。
   - 新增 `search_personal_reference_chunks`，只检索当前用户自己的 `personal_reference`，以及指定会话内的 `session_attachment`。
   - 聊天知识库测试夹具已调整为正式知识库来源，避免个人资料污染正式知识问答。

4. Stage 4/5 知识库基础接口与产品级上传入口：
   - 新增 `/api/knowledge/bases` CRUD：
     - admin 可创建、查看、修改、软删除 company 知识库。
     - 普通用户只能创建和管理自己的 personal 知识库。
     - 普通用户列表只返回 company 知识库和自己的 personal 知识库，不返回他人 personal 知识库。
   - 新增 `/api/knowledge/files/upload`：
     - admin 可将 `official_knowledge` 上传到 company 知识库，默认 `official + rag_enabled=true + PUBLIC`。
     - 普通用户可将 `personal_reference` 上传到自己的 personal 知识库，默认 `rag_enabled=false + private`。
     - 普通用户不能上传 `official_knowledge`，也不能向 company 知识库上传。
     - company 知识库拒绝 `personal_reference`，防止正式库和个人资料混用。

5. Stage 8 管理员审核流程基础：
   - 新增 `/api/knowledge/files/{file_id}/submit-review`：
     - 文件所有者可将自己的 `personal_reference` 提交审核。
     - 提交后保持个人资料属性，`review_status=pending`，`rag_enabled=false`。
     - 非所有者提交返回 404，避免泄露文件存在性。
   - 新增 `/api/knowledge/reviews/pending`：
     - admin 可查看待审核文件列表。
     - 普通用户访问返回 403。
   - 新增 `/api/knowledge/files/{file_id}/approve`：
     - admin 可将 pending 文件审核为 `official_knowledge`。
     - 审核通过后设置 `review_status=official`、`rag_enabled=true`、`visibility=PUBLIC`、正式知识库归属和 RAG/权限范围。
     - 审核通过后的文档已验证可被正式 RAG 检索。
   - 新增 `/api/knowledge/files/{file_id}/reject`：
     - admin 可驳回 pending 文件。
     - 驳回后保留为 `personal_reference`，`rag_enabled=false`，写入 `review_comment`。
   - submit / approve / reject 均写入 `ai_knowledge_review_logs`。

6. Stage 7/15 文档列表和生命周期基础：
   - 新增 `/api/knowledge/files`：
     - 普通用户可看到公司正式知识文档和自己的个人资料。
     - 普通用户看不到他人的个人资料。
     - admin 可查看全部未删除文档。
   - 新增 `/api/knowledge/files/{file_id}`：
     - 文件所有者可查看自己的个人资料。
     - 授权用户可查看正式知识库文档。
     - 他人个人资料返回 404。
   - 新增 `PATCH /api/knowledge/files/{file_id}`：
     - 文件所有者可修改自己的个人资料分类、文档类型和标签。
     - 普通用户不能修改正式知识库文档。
   - 新增 `DELETE /api/knowledge/files/{file_id}` 与 `/api/knowledge/files/trash`：
     - 软删除进入回收站，不物理删除。
     - 删除后 chunks 标记为 `DELETED`，不参与检索。
   - 新增 `/api/knowledge/files/{file_id}/restore`：
     - 恢复 deleted/archived 文档和 chunks。
   - 新增 `/api/knowledge/files/{file_id}/archive`：
     - 归档后 `status=ARCHIVED`、`rag_enabled=false`，正式 RAG 检索排除。
   - 新增 `/api/knowledge/files/{file_id}/enable-rag` 与 `/disable-rag`：
     - 仅 admin 可操作正式知识库文档。
     - 普通用户调用返回 403。
   - 新增 `/api/knowledge/files/{file_id}/reparse`：
     - 文件所有者可重解析自己的个人资料。
     - admin 可重解析正式知识库文档。
     - 普通用户不能重解析正式知识库文档。
     - 当前第一版在未持久化原始文件前，基于已解析 chunks 重建切片。
   - 新增 `/api/knowledge/reviews/history`：
     - admin 可查看 submit / approve / reject 审核日志历史。
     - 普通用户访问返回 403。

7. Stage 6/10/12 个人资料上下文与生成入口基础：
   - `RetrievedKnowledgeChunk` 新增 `source_kind`，正式 RAG 返回 `official_knowledge`，个人资料检索返回 `personal_reference` 或 `session_attachment`。
   - `ContextBuilder` 已拆分：
     - `official_knowledge_context`
     - `personal_reference_context`
   - `personal_reference_context` 明确写入“个人资料不能作为公司正式依据，生成内容必须标注参考个人资料生成”。
   - 新增中文无空格查询的 bigram 兜底，支持“参考我的会议记录生成纪要”这类自然中文问题命中资料。
   - 新增 `PersonalReferenceService` 与 `POST /api/personal-reference/generate`：
     - 只检索当前用户自己的 `personal_reference`。
     - 指定 `conversation_id` 时可检索当前会话 `session_attachment`。
     - 支持 `file_ids` 限定文件范围。
     - 返回本地模型调用所需 `messages`、`sources` 和安全提示 `notice`。
     - 写入 `ai_knowledge_search_logs`，`search_type=personal_reference`。
   - 聊天知识库模式已改为正式知识区和个人资料区分区注入，避免个人资料污染正式知识回答。

8. Stage 14 Word 导出参考来源：
   - 聊天引用来源从 `RetrievedKnowledgeChunk.source_kind` 传递到 `ChatMessageSource.source_type`，支持区分：
     - `official_knowledge`
     - `personal_reference`
     - `session_attachment`
   - `DocxExportService` 导出聊天 Word 时会读取当前导出消息的 `ChatMessageSource`。
   - 导出内容末尾追加“参考来源”部分：
     - 正式知识显示为“公司知识库 / 正式知识来源”。
     - 个人资料显示为“我的上传文件，仅用于本次内容生成”。
     - 当前附件显示为“当前会话附件”。
   - 个人资料来源会追加“本文参考用户个人上传资料生成，仅供用户本人使用”。
   - Word 中不输出服务器真实路径，也不过度展示 `chunk_id`。

9. Stage 9/11 正式知识库搜索和问答接口：
   - 新增 `POST /api/knowledge/search`：
     - 只返回 `official_knowledge` 来源。
     - 支持 `knowledge_base_ids` 限定正式知识库。
     - 支持 `filters.category` 与 `filters.document_type`。
     - 返回 `source_kind`、文件名、页码、章节、snippet，不暴露服务器真实路径。
     - 写入 `ai_knowledge_search_logs`，`search_type=official_rag`。
   - 新增 `POST /api/knowledge/ask`：
     - 有正式来源时返回本地模型调用所需 `messages`、`sources` 和正式 RAG notice。
     - 无正式来源时返回固定答案“当前正式知识库中未找到明确依据”，避免编造。
     - 上下文只注入 `official_knowledge_context`，不混入个人资料。
   - `search_knowledge_chunks` 支持按知识库、分类、文档类型过滤，并继续强制 `official_knowledge + rag_enabled + approved/official + parsed/indexed + 未归档/未删除` 边界。

10. Stage 11/12 单文档问答与总结接口：
   - 新增 `POST /api/knowledge/files/{file_id}/ask`：
     - 只读取指定文件的 READY chunks，不检索其他文档。
     - 正式知识库文档注入 `official_knowledge_context`。
     - 个人资料或当前会话附件注入 `personal_reference_context`。
     - 他人个人资料返回 404，避免泄露文件存在性。
   - 新增 `POST /api/knowledge/files/{file_id}/summary`：
     - 默认问题为“请总结这个文档，提炼核心内容、待办事项、风险提醒和下一步建议。”
     - 返回本地模型调用所需 `messages`、`sources` 和对应 notice。
   - 单文档接口会写入 `ai_knowledge_search_logs`，并保留来源类型。

11. Stage 10 个人参考资料搜索接口：
   - 新增 `POST /api/personal-reference/search`：
     - 只检索当前用户自己的 `personal_reference`。
     - 指定 `conversation_id` 时可检索当前会话 `session_attachment`。
     - 支持 `file_ids` 限定文件范围。
     - 返回 `source_kind`、文件名、页码、章节、snippet 和个人资料使用提示，不暴露服务器真实路径。
     - 写入 `ai_knowledge_search_logs`，`search_type=personal_reference`。

12. Stage 15 彻底删除接口：
   - 新增 `DELETE /api/knowledge/files/{file_id}/hard-delete?confirm=true`：
     - 必须显式传入 `confirm=true`，否则返回 400，作为后端二次确认边界。
     - 文件必须先进入回收站，否则返回 409，避免误删活跃文档。
     - 文件所有者可彻底删除自己的个人资料/当前会话附件，admin 可彻底删除正式知识库文档。
     - 彻底删除后设置 `status=HARD_DELETED`、`hard_deleted_at`，关闭 `rag_enabled` 和 `reference_enabled`。
     - 清理该文件下的 chunks，并从普通列表、回收站、详情和检索链路中排除。

13. Stage 6/15 原始文件持久化：
   - 新增 `knowledge_storage_dir` 配置，默认写入 `./storage`。
   - 上传时将原始文件按用途保存到：
     - `storage/knowledge/original`
     - `storage/user_uploads/session_attachments`
     - `storage/user_uploads/personal_references`
   - 实际存储文件名使用 UUID + 原始后缀，不直接使用用户上传文件名，避免路径穿越和重名覆盖。
   - `KnowledgeFile.file_path` / `stored_file_name` 写入实际存储信息，接口输出不暴露真实服务器路径。
   - `hard-delete` 已补充物理文件清理验证：只删除 `knowledge_storage_dir` 内的文件，避免任意路径删除。

14. Stage 15 基于原始文件的重新解析：
   - `/api/knowledge/files/{file_id}/reparse` 已优先读取 `knowledge_storage_dir` 内的原始文件。
   - 重新解析时清理旧 chunks，再按当前原始文件内容重新生成 chunks。
   - 对没有 `file_path` 的历史记录，保留从既有 chunks 重建的兼容兜底。
   - 测试已覆盖“修改原始文件后 reparse 生成新内容，且不再保留旧 chunk 文本”。

15. Stage 17/20 文档预览和下载接口：
   - 新增 `GET /api/knowledge/files/{file_id}/preview`：
     - 返回文档可预览 chunks、章节、页码和来源类型。
     - 复用文件查看权限，个人资料只有本人或 admin 可看，正式知识库按正式可见范围可看。
     - 不返回 `file_path` / `stored_file_name`，不暴露服务器真实路径。
   - 新增 `GET /api/knowledge/files/{file_id}/download`：
     - 通过 `file_id` 下载原始文件。
     - 只允许读取 `knowledge_storage_dir` 内的文件，避免路径穿越。
     - 文件名通过 `Content-Disposition` 返回，仍不暴露服务器真实路径。

16. Stage 17/20 来源片段定位预览：
   - `GET /api/knowledge/files/{file_id}/preview` 新增 `chunk_id` 查询参数。
   - 点击来源时可带 `file_id + chunk_id` 精准返回对应 chunk。
   - 查询仍强制限定在当前文件和当前用户可见权限内，其他文件的 chunk_id 不会越权泄露。
   - 已测试 `top_k=1&chunk_id=<目标片段>` 返回目标片段，而不是默认文档开头片段。

17. Stage 13/17/20 桌面端聊天来源点击预览：
   - 桌面端新增 `previewKnowledgeFile(fileUuid, { chunkId, topK })` API client，调用 `/api/knowledge/files/{file_id}/preview`。
   - 聊天回答中的引用来源从纯文本改为可点击来源按钮。
   - 点击来源后按 `file_uuid + chunk_id` 打开来源预览区域，展示文件名、来源提示、章节、页码和目标片段正文。
   - UI 不展示 `file_path`、`stored_file_name` 或服务器真实存储路径，符合来源展示安全要求。
   - 已覆盖历史会话中的正式知识库引用来源点击预览。

18. Stage 5/13/19 桌面端普通用户上传用途弹窗：
   - 聊天输入区上传文件后不再直接上传，先打开“上传资料”弹窗。
   - 普通用户弹窗显示三种用途：
     - 仅用于当前会话
     - 保存到我的资料
     - 提交管理员审核
   - 普通用户弹窗不显示“加入公司知识库”“启用公司级 RAG”等管理员能力。
   - 桌面端上传改为调用正式接口 `POST /api/knowledge/files/upload`。
   - 选择“提交管理员审核”时传递：
     - `usage_type=personal_reference`
     - `review_status=pending`
     - `rag_enabled=false`
     - `reference_enabled=true`
     - `rag_scope=personal`
     - `permission_scope=private`
   - 选择“仅用于当前会话”时预留 `conversation_id`，无当前会话时给出提示，不把附件上传成正式知识。
   - 文件选择已扩展到 docx / pdf / xlsx / txt / md / csv。

19. Stage 17 桌面端知识库页面入口：
   - 左侧主导航新增“知识库”入口，普通用户和管理员都可进入。
   - 普通用户页面展示：
     - 我的资料
     - 当前附件
     - 提交审核记录
     - 正式知识库
     - 文档搜索
     - 上传资料
   - 普通用户页面不展示“知识库审核”“待审核文档”等管理员模块。
   - 管理员页面展示：
     - 正式知识库
     - 知识库审核
     - 公司知识库
     - 部门知识库
     - 项目知识库
     - 文档列表
     - 待审核文档
     - 回收站
     - 文档上传
     - 分类和标签管理
   - 当前版本先补齐产品入口和角色化页面骨架，后续继续接入真实文档列表、搜索、上传、审核和回收站操作。

20. Stage 7/17 桌面端知识库文档列表：
   - 桌面端新增 `listKnowledgeFiles()` API client，调用 `GET /api/knowledge/files`。
   - 知识库页面进入后加载当前用户有权限查看的文档列表。
   - 文档列表展示文件名、分类、文档类型、标签、usage_type、source_type、解析状态、索引状态、审核状态、RAG 状态、参考资料状态和 chunk 数。
   - 文档卡片增加可访问名称，便于读屏和自动化测试按文件名定位。
   - UI 不展示 `file_uuid`、`file_path`、`stored_file_name` 或服务器真实路径。

21. Stage 17/20 桌面端知识库文档基础操作：
   - 文档列表增加普通用户可用的基础操作按钮：
     - 预览
     - 下载
     - 删除
   - “预览”调用 `GET /api/knowledge/files/{file_id}/preview`，展示来源类型、文件名、提示说明、章节、页码和片段正文。
   - 预览区域不展示 `chunk_id`、`file_path`、`stored_file_name` 或服务器真实路径。
   - “下载”通过 `/api/knowledge/files/{file_id}/download` 打开后端下载地址，继续由后端校验权限并隐藏真实路径。
   - “删除”调用 `DELETE /api/knowledge/files/{file_id}`，删除成功后从当前文档列表移除；后端按软删除进入回收站。

22. Stage 6/7/17 桌面端个人资料提交审核：
   - 桌面端新增 `submitKnowledgeFileForReview()` API client，调用 `POST /api/knowledge/files/{file_id}/submit-review`。
   - 普通用户的 `personal_reference` 文档在 `draft` / `rejected` 等非正式状态下显示“提交审核”按钮。
   - 提交时固定写入桌面端审核备注“用户从桌面端提交管理员审核”，后端继续校验所有权和文档用途。
   - 提交成功后更新当前文档卡片状态为 `pending`，隐藏提交按钮，并显示“已提交管理员审核”。
   - 管理员页面不展示该普通用户提交按钮，避免把审核入口和管理员治理入口混在一起。

23. Stage 16/17 桌面端知识库文档总结：
   - 桌面端新增 `summarizeKnowledgeFile()` API client，调用 `POST /api/knowledge/files/{file_id}/summary`。
   - 文档列表增加“总结”按钮，普通用户和管理员均可对当前可见文档发起总结。
   - 总结结果区展示后端返回的总结内容、来源提示和引用来源。
   - 来源展示转换为用户可读标签：正式知识来源、个人参考资料、当前会话附件。
   - 来源展示保留文件名、页码、章节和片段摘要，但不显示 `chunk_id` 或服务器真实路径。

24. Stage 14/16/17 桌面端根据资料生成内容：
   - 桌面端新增 `askKnowledgeFile()` API client，调用 `POST /api/knowledge/files/{file_id}/ask`。
   - 文档列表增加“根据此资料生成”按钮，针对当前可见文档生成结构化工作草稿。
   - 当前默认问题为“请根据这个文档生成一份可直接编辑的工作草稿，保留核心依据、结构化输出，并在末尾标明参考来源。”
   - 生成结果区展示后端返回内容、来源提示和引用来源。
   - 个人资料来源显示为“个人参考资料”，正式资料来源显示为“正式知识来源”，不展示 `chunk_id` 或服务器真实路径。

25. Stage 7/17 桌面端管理员 RAG 启停：
   - 桌面端新增 `enableKnowledgeFileRag()` 和 `disableKnowledgeFileRag()` API client。
   - 管理员查看 `official_knowledge` 文档时显示“启用 RAG”或“禁用 RAG”按钮。
   - 启停操作分别调用 `POST /api/knowledge/files/{file_id}/enable-rag` 和 `/disable-rag`。
   - 操作成功后更新当前文档卡片的 `RAG：开启/关闭` 状态，并切换按钮。
   - 普通用户不显示该按钮；后端仍保留管理员权限校验和正式知识文档限制。

26. Stage 8/17 桌面端管理员审核通过/驳回：
   - 桌面端新增 `approveKnowledgeFileReview()` 和 `rejectKnowledgeFileReview()` API client。
   - 管理员查看 `review_status=pending` 的文档时显示“审核通过”和“审核驳回”按钮。
   - “审核通过”调用 `POST /api/knowledge/files/{file_id}/approve`，传递正式知识库、权限范围、RAG 范围、分类、文档类型和标签。
   - “审核驳回”调用 `POST /api/knowledge/files/{file_id}/reject`，写入桌面端驳回备注。
   - 操作成功后用后端返回值刷新当前文档卡片，隐藏审核按钮，并显示最新 `usage_type`、审核状态和 RAG 状态。
   - 普通用户不显示审核按钮；后端仍负责角色和状态校验。

27. Stage 7/17 桌面端管理员重新解析：
   - 桌面端新增 `reparseKnowledgeFile()` API client。
   - 管理员查看 `official_knowledge` 文档时显示“重新解析”按钮。
   - 操作调用 `POST /api/knowledge/files/{file_id}/reparse`，由后端基于原始文件清理旧 chunks 并重新解析。
   - 操作成功后用后端返回值刷新当前文档卡片，展示最新 chunk 数和解析/索引状态。
   - 普通用户不显示该管理员操作；后端仍负责权限和文档状态校验。

28. Stage 7/17 桌面端文档归档与回收站：
   - 桌面端新增 `listKnowledgeFileTrash()`、`archiveKnowledgeFile()`、`restoreKnowledgeFile()`、`hardDeleteKnowledgeFile()` API client。
   - 管理员知识库页面增加“查看回收站 / 查看文档列表”切换。
   - 管理员查看正式知识文档时显示“归档”按钮，调用 `POST /api/knowledge/files/{file_id}/archive`。
   - 归档成功后刷新当前文档卡片状态，展示 `状态：ARCHIVED`，并显示 `RAG：关闭`。
   - 回收站列表调用 `GET /api/knowledge/files/trash`，展示已删除文档状态但不暴露服务器路径。
   - 回收站文档支持“恢复”和“彻底删除”：
     - 恢复调用 `POST /api/knowledge/files/{file_id}/restore`。
     - 彻底删除调用 `DELETE /api/knowledge/files/{file_id}/hard-delete?confirm=true`。
   - 彻底删除仅在回收站出现；后端仍负责二次确认参数、权限和文件状态校验。

29. Stage 4/5/8/17 桌面端知识库页面上传入口：
   - 桌面端扩展 `uploadKnowledgeFile()` API client，支持 `usage_type`、`review_status`、`rag_enabled`、`reference_enabled`、`rag_scope`、`permission_scope`、`category`、`document_type` 和 `tags`。
   - 普通用户知识库页面支持上传资料并选择：
     - 仅用于当前会话（提示应在聊天窗口上传）。
     - 保存到我的资料。
     - 提交管理员审核。
   - 普通用户上传到“我的资料”时固定为 `personal_reference`、`draft`、`rag_enabled=false`、`rag_scope=personal`、`permission_scope=private`。
   - 管理员知识库页面支持上传正式知识文件，并传递正式知识库 ID、分类、文档类型和标签。
   - 管理员上传正式知识时固定为 `official_knowledge`、`official`、`rag_enabled=true`、`rag_scope=company`、`permission_scope=company`。
   - 上传成功后将后端返回的文档插入当前列表并显示上传结果；上传控件保持唯一可访问名称，避免读屏和自动化测试重复匹配。

30. Stage 14/18/19 桌面端聊天显式引用个人资料和当前附件：
   - 聊天窗口新增“引用资料”选择器，默认“仅正式知识库”。
   - 用户可显式选择：
     - 正式知识库 + 我的资料。
     - 正式知识库 + 当前附件。
     - 正式知识库 + 我的资料和当前附件。
   - `prepareChat()` 请求新增 `include_personal_references` 和 `include_session_attachments`，不再默认把个人资料混入正式知识问答。
   - 后端 `ChatPrepareIn` 接收显式引用开关，并传入 `LoopRunner`。
   - `LoopRunner` 仅在用户显式选择时检索 `personal_reference` / `session_attachment`，并将结果放入 `personal_reference_context`，同时保留来源引用。
   - 个人资料和当前附件仍标记为非正式参考资料，不作为公司正式知识依据。

31. Stage 9/17 桌面端管理员分类、文档类型和标签编辑：
   - 桌面端新增 `updateKnowledgeFileMetadata()` API client，调用 `PATCH /api/knowledge/files/{file_id}`。
   - 管理员查看正式知识文档时显示“编辑分类标签”按钮。
   - 编辑表单支持修改分类、文档类型和标签；标签用逗号或中文逗号分隔后提交为数组。
   - 保存成功后用后端返回值刷新当前文档卡片，展示最新分类、文档类型和标签。
   - 普通用户不显示正式知识文档的编辑入口；后端仍负责 `_can_manage_file` 权限校验，防止越权修改。

### 本批验证

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
.venv/bin/python -m pytest tests/test_knowledge_bases.py tests/test_knowledge_upload_routes.py tests/test_knowledge_review_routes.py tests/test_knowledge_file_management_routes.py tests/test_knowledge_query_routes.py tests/test_migrations.py tests/test_models.py tests/test_knowledge_files.py tests/test_knowledge_search.py tests/test_chat_api.py tests/test_chat_word_export.py tests/test_context_builder.py tests/test_personal_reference_routes.py -q
```

结果：`86 passed, 1 warning`。

全量 `server/.venv/bin/python -m pytest -q` 当前在收集阶段因既有 desktop update 测试失败：

```text
ImportError: cannot import name 'create_engine_for_url' from 'app.database'
```

该失败不属于本批知识库/RAG 改动范围，后续可单独处理 desktop update 测试依赖。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- tests/chat-page.test.tsx
npm run typecheck
```

结果：`chat-page.test.tsx` 15 passed；`tsc --noEmit` 通过。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
.venv/bin/python -m pytest tests/test_chat_api.py tests/test_context_builder.py tests/test_knowledge_search.py -q
```

结果：`22 passed, 1 warning`。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- tests/admin-navigation.test.tsx
npm run typecheck
```

结果：`admin-navigation.test.tsx` 19 passed；`tsc --noEmit` 通过。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
.venv/bin/python -m pytest tests/test_knowledge_file_management_routes.py::test_owner_can_update_personal_file_metadata tests/test_knowledge_file_management_routes.py::test_employee_cannot_update_official_file_metadata -q
```

结果：`2 passed, 1 warning`。

备注：受当前沙盒限制，测试启动时 shell 打印 `/Users/zhanglei/.rvm/scripts/rvm:29: operation not permitted: ps`；Vitest 和 TypeScript 校验均已正常执行并通过。

32. Stage 7/8 后端解析格式扩展：
   - `knowledge_files.py` 的知识文件支持范围从 `txt/md/docx` 扩展为 `txt/md/docx/pdf/xlsx/csv`。
   - CSV 使用 UTF-8/UTF-8 BOM 解码并按表格行输出为 `单元格 | 单元格`，尽量保留表格结构。
   - XLSX 使用标准库读取工作表 XML，支持 inline string 和 shared string，按行保留表格文本。
   - PDF 优先尝试 `pypdf`（如果运行环境安装），未安装时使用基础 PDF 文本字面量提取兜底；扫描件或图片型 PDF 无文本时返回“需要 OCR 后再上传”的明确错误。
   - 新增测试覆盖 csv / xlsx / pdf 上传后的 chunk 解密文本，确认内容进入现有加密 chunk 流程。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
.venv/bin/python -m pytest tests/test_knowledge_files.py tests/test_knowledge_search.py tests/test_knowledge_upload_routes.py tests/test_knowledge_query_routes.py -q
```

结果：`25 passed, 1 warning`。

33. Stage 8/17 桌面端解析效果提示：
   - 知识库页面选择上传文件后，根据文件后缀展示解析效果提示。
   - PDF 提示会尝试提取可复制文本，扫描件或图片型 PDF 需要先 OCR，否则解析效果可能较差。
   - XLSX / CSV 提示会按行解析并尽量保留单元格关系，复杂合并单元格建议先整理后上传。
   - DOCX / TXT / MD 提供对应解析说明，未知格式显示当前支持范围。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- tests/admin-navigation.test.tsx
npm run typecheck
```

结果：`admin-navigation.test.tsx` 20 passed；`tsc --noEmit` 通过。

34. Stage 14/22 Word 导出参考来源隔离：
   - 聊天 Word 导出会在文档末尾追加“参考来源”。
   - 正式知识来源显示为“公司知识库 / 正式知识来源”，保留文件名、页码和章节。
   - 个人参考资料显示为“我的上传文件，仅用于本次内容生成”，并追加“本文参考用户个人上传资料生成，仅供用户本人使用。”。
   - 当前会话附件显示为“当前会话附件”，并追加“本文参考当前会话附件生成，仅供本次会话使用。”。
   - 来源去重后编号保持连续；不把 `chunk_id` 或服务器真实路径写入 Word。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_chat_word_export.py tests/test_chat_api.py tests/test_context_builder.py tests/test_knowledge_search.py -q
```

结果：`25 passed, 1 warning`。

35. Stage 15/17 知识库操作结果来源可点击预览：
   - 知识库页面的“文档总结 / 文档生成结果”来源列表中，带 `file_id` 的来源文件名渲染为可点击按钮。
   - 点击来源时调用 `/api/knowledge/files/{file_id}/preview`，如果来源带 `chunk_id` 则只请求对应片段（`top_k=1`），否则请求前 3 个片段。
   - 预览结果复用现有“文档预览”区域展示文件名、提示语、页码、章节和片段文本。
   - 用户界面仍不展示 `chunk_id`，只把它作为后端定位片段参数使用。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- tests/admin-navigation.test.tsx -t "summarizes a visible knowledge file with source labels"
npm test -- tests/admin-navigation.test.tsx
npm run typecheck
```

结果：定向测试 1 passed；`admin-navigation.test.tsx` 20 passed；`tsc --noEmit` 通过。

36. Stage 15/17 知识库页面“问这个文档”：
   - 知识库文件卡片新增问题输入框和“问这个文档”按钮。
   - 用户可针对单个可见文档输入自定义问题，桌面端调用现有 `/api/knowledge/files/{file_id}/ask`。
   - 请求保持 `mode=normal`、`top_k=6`、`include_sources=true`，继续返回答案、提示语和来源。
   - 结果展示复用“文档问答结果”区域；来源仍按正式知识 / 个人参考资料 / 当前会话附件区分，并隐藏 `chunk_id`。
   - 空问题会在页面显示明确提示，不发送请求。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- tests/admin-navigation.test.tsx -t "asks a custom question about a visible knowledge file"
npm test -- tests/admin-navigation.test.tsx
npm run typecheck
```

结果：定向测试 1 passed；`admin-navigation.test.tsx` 21 passed；`tsc --noEmit` 通过。

37. Stage 14/22 知识库操作结果导出 Word：
   - 新增 `POST /api/export/word/content`，用于导出未落入聊天会话的临时知识库操作结果。
   - 请求包含标题、正文、模板和来源列表；服务端复用现有聚信 Word 模板、导出文件保存和下载权限校验。
   - 导出的 Word 会在末尾保留参考来源，按正式知识 / 个人参考资料 / 当前会话附件标注，不写入 `chunk_id` 或服务器路径。
   - 知识库页面的“文档总结 / 文档生成结果 / 文档问答结果”区域新增“导出 Word”按钮。
   - 前端复用现有 Word 下载/桌面保存路径，浏览器环境触发下载，Tauri 环境保存到本地文件。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_chat_word_export.py::test_transient_knowledge_result_word_export_keeps_reference_sources -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_chat_word_export.py tests/test_chat_api.py tests/test_context_builder.py tests/test_knowledge_search.py -q

cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- tests/admin-navigation.test.tsx -t "asks a custom question about a visible knowledge file"
npm test -- tests/admin-navigation.test.tsx
npm run typecheck
```

结果：后端定向测试 1 passed；后端相关测试 26 passed, 1 warning；前端定向测试 1 passed；`admin-navigation.test.tsx` 21 passed；`tsc --noEmit` 通过。

38. Stage 13/17 知识库操作结果保存到聊天记录：
   - 新增 `POST /api/ai/chat/knowledge-result`，用于把知识库页面的临时结果保存为一轮已完成聊天。
   - 服务端创建或复用当前用户 active 会话，写入一条 user 消息和一条 assistant 消息，内容仍使用现有加密存储。
   - assistant 消息会同步写入来源到 `ai_chat_message_sources`，后续历史详情、来源预览和会话 Word 导出可复用同一套聊天来源链路。
   - 知识库页面结果区域新增“保存到聊天记录”按钮，点击后提交问题、答案、模式和来源。
   - 保存失败会显示明确错误，不影响结果查看和 Word 导出。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_chat_api.py::test_save_knowledge_result_to_chat_history -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_chat_api.py tests/test_chat_word_export.py tests/test_context_builder.py tests/test_knowledge_search.py -q

cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- tests/admin-navigation.test.tsx -t "asks a custom question about a visible knowledge file"
npm test -- tests/admin-navigation.test.tsx
npm run typecheck
```

结果：后端定向测试 1 passed；后端相关测试 27 passed, 1 warning；前端定向测试 1 passed；`admin-navigation.test.tsx` 21 passed；`tsc --noEmit` 通过。

39. Stage 9/17 知识库页面正式文档搜索入口：
   - 桌面端新增 `searchKnowledge()` API client，对接 `POST /api/knowledge/search`。
   - 知识库页面新增“搜索正式知识库”区域，用户输入关键词后检索自己有权限访问的正式知识来源。
   - 搜索请求固定使用 `mode=knowledge`、`top_k=8`、`include_sources=true`。
   - 搜索结果展示来源类型、文件名、页码、章节和 snippet，不展示 `chunk_id` 或服务器路径。
   - 搜索结果文件名可点击打开对应来源片段；带 `chunk_id` 时只预览该片段（`top_k=1`）。
   - 空搜索、无结果和接口异常都有明确页面提示。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- tests/admin-navigation.test.tsx -t "searches accessible official knowledge"
npm test -- tests/admin-navigation.test.tsx
npm run typecheck
```

结果：定向测试 1 passed；`admin-navigation.test.tsx` 22 passed；`tsc --noEmit` 通过。

40. Stage 10/17 知识库页面个人参考资料搜索入口：
   - 桌面端新增 `searchPersonalReference()` API client，对接 `POST /api/personal-reference/search`。
   - 知识库页面的搜索区新增“正式知识来源 / 我的资料搜索”范围选择。
   - 选择“正式知识来源”时继续调用 `/api/knowledge/search`，只检索 `official_knowledge`。
   - 选择“我的资料搜索”时调用 `/api/personal-reference/search`，只检索当前用户自己的个人参考资料。
   - 个人资料搜索结果显示为“个人参考资料”，展示文件名、章节和 snippet，不展示 `chunk_id` 或服务器路径。
   - 个人资料搜索结果来源可点击预览对应片段，继续复用 `/api/knowledge/files/{file_id}/preview`。
   - 页面提示明确写出“仅供当前用户使用”，避免把个人资料误认为公司正式知识来源。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- tests/admin-navigation.test.tsx -t "searches personal reference material"
npm test -- tests/admin-navigation.test.tsx
npm run typecheck
```

结果：定向测试 1 passed；`admin-navigation.test.tsx` 23 passed；`tsc --noEmit` 通过。

41. Stage 13/17 聊天窗口知识资料快捷入口：
   - 聊天输入区旁新增快捷按钮：`知识库`、`我的资料`、`当前附件`。
   - `知识库` 会切换到知识库问答模式，并保持只检索正式知识来源。
   - `我的资料` 会切换到知识库问答模式，并将 `include_personal_references=true` 传给 prepare API。
   - `当前附件` 会切换到知识库问答模式，并将 `include_session_attachments=true` 传给 prepare API。
   - 快捷按钮和顶部“引用资料”下拉框共用同一套 `referenceScope` 状态，避免两套入口语义不一致。
   - 上传入口文案从“上传”调整为“上传附件”，更贴合普通用户语境。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- tests/chat-page.test.tsx -t "offers composer shortcuts"
npm test -- tests/chat-page.test.tsx
npm run typecheck
```

结果：定向测试 1 passed；`chat-page.test.tsx` 16 passed；`tsc --noEmit` 通过。

42. Stage 13/17 聊天上传后的引用状态反馈：
   - 聊天窗口上传并“保存到我的资料”后，自动切换到知识库问答模式。
   - 上传成功后自动启用“我的资料”引用范围，下一次发送会携带 `include_personal_references=true`。
   - 上传状态文案明确提示：当前对话已启用“我的资料”引用，减少用户不知道资料是否会被参考的问题。
   - 当前会话附件上传成功后同样会自动启用“当前附件”引用范围；若已经启用个人资料，会保持组合引用状态。
   - 提交管理员审核仍只显示审核状态，不自动把待审核资料当作正式知识来源。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- tests/chat-page.test.tsx -t "enables personal reference scope after saving an uploaded material"
npm test -- tests/chat-page.test.tsx
npm run typecheck
```

结果：定向测试 1 passed；`chat-page.test.tsx` 17 passed；`tsc --noEmit` 通过。

43. Stage 13/17 聊天窗口当前可引用资料清单：
   - 聊天窗口新增“当前可引用资料”区域，上传保存到“我的资料”或“当前附件”后会显示文件名和来源类型。
   - 清单明确提示这些资料只作为本次对话的非正式参考，不会进入公司正式知识库。
   - 用户可对单个已上传资料点击“关闭引用”，页面会同步从当前引用清单移除。
   - 当关闭最后一个“我的资料”引用时，顶部“引用资料”下拉框自动回到“仅正式知识库”，下一次发送不再携带 `include_personal_references=true`。
   - 切换会话、新建会话、彻底删除当前会话时会清空本地可引用资料清单，避免跨会话误用临时上下文。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- tests/chat-page.test.tsx -t "lets users see and turn off uploaded personal materials before sending"
npm test -- tests/chat-page.test.tsx
npm run typecheck
```

结果：定向测试 1 passed；`chat-page.test.tsx` 18 passed；`tsc --noEmit` 通过。

44. Stage 13/14 聊天生成与 Word 导出的来源编号隔离：
   - 后端 `ContextBuilder` 注入正式知识库、个人参考资料和当前会话附件时，不再把内部 `chunk_id` 写入大模型上下文。
   - 旧 RAG helper 的 system prompt 不再要求模型在回答里输出 `chunk_id`，改为要求来源包含文件名、页码或章节。
   - `prepare` 接口返回的 `citations` 仍保留 `chunk_id`，仅用于前端点击来源时定位片段，不作为普通用户可见回答内容。
   - 这样可以降低模型把内部片段编号写进聊天回答或 Word 正文的概率，同时不影响来源预览、历史详情和 Word 参考来源。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_chat_api.py::test_knowledge_chat_prepare_returns_citations_and_persists_sources -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_chat_api.py tests/test_context_builder.py tests/test_chat_word_export.py -q
```

结果：定向测试 1 passed, 1 warning；后端相关测试 23 passed, 1 warning。

45. Stage 13/14 个人资料生成结果标注约束：
   - `ContextBuilder` 在注入个人参考资料或当前会话附件时，明确要求生成内容末尾标注“参考资料：个人上传资料 / 当前会话附件”。
   - 该要求和需求源文件中的“个人参考资料生成 Prompt”保持一致，避免模型只笼统写“参考个人资料生成”。
   - 保留“个人资料不能作为公司正式依据”的约束，防止个人资料污染正式知识库回答。
   - 相关测试覆盖 official 与 personal context 的分离顺序、正式/个人内容同时注入、以及固定标注语句。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_context_builder.py::test_chat_context_builder_separates_official_and_personal_contexts -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_context_builder.py tests/test_chat_api.py tests/test_chat_word_export.py -q
```

结果：定向测试 1 passed；后端相关测试 23 passed, 1 warning。

46. Stage 12/13 个人资料生成接口来源提示区分：
   - `/api/personal-reference/generate` 和 `/api/personal-reference/search` 的 notice 会根据实际命中的来源类型动态生成。
   - 仅命中 `personal_reference` 时提示“该内容参考用户个人上传资料生成，仅供当前用户使用。”。
   - 仅命中 `session_attachment` 时提示“该内容参考当前会话附件生成，仅供本次会话使用。”。
   - 同时命中个人资料和当前会话附件时，提示两类来源的不同使用边界。
   - 新增测试覆盖当前会话附件只返回当前会话资料，不包含其他会话附件，并返回当前附件专属 notice。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_personal_reference_routes.py::test_personal_reference_generate_marks_current_session_attachment_notice -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_personal_reference_routes.py tests/test_chat_api.py tests/test_context_builder.py tests/test_chat_word_export.py -q
```

结果：定向测试 1 passed, 1 warning；后端相关测试 26 passed, 1 warning。

47. Stage 12/13 个人资料无命中提示修正：
   - `/api/personal-reference/generate` 在没有命中个人参考资料或当前会话附件时，不再误报“参考用户个人上传资料生成”。
   - 无资料命中时返回 notice：“当前未检索到个人参考资料或当前会话附件。”。
   - system prompt 中仍保留“当前未检索到个人参考资料或当前会话附件。个人资料不能作为公司正式依据。”，让模型不能把不存在的个人资料当作来源。
   - 该行为减少普通用户误以为系统已经参考了上传资料的风险，也避免个人参考资料来源标注被错误写入生成结果或 Word 导出。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_personal_reference_routes.py::test_personal_reference_generate_reports_when_no_reference_material_found -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_personal_reference_routes.py tests/test_chat_api.py tests/test_context_builder.py tests/test_chat_word_export.py -q
```

结果：定向测试 1 passed, 1 warning；后端相关测试 27 passed, 1 warning。

48. Stage 13 聊天窗口显式附件引用修正：
   - 修复 `attachment_file_ids` 已传入但未同时携带 `include_personal_references/include_session_attachments` 时，后端不会检索指定附件的问题。
   - 当用户明确选择某个附件或个人资料文件时，聊天准备阶段会自动允许检索这些显式文件。
   - 检索仍然保留后端安全过滤：仅当前用户、private 权限、reference_enabled、已解析/已索引；当前会话附件仍限定在当前 conversation。
   - 这样前端“当前可引用资料”或手动选中文件后，不会因为缺少额外开关而丢失引用来源。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_chat_api.py::test_chat_prepare_uses_explicit_attachment_file_ids_without_extra_flags -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_chat_api.py tests/test_personal_reference_routes.py tests/test_context_builder.py tests/test_chat_word_export.py -q
```

结果：定向测试 1 passed, 1 warning；后端相关测试 28 passed, 1 warning。

49. Stage 14 正式文档导出范围修正：
   - 修复 `formal_document` 导出类型忽略 `message_id` 的问题。
   - 用户点击某条回答下方“导出聚信格式 Word”时，后端现在只整理并导出该条回答，不再把整段会话的用户问题和其他消息混入正式文档。
   - 如果 `formal_document` 传入 `selected_message_ids`，则按选中消息导出；未传 `message_id` 和 `selected_message_ids` 时，仍保留导出完整会话的能力。
   - 参考来源仍在文档末尾“参考来源”中保留，个人资料和当前会话附件的使用边界说明继续保留。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_chat_word_export.py::test_formal_document_word_export_respects_message_id_scope -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_chat_word_export.py tests/test_chat_api.py tests/test_personal_reference_routes.py tests/test_context_builder.py -q
```

结果：定向测试 1 passed, 1 warning；后端相关测试 29 passed, 1 warning。

50. Stage 13/15 聊天来源标签统一：
   - 聊天页来源标签和需求、Word 导出保持一致。
   - 正式知识库来源显示为“公司知识库 / 正式知识来源”，并同时显示页码和章节。
   - 个人资料来源显示为“我的上传文件，仅用于本次内容生成”，避免普通用户误认为其是公司正式知识依据。
   - 当前会话附件来源显示为“当前会话附件”，并同时显示页码和章节。
   - 前端普通来源列表不显示 `chunk_id`，仍保留点击来源预览时用 `chunk_id` 定位片段的能力。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- tests/chat-page.test.tsx -t "labels official, personal, and session attachment citations"
npm test -- tests/chat-page.test.tsx
npm run typecheck
```

结果：定向测试 1 passed；`chat-page.test.tsx` 19 passed；`tsc --noEmit` 通过。

51. Stage 15/17 知识库页面来源标签统一：
   - 知识库页面文档列表不再直接显示内部枚举 `official_knowledge`、`personal_reference`、`user_upload`、`admin_upload`。
   - 正式知识库文档显示为“公司知识库 / 正式知识来源”，上传来源显示为“管理员上传”。
   - 个人资料文档显示为“我的上传文件，仅用于本次内容生成”，上传来源显示为“用户上传”。
   - 搜索结果、文档总结、根据资料生成、问这个文档等区域沿用同一套来源标签，避免普通用户误把个人资料当作公司正式依据。
   - UI 仍不展示 `chunk_id`、`file_path`、`stored_file_name` 或服务器真实路径。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- tests/admin-navigation.test.tsx
npm run typecheck
```

结果：`admin-navigation.test.tsx` 23 passed；`tsc --noEmit` 通过。

52. Stage 13/16 助手模式默认正式知识库过滤：
   - 新增模式知识过滤映射，正式知识库检索会根据助手模式自动限定默认分类和文档类型。
   - 当前覆盖：商务、售前、交付、安全运维、风险评估、应急响应、软件测试、渗透测试。
   - `/api/knowledge/search`、`/api/knowledge/ask` 在用户未显式传入 filters 时，会按模式补充默认过滤；用户显式传入分类或文档类型时优先尊重用户输入。
   - 聊天 loop 的正式知识库检索同样接入该映射，避免“交付助手”把售前资料当交付依据，或“安全运维助手”检索到无关模板。
   - 该过滤只作用于 `official_knowledge` 正式知识库，不影响个人资料和当前会话附件的显式引用规则。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_knowledge_query_routes.py::test_delivery_mode_applies_default_official_knowledge_filters -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_chat_api.py::test_chat_prepare_applies_mode_default_official_knowledge_filters -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_knowledge_query_routes.py tests/test_knowledge_search.py -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_chat_api.py tests/test_context_builder.py tests/test_personal_reference_routes.py tests/test_chat_word_export.py -q
```

结果：两个定向测试均 1 passed, 1 warning；知识库检索相关测试 10 passed, 1 warning；聊天/上下文/个人资料/Word 导出相关测试 30 passed, 1 warning。

53. Stage 13/21 长期记忆与知识库边界入口：
   - `ContextBuilder.build_messages()` 新增可选 `long_term_memories` 参数，后续长期记忆服务可将相关用户偏好传入上下文。
   - system prompt 新增 `## long_term_memory` 区块，放在 conversation summary 之后、official knowledge context 之前。
   - 长期记忆区明确声明“长期记忆只用于输出偏好和默认选择，不能替代正式知识库依据”。
   - 当前实现保持兼容：现有调用不传 `long_term_memories` 时，会写入“当前未提供相关长期记忆”，不影响聊天、RAG、个人资料和 Word 导出链路。
   - 这样先建立“记忆负责偏好、知识库负责依据”的上下文边界，后续可接入真实长期记忆检索服务。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_context_builder.py::test_chat_context_builder_keeps_long_term_memory_as_preferences_not_evidence -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_context_builder.py tests/test_chat_api.py tests/test_knowledge_query_routes.py tests/test_personal_reference_routes.py tests/test_chat_word_export.py -q
```

结果：定向测试 1 passed；上下文/聊天/知识库问答/个人资料/Word 导出相关测试 37 passed, 1 warning。

54. Stage 10/12 当前会话附件检索日志类型修正：
   - `/api/personal-reference/search` 和 `/api/personal-reference/generate` 写入 `ai_knowledge_search_logs` 时，会根据实际命中的来源类型设置 `search_type`。
   - 仅命中当前会话附件时，`search_type=session_attachment`。
   - 命中个人参考资料、混合命中或无命中时，继续使用 `search_type=personal_reference`，保持第一版允许值范围内的审计分类。
   - 这样管理员后续审计时可以区分“个人资料检索”和“当前会话附件检索”，不再把所有非正式资料检索都混记为个人资料。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_personal_reference_routes.py::test_personal_reference_generate_marks_current_session_attachment_notice -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_personal_reference_routes.py tests/test_chat_api.py tests/test_context_builder.py tests/test_chat_word_export.py -q
```

结果：定向测试 1 passed, 1 warning；个人资料/聊天/上下文/Word 导出相关测试 31 passed, 1 warning。

55. Stage 10/13 聊天个人资料检索日志补齐：
   - 聊天窗口通过 `/api/ai/chat/prepare` 显式引用“我的资料”或“当前会话附件”时，也会写入 `ai_knowledge_search_logs`。
   - 日志保留当前用户、助手模式、会话 ID、显式文件 ID、个人资料/附件开关以及命中的 chunk IDs。
   - 仅命中当前会话附件时，`search_type=session_attachment`；命中个人资料、混合命中或无命中时，`search_type=personal_reference`。
   - 该变更不改变检索权限：个人资料仍只按 `owner_user_id` 检索，当前会话附件仍受 `conversation_id` 和显式文件选择约束，不进入正式 RAG。
   - 这样聊天、个人资料接口和后续审计中心的检索记录保持一致。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_chat_api.py::test_chat_prepare_uses_personal_references_only_when_explicitly_requested tests/test_chat_api.py::test_chat_prepare_uses_explicit_attachment_file_ids_without_extra_flags -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_chat_api.py tests/test_personal_reference_routes.py tests/test_knowledge_query_routes.py tests/test_context_builder.py tests/test_chat_word_export.py -q
```

结果：聊天个人资料/当前附件定向测试 2 passed, 1 warning；聊天/个人资料/知识库问答/上下文/Word 导出相关测试 37 passed, 1 warning。

56. Stage 10/13 聊天检索日志关联回答消息：
   - 聊天窗口使用个人资料或当前会话附件检索时，`ai_knowledge_search_logs.answer_message_id` 会回填本次 assistant 消息 UUID。
   - `ToolResult` 和 `LoopRunResult` 增加 `search_log_ids`，由 loop 将本次检索产生的日志 ID 带回聊天服务。
   - `prepare_chat` 在创建 assistant 消息后，按日志 ID 回填 `answer_message_id`，使检索记录、回答消息和历史来源可以被审计关联。
   - 该改动只补审计关联，不改变模型上下文、引用来源、权限过滤或用户可见内容。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_chat_api.py::test_chat_prepare_uses_personal_references_only_when_explicitly_requested tests/test_chat_api.py::test_chat_prepare_uses_explicit_attachment_file_ids_without_extra_flags -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_chat_api.py tests/test_personal_reference_routes.py tests/test_knowledge_query_routes.py tests/test_context_builder.py tests/test_chat_word_export.py -q
```

结果：聊天检索日志关联消息定向测试 2 passed, 1 warning；聊天/个人资料/知识库问答/上下文/Word 导出相关测试 37 passed, 1 warning。

57. Stage 9/10/17 文档使用统计更新：
   - 正式知识库检索和个人资料/当前附件检索命中文档后，会更新 `KnowledgeFile.usage_count` 与 `KnowledgeFile.last_used_at`。
   - 同一次检索中同一文档即使命中多个 chunk，也只累计 1 次，避免引用次数被 chunk 数放大。
   - 该统计同时覆盖 `official_knowledge`、`personal_reference` 和 `session_attachment`，用于知识库列表中的“最近使用时间”和“引用次数”展示。
   - 无命中检索不更新任何文档统计。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_knowledge_search.py::test_official_search_updates_document_usage_stats tests/test_knowledge_search.py::test_personal_reference_search_updates_document_usage_stats -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_knowledge_search.py tests/test_knowledge_query_routes.py tests/test_personal_reference_routes.py tests/test_chat_api.py tests/test_context_builder.py tests/test_chat_word_export.py -q
```

结果：文档使用统计定向测试 2 passed；知识库检索/问答/个人资料/聊天/上下文/Word 导出相关测试 43 passed, 1 warning。

58. Stage 15/17 单文档问答与总结使用统计补齐：
   - `POST /api/knowledge/files/{file_id}/ask` 命中文档 chunks 后，会更新该文档的 `usage_count` 与 `last_used_at`。
   - `POST /api/knowledge/files/{file_id}/summary` 命中文档 chunks 后，也会更新该文档的 `usage_count` 与 `last_used_at`。
   - 这样“问这个文档”“总结这个文档”和普通搜索/RAG 检索的使用统计口径保持一致。
   - 无权访问或文档不存在的请求仍返回 404，不会更新统计。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_knowledge_query_routes.py::test_ask_single_official_file_prepares_official_context tests/test_knowledge_query_routes.py::test_summarize_personal_file_uses_personal_reference_context_and_is_private -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_knowledge_query_routes.py tests/test_knowledge_search.py tests/test_personal_reference_routes.py tests/test_chat_api.py tests/test_context_builder.py tests/test_chat_word_export.py -q
```

结果：单文档问答/总结使用统计定向测试 2 passed, 1 warning；知识库查询/检索/个人资料/聊天/上下文/Word 导出相关测试 43 passed, 1 warning。

59. Stage 15/18/20 文档生命周期审计日志补齐：
   - 软删除 `DELETE /api/knowledge/files/{file_id}` 成功后写入 `KnowledgeReviewLog.action=delete`。
   - 恢复 `POST /api/knowledge/files/{file_id}/restore` 成功后写入 `KnowledgeReviewLog.action=restore`。
   - 归档 `POST /api/knowledge/files/{file_id}/archive` 成功后写入 `KnowledgeReviewLog.action=archive`。
   - 日志记录 `old_status` 与 `new_status`，后续审核历史页面可以追踪文档从 READY/ARCHIVED/DELETED 之间的状态变化。
   - 无权访问、文档不存在或操作失败时不写日志。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_knowledge_file_management_routes.py::test_soft_delete_moves_file_to_trash_and_restore_reactivates tests/test_knowledge_file_management_routes.py::test_archive_excludes_official_file_from_search_until_restore -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_knowledge_file_management_routes.py tests/test_knowledge_review_routes.py tests/test_knowledge_query_routes.py tests/test_knowledge_search.py tests/test_personal_reference_routes.py tests/test_chat_api.py tests/test_context_builder.py tests/test_chat_word_export.py -q
```

结果：生命周期审计日志定向测试 2 passed, 1 warning；文件管理/审核/知识库查询/检索/个人资料/聊天/上下文/Word 导出相关测试 63 passed, 1 warning。

60. Stage 7/23 文档分类接口补齐：
   - 新增 `POST /api/knowledge/files/{file_id}/classify`，补齐接口清单中的文档分类入口。
   - 第一版采用本地规则分类，不调用模型、不新增外部依赖；根据文件名、摘要、已有分类/类型和标签识别会议纪要、商务投标、产品交付、安全运维、风险评估、应急响应、渗透测试、软件测试、等保合规、产品资料等常见类型。
   - 默认 `apply=true`，会写回 `category`、`document_type` 和 tags；后续可以扩展为模型自动分类或只预览建议。
   - 权限沿用文档管理规则：普通用户只能分类自己的个人资料/附件，不能分类正式知识库文档；管理员可以分类正式文档。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_knowledge_file_management_routes.py::test_classify_file_updates_metadata_with_rule_based_suggestion tests/test_knowledge_file_management_routes.py::test_employee_cannot_classify_official_file_but_admin_can -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_knowledge_file_management_routes.py tests/test_knowledge_upload_routes.py tests/test_knowledge_query_routes.py tests/test_knowledge_search.py tests/test_knowledge_review_routes.py tests/test_personal_reference_routes.py tests/test_chat_api.py tests/test_context_builder.py tests/test_chat_word_export.py -q
```

结果：文档分类接口定向测试 2 passed, 1 warning；文件管理/上传/知识库查询/检索/审核/个人资料/聊天/上下文/Word 导出相关测试 69 passed, 1 warning。

61. Stage 9/11/25 正式 RAG 公司级范围过滤补强：
   - 正式 RAG 检索默认只召回 `rag_scope=company` 且 `permission_scope=company` 的正式知识库文档。
   - 避免 `project`、`department`、`admin` 范围的正式文档被普通公司级问答误召回。
   - 继续保留 `usage_type=official_knowledge`、`rag_enabled=true`、`review_status in approved/official`、解析/索引完成、未归档/未删除等既有过滤。
   - 这符合第一版“公司正式知识库”实现范围；部门/项目/客户知识库仍作为后续权限细化扩展。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_knowledge_search.py::test_official_search_uses_company_rag_scope_by_default -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_knowledge_search.py tests/test_knowledge_query_routes.py tests/test_chat_api.py tests/test_context_builder.py tests/test_personal_reference_routes.py tests/test_chat_word_export.py -q
```

结果：正式 RAG 范围过滤定向测试 1 passed；知识库检索/问答/聊天/上下文/个人资料/Word 导出相关测试 44 passed, 1 warning。

62. Stage 14/17/20 导出来源与预览链路恢复核验：
   - 已重新读取需求源文件，确认第一版仍要求“回答导出 Word 时带参考来源”和“点击来源可以看到对应文件或片段”。
   - 复核后端 `chat_word_export.py`：单条回答、选中消息、完整会话、正式文档和临时知识库结果导出均复用同一套来源追加逻辑。
   - 复核桌面端 `ChatPage.tsx` 与 `KnowledgePage.tsx`：引用来源使用 `file_uuid/file_id + chunk_id` 打开 `/api/knowledge/files/{file_id}/preview`，普通界面不展示内部 `chunk_id` 或服务器路径。
   - 已单独运行聊天 Word 导出测试，确认当前 5 个导出用例通过。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_chat_word_export.py -q
```

结果：`5 passed, 1 warning`。

63. 后端全量回归恢复核验：
   - 补齐 `app.database.create_engine_for_url()` 与 `get_session_for_url()`，恢复 desktop update 模型/服务/API 测试对独立 SQLite 数据库的复用入口。
   - 修复 `GovernanceError` 使用 frozen slots dataclass 导致 FastAPI/AnyIO 无法写入 `__traceback__` 的问题，业务错误现在能稳定进入全局 JSON 异常处理器。
   - 修正 desktop update API/并发测试对环境变量的污染：测试内使用合法 URL-safe base64 内容加密密钥，并通过 `monkeypatch` 自动恢复。
   - 补齐 desktop update 服务层局部 DB fixture，并让文件名路径穿越错误文案显式包含 `/`。
   - 同步 V1.10 手册 3 个销售任务的 manifest/report 审计候选与哈希，保持 `manual-v1.10.json`、`manual-v1.10-report.json` 与 `assistants.json` 一致。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_desktop_update_models.py tests/test_desktop_update_service.py tests/test_desktop_update_api.py tests/test_desktop_update_concurrency.py -q
PYTHONPATH=. .venv/bin/python -m pytest tests/test_catalog.py::test_catalog_contains_every_v110_manifest_task tests/test_manual_compiler.py -q --tb=short
PYTHONPATH=. .venv/bin/python -m pytest -q --tb=short
```

结果：desktop update 目标测试 `19 passed, 2 warnings`；catalog/manual 目标测试 `26 passed`；后端全量 `395 passed, 2 warnings`。

64. 桌面端聊天/知识库前端回归核验：
   - 抽样运行 `tests/chat-page.test.tsx` 与 `tests/admin-navigation.test.tsx`，覆盖聊天窗口、模式切换、个人资料/当前附件引用、来源标签、来源预览、聊天回答导出 Word、知识库管理入口与管理员导航。
   - 扩展运行桌面端全量 Vitest，覆盖工作台、全部助手、历史记录、个人模型、任务生成、上传附件、Word 导出、权限导航、启动页等既有页面。
   - 运行 TypeScript 类型检查与 Vite Web 构建，确认当前前端代码可编译。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- tests/chat-page.test.tsx tests/admin-navigation.test.tsx
npm test
npm run typecheck
npm run build
```

结果：聊天/知识库关键抽样 `2 files, 42 tests passed`；桌面端全量 `17 files, 157 tests passed`；`tsc --noEmit` 通过；`vite build` 通过。

65. Tauri/Rust 桌面壳层回归核验：
   - 运行 `src-tauri` Rust 测试，覆盖本地模型请求与续写、API Key 本地加密文件存储、模型配置迁移、局域网/HTTPS 地址策略、统一登录本地绑定、草稿/待同步隔离、窗口 IPC 安全、自动更新策略与下载状态管理。
   - 该核验对应“本地 Tauri 模型与钥匙串边界”“允许局域网测试地址”“自动更新提示与安全发布边界”等桌面端约束。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src-tauri
cargo test
```

结果：全部 Rust unit/integration/doc tests 通过；主要分组包括 `model_client`、`keychain`、`model_profile_security`、`server_config`、`local_security`、`window_security`、`update_manager`、`updater_policy`。

66. 运行态服务启动与统一登录入口核验：
   - 使用 Docker Compose 构建并启动最新 `ai-assistant-api` 与 `web-ai-assistant`，依赖服务包括 MySQL、统一登录、Prompt Center。
   - `http://localhost:5193/health` 返回 `{"status":"ok","service":"juxin-ai-assistant","version":"1.0.0"}`。
   - `http://localhost:18093` 未登录状态下会进入“聚信统一登录平台 v5.105.3”，说明 Web 入口到统一登录的跳转链路可达。
   - `docker compose ps` 显示 `ai-assistant-api` healthy，`auth`、`prompt-center-api`、`mysql`、`web-ai-assistant` 均已启动。
   - 登录后的聊天/知识库/上传/来源预览/导出 Word 路径仍需用户输入真实账号、密码和验证码后人工继续核验。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new
docker compose up -d --build ai-assistant-api web-ai-assistant
curl -fsS http://localhost:5193/health
curl -fsSI http://localhost:18093
curl -fsSI 'http://localhost:5180/portal?system=ai-assistant'
```

结果：服务启动成功；API health 正常；统一登录页面 HTTP 200；Web 未登录入口显示统一登录页面。

67. 桌面端 SSO 回跳参数清理修复：
   - 发现运行态登录回跳后浏览器地址栏仍可能残留统一登录 handoff 参数。
   - 根因：桌面端 API client 只消费并清理 `sso_token`，未清理同一回跳链路中的 `portal_session`；进一步运行态核验发现 Web 浏览器 session accepted 后也会残留 `sso_token/portal_session`。
   - 修复：抽出 `clearSsoCallbackParams()`，桌面读取 SSO handoff token 后清理；Web/App session accepted 后也清理，避免敏感回跳参数继续停留在地址栏或历史记录中。
   - 补充测试：`tests/session.test.tsx` 覆盖“桌面端 SSO handoff”和“Web session accepted”两个场景，均要求 URL 不再包含 SSO callback 参数。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- tests/session.test.tsx
npm test -- tests/session.test.tsx tests/chat-page.test.tsx tests/employee-flow.test.tsx
```

结果：`tests/session.test.tsx` `8 passed`；会话/聊天/员工流抽样 `3 files, 30 tests passed`。

更新结果：`tests/session.test.tsx` `9 passed`；会话/聊天/员工流抽样 `3 files, 31 tests passed`；桌面端全量 Vitest 最新 `17 files, 158 tests passed`；Chrome 登录态刷新后 query keys 为空。

68. MySQL 真实迁移失败修复：
   - Docker Compose 重建最新 Web/API 时，`ai-assistant-db-init` 在 MySQL 上执行 `0011_knowledge_document_management` 失败。
   - 根因：迁移中对 `TEXT` 字段 `description` 与 `comment` 设置了 `server_default=""`，SQLite 可通过但 MySQL 不允许 `TEXT/BLOB/JSON` 字段设置默认值。
   - 修复：移除这两个 `TEXT` 字段的数据库默认值；业务默认仍由服务层写入。
   - 补充测试：`tests/test_migrations.py::test_knowledge_migration_does_not_set_defaults_on_mysql_text_or_json_columns` 静态检查 0011 迁移，防止后续再把 `Text/JSON + server_default` 混入 MySQL 迁移。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
PYTHONPATH=. .venv/bin/python -m pytest tests/test_migrations.py -q --tb=short
PYTHONPATH=. .venv/bin/python -m pytest -q --tb=short
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new
docker compose up -d --build web-ai-assistant
curl -fsS http://localhost:5193/health
```

结果：migration 测试 `12 passed`；后端全量最新 `396 passed, 2 warnings`；Docker Compose 真实 MySQL migration/db-init/API/Web 启动链路通过；API health 正常。

69. 登录后运行态页面核验：
   - Chrome 已登录态刷新 `http://localhost:18093/` 后，工作台正常显示，URL 查询参数为空。
   - 点击“打开 AI 对话”可进入聊天页。
   - 聊天页显示历史会话、归档会话、回收站、批量归档/删除、导出当前回答、新建对话、上传附件、知识库、我的资料、当前附件等控件。
   - 聊天模式下拉显示普通助手、销售助手、商务助手、行政人力助手、售前助手、交付助手、软测助手、渗透测试助手、安全运维助手、风险评估助手、应急响应助手、知识库问答。
   - 当前运行态显示“模型：未配置”，因此未发起真实模型生成；Chrome 扩展环境拒绝 `filechooser.setFiles`，所以真实 UI 文件选择上传仍需人工点选或改用后续 e2e 环境继续核验。

70. 知识库无依据回答不依赖本地模型配置：
   - 运行态发现：聊天页处于“模型：未配置”时，选择“知识库问答”并发送正式知识库无命中问题，前端会在调用后端检索前直接提示“请先配置个人模型”，导致本应由后端返回的 no-evidence 固定回答无法展示。
   - 根因：`ChatPage.send()` 在调用 `prepareChat()` 之前统一检查 `activeProfile`；但知识库问答的“无正式来源”分支不需要本地模型生成，应先让后端执行正式知识库检索和编造防护判断。
   - 修复：普通聊天仍在发送前要求模型配置；知识库问答先调用 `prepareChat()`。如果后端返回 `completed=true`，直接展示“当前知识库未找到明确依据”等固定回答；只有后续确实需要本地模型生成时，才提示配置个人模型。
   - 补充测试：`tests/chat-page.test.tsx` 增加无模型配置下知识库 no-evidence 仍可返回的用例，并断言不会调用 `generateLocalModel()`。
   - 运行态复测：选择“知识库问答”，发送无命中问题，页面返回“当前知识库未找到明确依据”，未出现“请先配置个人模型”或“聊天生成失败”；回答下方显示“导出 Word”，点击后提示“Word 已开始下载”。

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- tests/chat-page.test.tsx -t "allows knowledge no-evidence"
npm test -- tests/chat-page.test.tsx
npm test
```

结果：定向 no-evidence 测试 `1 passed`；聊天页全量 `20 passed`；桌面端全量 Vitest 最新 `17 files, 159 tests passed`。

71. 运行态正式知识库上传/解析/检索闭环核验：
   - 由于 Chrome 扩展环境拒绝自动化 `filechooser.setFiles`，本轮改用真实 HTTP multipart 方式验证运行态后端链路。
   - 使用本地开发统一登录短期 session，并带受信任来源 `Origin: http://localhost:18093` 调用运行态 API；未输出 token，不记录任何凭据。
   - 验证链路：创建公司知识库 → 上传正式知识库 txt 文档 → 自动解析/切片/索引 → 正式知识库搜索 → `/api/knowledge/ask` 准备正式 RAG 上下文 → 文件预览来源片段 → 软删/彻底删除临时文档 → 清理临时知识库和 auth session。
   - 结果证明运行态接口已满足：`usage_type=official_knowledge`、`review_status=official`、`rag_enabled=true`、`parse_status=parsed`、`index_status=indexed`、生成 chunks、正式检索只返回 `official_knowledge` 来源、预览响应不暴露服务器路径。
   - 验证后已检查数据库，`runtime-kb-%` 临时知识库与文件残留为 0。

运行态摘要：

```text
runtime_upload_status=ok usage=official_knowledge review=official rag=true parse=parsed index=indexed chunks=2
runtime_search_total=2 first_source_kind=official_knowledge
runtime_ask_sources=2 notice=本次回答应仅依据正式知识库资料生成；来源需显示文件名、章节或页码。
runtime_preview_chunks=2 preview_path_leak=false
runtime_bases=0
runtime_files=0
```

72. 运行态 RAG 回答导出 Word 下载与内容核验：
   - 本轮验证真实运行态 `/api/export/word`，路径为：正式知识库上传 → `/api/knowledge/ask` 获取正式来源 → `/api/ai/chat/knowledge-result` 保存为聊天 AI 回复 → `/api/export/word` 导出当前回答 → `/api/export/download/{file_id}` 下载 `.docx`。
   - 下载后使用 `zipfile` 解包 `.docx`，检查 `word/document.xml`、页眉和页脚 XML，不依赖浏览器下载事件。
   - 已验证 `.docx` 可识别，包含本次回答正文、表格文本、“参考来源”、正式来源标签“公司知识库 / 正式知识来源”、聚信得仁页眉或页脚。
   - 已验证导出内容不包含内部 `chunk_id`，不暴露 `/app/`、`/storage/`、`/Users/` 等服务器真实路径。
   - 验证后已清理临时 auth session、临时知识库、临时文档、聊天会话、导出记录和 `runtime-word-%` 残留。

运行态摘要：

```text
runtime_word_export_status=ok ask_sources=2 docx_bytes=39980
runtime_word_docx_check={"is_docx": true, "has_run_id": true, "has_reference_sources": true, "has_official_source_label": true, "has_juxin_header_or_footer": true, "has_table_text": true, "leaks_chunk_id": false, "leaks_server_path": false}
runtime_word_bases=0
runtime_word_files=0
runtime_word_exports=0
```

73. 运行态 Web 代理修复与聊天来源点击预览核验：
   - 运行态 UI 自动化前发现 `web-ai-assistant` 的 Nginx 只代理 `/api/ai` 和 `/api/export`，而桌面端知识库/个人资料/会话功能还会调用 `/api/knowledge`、`/api/personal-reference`、`/api/conversations`。
   - 根因：Web 容器和 Vite 开发代理缺少这些 API 前缀，导致知识库创建、聊天会话列表等请求在 Web 容器下返回 405；首次修复中使用带变量的 `proxy_pass ...$request_uri` 又触发 Nginx 502，最终改为静态 upstream 并保留完整 URI。
   - 修复：
     - `apps/desktop/vite.config.ts` 统一代理 `/api/ai`、`/api/export`、`/api/knowledge`、`/api/personal-reference`、`/api/conversations` 到 `http://127.0.0.1:5193`。
     - `apps/desktop/nginx.conf` 用正则 location 覆盖上述 API 前缀，并代理到 `http://ai-assistant-api:5193`。
     - 新增 `tests/proxy-config.test.ts` 防止后续新增 API 前缀漏配代理。
   - 重建 Web 容器后，未登录状态访问 `/api/ai/session`、`/api/knowledge/bases`、`/api/conversations` 均返回 401，证明请求已进入后端而不是 Nginx 静态层。
   - 运行态 UI 验证链路：创建临时公司知识库 → 上传正式知识文档 → `/api/knowledge/ask` 获取正式来源 → `/api/ai/chat/knowledge-result` 保存聊天记录 → Playwright 打开 `http://localhost:18093` → 点击“打开 AI 对话” → 选择该会话 → 点击正式来源按钮 → 打开“来源预览”区域。
   - 已验证来源按钮显示“公司知识库 / 正式知识来源”，来源预览区域显示文件名和对应片段；预览区域不包含 `/app/`、`/storage/`、`/Users/` 等服务器真实路径，也不显示内部 `chunk_id`。
   - 验证后已清理临时 auth session、临时知识库、临时文档、临时聊天会话和相关残留。

运行态摘要：

```text
runtime_ui_source_preview_status=ok sources=2 console_errors=0
runtime_ui_cleanup_bases=0
runtime_ui_cleanup_files=0
runtime_ui_cleanup_chats=0
```

74. 运行态普通用户真实 UI 文件上传核验：
   - 针对剩余弱证据“真实 UI 文件选择上传”，使用普通用户登录态在运行态 Web 页面执行真实上传路径。
   - 先发现上传弹窗按钮会被右下角固定主题切换器拦截点击；根因是 `.chat-upload-dialog` 缺少 fixed overlay 和高于 `.theme-switcher` 的 z-index。
   - 修复：
     - `apps/desktop/src/theme/tokens.css` 为聊天上传弹窗增加 fixed overlay、z-index、居中卡片和可滚动内容区。
     - `apps/desktop/tests/proxy-config.test.ts` 增加 modal layering 测试，要求上传弹窗高于主题切换器。
   - 重建 `web-ai-assistant` 后，使用 Playwright 真实操作：
     - 普通用户打开 AI 对话；
     - 对 `aria-label="上传知识文件"` 的文件输入设置 txt 文件；
     - 上传弹窗选择“保存到我的资料”；
     - 真实点击“开始上传”；
     - 页面显示“资料已保存到我的资料”，并在“当前可引用资料”区域显示该文件与“我的资料”标签。
   - 后端运行态核验：
     - `GET /api/knowledge/files` 中该文件为 `usage_type=personal_reference`、`review_status=draft`、`rag_enabled=false`、`permission_scope=private`、`rag_scope=personal`。
     - `/api/knowledge/search` 对该文件关键词返回 `total=0`，证明没有进入正式 RAG。
     - `/api/personal-reference/search` 可检索到该文件，来源为 `personal_reference`。
     - 普通用户上传界面未暴露“加入公司知识库 / 启用公司级 RAG / 设为正式知识”等管理员选项。
   - 验证后已清理临时 auth session、临时上传文件、知识文件、chunks 和检索日志。

运行态摘要：

```text
runtime_ui_upload_status=ok usage=personal_reference rag=false official_total=0 personal_sources=2 console_errors=0
runtime_ui_upload_cleanup_files=0
runtime_ui_upload_cleanup_logs=0
```

补充回归：

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm test -- tests/proxy-config.test.ts tests/chat-page.test.tsx
npm test
npm run build
```

结果：proxy/chat 抽样 `2 files, 23 tests passed`；桌面端全量 `18 files, 162 tests passed`；`tsc --noEmit && vite build` 通过。

## 验收标准证据矩阵（2026-06-30 恢复核验）

| # | 验收项 | 当前证据 | 状态 |
|---|---|---|---|
| 1 | 普通用户上传文件后默认 `rag_enabled=false` | `tests/test_models.py::test_ordinary_user_knowledge_file_defaults_to_private_reference`、上传路由测试；运行态普通用户 UI 上传后 `rag=false` | 已覆盖 |
| 2 | 普通用户上传文件只能用于当前会话或个人资料参考 | `tests/test_knowledge_upload_routes.py`、`tests/test_chat_api.py` 显式引用开关；运行态普通用户 UI 上传落为 `personal_reference/private/personal` | 已覆盖 |
| 3 | 普通用户上传文件不会被其他用户检索 | `tests/test_knowledge_search.py::test_personal_reference_search_retrieves_owner_reference_and_current_session_only` | 已覆盖 |
| 4 | 普通用户上传文件不会进入公司级 RAG | `tests/test_knowledge_search.py` official 检索边界、`tests/test_chat_api.py` personal 显式引用；运行态 UI 上传后 `/api/knowledge/search` 返回 `total=0` | 已覆盖 |
| 5 | 普通用户可基于自己上传文件生成文案、方案、纪要、报告草稿 | `tests/test_personal_reference_routes.py`、`apps/desktop/tests/admin-navigation.test.tsx` 文档生成；运行态 UI 上传后 `/api/personal-reference/search` 返回该个人资料来源 | 已覆盖 |
| 6 | 个人资料生成内容来源显示为个人参考资料或当前会话附件 | `tests/test_personal_reference_routes.py`、`tests/test_context_builder.py`、前端来源标签测试 | 已覆盖 |
| 7 | 管理员上传正式知识库文档可以进入 RAG | `tests/test_knowledge_upload_routes.py`、`tests/test_knowledge_search.py`；运行态 HTTP multipart 验证 `usage=official_knowledge/rag=true/parse=parsed/index=indexed` | 已覆盖 |
| 8 | 管理员审核通过文档可以进入 RAG | `tests/test_knowledge_review_routes.py` | 已覆盖 |
| 9 | 正式 RAG 只检索 `official_knowledge` | `tests/test_knowledge_search.py`、`tests/test_knowledge_query_routes.py` | 已覆盖 |
| 10 | `personal_reference` 不污染 `official_knowledge` 回答 | `tests/test_chat_api.py`、`tests/test_context_builder.py` | 已覆盖 |
| 11 | 普通用户不能通过接口直接设为 official | `tests/test_knowledge_upload_routes.py` | 已覆盖 |
| 12 | 用户可以创建或查看自己有权限的知识库 | `tests/test_knowledge_bases.py` | 已覆盖 |
| 13 | 支持上传 docx、pdf、xlsx、txt、md、csv | `tests/test_knowledge_files.py`、`tests/test_knowledge_upload_routes.py` | 已覆盖 |
| 14 | 用户可以设置分类、文档类型和标签 | `tests/test_knowledge_file_management_routes.py`、前端知识库编辑测试 | 已覆盖 |
| 15 | 系统可以解析文档并生成 chunks | `tests/test_knowledge_files.py`；运行态上传后 `chunks=2` | 已覆盖 |
| 16 | 文档解析、索引、RAG 状态可在列表看到 | `apps/desktop/tests/admin-navigation.test.tsx` 文档列表断言 | 已覆盖 |
| 17 | 用户可以搜索有权限知识库内容 | `tests/test_knowledge_query_routes.py`、前端正式/个人搜索测试；运行态 `/api/knowledge/search` 返回 `total=2` | 已覆盖 |
| 18 | 用户可以在聊天中启用知识库问答 | `tests/test_chat_api.py::test_knowledge_chat_prepare_returns_citations_and_persists_sources`、`apps/desktop/tests/chat-page.test.tsx`；聊天页最新 `20 passed`；桌面端关键抽样 `42 passed` | 已覆盖 |
| 19 | 正式 RAG 回答必须带正式来源 | `tests/test_chat_api.py`、`tests/test_knowledge_query_routes.py`；运行态 `/api/knowledge/ask` 返回 `sources=2` 且 `source_kind=official_knowledge` | 已覆盖 |
| 20 | 点击来源可以看到对应文件或片段 | 后端 preview 测试、`apps/desktop/tests/chat-page.test.tsx` 来源预览测试、运行态 preview `chunks=2` 且 `preview_path_leak=false`；运行态 Playwright 点击聊天来源按钮后打开“来源预览”，文件名/片段可见且不泄露路径或 chunk_id | 已覆盖 |
| 21 | 正式知识库无资料时 AI 不得编造 | `tests/test_knowledge_query_routes.py::test_knowledge_ask_without_official_sources_returns_no_evidence_answer`；`tests/chat-page.test.tsx` 覆盖未配置模型时仍返回 no-evidence 固定回答，不误触发本地模型生成 | 已覆盖 |
| 22 | 不同助手模式默认检索不同正式知识库分类 | `tests/test_knowledge_query_routes.py::test_delivery_mode_applies_default_official_knowledge_filters`、聊天模式过滤测试 | 已覆盖 |
| 23 | 用户可以对单个文档“问这个文档” | `tests/test_knowledge_query_routes.py`、前端自定义提问测试 | 已覆盖 |
| 24 | 用户可以对单个文档“总结这个文档” | `tests/test_knowledge_query_routes.py`、前端总结测试 | 已覆盖 |
| 25 | 管理员可以启用或禁用正式文档 RAG | `tests/test_knowledge_file_management_routes.py`、前端 RAG 启停测试 | 已覆盖 |
| 26 | 管理员可以重新解析文档 | `tests/test_knowledge_file_management_routes.py`、前端重新解析测试 | 已覆盖 |
| 27 | 用户可以删除自己的个人资料 | `tests/test_knowledge_file_management_routes.py`、前端删除测试 | 已覆盖 |
| 28 | 管理员可以归档或删除正式文档 | `tests/test_knowledge_file_management_routes.py`、前端归档/回收站测试 | 已覆盖 |
| 29 | 删除后的文档不参与 RAG | `tests/test_knowledge_file_management_routes.py::test_archive_excludes_official_file_from_search_until_restore` | 已覆盖 |
| 30 | RAG 回答可导出 Word 并保留参考来源 | `tests/test_chat_word_export.py`；运行态 `/api/export/word` 下载 `.docx` 解包验证：包含正文、表格、参考来源、正式来源标签、聚信得仁页眉/页脚，且不泄露 `chunk_id` 或服务器路径 | 已覆盖 |
| 31 | 不影响现有聊天、长期记忆、Word 导出、会话归档删除 | 后端全量 `396 passed, 2 warnings`；桌面端全量 `159 passed`；桌面端 `npm run typecheck` 与 `npm run build` 通过；`src-tauri cargo test` 通过 | 已覆盖 |

### 下一步

1. 当前 31 条第一版验收项均已有自动化测试或运行态证据覆盖。
2. 如需交付给用户试用，下一步按版本规则重新打包 release，并在提交前再跑一次后端/前端关键回归。
3. 第二版能力（向量检索、重排序、权限细化、版本管理、相似文档检测等）仍按原计划后续实施。
