# Chat, RAG, and Citation Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the chat window, knowledge-file chunking, RAG question answering, chat history, and citation-source display without breaking the existing task-generation workflow.

**Architecture:** Keep the accepted local-model boundary: the FastAPI server prepares context, retrieves chunks, stores sessions/messages/sources, and audits state; the Tauri desktop app continues to stream model output through the local `model_generate` command. Knowledge files and chunks live in MySQL with encrypted chunk text, while UI citation rendering is shared by chat/RAG and task-generation results.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, MySQL/SQLite tests, React, TypeScript, Vite, Tauri 2, Rust local model bridge, Vitest, Pytest.

---

## File Structure Map

### Backend

- Create `juxin-ai-assistant/server/alembic/versions/0008_chat_rag_sources.py`
  - Adds knowledge file/chunk tables and chat session/message/source tables.
- Modify `juxin-ai-assistant/server/app/models.py`
  - Adds SQLAlchemy models for knowledge files, knowledge chunks, chat sessions, chat messages, and chat message sources.
- Create `juxin-ai-assistant/server/app/knowledge_files.py`
  - Owns upload parsing, safe file metadata, chunk generation, encrypted chunk persistence, and per-user file deletion.
- Create `juxin-ai-assistant/server/app/knowledge_search.py`
  - Owns Top-K chunk retrieval across public company knowledge and current user files.
- Create `juxin-ai-assistant/server/app/chat_service.py`
  - Owns chat session creation, message prepare/complete/fail, no-result fixed answer, and citation persistence.
- Create `juxin-ai-assistant/server/app/chat_routes.py`
  - Adds `/api/ai/chat/*` API routes.
- Modify `juxin-ai-assistant/server/app/main.py`
  - Includes chat routes and exposes knowledge-file upload routes.
- Modify `juxin-ai-assistant/server/app/schemas.py`
  - Adds request/response schemas for knowledge files, chunks, chat sessions, messages, and citations.
- Modify `juxin-ai-assistant/server/app/generation_service.py`
  - Adds unified source refs for task-generation knowledge, attachment, and governance-rule usage.
- Modify `juxin-ai-assistant/server/app/history_service.py`
  - Returns citation/source refs in history details.
- Modify `juxin-ai-assistant/server/app/word_export.py`
  - Appends citation/source refs to exported Word documents when present.

### Backend Tests

- Create `juxin-ai-assistant/server/tests/test_knowledge_files.py`
  - Covers upload parsing, chunking, metadata, encryption, file type/size, path traversal, and per-user deletion.
- Create `juxin-ai-assistant/server/tests/test_knowledge_search.py`
  - Covers Top-K retrieval, no-result behavior, and user-private isolation.
- Create `juxin-ai-assistant/server/tests/test_chat_api.py`
  - Covers session list/create/detail/delete, normal chat prepare/complete/fail, RAG prepare/complete/fail, fixed no-evidence answer, and citation persistence.
- Modify `juxin-ai-assistant/server/tests/test_generation_flow.py`
  - Covers task-generation citation refs for knowledge and attachments.
- Modify `juxin-ai-assistant/server/tests/test_history.py`
  - Covers source refs in history details.
- Modify `juxin-ai-assistant/server/tests/test_word_export.py`
  - Covers citation/source refs in Word export.
- Modify `juxin-ai-assistant/server/tests/test_migrations.py`
  - Updates migration head and verifies new tables/columns.

### Frontend/Desktop

- Modify `juxin-ai-assistant/apps/desktop/src/App.tsx`
  - Adds sidebar entry and page state for chat.
- Create `juxin-ai-assistant/apps/desktop/src/api/chat.ts`
  - Adds typed chat and knowledge-file API client methods using existing `apiFetch`.
- Create `juxin-ai-assistant/apps/desktop/src/components/CitationList.tsx`
  - Shared citation/source rendering for chat and task-generation output.
- Create `juxin-ai-assistant/apps/desktop/src/components/KnowledgeFileUpload.tsx`
  - Uploads per-user knowledge files and displays parsing/chunk status.
- Create `juxin-ai-assistant/apps/desktop/src/pages/ChatPage.tsx`
  - Renders mode selector, model selector, session list, message list, composer, streaming output, citations, and upload panel.
