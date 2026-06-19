# 聚信 AI 助手阶段 2：完整员工能力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在阶段 1 真实纵切上补齐八类助手、动态表单、敏感确认、基础知识检索、加密历史、收藏、最近使用、重新生成、反馈和离线待同步，形成普通员工可日常使用的完整工作台。

**Architecture:** FastAPI 继续作为任务、Prompt、知识和历史的唯一业务编排层；Tauri 继续只负责本地模型与设备存储。员工能力通过小型领域服务拆分，所有记录按统一登录用户 ID 隔离，前端只消费稳定 API，不读取数据库或 Prompt 中心内部结构。

**Tech Stack:** FastAPI、SQLAlchemy 2、Alembic、MySQL、AES-256-GCM、React 19、TypeScript、Ant Design、Tauri 2、pytest、Vitest、Playwright。

---

## 阶段依赖与文件职责

本计划要求阶段 1 完成定义全部通过。新增文件职责：

- `server/app/field_validation.py`：动态字段白名单与值校验。
- `server/app/sensitive.py`：敏感信息检测与确认摘要。
- `server/app/knowledge.py`：可替换的基础知识检索接口。
- `server/app/history_service.py`：对象级历史权限和密文读取。
- `server/app/feedback_service.py`：反馈创建和类型校验。
- `server/catalog/assistants.json`：八类助手、全部任务与字段定义。
- `server/scripts/seed_catalog.py`：幂等导入目录并校验 Prompt 绑定。
- `apps/desktop/src/pages/HomePage.tsx`：首页与最近内容。
- `apps/desktop/src/pages/AssistantsPage.tsx`：全量助手、搜索和收藏。
- `apps/desktop/src/pages/HistoryPage.tsx`：个人历史筛选和详情。
- `apps/desktop/src/local/drafts.ts`：设备本地草稿。
- `apps/desktop/src/local/syncQueue.ts`：完成结果待同步队列。

### 测试 fixture 契约

本阶段扩展 `server/tests/conftest.py`，定义 `db`、`client`、`client_for_user`、`active_task`、`completed_generation`、`records`、`knowledge_service`、`retriever`、`generation_rows`。用户工厂必须通过 dependency override 提供不同 `sso_user_id`，每次返回独立 TestClient，并在关闭时清理 override；数据 fixture 只写临时数据库。每个引用新 fixture 的 Task 都要把对应 fixture 实现纳入该 Task 的 Step 1 diff。

---

### Task 1: 扩展员工数据模型与迁移

**Files:**
- Modify: `juxin-ai-assistant/server/app/models.py`
- Create: `juxin-ai-assistant/server/alembic/versions/0002_employee_features.py`
- Create: `juxin-ai-assistant/server/tests/test_employee_models.py`

- [ ] **Step 1: 写新增表、唯一约束和历史关联测试**

```python
# juxin-ai-assistant/server/tests/test_employee_models.py
from sqlalchemy import inspect

from app.database import Base, engine
from app import models  # noqa: F401


def test_employee_feature_tables_and_constraints() -> None:
    Base.metadata.create_all(engine)
    inspector = inspect(engine)
    assert {
        "ai_knowledge_items",
        "ai_knowledge_task_links",
        "ai_feedback_records",
        "ai_user_favorites",
    }.issubset(set(inspector.get_table_names()))
    generation_columns = {item["name"] for item in inspector.get_columns("ai_generation_records")}
    assert {"parent_generation_id", "completion_token_hash", "input_nonce", "output_nonce"} <= generation_columns
```

- [ ] **Step 2: 运行并确认表/字段缺失**

Run: `cd juxin-ai-assistant/server && AUTH_DEV_BYPASS=true python3 -m pytest tests/test_employee_models.py -q`

Expected: FAIL with missing tables/columns.

- [ ] **Step 3: 增加 ORM 模型**

