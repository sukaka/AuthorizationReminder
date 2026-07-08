# Web Personal Model Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Web 端每个员工都能设置自己的大模型配置，API Key 由服务端加密保存，聊天时优先使用个人默认模型，未配置时回退服务端统一模型。

**Architecture:** 桌面端继续使用 Tauri 钥匙串；Web 端新增服务端 `ai_user_model_profiles` 表和 `/api/ai/model-profiles` API。聊天生成接口根据当前用户默认模型解密 API Key 调用 OpenAI 兼容接口，否则使用服务端统一模型。

**Tech Stack:** FastAPI + SQLAlchemy + Alembic + ContentCipher；React + Vitest/MSW。

## Global Constraints

- 不在浏览器保存 API Key。
- 不回显完整 API Key。
- 不影响桌面端本地模型配置。
- 不提交真实密钥和本地 SQLite DB。
- TDD：先补测试，再实现。

---

### Task 1: 后端个人模型配置 API

**Files:**
- Modify: `server/app/models.py`
- Create: `server/alembic/versions/0020_user_model_profiles.py`
- Modify: `server/app/schemas.py`
- Create: `server/app/model_profile_routes.py`
- Modify: `server/app/main.py`
- Test: `server/tests/test_user_model_profiles_api.py`

**Steps:**
- [x] 写失败测试：普通用户可新增/列表/默认/删除个人模型，列表不返回 API Key。
- [x] 加表：`sso_user_id`、显示名、base_url、model_id、temperature、max_output_tokens、timeout_seconds、is_default、secret_ciphertext、secret_nonce、status。
- [x] 实现加密保存与解密加载辅助函数。
- [x] 注册 API 路由并跑测试。

### Task 2: 聊天生成优先使用个人模型

**Files:**
- Modify: `server/app/server_model_client.py`
- Modify: `server/app/chat_routes.py`
- Test: `server/tests/test_chat_api.py`

**Steps:**
- [x] 写失败测试：用户默认模型存在时使用个人 base_url/model_id/API Key。
- [x] 实现个人模型选择和解密，缺省回退服务端统一模型。
- [x] 错误码保持安全，不泄露 API Key。

### Task 3: Web 设置页接个人模型配置

**Files:**
- Modify: `apps/desktop/src/api/chat.ts`
- Modify: `apps/desktop/src/pages/ModelProfilesPage.tsx`
- Test: `apps/desktop/tests/web-mode.test.tsx`

**Steps:**
- [x] 写失败测试：Web 设置页可保存个人模型，显示“密钥已保存”，不调用 Tauri。
- [x] 增加 API client。
- [x] Web 分支渲染个人模型表单和列表；桌面分支保持不变。

### Task 4: 验证

**Commands:**
- `cd server && PYTHONPATH=. .venv/bin/python -m pytest tests/test_user_model_profiles_api.py tests/test_chat_api.py -q`
- `cd apps/desktop && npm test -- --run tests/web-mode.test.tsx tests/model-profiles.test.tsx tests/chat-page.test.tsx`
- `cd apps/desktop && npm run typecheck`
- `cd apps/desktop && npm run build:web`

**Status:** Completed on 2026-07-07.