- Modify `juxin-ai-assistant/apps/desktop/src/pages/TaskRunPage.tsx`
  - Displays citation/source refs after generation output.
- Modify `juxin-ai-assistant/apps/desktop/src/pages/HistoryPage.tsx`
  - Displays citation/source refs in history details.
- Modify `juxin-ai-assistant/apps/desktop/src/api/client.ts`
  - Extends history/generation payload types with citation/source refs.

### Frontend Tests

- Create `juxin-ai-assistant/apps/desktop/tests/chat-page.test.tsx`
  - Covers chat render, normal mode send, RAG mode send, streaming delta display, no-model state, no-evidence state, and citations.
- Create `juxin-ai-assistant/apps/desktop/tests/citation-list.test.tsx`
  - Covers citation rendering for knowledge chunks, attachments, and empty sources.
- Modify `juxin-ai-assistant/apps/desktop/tests/task-run.test.tsx`
  - Covers task-generation citation display.
- Modify `juxin-ai-assistant/apps/desktop/tests/employee-flow.test.tsx`
  - Covers chat navigation does not hide existing user pages.

---

## Task 1: Knowledge File and Chunk Persistence

**Files:**
- Create: `juxin-ai-assistant/server/tests/test_knowledge_files.py`
- Modify: `juxin-ai-assistant/server/app/models.py`
- Create: `juxin-ai-assistant/server/app/knowledge_files.py`
- Create: `juxin-ai-assistant/server/alembic/versions/0008_chat_rag_sources.py`
- Modify: `juxin-ai-assistant/server/tests/test_migrations.py`

- [ ] **Step 1: Write failing tests for chunking and encrypted persistence**

Create `test_knowledge_files.py` with tests that call a `chunk_text()` helper and `create_knowledge_file_from_upload()` service. Assertions must prove:

- long text produces multiple ordered chunks;
- each chunk has `chunk_id`, `file_name`, `chunk_index`, `section_title`, `created_at`;
- plaintext chunk text is not stored in ciphertext;
- unsafe uploaded path names become safe base names;
- unsupported file suffixes raise a 415 HTTP error.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
python -m pytest tests/test_knowledge_files.py -q
```

Expected: fail with missing `app.knowledge_files` or missing model classes.

- [ ] **Step 3: Implement models, service, and migration**

Add:

- `KnowledgeFile`
- `KnowledgeChunk`

Use encrypted `chunk_text_ciphertext` and `chunk_text_nonce`. Do not store plaintext chunks in the database model. Use `BigInteger().with_variant(Integer, "sqlite")` for IDs to match existing models.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
python -m pytest tests/test_knowledge_files.py tests/test_migrations.py -q
```

Expected: all selected tests pass.

---

## Task 2: Knowledge File API

**Files:**
- Modify: `juxin-ai-assistant/server/app/schemas.py`
- Modify: `juxin-ai-assistant/server/app/main.py` or create `juxin-ai-assistant/server/app/chat_routes.py`
- Modify: `juxin-ai-assistant/server/tests/test_knowledge_files.py`

- [ ] **Step 1: Write failing API tests**

Add tests for:

- `POST /api/ai/knowledge/files` returns file metadata and chunk count;
- `GET /api/ai/knowledge/files` returns only current user's files plus public metadata allowed by policy;
- `DELETE /api/ai/knowledge/files/{file_uuid}` disables only current user's file and chunks;
- cross-user delete returns 404 or 403 without leaking existence.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
python -m pytest tests/test_knowledge_files.py -q
```

Expected: route not found.

- [ ] **Step 3: Implement API narrowly**

Use existing dependencies:

- `get_session`
- `get_db`
- `get_content_cipher`
- `require_action("ai_assistant:use", ...)`

Return clear errors for oversized, unsupported, and parse-failed files.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
python -m pytest tests/test_knowledge_files.py -q
```

Expected: all tests pass.

---

## Task 3: Chunk Retrieval for RAG

**Files:**
- Create: `juxin-ai-assistant/server/tests/test_knowledge_search.py`
- Create: `juxin-ai-assistant/server/app/knowledge_search.py`
- Modify: `juxin-ai-assistant/server/app/models.py`

- [ ] **Step 1: Write failing retrieval tests**