```python
# models.py additions
class KnowledgeItem(TimestampMixin, Base):
    __tablename__ = "ai_knowledge_items"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    title: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(64), index=True)
    tags_json: Mapped[list] = mapped_column(JSON, default=list)
    keywords_json: Mapped[list] = mapped_column(JSON, default=list)
    content_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    content_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[str] = mapped_column(String(32))
    priority: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", index=True)
    created_by: Mapped[str] = mapped_column(String(64))
    updated_by: Mapped[str] = mapped_column(String(64))


class KnowledgeTaskLink(TimestampMixin, Base):
    __tablename__ = "ai_knowledge_task_links"
    __table_args__ = (UniqueConstraint("knowledge_id", "task_id"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    knowledge_id: Mapped[int] = mapped_column(ForeignKey("ai_knowledge_items.id", ondelete="CASCADE"))
    task_id: Mapped[int] = mapped_column(ForeignKey("ai_tasks.id", ondelete="CASCADE"))


class FeedbackRecord(TimestampMixin, Base):
    __tablename__ = "ai_feedback_records"
    __table_args__ = (UniqueConstraint("generation_id", "sso_user_id", "feedback_type"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    generation_id: Mapped[int] = mapped_column(ForeignKey("ai_generation_records.id", ondelete="CASCADE"), index=True)
    sso_user_id: Mapped[str] = mapped_column(String(64), index=True)
    feedback_type: Mapped[str] = mapped_column(String(32))
    content_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    content_nonce: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    key_version: Mapped[str] = mapped_column(String(32))


class UserFavorite(TimestampMixin, Base):
    __tablename__ = "ai_user_favorites"
    __table_args__ = (UniqueConstraint("sso_user_id", "task_id"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    sso_user_id: Mapped[str] = mapped_column(String(64), index=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("ai_tasks.id", ondelete="CASCADE"))
```

Phase 1 already defines `completion_token_hash`, `input_nonce` and `output_nonce`. Add only nullable self-FK `parent_generation_id`, `finished_at`, `error_message_safe` and `knowledge_refs_json` in this migration; do not recreate or rename the phase 1 nonce fields.

- [ ] **Step 4: 编写显式迁移并验证回滚**

Run: `cd juxin-ai-assistant/server && alembic upgrade 0002_employee_features && alembic downgrade 0001_foundation && alembic upgrade head`

Expected: all commands exit 0 and preserve phase 1 generation rows during upgrade.

- [ ] **Step 5: 提交数据扩展**

```bash
git add juxin-ai-assistant/server
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 2: 实现动态字段权威校验

**Files:**
- Create: `juxin-ai-assistant/server/app/field_validation.py`
- Create: `juxin-ai-assistant/server/tests/test_field_validation.py`
- Modify: `juxin-ai-assistant/server/app/generation_service.py`

- [ ] **Step 1: 写每种字段类型和未知字段测试**

```python
# tests/test_field_validation.py
import pytest

from app.field_validation import FieldValidationError, validate_task_inputs


def test_rejects_missing_required_and_unknown_fields() -> None:
    fields = [{"field_key": "title", "field_type": "TEXT", "required": True, "validation_json": {"max_length": 20}}]
    with pytest.raises(FieldValidationError, match="title.*必填"):
        validate_task_inputs(fields, {})
    with pytest.raises(FieldValidationError, match="未知字段"):
        validate_task_inputs(fields, {"title": "周报", "api_key": "secret"})


@pytest.mark.parametrize(
    ("field_type", "value"),
    [("TEXT", "内容"), ("TEXTAREA", "多行\n内容"), ("SELECT", "A"), ("MULTISELECT", ["A"]),
     ("DATE", "2026-06-19"), ("NUMBER", 3), ("SWITCH", True)],
)
def test_accepts_supported_field_types(field_type: str, value: object) -> None:
    fields = [{"field_key": "value", "field_type": field_type, "required": True, "validation_json": {}}]
    assert validate_task_inputs(fields, {"value": value}) == {"value": value}
```

- [ ] **Step 2: 运行并确认 validator 缺失**

Run: `cd juxin-ai-assistant/server && python3 -m pytest tests/test_field_validation.py -q`

Expected: FAIL with missing module.

- [ ] **Step 3: 实现白名单、长度、选项、日期和数字范围校验**

```python
# app/field_validation.py
from datetime import date


class FieldValidationError(ValueError):
    pass


SUPPORTED_TYPES = {"TEXT", "TEXTAREA", "SELECT", "MULTISELECT", "DATE", "NUMBER", "SWITCH", "FILE_RESERVED"}


