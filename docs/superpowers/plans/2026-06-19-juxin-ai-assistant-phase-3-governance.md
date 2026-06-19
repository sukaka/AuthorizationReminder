# 聚信 AI 助手阶段 3：管理与治理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐任务与知识管理、部门负责人建议、系统设置、部门/全局统计和可汇聚审计，同时保持用户、部门、Prompt 和模型配置各自唯一的管理边界。

**Architecture:** 统一登录仍决定角色、应用访问和 `managedDepartments`；FastAPI 管理 AI 助手自己的任务/知识/设置，并对每个管理接口调用明确的 authorize action。审计写入 AI 助手独立表并通过受保护的只读端点汇聚到现有审计中心；Prompt、用户和部门管理仅提供深链。

**Tech Stack:** FastAPI、SQLAlchemy 2、Alembic、MySQL、React 19、TypeScript、Ant Design、Node test runner、pytest、Vitest、Playwright。

---

## 文件职责

- `server/app/admin/task_admin.py`：任务、字段和 Prompt 绑定事务。
- `server/app/admin/knowledge_admin.py`：知识密文写入和关联。
- `server/app/admin/settings_service.py`：允许键白名单与版本化设置。
- `server/app/admin/suggestion_service.py`：负责人建议与审核状态机。
- `server/app/admin/stats_service.py`：只读聚合，不解密正文。
- `server/app/audit.py`：统一审计事件写入、查询和元数据清洗。
- `apps/desktop/src/pages/admin/`：管理页面；不含用户/部门/模型密钥表单。

### 测试 fixture 契约

本阶段扩展 `server/tests/conftest.py`，提供 `user_client`、`admin_client`、`manager_client`、`prompt_stub`、`suggestion` 和带多部门元数据的 `generation_rows`。权限 client 不启用全局 dev-bypass，而是 mock 统一 `introspect/authorize` 的真实 allow/deny 返回；因此直接 URL 和 API 越权测试仍能覆盖服务端授权。

---

### Task 1: 固化统一授权动作和部门负责人范围

**Files:**
- Create: `auth/ai-assistant-authorization.js`
- Create: `auth/tests/ai-assistant-authorization.test.js`
- Modify: `auth/portal-routing.js`
- Modify: `auth/tests/portal-routing.test.js`
- Modify: `auth/index.js`
- Modify: `auth/Dockerfile`

- [ ] **Step 1: 写普通员工、负责人、管理员和审计员矩阵测试**

```javascript
// auth/tests/ai-assistant-authorization.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { authorizeAiAssistant } = require('../ai-assistant-authorization');

const user = (role, access = ['ai-assistant']) => ({ role, app_access: JSON.stringify(access) });

test('all app users can use tasks', () => {
  assert.equal(authorizeAiAssistant(user('user'), 'ai_assistant:use', {}).allow, true);
});

test('only managed department users can read department stats or suggest', () => {
  assert.equal(authorizeAiAssistant(user('user'), 'ai_assistant:department:stats', { managedDepartments: [] }).allow, false);
  assert.equal(authorizeAiAssistant(user('user'), 'ai_assistant:department:stats', { managedDepartments: ['销售'] }).allow, true);
  assert.equal(authorizeAiAssistant(user('user'), 'ai_assistant:task:suggest', { managedDepartments: ['销售'] }).allow, true);
});

test('admin and audit actions stay separate', () => {
  assert.equal(authorizeAiAssistant(user('admin'), 'ai_assistant:admin', {}).allow, true);
  assert.equal(authorizeAiAssistant(user('sysadmin'), 'ai_assistant:admin', {}).allow, true);
  assert.equal(authorizeAiAssistant(user('auditor'), 'ai_assistant:admin', {}).allow, false);
  assert.equal(authorizeAiAssistant(user('auditor'), 'ai_assistant:audit:read', {}).allow, true);
  assert.equal(authorizeAiAssistant(user('user'), 'ai_assistant:audit:read', {}).allow, false);
});
```

Extend `auth/tests/portal-routing.test.js` with:

```javascript
test('system and audit administrators receive AI assistant access for their scoped actions', () => {
  assert.deepEqual(defaultAppAccessByRole('sysadmin'), ['admin-center', 'ai-assistant']);
  assert.deepEqual(defaultAppAccessByRole('auditor'), ['audit-center', 'delivery', 'ai-assistant']);
});
```

- [ ] **Step 2: 运行并确认 helper 文件缺失**

Run: `node --test auth/tests/ai-assistant-authorization.test.js`

Expected: FAIL with module not found.

- [ ] **Step 3: 让 sysadmin/auditor 获得 AI 助手应用入口**

```javascript
// auth/portal-routing.js inside defaultAppAccessByRole
if (normalizedRole === 'sysadmin') return [ADMIN_CENTER_KEY, 'ai-assistant'];
if (normalizedRole === 'auditor') return [AUDIT_CENTER_KEY, DELIVERY_KEY, 'ai-assistant'];
```

- [ ] **Step 4: 抽取授权 helper 并复用现有 access 解析**

```javascript
// auth/ai-assistant-authorization.js
const { resolveUserAppAccess } = require('./portal-routing');

const allow = () => ({ allow: true });
const deny = (reason) => ({ allow: false, reason });

const authorizeAiAssistant = (user, action, scope = {}) => {
  if (!user) return deny('未登录');
  if (!resolveUserAppAccess(user).includes('ai-assistant')) return deny('无权限访问聚信 AI 助手');
  const role = String(user.role || '').toLowerCase();
  if (action === 'app:enter' || action === 'ai_assistant:use') return allow();
  if (action === 'ai_assistant:department:stats' || action === 'ai_assistant:task:suggest') {
    return Array.isArray(scope.managedDepartments) && scope.managedDepartments.length
      ? allow()
      : deny('仅部门负责人可执行该操作');
  }
  if (action === 'ai_assistant:admin') {
    return role === 'admin' || role === 'sysadmin' ? allow() : deny('仅管理员或系统管理员可执行该操作');
  }
  if (action === 'ai_assistant:audit:read') {
    return role === 'admin' || role === 'auditor' ? allow() : deny('仅管理员或审计员可查看审计日志');
  }
  return deny('不支持的授权动作');
};

module.exports = { authorizeAiAssistant };
```

- [ ] **Step 5: 从 `auth/index.js` 删除内联重复实现并导入 helper**

Add `COPY auth/ai-assistant-authorization.js ./auth/ai-assistant-authorization.js` to `auth/Dockerfile` and make `/api/auth/authorize` pass the already built `scope` unchanged.

- [ ] **Step 6: 运行认证相关测试并提交**

Run: `node --test auth/tests/ai-assistant-authorization.test.js auth/tests/ai-assistant-portal-source.test.js auth/tests/department-scope-source.test.js auth/tests/portal-routing.test.js`

Expected: all tests PASS.

```bash
git add auth
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 2: 增加建议、设置和审计数据模型

**Files:**
- Modify: `juxin-ai-assistant/server/app/models.py`
- Create: `juxin-ai-assistant/server/alembic/versions/0003_governance.py`
- Create: `juxin-ai-assistant/server/tests/test_governance_models.py`

- [ ] **Step 1: 写表和关键索引测试**

```python
# tests/test_governance_models.py
from sqlalchemy import inspect
from app.database import Base, engine
from app import models  # noqa: F401


def test_governance_tables_exist() -> None:
    Base.metadata.create_all(engine)
    inspector = inspect(engine)
    assert {"ai_task_suggestions", "ai_system_settings", "ai_audit_logs"} <= set(inspector.get_table_names())
    audit_indexes = {item["name"] for item in inspector.get_indexes("ai_audit_logs")}
    assert {"idx_ai_audit_created", "idx_ai_audit_entity"} <= audit_indexes