Cover:

- Top-K defaults to 8 and clamps to 5-10 where applicable;
- keyword overlap and priority order relevant chunks above unrelated chunks;
- current user can retrieve own private chunks;
- current user cannot retrieve other users' private chunks;
- public/company chunks can be retrieved by employees.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
python -m pytest tests/test_knowledge_search.py -q
```

Expected: missing `knowledge_search`.

- [ ] **Step 3: Implement minimal keyword retrieval**

Implement simple deterministic scoring:

- tokenize by whitespace and contiguous Chinese text fallbacks;
- score by substring occurrences in title, file name, section title, and decrypted chunk text;
- sort by score desc, priority desc, created_at desc, chunk_id asc;
- return citation metadata and clipped snippet.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
python -m pytest tests/test_knowledge_search.py -q
```

Expected: all tests pass.

---

## Task 4: Chat Sessions and Prepare/Complete API

**Files:**
- Create: `juxin-ai-assistant/server/tests/test_chat_api.py`
- Modify: `juxin-ai-assistant/server/app/models.py`
- Create: `juxin-ai-assistant/server/app/chat_service.py`
- Create: `juxin-ai-assistant/server/app/chat_routes.py`
- Modify: `juxin-ai-assistant/server/app/main.py`
- Modify: `juxin-ai-assistant/server/app/schemas.py`

- [ ] **Step 1: Write failing chat API tests**

Cover:

- normal mode prepare returns `messages` and no citations;
- knowledge mode prepare returns fixed answer state when no chunks match;
- knowledge mode prepare returns messages and citations when chunks match;
- complete persists assistant answer, model info, usage, and citations;
- fail marks pending assistant message as failed;
- session list/detail only returns current user's sessions.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
python -m pytest tests/test_chat_api.py -q
```

Expected: route not found or missing service.

- [ ] **Step 3: Implement chat service and routes**

Use completion-token hashing like `GenerationRecord`. Encrypt user and assistant message text with `ContentCipher`. For no evidence in knowledge mode, avoid model call by returning a completed assistant message with answer `当前知识库中未找到明确依据`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
python -m pytest tests/test_chat_api.py -q
```

Expected: all tests pass.

---

## Task 5: Task-Generation Citation Sources

**Files:**
- Modify: `juxin-ai-assistant/server/tests/test_generation_flow.py`
- Modify: `juxin-ai-assistant/server/tests/test_history.py`
- Modify: `juxin-ai-assistant/server/tests/test_word_export.py`
- Modify: `juxin-ai-assistant/server/app/generation_service.py`
- Modify: `juxin-ai-assistant/server/app/history_service.py`
- Modify: `juxin-ai-assistant/server/app/word_export.py`
- Modify: `juxin-ai-assistant/server/app/schemas.py`

- [ ] **Step 1: Write failing citation tests**

Cover:

- prepare stores `source_refs_json` or extended `knowledge_refs_json` for knowledge sources;
- prepare stores uploaded attachment source metadata when attachments are used;
- history detail returns citations/source refs;
- Word export includes a reference-source section when sources exist.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
python -m pytest tests/test_generation_flow.py tests/test_history.py tests/test_word_export.py -q
```

Expected: citation/source fields missing.

- [ ] **Step 3: Implement source refs**

Prefer extending existing `knowledge_refs_json` into a unified response field without destructive migration. Keep existing keys backward compatible.

- [ ] **Step 4: Verify GREEN**

Run the same selected pytest command. Expected: all selected tests pass.

---

## Task 6: Frontend Chat Page and Streaming

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/tests/chat-page.test.tsx`
- Create: `juxin-ai-assistant/apps/desktop/src/api/chat.ts`
- Create: `juxin-ai-assistant/apps/desktop/src/pages/ChatPage.tsx`
- Modify: `juxin-ai-assistant/apps/desktop/src/App.tsx`

- [ ] **Step 1: Write failing frontend tests**

Cover:

- sidebar shows Chat entry;
- chat page renders normal and knowledge modes;
- normal send calls chat prepare, then `generateLocalModel`, then complete;
- stream delta appears while generation is running;
- knowledge mode no-evidence answer displays fixed response and skips model call.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm run test -- tests/chat-page.test.tsx
```

Expected: missing component/API.

- [ ] **Step 3: Implement page and API client**

Use existing `apiFetch` and `generateLocalModel`. Keep styling consistent with existing pages and `tokens.css`.

- [ ] **Step 4: Verify GREEN**

Run the same Vitest command. Expected: all selected tests pass.

---

## Task 7: Citation UI for Chat, Task Results, and History

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/tests/citation-list.test.tsx`
- Create: `juxin-ai-assistant/apps/desktop/src/components/CitationList.tsx`
- Modify: `juxin-ai-assistant/apps/desktop/tests/task-run.test.tsx`
- Modify: `juxin-ai-assistant/apps/desktop/src/pages/TaskRunPage.tsx`
- Modify: `juxin-ai-assistant/apps/desktop/src/pages/HistoryPage.tsx`
- Modify: `juxin-ai-assistant/apps/desktop/src/api/client.ts`

- [ ] **Step 1: Write failing citation UI tests**

Cover:

- citation list renders file name, page/section, and chunk id;
- empty citations render nothing;
- task generation result shows citation list when API returns citations;
- history detail shows citation list when detail includes citations.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm run test -- tests/citation-list.test.tsx tests/task-run.test.tsx
```

Expected: citation component missing or assertions fail.

- [ ] **Step 3: Implement shared citation component**

Keep component purely presentational and reusable by ChatPage, TaskRunPage, and HistoryPage.

- [ ] **Step 4: Verify GREEN**

Run the same Vitest command. Expected: all selected tests pass.

---

## Task 8: Knowledge File Upload UI

**Files:**
- Modify: `juxin-ai-assistant/apps/desktop/tests/chat-page.test.tsx`
- Create: `juxin-ai-assistant/apps/desktop/src/components/KnowledgeFileUpload.tsx`
- Modify: `juxin-ai-assistant/apps/desktop/src/pages/ChatPage.tsx`
- Modify: `juxin-ai-assistant/apps/desktop/src/api/chat.ts`

- [ ] **Step 1: Write failing upload UI tests**

Cover:

- uploading `txt/md/docx` calls `/api/ai/knowledge/files`;
- upload success displays file name and chunk count;
- upload error displays readable error;
- unsupported file type is surfaced as server error, not silent failure.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm run test -- tests/chat-page.test.tsx
```

Expected: upload UI missing.

- [ ] **Step 3: Implement upload UI**

Use existing upload style patterns from `AttachmentUpload.tsx`, but call the knowledge-file API instead of task attachment API.

- [ ] **Step 4: Verify GREEN**

Run the same Vitest command. Expected: all selected tests pass.

---

## Task 9: Regression and Runtime Verification

**Files:**
- No new implementation files unless a regression is discovered.

- [ ] **Step 1: Run backend focused suite**

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
python -m pytest tests/test_knowledge_files.py tests/test_knowledge_search.py tests/test_chat_api.py tests/test_generation_flow.py tests/test_history.py tests/test_word_export.py tests/test_migrations.py -q
```

- [ ] **Step 2: Run frontend focused suite**

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm run test -- tests/chat-page.test.tsx tests/citation-list.test.tsx tests/task-run.test.tsx tests/employee-flow.test.tsx
```

- [ ] **Step 3: Run type checks**

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm run typecheck
```

- [ ] **Step 4: Run diff whitespace check**

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new
git diff --check
```

- [ ] **Step 5: Manual runtime smoke**

With `auth`, `ai-assistant-api`, and Vite/desktop running:

- open AI assistant;
- login through existing SSO;
- open Chat;
- send normal chat message;
- upload a small txt file;
- switch to knowledge mode and ask about uploaded content;
- confirm streamed answer and citation source;
- run a task generation that uses knowledge/attachment and confirm citations show.

---

## Plan Self-Review

- Spec coverage: upload parsing, chunking, chat UI, normal chat, RAG mode, history sessions, citations, task-generation citation display, Word export citations, security, and regression checks are covered.
- Placeholder scan: this plan contains no TBD/TODO placeholders.
- Boundary check: the plan preserves unified SSO, local model API Key storage, and Tauri local model streaming.
- Scope check: this is a large feature, so implementation should proceed task-by-task with verification after each task rather than as a single large diff.