def validate_task_inputs(fields: list[dict], values: dict[str, object]) -> dict[str, object]:
    allowed = {field["field_key"]: field for field in fields}
    unknown = sorted(set(values) - set(allowed))
    if unknown:
        raise FieldValidationError(f"未知字段：{', '.join(unknown)}")
    normalized: dict[str, object] = {}
    for key, field in allowed.items():
        field_type = field["field_type"]
        if field_type not in SUPPORTED_TYPES:
            raise FieldValidationError(f"{key} 的字段类型不受支持")
        value = values.get(key)
        if field.get("required") and (value is None or value == "" or value == []):
            raise FieldValidationError(f"{key} 为必填项")
        if value is None or value == "":
            continue
        rules = field.get("validation_json") or {}
        options = {item["value"] for item in field.get("options_json") or []}
        if field_type in {"TEXT", "TEXTAREA"}:
            text = str(value).strip()
            if len(text) > int(rules.get("max_length", 20000)):
                raise FieldValidationError(f"{key} 超过最大长度")
            normalized[key] = text
        elif field_type == "SELECT":
            if value not in options:
                raise FieldValidationError(f"{key} 选项无效")
            normalized[key] = value
        elif field_type == "MULTISELECT":
            if not isinstance(value, list) or not set(value) <= options:
                raise FieldValidationError(f"{key} 多选值无效")
            normalized[key] = value
        elif field_type == "DATE":
            normalized[key] = date.fromisoformat(str(value)).isoformat()
        elif field_type == "NUMBER":
            number = float(value)
            if "min" in rules and number < float(rules["min"]):
                raise FieldValidationError(f"{key} 小于最小值")
            if "max" in rules and number > float(rules["max"]):
                raise FieldValidationError(f"{key} 大于最大值")
            normalized[key] = number
        elif field_type == "SWITCH":
            if not isinstance(value, bool):
                raise FieldValidationError(f"{key} 必须是布尔值")
            normalized[key] = value
        else:
            raise FieldValidationError(f"{key} 的文件上传尚未启用")
    return normalized
```

- [ ] **Step 4: 把 validator 接入 prepare 并统一返回 422**

`generation_service.prepare` must query ordered `TaskField` rows, call `validate_task_inputs`, map `FieldValidationError` to API code `TASK_INPUT_INVALID`, and encrypt only normalized values.

- [ ] **Step 5: 运行测试并提交**

Run: `cd juxin-ai-assistant/server && python3 -m pytest tests/test_field_validation.py tests/test_generation_flow.py -q`

Expected: all tests PASS.

```bash
git add juxin-ai-assistant/server
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 3: 实现敏感信息检测与不可伪造确认摘要

**Files:**
- Create: `juxin-ai-assistant/server/app/sensitive.py`
- Create: `juxin-ai-assistant/server/tests/test_sensitive.py`
- Modify: `juxin-ai-assistant/server/app/schemas.py`
- Modify: `juxin-ai-assistant/server/app/generation_service.py`

- [ ] **Step 1: 写检测、脱敏预览和摘要变化测试**

```python
# tests/test_sensitive.py
from app.sensitive import SensitiveDetector


def test_detects_required_patterns_without_returning_raw_secret() -> None:
    detector = SensitiveDetector(confirm_signing_key=b"x" * 32)
    result = detector.scan({"content": "api_key=sk-private 13800138000 admin/password123 10.0.0.8"})
    assert {item.code for item in result.findings} >= {"API_KEY", "PHONE", "ACCOUNT_PASSWORD", "IPV4"}
    assert "sk-private" not in repr(result)
    assert "13800138000" not in repr(result)


def test_confirmation_digest_changes_when_input_changes() -> None:
    detector = SensitiveDetector(confirm_signing_key=b"x" * 32)
    first = detector.scan({"content": "token=one"})
    second = detector.scan({"content": "token=two"})
    assert first.confirmation_digest != second.confirmation_digest
```

- [ ] **Step 2: 运行并确认 detector 缺失**

Run: `cd juxin-ai-assistant/server && python3 -m pytest tests/test_sensitive.py -q`