```

- [ ] **Step 2: 添加 ORM 模型**

```python
# models.py additions
class TaskSuggestion(TimestampMixin, Base):
    __tablename__ = "ai_task_suggestions"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    sso_user_id: Mapped[str] = mapped_column(String(64), index=True)
    department_code: Mapped[str] = mapped_column(String(128), index=True)
    suggestion_type: Mapped[str] = mapped_column(String(32))
    task_id: Mapped[int | None] = mapped_column(ForeignKey("ai_tasks.id"), nullable=True)
    content_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    content_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default="PENDING", index=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    review_comment_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    review_comment_nonce: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)


class SystemSetting(TimestampMixin, Base):
    __tablename__ = "ai_system_settings"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    setting_key: Mapped[str] = mapped_column(String(96), unique=True)
    value_json: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE")
    created_by: Mapped[str] = mapped_column(String(64))
    updated_by: Mapped[str] = mapped_column(String(64))


class AuditLog(Base):
    __tablename__ = "ai_audit_logs"
    __table_args__ = (
        Index("idx_ai_audit_created", "created_at"),
        Index("idx_ai_audit_entity", "entity_type", "entity_uuid", "created_at"),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    sso_user_id: Mapped[str] = mapped_column(String(64), index=True)
    username_snapshot: Mapped[str] = mapped_column(String(128))
    action: Mapped[str] = mapped_column(String(96), index=True)
    entity_type: Mapped[str] = mapped_column(String(64))
    entity_uuid: Mapped[str] = mapped_column(String(64), default="")
    result: Mapped[str] = mapped_column(String(16))
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    ip_hash: Mapped[str] = mapped_column(String(64), default="")
    user_agent_hash: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
```

- [ ] **Step 3: 编写并验证 `0003_governance` 迁移**

Run: `cd juxin-ai-assistant/server && alembic upgrade 0003_governance && alembic downgrade 0002_employee_features && alembic upgrade head`

Expected: commands exit 0.

- [ ] **Step 4: 运行模型测试并提交**

Run: `cd juxin-ai-assistant/server && python3 -m pytest tests/test_governance_models.py -q`

Expected: PASS.

```bash
git add juxin-ai-assistant/server
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 3: 实现统一审计写入与元数据清洗

**Files:**
- Create: `juxin-ai-assistant/server/app/audit.py`
- Create: `juxin-ai-assistant/server/tests/test_audit.py`
- Modify: `juxin-ai-assistant/server/app/config.py`

- [ ] **Step 1: 写禁止敏感键和稳定 hash 测试**

```python
# tests/test_audit.py
from app.audit import sanitize_metadata, stable_request_hash


def test_sanitize_metadata_drops_secret_and_content_fields() -> None:
    cleaned = sanitize_metadata({
        "task_uuid": "task-1",
        "api_key": "secret",
        "authorization": "Bearer secret",
        "input": "private input",
        "output": "private output",
    })
    assert cleaned == {"task_uuid": "task-1"}


def test_request_hash_is_stable_and_salted() -> None:
    assert stable_request_hash("10.0.0.8", "salt") == stable_request_hash("10.0.0.8", "salt")
    assert stable_request_hash("10.0.0.8", "salt") != stable_request_hash("10.0.0.8", "other")
```

- [ ] **Step 2: 实现白名单清洗和审计 writer**

```python
# app/audit.py
import hashlib

ALLOWED_METADATA_KEYS = {
    "task_uuid", "assistant_code", "generation_uuid", "prompt_external_id", "prompt_version",
    "status", "feedback_type", "setting_key", "suggestion_uuid", "record_count",
}


def sanitize_metadata(value: dict) -> dict:
    return {key: value[key] for key in ALLOWED_METADATA_KEYS if key in value}


def stable_request_hash(value: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{value}".encode()).hexdigest()


def write_audit(db, session, request, action: str, entity_type: str, entity_uuid: str, result: str, metadata: dict) -> None:
    db.add(AuditLog(
        sso_user_id=str(session.user.id),
        username_snapshot=session.user.username,
        action=action,
        entity_type=entity_type,
        entity_uuid=entity_uuid,
        result=result,
        metadata_json=sanitize_metadata(metadata),
        ip_hash=stable_request_hash(request.client.host if request.client else "", get_settings().audit_hash_salt),
        user_agent_hash=stable_request_hash(request.headers.get("user-agent", ""), get_settings().audit_hash_salt),
    ))
```

- [ ] **Step 3: 把审计写入事务接入关键操作**

Task/knowledge/settings mutations, suggestion submission/review, generation prepare/complete/fail/delete, feedback and unauthorized admin attempts must write stable actions. Failed authorization may be logged without a DB transaction only when a valid unified user is known.

- [ ] **Step 4: 运行测试并提交**

Run: `cd juxin-ai-assistant/server && python3 -m pytest tests/test_audit.py tests/test_generation_flow.py -q`

Expected: PASS and secret scan of captured logs finds no test secret.

```bash
git add juxin-ai-assistant/server
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 4: 实现任务、字段和 Prompt 绑定管理 API

**Files:**
- Create: `juxin-ai-assistant/server/app/admin/__init__.py`
- Create: `juxin-ai-assistant/server/app/admin/task_admin.py`
- Create: `juxin-ai-assistant/server/tests/test_task_admin.py`
- Modify: `juxin-ai-assistant/server/app/main.py`
- Modify: `juxin-ai-assistant/server/app/schemas.py`

- [ ] **Step 1: 写 admin 权限、事务回滚和发布绑定测试**

```python
# tests/test_task_admin.py
def test_non_admin_cannot_mutate_tasks(user_client, task) -> None:
    response = user_client.put(f"/api/ai/admin/tasks/{task.uuid}", json={"name": "篡改"})
    assert response.status_code == 403


def test_active_task_requires_published_prompt(admin_client, draft_task, prompt_stub) -> None:
    prompt_stub.return_value = None
    response = admin_client.put(
        f"/api/ai/admin/tasks/{draft_task.uuid}",
        json={"status": "ACTIVE"},
    )
    assert response.status_code == 409
    assert response.json()["code"] == "PUBLISHED_PROMPT_REQUIRED"


def test_field_replace_is_atomic(admin_client, task, db) -> None:
    response = admin_client.put(
        f"/api/ai/admin/tasks/{task.uuid}/fields",
        json={"fields": [{"field_key": "bad key", "label": "错误", "field_type": "TEXT"}]},
    )
    assert response.status_code == 422
    assert [field.field_key for field in task.fields] == ["background"]
```

- [ ] **Step 2: 实现事务化 service 和 Pydantic schemas**

Task codes/field keys must match `^[a-z][a-z0-9_-]{1,95}$`; status is `DRAFT|ACTIVE|DISABLED`; delete is allowed only for never-active drafts with no generations, otherwise use disable. Replacing fields validates the entire list, unique keys and supported types before deleting old rows. Prompt binding calls runtime API before commit.

- [ ] **Step 3: 暴露管理路由并强制 `ai_assistant:admin`**

Routes: list/create/update/delete task, replace fields, update prompt binding. Every handler obtains the unified session, invokes `require_action("ai_assistant:admin")`, uses one transaction and writes audit.

- [ ] **Step 4: 运行并提交**

Run: `cd juxin-ai-assistant/server && python3 -m pytest tests/test_task_admin.py -q`

Expected: all tests PASS.

```bash
git add juxin-ai-assistant/server
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 5: 实现知识库管理 API

**Files:**
- Create: `juxin-ai-assistant/server/app/admin/knowledge_admin.py`
- Create: `juxin-ai-assistant/server/tests/test_knowledge_admin.py`
- Modify: `juxin-ai-assistant/server/app/main.py`

- [ ] **Step 1: 写密文、关联和停用测试**

```python
# tests/test_knowledge_admin.py
def test_create_encrypts_content_and_links_tasks(admin_client, db, task) -> None:
    response = admin_client.post("/api/ai/admin/knowledge", json={
        "title": "公司介绍",
        "category": "COMPANY",
        "tags": ["公司"],
        "keywords": ["聚信"],
        "content": "北京聚信得仁科技有限公司",
        "task_uuids": [task.uuid],
        "priority": 10,
    })
    assert response.status_code == 201
    row = db.query(KnowledgeItem).one()
    assert b"北京聚信得仁科技有限公司" not in row.content_ciphertext
    assert len(row.task_links) == 1


def test_disable_removes_item_from_retrieval(admin_client, retriever, knowledge) -> None:
    assert admin_client.delete(f"/api/ai/admin/knowledge/{knowledge.uuid}").status_code == 204
    assert retriever.retrieve_for_test(knowledge.task_id, "聚信") == []
```

- [ ] **Step 2: 实现分类白名单和密文 CRUD**

Categories: `COMPANY|PRODUCT|SERVICE|SALES_SCRIPT|DELIVERY|TENDER|FAQ|CASE|TRAINING|COMPLIANCE|TECHNICAL`. Create/update validates all task UUIDs before encrypting. List returns metadata only; detail decrypts only after admin authorize. DELETE maps to `DISABLED`; physical delete is limited to unused drafts and is not exposed in phase 3 UI.

- [ ] **Step 3: 运行并提交**

Run: `cd juxin-ai-assistant/server && python3 -m pytest tests/test_knowledge_admin.py tests/test_knowledge.py -q`

Expected: PASS.

```bash
git add juxin-ai-assistant/server
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 6: 实现系统设置和负责人建议状态机

**Files:**
- Create: `juxin-ai-assistant/server/app/admin/settings_service.py`
- Create: `juxin-ai-assistant/server/app/admin/suggestion_service.py`
- Create: `juxin-ai-assistant/server/tests/test_settings_suggestions.py`
- Modify: `juxin-ai-assistant/server/app/main.py`

- [ ] **Step 1: 写设置键白名单和负责人范围测试**

```python
# tests/test_settings_suggestions.py
def test_settings_reject_secret_like_keys(admin_client) -> None:
    response = admin_client.put("/api/ai/admin/settings", json={"model_api_key": "secret"})
    assert response.status_code == 422


def test_manager_can_only_suggest_for_managed_department(manager_client) -> None:
    allowed = manager_client(["销售"]).post("/api/ai/suggestions", json={
        "department_code": "销售",
        "suggestion_type": "PROMPT_CHANGE",
        "content": "补充回款风险场景",
    })
    denied = manager_client(["销售"]).post("/api/ai/suggestions", json={
        "department_code": "商务投标",
        "suggestion_type": "PROMPT_CHANGE",
        "content": "越权建议",
    })
    assert allowed.status_code == 201
    assert denied.status_code == 403


def test_review_state_machine_is_terminal(admin_client, suggestion) -> None:
    assert admin_client.post(f"/api/ai/admin/suggestions/{suggestion.uuid}/review", json={"decision": "APPROVE"}).status_code == 200
    assert admin_client.post(f"/api/ai/admin/suggestions/{suggestion.uuid}/review", json={"decision": "REJECT"}).status_code == 409
```

- [ ] **Step 2: 实现设置白名单**

Allowed keys: `global_safety_notice`, `sensitive_detection_enabled`, `history_retention_days`, `knowledge_limit`, `default_temperature`, `support_contact`. Reject any key containing `key|token|secret|password|credential` case-insensitively. No setting can contain model Base URL or user model metadata.

- [ ] **Step 3: 实现建议状态机**

Suggestion types: `COMMON_TASK_CHANGE|PROMPT_CHANGE`; statuses: `PENDING -> APPROVED|REJECTED`. Submission verifies `department_code` is in session `managedDepartments`, encrypts content and writes audit. Review requires admin; approval records decision only and never silently edits Prompt or task.

- [ ] **Step 4: 运行并提交**

Run: `cd juxin-ai-assistant/server && python3 -m pytest tests/test_settings_suggestions.py -q`

Expected: PASS.

```bash
git add juxin-ai-assistant/server
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 7: 实现部门和全局统计，不解密正文

**Files:**
- Create: `juxin-ai-assistant/server/app/admin/stats_service.py`
- Create: `juxin-ai-assistant/server/tests/test_stats.py`
- Modify: `juxin-ai-assistant/server/app/main.py`

- [ ] **Step 1: 写部门范围和元数据聚合测试**

```python
# tests/test_stats.py
def test_manager_stats_are_scoped_to_managed_departments(manager_client, generation_rows) -> None:
    payload = manager_client(["销售"]).get("/api/ai/department-stats").json()
    assert payload["departments"] == ["销售"]
    assert payload["total"] == generation_rows.sales_count
    assert "input" not in str(payload).lower()
    assert "output" not in str(payload).lower()


def test_admin_stats_cover_all_departments(admin_client, generation_rows) -> None:
    payload = admin_client.get("/api/ai/admin/stats").json()
    assert payload["total"] == generation_rows.total_count
    assert set(payload["by_department"]) >= {"销售", "商务投标"}
```

- [ ] **Step 2: 实现带日期上限的聚合查询**

Statistics include total, completion/failure rate, task ranking, daily trend and feedback distribution. Date range defaults to 30 days and caps at 366. Queries use only status/task/department/time/feedback metadata and never select ciphertext columns.

- [ ] **Step 3: 运行并提交**

Run: `cd juxin-ai-assistant/server && python3 -m pytest tests/test_stats.py -q`

Expected: PASS.

```bash
git add juxin-ai-assistant/server
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 8: 接入统一审计中心

**Files:**
- Create: `juxin-ai-assistant/server/tests/test_audit_api.py`
- Modify: `juxin-ai-assistant/server/app/main.py`
- Modify: `auth/audit-center-logs.js`
- Modify: `auth/audit-log-display.js`
- Modify: `auth/index.js`
- Modify: `docker-compose.yml`
- Test: `auth/tests/ai-assistant-audit-source.test.js`

- [ ] **Step 1: 写审计源注册和只读接口权限测试**

```javascript
// auth/tests/ai-assistant-audit-source.test.js
const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync('auth/audit-center-logs.js', 'utf8');
test('audit center aggregates AI assistant logs', () => {
  assert.match(source, /'ai-assistant'/);
  assert.match(source, /\/api\/ai\/admin\/audit-logs/);
});
```

- [ ] **Step 2: 实现分页审计 API**

`GET /api/ai/admin/audit-logs` requires `ai_assistant:audit:read`, caps limit at 500, filters action/entity/username/time, and returns `{items,total}` with sanitized metadata. Add an internal audit-source credential only if the existing audit center source adapter requires service authentication; reuse its existing pattern instead of creating a second protocol.

- [ ] **Step 3: 注册来源和显示标签**

Add `AUDIT_SOURCE_AI_ASSISTANT_URL: "http://ai-assistant-api:5193"` to auth Compose environment. Register system label `聚信 AI 助手`, map generation/task/knowledge/suggestion actions to Chinese display labels, and ensure source failure is isolated like other audit sources.

- [ ] **Step 4: 运行审计测试并提交**

Run: `node --test auth/tests/ai-assistant-audit-source.test.js auth/tests/audit-center-logs.test.js auth/tests/audit-log-display.test.js && cd juxin-ai-assistant/server && python3 -m pytest tests/test_audit.py tests/test_audit_api.py -q`

Expected: PASS.

```bash
git add auth docker-compose.yml juxin-ai-assistant/server
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 9: 实现管理 UI 和中心深链

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/src/pages/admin/TaskAdminPage.tsx`
- Create: `juxin-ai-assistant/apps/desktop/src/pages/admin/KnowledgeAdminPage.tsx`
- Create: `juxin-ai-assistant/apps/desktop/src/pages/admin/SuggestionsPage.tsx`
- Create: `juxin-ai-assistant/apps/desktop/src/pages/admin/StatsPage.tsx`
- Create: `juxin-ai-assistant/apps/desktop/src/pages/admin/AuditPage.tsx`
- Create: `juxin-ai-assistant/apps/desktop/src/pages/admin/SettingsPage.tsx`
- Create: `juxin-ai-assistant/apps/desktop/src/pages/admin/AdminLinksPage.tsx`
- Create: `juxin-ai-assistant/apps/desktop/tests/admin-navigation.test.tsx`
- Modify: `juxin-ai-assistant/apps/desktop/src/App.tsx`

- [ ] **Step 1: 写权限导航和禁止模型管理测试**

```tsx
// tests/admin-navigation.test.tsx
it('shows AI governance pages to admin without user or server model forms', async () => {
  render(<App initialSession={adminSession} />);
  expect(screen.getByRole('link', { name: '任务管理' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '知识库' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '系统设置' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '服务端模型配置' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '新增用户' })).not.toBeInTheDocument();
});

it('links user and prompt management to existing centers', () => {
  render(<AdminLinksPage urls={{ adminCenter: 'http://localhost:5180/admin-center', promptCenter: 'http://localhost:18088' }} />);
  expect(screen.getByRole('link', { name: '打开统一用户管理' })).toHaveAttribute('href', 'http://localhost:5180/admin-center');
  expect(screen.getByRole('link', { name: '打开提示词管理中心' })).toHaveAttribute('href', 'http://localhost:18088');
});
```

- [ ] **Step 2: 实现管理页面**

Task editor uses a field list with explicit supported types and Prompt ID/version policy; activation shows runtime validation result. Knowledge editor keeps content in a controlled textarea only while editing and clears it after save/navigation. Settings uses a generated whitelist form, not arbitrary key/value input. Stats and audit never request decrypted generation content.

- [ ] **Step 3: 实现负责人入口**

When `managedDepartments` is nonempty, show `部门数据` and `提交建议`; scope selector contains only managed departments. Ordinary users see neither. Admin pages rely on API 403 as the authority even if client navigation is manipulated.

- [ ] **Step 4: 运行前端测试和构建**

Run: `npm --prefix juxin-ai-assistant/apps/desktop test && npm --prefix juxin-ai-assistant/apps/desktop run build`

Expected: PASS.

- [ ] **Step 5: 提交管理 UI**

```bash
git add juxin-ai-assistant/apps/desktop
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 10: 阶段 3 权限与治理验收

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/e2e/governance.spec.ts`
- Modify: `scripts/tests/ai-assistant.sh`
- Modify: `juxin-ai-assistant/README.md`

- [ ] **Step 1: 编写角色矩阵 E2E**

Use test sessions for ordinary user, department manager, admin, sysadmin and auditor. Assert every navigation and API mutation against the design matrix; explicitly try direct URL/API access to prove hidden navigation is not the permission control.

- [ ] **Step 2: 运行治理全量测试**

Run:

```bash
node --test auth/tests/ai-assistant-authorization.test.js auth/tests/ai-assistant-audit-source.test.js
python3 -m pytest juxin-ai-assistant/server/tests -q
npm --prefix juxin-ai-assistant/apps/desktop test
npm --prefix juxin-ai-assistant/apps/desktop run build
npm --prefix juxin-ai-assistant/apps/desktop run test:e2e -- governance.spec.ts
bash scripts/tests/ai-assistant.sh
```

Expected: all checks PASS; role matrix matches design; audit center shows AI assistant actions; no user/department CRUD or server model configuration endpoint exists.

- [ ] **Step 3: 更新管理手册并提交**

Document task activation rules, Prompt center ownership, knowledge encryption, suggestion review, stats scope, audit retention and deep links.

```bash
git add juxin-ai-assistant scripts/tests/ai-assistant.sh
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

## 阶段 3 完成定义

- 管理员可管理任务、字段、Prompt 绑定、知识和允许的系统设置。
- 部门负责人只能查看所管理部门统计并为这些部门提交建议。
- 审计员可在统一审计中心查看脱敏 AI 助手日志。
- 用户/部门/Prompt 管理跳转现有中心，不复制 CRUD。
- 服务端和管理 UI 均不存在模型 API Key 或管理员模型配置。
- 全部管理操作有权限测试、事务测试和审计证据。