Expected: FAIL with missing module.

- [ ] **Step 3: 实现规则和 HMAC 摘要**

```python
# app/sensitive.py
import hashlib
import hmac
import json
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Finding:
    code: str
    field: str
    start: int
    end: int
    preview: str


@dataclass(frozen=True)
class ScanResult:
    findings: list[Finding]
    confirmation_digest: str


RULES = {
    "PRIVATE_KEY": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", re.I),
    "API_KEY": re.compile(r"\b(?:api[_-]?key|access[_-]?key|secret|token)\s*[:=]\s*\S+", re.I),
    "PHONE": re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"),
    "ID_CARD": re.compile(r"(?<!\d)\d{17}[0-9Xx](?!\d)"),
    "EMAIL": re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I),
    "IPV4": re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
    "URL": re.compile(r"https?://[^\s]+", re.I),
    "ACCOUNT_PASSWORD": re.compile(r"\b[\w.@+-]+\s*[/|,，]\s*(?:password|passwd|pwd)?\s*[:=]?\s*\S+", re.I),
}


class SensitiveDetector:
    def __init__(self, confirm_signing_key: bytes):
        self._key = confirm_signing_key

    def scan(self, values: dict[str, object]) -> ScanResult:
        canonical = json.dumps(values, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        findings: list[Finding] = []
        for field, raw in values.items():
            text = str(raw)
            for code, pattern in RULES.items():
                for match in pattern.finditer(text):
                    findings.append(Finding(code, field, match.start(), match.end(), "***"))
        digest = hmac.new(self._key, canonical.encode(), hashlib.sha256).hexdigest()
        return ScanResult(findings=findings, confirmation_digest=digest)
```

- [ ] **Step 4: 接入 prepare 的 409 流程**

`PrepareGenerationIn` adds optional `sensitive_confirmation_digest`. If findings exist and the supplied digest does not constant-time match the current digest, return HTTP 409 with code `SENSITIVE_CONFIRMATION_REQUIRED`, findings and digest. A changed input invalidates the old digest.

- [ ] **Step 5: 运行并提交**

Run: `cd juxin-ai-assistant/server && python3 -m pytest tests/test_sensitive.py tests/test_generation_flow.py -q`

Expected: all tests PASS, and test logs contain no matched raw value.

```bash
git add juxin-ai-assistant/server
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 4: 实现基础知识检索与可追溯 Prompt 编排

**Files:**
- Create: `juxin-ai-assistant/server/app/knowledge.py`
- Create: `juxin-ai-assistant/server/tests/test_knowledge.py`
- Modify: `juxin-ai-assistant/server/app/generation_service.py`
- Modify: `juxin-ai-assistant/server/app/models.py`

- [ ] **Step 1: 写任务关联、关键词和优先级测试**

```python
# tests/test_knowledge.py
def test_retrieval_filters_active_task_links_and_orders_priority(knowledge_service, task, db) -> None:
    low = knowledge_service.create_for_test(task, title="通用说明", keywords=["客户"], priority=1, content="低优先级")
    high = knowledge_service.create_for_test(task, title="客户案例", keywords=["客户", "报价"], priority=10, content="高优先级")
    knowledge_service.create_for_test(task, title="停用条目", keywords=["客户"], priority=99, status="DISABLED", content="不可见")
    results = knowledge_service.retrieve(db, task.id, {"background": "客户报价"}, limit=5)
    assert [item.uuid for item in results] == [high.uuid, low.uuid]
```

- [ ] **Step 2: 运行并确认服务缺失**

Run: `cd juxin-ai-assistant/server && python3 -m pytest tests/test_knowledge.py -q`

Expected: FAIL with missing service.

- [ ] **Step 3: 实现可替换接口和规则评分**

```python
# app/knowledge.py
from dataclasses import dataclass


@dataclass(frozen=True)
class RetrievedKnowledge:
    uuid: str
    title: str
    content: str
    score: int
    priority: int


class KnowledgeRetriever:
    def retrieve(self, db, task_id: int, inputs: dict[str, object], limit: int = 8) -> list[RetrievedKnowledge]:
        query_text = " ".join(str(value) for value in inputs.values()).lower()
        rows = self._active_rows_for_task(db, task_id)
        ranked = []
        for row in rows:
            keywords = [str(item).lower() for item in row.keywords_json or []]
            score = sum(1 for keyword in keywords if keyword and keyword in query_text)
            ranked.append(RetrievedKnowledge(
                uuid=row.uuid,
                title=row.title,
                content=self._decrypt(row),
                score=score,
                priority=row.priority,
            ))
        ranked.sort(key=lambda item: (item.score, item.priority, item.uuid), reverse=True)
        return ranked[:limit]
```

- [ ] **Step 4: 编排消息并记录知识 ID**

System message order must be: company safety rules → published Prompt → output format. User message contains normalized field labels/values followed by a delimited `参考知识` block. Add `knowledge_refs_json` to `GenerationRecord`; store only knowledge UUID/title/score, not duplicate plaintext.

- [ ] **Step 5: 运行并提交**

Run: `cd juxin-ai-assistant/server && python3 -m pytest tests/test_knowledge.py tests/test_generation_flow.py -q`

Expected: retrieval and prompt snapshot assertions PASS.

```bash
git add juxin-ai-assistant/server
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 5: 完成个人历史、删除与重新生成

**Files:**
- Create: `juxin-ai-assistant/server/app/history_service.py`
- Create: `juxin-ai-assistant/server/tests/test_history.py`
- Modify: `juxin-ai-assistant/server/app/main.py`
- Modify: `juxin-ai-assistant/server/app/schemas.py`

- [ ] **Step 1: 写对象归属和列表不解密正文测试**

```python
# tests/test_history.py
def test_user_only_reads_own_history(client_for_user, records) -> None:
    response = client_for_user("u-1").get("/api/ai/generations")
    assert response.status_code == 200
    assert {item["uuid"] for item in response.json()["items"]} == {records.u1.uuid}
    assert "input" not in response.json()["items"][0]
    assert "output" not in response.json()["items"][0]


def test_detail_decrypts_owner_record_only(client_for_user, records) -> None:
    assert client_for_user("u-1").get(f"/api/ai/generations/{records.u1.uuid}").status_code == 200
    assert client_for_user("u-2").get(f"/api/ai/generations/{records.u1.uuid}").status_code == 404


def test_regenerate_creates_child_record(client_for_user, records) -> None:
    response = client_for_user("u-1").post(f"/api/ai/generations/{records.u1.uuid}/regenerate")
    assert response.status_code == 201
    assert response.json()["parent_generation_uuid"] == records.u1.uuid
```

- [ ] **Step 2: 运行并确认历史路由缺失**

Run: `cd juxin-ai-assistant/server && python3 -m pytest tests/test_history.py -q`

Expected: FAIL with 404.

- [ ] **Step 3: 实现列表、详情、删除和重新生成服务**

List query filters by authenticated `sso_user_id` before pagination and returns metadata only. Detail queries by both UUID and user ID before decryption. Delete overwrites ciphertext/nonces with empty encrypted payload, sets `status=DELETED`, then deletes or tombstones the row according to retention setting. Regenerate decrypts only the owner input, creates a new prepare operation and sets parent ID.

- [ ] **Step 4: 暴露 API 并验证筛选**

Endpoints: `GET /api/ai/generations`, `GET /api/ai/generations/{uuid}`, `DELETE /api/ai/generations/{uuid}`, `POST /api/ai/generations/{uuid}/regenerate`. Filters: task UUID, assistant code, status, `created_from`, `created_to`, page and page size capped at 100.

- [ ] **Step 5: 运行并提交**

Run: `cd juxin-ai-assistant/server && python3 -m pytest tests/test_history.py -q`

Expected: all history tests PASS.

```bash
git add juxin-ai-assistant/server
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 6: 完成收藏、最近使用和首页聚合

**Files:**
- Create: `juxin-ai-assistant/server/tests/test_home.py`
- Modify: `juxin-ai-assistant/server/app/main.py`
- Modify: `juxin-ai-assistant/server/app/schemas.py`

- [ ] **Step 1: 写幂等收藏和用户隔离测试**

```python
# tests/test_home.py
def test_favorite_put_and_delete_are_idempotent(client, active_task) -> None:
    assert client.put(f"/api/ai/favorites/{active_task.uuid}").status_code == 204
    assert client.put(f"/api/ai/favorites/{active_task.uuid}").status_code == 204
    assert client.delete(f"/api/ai/favorites/{active_task.uuid}").status_code == 204
    assert client.delete(f"/api/ai/favorites/{active_task.uuid}").status_code == 204


def test_home_returns_favorites_recent_tasks_and_recent_records(client, seeded_home_data) -> None:
    payload = client.get("/api/ai/home").json()
    assert set(payload) == {"favorites", "recent_tasks", "recent_generations", "safety_reminders"}
    assert len(payload["recent_tasks"]) <= 8
    assert all("output" not in item for item in payload["recent_generations"])
```

- [ ] **Step 2: 实现聚合查询**

Favorite PUT uses MySQL `INSERT IGNORE` and SQLite-compatible test fallback; DELETE is safe when absent. Recent tasks derive from the authenticated user's latest generation per task, not a separate mutable table. Home endpoint executes four bounded queries and never decrypts generation content.

- [ ] **Step 3: 运行并提交**

Run: `cd juxin-ai-assistant/server && python3 -m pytest tests/test_home.py -q`

Expected: all tests PASS.

```bash
git add juxin-ai-assistant/server
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 7: 完成反馈能力

**Files:**
- Create: `juxin-ai-assistant/server/app/feedback_service.py`
- Create: `juxin-ai-assistant/server/tests/test_feedback.py`
- Modify: `juxin-ai-assistant/server/app/main.py`

- [ ] **Step 1: 写反馈类型、归属和密文测试**

```python
# tests/test_feedback.py
ALLOWED = {"USEFUL", "INACCURATE", "WRONG_FORMAT", "TOO_VAGUE", "NEEDS_EXPERTISE", "NOT_CLIENT_READY", "OTHER"}


def test_owner_can_submit_each_feedback_type(client, completed_generation) -> None:
    for feedback_type in ALLOWED:
        response = client.post(
            f"/api/ai/generations/{completed_generation.uuid}/feedback",
            json={"feedback_type": feedback_type, "content": "补充说明"},
        )
        assert response.status_code == 201


def test_feedback_never_stores_plain_comment(client, db, completed_generation) -> None:
    client.post(
        f"/api/ai/generations/{completed_generation.uuid}/feedback",
        json={"feedback_type": "OTHER", "content": "敏感反馈内容"},
    )
    row = db.query(FeedbackRecord).one()
    assert b"敏感反馈内容" not in row.content_ciphertext
```

- [ ] **Step 2: 实现反馈类型 enum、对象归属和 AES-GCM**

Create one feedback per user/generation/type per request; allow multiple types but use a unique constraint to prevent duplicate accidental clicks. `OTHER` requires non-empty content; other types may omit content. Only the record owner can submit.

- [ ] **Step 3: 运行并提交**

Run: `cd juxin-ai-assistant/server && python3 -m pytest tests/test_feedback.py -q`

Expected: all tests PASS.

```bash
git add juxin-ai-assistant/server
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 8: 建立完整八类任务目录和幂等种子

**Files:**
- Create: `juxin-ai-assistant/server/catalog/assistants.json`
- Create: `juxin-ai-assistant/server/scripts/seed_catalog.py`
- Create: `juxin-ai-assistant/server/tests/test_catalog.py`

- [ ] **Step 1: 写职责、数量、字段和 Prompt 绑定契约测试**

```python
# tests/test_catalog.py
import json
from pathlib import Path


def test_catalog_contains_all_confirmed_assistants_and_tasks() -> None:
    catalog = json.loads(Path("catalog/assistants.json").read_text(encoding="utf-8"))
    by_code = {item["code"]: item for item in catalog["assistants"]}
    assert set(by_code) == {"general", "sales", "delivery", "tender", "hr", "security", "documents", "training"}
    assert {task["name"] for task in by_code["sales"]["tasks"]} >= {"报价说明生成", "合同初稿辅助", "回款跟进话术"}
    tender_names = {task["name"] for task in by_code["tender"]["tasks"]}
    assert {"合同初稿辅助", "报价说明生成", "回款跟进话术"}.isdisjoint(tender_names)
    assert {"招标文件解读", "评分项分析", "废标风险检查"} <= tender_names
    for assistant in catalog["assistants"]:
        assert len(assistant["tasks"]) >= 3
        for task in assistant["tasks"]:
            assert task["prompt_external_id"] > 0
            assert task["fields"]
            assert all(field["field_key"] for field in task["fields"])
```

- [ ] **Step 2: 运行并确认目录缺失**

Run: `cd juxin-ai-assistant/server && python3 -m pytest tests/test_catalog.py -q`

Expected: FAIL because catalog file is missing.

- [ ] **Step 3: 写完整目录 JSON**

Use the exact task inventory from design spec section 14.1. Each task object must contain `code`, `name`, `description`, `output_format`, `safety_notice`, positive `prompt_external_id`, and at least one field. Use task-specific fields for the required examples; for remaining tasks use the explicit common trio `background` (TEXTAREA, required), `requirements` (TEXTAREA, required), `audience` (SELECT, required, internal/leader/customer) and then refine fields before activation. No task may be active with a zero Prompt ID.

- [ ] **Step 4: 实现事务化幂等种子**

`seed_catalog.py` validates the whole JSON first, calls the Prompt runtime endpoint for every binding, reports all missing published prompts in one error, then performs an upsert transaction. Existing admin edits to descriptions/fields are preserved unless `--force-config` is passed; status is never auto-promoted when Prompt validation fails.

- [ ] **Step 5: 运行目录测试和两次种子**

Run:

```bash
cd juxin-ai-assistant/server
python3 -m pytest tests/test_catalog.py -q
python3 scripts/seed_catalog.py --validate-only
python3 scripts/seed_catalog.py
python3 scripts/seed_catalog.py
```

Expected: tests PASS; second seed reports zero new rows and no duplicates.

- [ ] **Step 6: 提交目录**

```bash
git add juxin-ai-assistant/server
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 9: 完成员工工作台页面、草稿和待同步队列

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/src/pages/HomePage.tsx`
- Create: `juxin-ai-assistant/apps/desktop/src/pages/AssistantsPage.tsx`
- Create: `juxin-ai-assistant/apps/desktop/src/pages/HistoryPage.tsx`
- Create: `juxin-ai-assistant/apps/desktop/src/components/DynamicTaskForm.tsx`
- Create: `juxin-ai-assistant/apps/desktop/src/components/SensitiveWarningDialog.tsx`
- Create: `juxin-ai-assistant/apps/desktop/src/components/FeedbackPanel.tsx`
- Create: `juxin-ai-assistant/apps/desktop/src/local/drafts.ts`
- Create: `juxin-ai-assistant/apps/desktop/src/local/syncQueue.ts`
- Create: `juxin-ai-assistant/apps/desktop/tests/employee-flow.test.tsx`
- Modify: `juxin-ai-assistant/apps/desktop/src/App.tsx`

- [ ] **Step 1: 写员工导航、搜索、警告确认和历史测试**

```tsx
// tests/employee-flow.test.tsx
it('shows all assistants regardless of the signed-in department', async () => {
  render(<App initialSession={salesUserSession} />);
  await userEvent.click(screen.getByRole('link', { name: '全部助手' }));
  expect(await screen.findByText('销售助手')).toBeInTheDocument();
  expect(screen.getByText('商务投标助手')).toBeInTheDocument();
  expect(screen.getByText('技术与安全服务助手')).toBeInTheDocument();
});

it('requires explicit confirmation for the current sensitive digest', async () => {
  prepareMock.mockResolvedValueOnce({ code: 'SENSITIVE_CONFIRMATION_REQUIRED', digest: 'digest-1', findings: [{ code: 'PHONE', preview: '***' }] });
  render(<TaskRunPage task={task} />);
  await userEvent.click(screen.getByRole('button', { name: '开始生成' }));
  expect(await screen.findByRole('dialog', { name: '检测到敏感信息' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '确认并继续' }));
  expect(prepareMock).toHaveBeenLastCalledWith(expect.objectContaining({ sensitive_confirmation_digest: 'digest-1' }));
});
```

- [ ] **Step 2: 实现动态字段渲染和无文件解析状态**

Map server field types to Ant Design Input/Input.TextArea/Select/DatePicker/InputNumber/Switch. `FILE_RESERVED` renders a disabled upload card with exact text `文件解析将在后续版本启用，请先粘贴文本内容` and never submits a fake file value.

- [ ] **Step 3: 实现本地草稿和同步队列**

Draft key is `draft:<sso_user_id>:<task_uuid>`, with 7-day expiry and no API Key. Pending result queue item includes generation UUID, completion token, output, non-secret model metadata, retry count and next retry time; persist through Tauri local storage, not browser localStorage. Encrypt queued output with a device-local random key stored in the system keychain under fixed account `result-sync-key`.

- [ ] **Step 4: 实现历史和反馈 UI**

History list shows metadata first, decrypts detail only after row selection, supports task/date/status filters, copy and delete. Result controls include stop, copy全文, regenerate, save/sync status and feedback. Feedback panel uses the seven confirmed feedback types and only shows free text for `OTHER` or optional elaboration. Settings stores default output style locally and provides the cache-clearing entry; because all assistants are visible, it does not create a duplicate organization department preference.

- [ ] **Step 5: 运行前端测试、类型检查和构建**

Run: `npm --prefix juxin-ai-assistant/apps/desktop test && npm --prefix juxin-ai-assistant/apps/desktop run build`

Expected: all tests PASS; no login form or model API Key input outside `ModelProfilesPage`.

- [ ] **Step 6: 提交员工工作台**

```bash
git add juxin-ai-assistant/apps/desktop
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 10: 阶段 2 集成、隐私和端到端验收

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/e2e/employee-flow.spec.ts`
- Create: `juxin-ai-assistant/server/tests/test_secret_boundary.py`
- Modify: `scripts/tests/ai-assistant.sh`
- Modify: `juxin-ai-assistant/README.md`

- [ ] **Step 1: 写服务端永不接收密钥契约测试**

```python
# tests/test_secret_boundary.py
def test_all_openapi_request_schemas_exclude_model_secrets(client) -> None:
    schema = client.get("/openapi.json").json()
    serialized = str(schema).lower()
    assert "api_key" not in serialized
    assert "authorization" not in serialized
    assert "model_base_url" not in serialized
```

- [ ] **Step 2: 写 Playwright 员工闭环**

The E2E test uses a fake unified session fixture and a local mock OpenAI-compatible server. It must cover: all eight assistant cards visible, task search, favorite, draft restore, sensitive confirmation, streaming generation, completion sync, history detail, copy, regenerate, feedback and delete. Capture light and dark screenshots for Home, TaskRun and History.

- [ ] **Step 3: 运行阶段 2 全量验收**

Run:

```bash
python3 -m pytest juxin-ai-assistant/server/tests -q
npm --prefix juxin-ai-assistant/apps/desktop test
npm --prefix juxin-ai-assistant/apps/desktop run build
cargo test --manifest-path juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml
npm --prefix juxin-ai-assistant/apps/desktop run test:e2e
bash scripts/tests/ai-assistant.sh
```

Expected: all checks PASS; eight assistants and every catalog task load; E2E mock API Key appears only in mock model process input and nowhere in FastAPI access logs, request captures or database fixtures.

- [ ] **Step 4: 更新员工使用说明并提交**

README documents model data responsibility, sensitive confirmation, history retention/delete, local drafts, browser limitation and how to connect OpenAI-compatible local models.

```bash
git add juxin-ai-assistant scripts/tests/ai-assistant.sh
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

## 阶段 2 完成定义

- 八类助手和设计规格中的全部任务已导入，职责边界正确。
- 每个 ACTIVE 任务都有动态字段和可读取的已发布 Prompt。
- 敏感确认不可复用到修改后的输入，日志无敏感原文。
- 基础知识检索可解释、可追溯，生成记录保存 Prompt/知识版本信息。
- 用户只能查看、删除和反馈自己的完整历史。
- 收藏、最近使用、草稿、重新生成和离线待同步可用。
- API/OpenAPI、服务端日志和数据库均不包含模型 API Key。
