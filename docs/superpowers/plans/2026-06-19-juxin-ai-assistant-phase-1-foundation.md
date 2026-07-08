# 聚信 AI 助手阶段 1：平台基础与可用纵切 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有统一平台中交付一个可运行的“工作总结”纵切：统一 SSO 登录、MySQL 任务数据、提示词中心运行时读取、React 动态表单、Tauri 本地模型和加密历史回存全部打通。

**Architecture:** React 工作台由 Nginx 提供并复用统一登录 Cookie；FastAPI 通过 `auth` introspect/authorize 管理业务权限并访问独立 MySQL schema；Tauri 仅向固定工作台来源开放收窄的本地模型命令，API Key 留在系统钥匙串。阶段 1 只实现一个真实任务，但所有边界按最终架构建立，后续阶段在这些接口上扩展。

**Tech Stack:** Tauri 2、Rust、React 19、TypeScript 6、Vite、Ant Design、FastAPI、SQLAlchemy 2、Alembic、MySQL 8、pytest、Vitest、Playwright、Node test runner。

---

## 文件职责图

### 新增目录

- `juxin-ai-assistant/server/app/config.py`：环境配置与启动校验。
- `juxin-ai-assistant/server/app/database.py`：SQLAlchemy engine/session/base。
- `juxin-ai-assistant/server/app/auth.py`：统一登录 introspect/authorize 客户端。
- `juxin-ai-assistant/server/app/models.py`：阶段 1 助手、任务、字段、Prompt 绑定、生成记录 ORM。
- `juxin-ai-assistant/server/app/schemas.py`：稳定 API 类型。
- `juxin-ai-assistant/server/app/crypto.py`：内容 AES-GCM 加解密。
- `juxin-ai-assistant/server/app/prompt_client.py`：提示词中心运行时客户端。
- `juxin-ai-assistant/server/app/generation_service.py`：任务校验、消息编排和完成令牌。
- `juxin-ai-assistant/server/app/main.py`：FastAPI 路由与统一错误形状。
- `juxin-ai-assistant/server/alembic/`：显式数据库迁移。
- `juxin-ai-assistant/server/scripts/seed.py`：幂等初始化“通用助手/工作总结”。
- `juxin-ai-assistant/apps/desktop/src/`：React 工作台、主题、动态表单和结果页。
- `juxin-ai-assistant/apps/desktop/src-tauri/src/model_profiles.rs`：非秘密模型元数据。
- `juxin-ai-assistant/apps/desktop/src-tauri/src/keychain.rs`：系统钥匙串抽象。
- `juxin-ai-assistant/apps/desktop/src-tauri/src/model_client.rs`：OpenAI 兼容本地调用与 URL 安全。
- `juxin-ai-assistant/apps/desktop/src-tauri/src/commands.rs`：不返回密钥的 Tauri 命令。

### 修改现有文件

- `auth/portal-routing.js`：注册 `ai-assistant` 系统键和默认访问范围。
- `auth/system-access-display.js`：统一管理中心显示名称。
- `auth/index.js`：门户 URL、应用卡片和授权动作。
- `prompt-center/backend/src/index.js`：增加服务端运行时读取路由。
- `prompt-center/backend/src/prompt-service.js`：读取已发布 Prompt/指定发布版本。
- `docker-compose.yml`：注册 API 和 Web 服务并注入现有 MySQL/auth/prompt-center。
- `.env.example`：只增加变量名和安全说明，不写真实值。
- `README.md`：增加服务入口和启动命令。

### 测试 fixture 契约

`server/tests/conftest.py` 随任务逐步扩展，并统一提供：`client`（dev-bypass 用户 + 每测试独立 SQLite）、`seeded_task`（ACTIVE 工作总结任务及字段/绑定）、`pending_generation`（归属当前用户的 PENDING 记录）。所有工厂通过 FastAPI dependency override 注入会话，通过事务回滚隔离数据库；不得通过生产环境变量伪造用户。前端 `tests/setup.ts` 统一启动 MSW，Tauri invoke mock 必须在测试文件中显式声明。

### 类型与命名约定

HTTP JSON 沿用 FastAPI/Pydantic 的 `snake_case`（如 `generation_uuid`、`model_id`）；Tauri IPC 的 Rust 输入输出统一加 `#[serde(rename_all = "camelCase")]`，React 调用使用 `profileId`、`latencyMs`。数据库列保持 `snake_case`。后续阶段不得混用这些边界命名。

---

### Task 1: 建立 FastAPI 可测试骨架

**Files:**
- Create: `juxin-ai-assistant/server/requirements.txt`
- Create: `juxin-ai-assistant/server/app/__init__.py`
- Create: `juxin-ai-assistant/server/app/config.py`
- Create: `juxin-ai-assistant/server/app/database.py`
- Create: `juxin-ai-assistant/server/app/main.py`
- Create: `juxin-ai-assistant/server/tests/conftest.py`
- Create: `juxin-ai-assistant/server/tests/test_health.py`
- Create: `juxin-ai-assistant/server/Dockerfile`

- [ ] **Step 1: 写测试环境和失败的健康检查测试**

```python
# juxin-ai-assistant/server/tests/conftest.py
import os

import pytest

os.environ.setdefault("AUTH_DEV_BYPASS", "true")


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as value:
        yield value
```

```python
# juxin-ai-assistant/server/tests/test_health.py
from fastapi.testclient import TestClient

from app.main import app


def test_health_exposes_service_and_version() -> None:
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "juxin-ai-assistant",
        "version": "1.0.0",
    }
```

- [ ] **Step 2: 运行测试并确认因模块缺失而失败**

Run: `cd juxin-ai-assistant/server && python3 -m pytest tests/test_health.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'app'`.

- [ ] **Step 3: 创建锁定依赖和最小应用**

```text
# juxin-ai-assistant/server/requirements.txt
fastapi==0.136.3
uvicorn[standard]==0.32.1
SQLAlchemy==2.0.36
alembic==1.14.1
PyMySQL==1.1.1
pydantic-settings==2.7.1
httpx==0.28.1
cryptography==44.0.1
pytest==9.0.3
pytest-asyncio==1.4.0
```

```python
# juxin-ai-assistant/server/app/config.py
from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "聚信 AI 助手"
    app_version: str = "1.0.0"
    database_url: str = "sqlite+pysqlite:///./juxin-ai-assistant-dev.db"
    auth_service_url: str = "http://auth:5180"
    auth_system_key: str = "ai-assistant"
    auth_cookie_name: str = "juxin_auth_token"
    auth_fetch_timeout_ms: int = Field(default=5000, ge=1000, le=30000)
    auth_dev_bypass: bool = False
    prompt_center_url: str = "http://prompt-center-api:5189"
    prompt_center_runtime_token: str = ""
    content_encryption_key: str = ""
    content_encryption_key_version: str = "v1"
    public_url: str = "http://localhost:18093"
    cors_origins: str = "http://localhost:18093,http://127.0.0.1:18093"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @model_validator(mode="after")
    def validate_production_secrets(self) -> "Settings":
        if not self.auth_dev_bypass:
            if len(self.prompt_center_runtime_token) < 32:
                raise ValueError("PROMPT_CENTER_RUNTIME_TOKEN 至少需要 32 个字符")
            if len(self.content_encryption_key) < 43:
                raise ValueError("CONTENT_ENCRYPTION_KEY 必须是 32 字节 URL-safe base64")
        return self

    @property
    def allowed_origins(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

```python
# juxin-ai-assistant/server/app/database.py
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

```python
# juxin-ai-assistant/server/app/main.py
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings

settings = get_settings()
app = FastAPI(title=settings.app_name, version=settings.app_version)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
)


@app.middleware("http")
async def enforce_write_origin(request: Request, call_next):
    if request.method not in {"GET", "HEAD", "OPTIONS"} and not settings.auth_dev_bypass:
        if request.headers.get("origin", "") not in settings.allowed_origins:
            return JSONResponse(status_code=403, content={
                "success": False,
                "code": "ORIGIN_FORBIDDEN",
                "message": "请求来源不受信任",
                "data": None,
            })
    return await call_next(request)


@app.exception_handler(Exception)
async def unhandled_error(_request: Request, _error: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"success": False, "code": "INTERNAL_ERROR", "message": "服务暂不可用", "data": None},
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "juxin-ai-assistant",
        "version": settings.app_version,
    }
```

- [ ] **Step 4: 安装依赖并运行测试**

Run: `cd juxin-ai-assistant/server && python3 -m pip install -r requirements.txt && AUTH_DEV_BYPASS=true python3 -m pytest tests/test_health.py -q`

Expected: `1 passed`.

- [ ] **Step 5: 添加非 root Docker 镜像并构建**

```dockerfile
# juxin-ai-assistant/server/Dockerfile
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
RUN adduser --disabled-password --gecos "" appuser && chown -R appuser:appuser /app
USER appuser
EXPOSE 5193
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5193", "--workers", "2"]
```

Run: `docker build -t juxin-ai-assistant-api:test juxin-ai-assistant/server`

Expected: image builds without copying `.env` or tests into the runtime image.

- [ ] **Step 6: 提交骨架**

```bash
git add juxin-ai-assistant/server
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

Expected: post-commit hook pushes `codex/5.87.0` without changing version `5.87.0`.

---

### Task 2: 把 AI 助手注册到统一登录和门户

**Files:**
- Modify: `auth/portal-routing.js`
- Modify: `auth/system-access-display.js`
- Modify: `auth/index.js`
- Modify: `docker-compose.yml`
- Test: `auth/tests/ai-assistant-portal-source.test.js`
- Test: `auth/tests/portal-routing.test.js`
- Test: `auth/tests/system-access-display.test.js`

- [ ] **Step 1: 写系统键、显示名、门户和授权失败测试**

```javascript
// auth/tests/ai-assistant-portal-source.test.js
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'auth', 'index.js'), 'utf8');

test('auth exposes the AI assistant portal entry and authorization branch', () => {
  assert.match(source, /APP_AI_ASSISTANT_URL/);
  assert.match(source, /key: 'ai-assistant', name: '聚信 AI 助手'/);
  assert.match(source, /system === 'ai-assistant'/);
  assert.match(source, /result = authorizeAiAssistant\(user, action, scope\);/);
});

test('AI assistant does not add a child-system login endpoint', () => {
  assert.doesNotMatch(source, /ai-assistant.*auth\/login/);
});
```

- [ ] **Step 2: 运行并确认缺少注册**

Run: `node --test auth/tests/ai-assistant-portal-source.test.js auth/tests/portal-routing.test.js auth/tests/system-access-display.test.js`

Expected: FAIL because `ai-assistant` is absent.

- [ ] **Step 3: 增加系统键和默认业务访问**

```javascript
// auth/portal-routing.js additions
const SYSTEM_ACCESS_KEYS = Object.freeze([
  'reminder',
  DELIVERY_KEY,
  'cmdb',
  'inventory',
  'device-flow',
  'faq',
  'tender',
  'train-exam',
  'prompt-center',
  'sca',
  'big-screen',
  'ai-assistant',
  ADMIN_CENTER_KEY,
  AUDIT_CENTER_KEY,
]);

const REQUIRED_BUSINESS_PORTAL_KEYS = Object.freeze([
  'train-exam',
  'prompt-center',
  'sca',
  'big-screen',
  'ai-assistant',
]);
```

```javascript
// auth/system-access-display.js addition before dedicated centers
{ key: 'ai-assistant', label: '聚信 AI 助手', shortLabel: 'AI 助手' },
```

- [ ] **Step 4: 增加授权函数和门户卡片**

```javascript
// auth/index.js
const authorizeAiAssistant = (user, action, scope = {}) => {
  if (!user) return deny('未登录');
  if (!canAccessSystem(user, 'ai-assistant')) return deny('无权限访问聚信 AI 助手');
  const role = String(user.role || '').toLowerCase();
  if (action === 'app:enter' || action === 'ai_assistant:use') return allow();
  if (action === 'ai_assistant:department:stats' || action === 'ai_assistant:task:suggest') {
    if (Array.isArray(scope.managedDepartments) && scope.managedDepartments.length) return allow();
    return deny('仅部门负责人可执行该操作');
  }
  if (action === 'ai_assistant:admin') {
    if (role === 'admin' || role === 'sysadmin') return allow();
    return deny('仅管理员或系统管理员可执行该操作');
  }
  if (action === 'ai_assistant:audit:read') {
    if (role === 'admin' || role === 'auditor') return allow();
    return deny('仅管理员或审计员可查看审计日志');
  }
  return deny('不支持的授权动作');
};
```

Add to `/api/auth/authorize` after `scope` is built:

```javascript
} else if (system === 'ai-assistant') {
  result = authorizeAiAssistant(user, action, scope);
}
```

Add to `/api/auth/apps`:

```javascript
const aiAssistantURL = process.env.APP_AI_ASSISTANT_URL || 'http://localhost:18093';

if (appAccess.includes('ai-assistant')) {
  const aiAssistantAuth = authorizeAiAssistant(user, 'app:enter', await buildUserScope(user));
  apps.push({ key: 'ai-assistant', name: '聚信 AI 助手', url: aiAssistantURL, allow: !!aiAssistantAuth.allow });
}
```

- [ ] **Step 5: 注入门户 URL 并运行认证测试**

Add under `auth.environment` in `docker-compose.yml`:

```yaml
APP_AI_ASSISTANT_URL: "http://${PUBLIC_HOST:-localhost}:18093"
```

Run: `node --test auth/tests/ai-assistant-portal-source.test.js auth/tests/portal-routing.test.js auth/tests/system-access-display.test.js`

Expected: all selected tests PASS.

- [ ] **Step 6: 提交统一登录集成**

```bash
git add auth/portal-routing.js auth/system-access-display.js auth/index.js auth/tests/ai-assistant-portal-source.test.js auth/tests/portal-routing.test.js auth/tests/system-access-display.test.js docker-compose.yml
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 3: 实现 FastAPI 统一会话依赖

**Files:**
- Create: `juxin-ai-assistant/server/app/auth.py`
- Create: `juxin-ai-assistant/server/app/schemas.py`
- Create: `juxin-ai-assistant/server/tests/test_auth.py`
- Modify: `juxin-ai-assistant/server/app/main.py`

- [ ] **Step 1: 写 Cookie 转发和无独立登录测试**

```python
# juxin-ai-assistant/server/tests/test_auth.py
from fastapi.testclient import TestClient

from app.main import app


def test_session_uses_dev_bypass_without_login_route(monkeypatch) -> None:
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    routes = {route.path for route in app.routes}
    assert "/api/ai/auth/login" not in routes
    assert "/api/auth/login" not in routes


def test_session_returns_unified_user(client: TestClient) -> None:
    response = client.get("/api/ai/session")
    assert response.status_code == 200
    assert response.json()["user"]["username"] == "dev_admin"
    assert response.json()["apps"] == ["ai-assistant"]
```

- [ ] **Step 2: 运行并确认 session 路由不存在**

Run: `cd juxin-ai-assistant/server && AUTH_DEV_BYPASS=true python3 -m pytest tests/test_auth.py -q`

Expected: FAIL with `404` for `/api/ai/session`.

- [ ] **Step 3: 实现 introspect 和 authorize 客户端**

```python
# juxin-ai-assistant/server/app/schemas.py
from pydantic import BaseModel, Field


class UserPayload(BaseModel):
    id: int | str
    username: str
    role: str


class AuthScope(BaseModel):
    department: str | None = None
    managed_departments: list[str] = Field(default_factory=list, alias="managedDepartments")


class SessionPayload(BaseModel):
    user: UserPayload
    scope: AuthScope
    apps: list[str]
```

```python
# juxin-ai-assistant/server/app/auth.py
from typing import Annotated, Any

import httpx
from fastapi import Depends, HTTPException, Request

from .config import Settings, get_settings
from .schemas import AuthScope, SessionPayload, UserPayload


async def get_session(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> SessionPayload:
    if settings.auth_dev_bypass:
        return SessionPayload(
            user=UserPayload(id="dev", username="dev_admin", role="admin"),
            scope=AuthScope(department="通用", managedDepartments=["通用"]),
            apps=[settings.auth_system_key],
        )
    token = request.cookies.get(settings.auth_cookie_name)
    if not token:
        raise HTTPException(status_code=401, detail="未登录")
    try:
        async with httpx.AsyncClient(base_url=settings.auth_service_url, timeout=settings.auth_fetch_timeout_ms / 1000) as client:
            response = await client.get("/api/auth/introspect", cookies={settings.auth_cookie_name: token})
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="统一登录平台暂不可用") from exc
    if response.status_code == 401:
        raise HTTPException(status_code=401, detail="登录已过期")
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail="统一登录校验失败")
    payload: dict[str, Any] = response.json()
    apps = payload.get("apps") or []
    if settings.auth_system_key not in apps:
        raise HTTPException(status_code=403, detail="无权限访问聚信 AI 助手")
    return SessionPayload(user=payload["user"], scope=payload.get("scope") or {}, apps=apps)


async def require_action(action: str, request: Request, session: SessionPayload, settings: Settings) -> SessionPayload:
    if settings.auth_dev_bypass:
        return session
    token = request.cookies.get(settings.auth_cookie_name)
    async with httpx.AsyncClient(base_url=settings.auth_service_url, timeout=settings.auth_fetch_timeout_ms / 1000) as client:
        response = await client.post(
            "/api/auth/authorize",
            cookies={settings.auth_cookie_name: token},
            json={"system": settings.auth_system_key, "action": action},
        )
    payload = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
    if response.status_code >= 400 or not payload.get("allow"):
        raise HTTPException(status_code=403, detail=payload.get("reason") or "无权限访问聚信 AI 助手")
    return session
```

- [ ] **Step 4: 暴露只读 session 路由**

```python
# juxin-ai-assistant/server/app/main.py additions
from typing import Annotated
import httpx
from fastapi import Depends, Request, Response
from .auth import get_session
from .schemas import SessionPayload


@app.get("/api/ai/session", response_model=SessionPayload)
async def session(payload: Annotated[SessionPayload, Depends(get_session)]) -> SessionPayload:
    return payload


@app.post("/api/ai/logout", status_code=204)
async def logout(request: Request, settings: Annotated[Settings, Depends(get_settings)]) -> Response:
    token = request.cookies.get(settings.auth_cookie_name)
    if token:
        async with httpx.AsyncClient(base_url=settings.auth_service_url, timeout=settings.auth_fetch_timeout_ms / 1000) as client:
            await client.post("/api/auth/logout", cookies={settings.auth_cookie_name: token})
    response = Response(status_code=204)
    response.delete_cookie(settings.auth_cookie_name, path="/")
    return response
```

- [ ] **Step 5: 用 respx/httpx mock 覆盖 401、503、成功转发**

Add `respx==0.22.0` to `requirements.txt`, then add tests that assert introspect/logout outbound requests contain only `juxin_auth_token`, never a username/password body, and that a valid SSO user without `ai-assistant` in `apps` receives 403.

Run: `cd juxin-ai-assistant/server && AUTH_DEV_BYPASS=true python3 -m pytest tests/test_auth.py -q`

Expected: all auth tests PASS.

- [ ] **Step 6: 提交会话边界**

```bash
git add juxin-ai-assistant/server
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 4: 建立 MySQL schema、Alembic 和阶段 1 ORM

**Files:**
- Create: `juxin-ai-assistant/server/alembic.ini`
- Create: `juxin-ai-assistant/server/alembic/env.py`
- Create: `juxin-ai-assistant/server/alembic/versions/0001_foundation.py`
- Create: `juxin-ai-assistant/server/app/models.py`
- Create: `juxin-ai-assistant/server/scripts/bootstrap_db.py`
- Modify: `juxin-ai-assistant/server/Dockerfile`
- Create: `juxin-ai-assistant/server/tests/test_models.py`

- [ ] **Step 1: 写模型结构测试**

```python
# juxin-ai-assistant/server/tests/test_models.py
from sqlalchemy import inspect

from app.database import Base, engine
from app import models  # noqa: F401


def test_foundation_tables_and_unique_codes() -> None:
    Base.metadata.create_all(engine)
    inspector = inspect(engine)
    assert {
        "ai_assistants",
        "ai_tasks",
        "ai_task_fields",
        "ai_task_prompt_bindings",
        "ai_generation_records",
    }.issubset(set(inspector.get_table_names()))
    assert {column["name"] for column in inspector.get_columns("ai_generation_records")} >= {
        "uuid",
        "sso_user_id",
        "input_ciphertext",
        "output_ciphertext",
        "status",
        "created_at",
        "updated_at",
    }
```

- [ ] **Step 2: 运行并确认表不存在**

Run: `cd juxin-ai-assistant/server && AUTH_DEV_BYPASS=true python3 -m pytest tests/test_models.py -q`

Expected: FAIL because `app.models` does not exist.

- [ ] **Step 3: 实现带审计时间的 ORM 基类和五张表**

```python
# juxin-ai-assistant/server/app/models.py
import uuid as uuid_lib
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, JSON, LargeBinary, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class Assistant(TimestampMixin, Base):
    __tablename__ = "ai_assistants"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    code: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text, default="")
    icon: Mapped[str] = mapped_column(String(64), default="sparkles")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE")
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    updated_by: Mapped[str] = mapped_column(String(64), default="system")


class Task(TimestampMixin, Base):
    __tablename__ = "ai_tasks"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    assistant_id: Mapped[int] = mapped_column(ForeignKey("ai_assistants.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(96), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text, default="")
    output_format: Mapped[str] = mapped_column(Text, default="Markdown")
    safety_notice: Mapped[str] = mapped_column(Text, default="生成内容需人工复核")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="DRAFT")
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    updated_by: Mapped[str] = mapped_column(String(64), default="system")
    assistant: Mapped[Assistant] = relationship()


class TaskField(TimestampMixin, Base):
    __tablename__ = "ai_task_fields"
    __table_args__ = (UniqueConstraint("task_id", "field_key"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    task_id: Mapped[int] = mapped_column(ForeignKey("ai_tasks.id", ondelete="CASCADE"), index=True)
    field_key: Mapped[str] = mapped_column(String(96))
    label: Mapped[str] = mapped_column(String(128))
    field_type: Mapped[str] = mapped_column(String(32))
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    placeholder: Mapped[str] = mapped_column(String(512), default="")
    example: Mapped[str] = mapped_column(Text, default="")
    options_json: Mapped[list] = mapped_column(JSON, default=list)
    validation_json: Mapped[dict] = mapped_column(JSON, default=dict)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    updated_by: Mapped[str] = mapped_column(String(64), default="system")


class TaskPromptBinding(TimestampMixin, Base):
    __tablename__ = "ai_task_prompt_bindings"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("ai_tasks.id", ondelete="CASCADE"), unique=True)
    prompt_external_id: Mapped[int] = mapped_column(BigInteger)
    version_policy: Mapped[str] = mapped_column(String(16), default="PUBLISHED")
    pinned_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE")
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    updated_by: Mapped[str] = mapped_column(String(64), default="system")


class GenerationRecord(TimestampMixin, Base):
    __tablename__ = "ai_generation_records"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    sso_user_id: Mapped[str] = mapped_column(String(64), index=True)
    username_snapshot: Mapped[str] = mapped_column(String(128))
    department_snapshot: Mapped[str] = mapped_column(String(128), default="")
    task_id: Mapped[int] = mapped_column(ForeignKey("ai_tasks.id"), index=True)
    prompt_external_id: Mapped[int] = mapped_column(BigInteger)
    prompt_version: Mapped[int] = mapped_column(Integer)
    input_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    output_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    input_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    output_nonce: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    key_version: Mapped[str] = mapped_column(String(32))
    completion_token_hash: Mapped[bytes] = mapped_column(LargeBinary)
    model_display_name: Mapped[str] = mapped_column(String(128), default="")
    model_id: Mapped[str] = mapped_column(String(128), default="")
    status: Mapped[str] = mapped_column(String(24), default="PENDING", index=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    usage_json: Mapped[dict] = mapped_column(JSON, default=dict)
    error_code: Mapped[str] = mapped_column(String(64), default="")
```

- [ ] **Step 4: 实现独立 schema/最小权限账号初始化**

```python
# juxin-ai-assistant/server/scripts/bootstrap_db.py
import os
import re

import pymysql

IDENTIFIER = re.compile(r"^[A-Za-z0-9_]+$")
database = os.environ.get("MYSQL_DATABASE", "juxin_ai_assistant")
app_user = os.environ.get("MYSQL_USER", "ai_assistant_user")
app_password = os.environ["MYSQL_PASSWORD"]
for value in (database, app_user):
    if not IDENTIFIER.fullmatch(value):
        raise SystemExit("数据库名或账号格式无效")

connection = pymysql.connect(
    host=os.environ.get("MYSQL_HOST", "mysql"),
    port=int(os.environ.get("MYSQL_PORT", "3306")),
    user=os.environ.get("MYSQL_ADMIN_USER", "root"),
    password=os.environ["MYSQL_ADMIN_PASSWORD"],
    autocommit=True,
)
with connection.cursor() as cursor:
    cursor.execute(f"CREATE DATABASE IF NOT EXISTS `{database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
    cursor.execute(f"CREATE USER IF NOT EXISTS '{app_user}'@'%' IDENTIFIED BY %s", (app_password,))
    cursor.execute(f"ALTER USER '{app_user}'@'%' IDENTIFIED BY %s", (app_password,))
    cursor.execute(f"GRANT ALL PRIVILEGES ON `{database}`.* TO '{app_user}'@'%'")
connection.close()
```

The one-shot init container receives root credentials; the long-running API container receives only the app-user `DATABASE_URL`.

Update the server Dockerfile after these files exist:

```dockerfile
COPY app ./app
COPY alembic.ini ./alembic.ini
COPY alembic ./alembic
COPY scripts ./scripts
```

- [ ] **Step 5: 生成并审阅 Alembic 迁移**

Run: `cd juxin-ai-assistant/server && AUTH_DEV_BYPASS=true alembic revision --autogenerate -m foundation`

Expected: migration creates exactly the five `ai_*` tables, unique constraints and indexes. Rename file to `0001_foundation.py` and set `revision = "0001_foundation"`.

- [ ] **Step 6: 在临时 MySQL schema 执行 upgrade/downgrade/upgrade**

Run: `DATABASE_URL='mysql+pymysql://ai_test:ai_test@127.0.0.1:3308/juxin_ai_assistant_test' AUTH_DEV_BYPASS=true alembic upgrade head && alembic downgrade base && alembic upgrade head`

Expected: all three commands exit 0; no table appears outside the test schema.

- [ ] **Step 7: 提交数据基础**

```bash
git add juxin-ai-assistant/server
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 5: 增加提示词中心已发布版本运行时接口

**Files:**
- Modify: `prompt-center/backend/src/prompt-service.js`
- Modify: `prompt-center/backend/src/index.js`
- Modify: `prompt-center/backend/Dockerfile`
- Test: `prompt-center/backend/tests/runtime-prompt.test.mjs`
- Modify: `docker-compose.yml`

- [ ] **Step 1: 写 token、发布状态和指定版本测试**

```javascript
// prompt-center/backend/tests/runtime-prompt.test.mjs
import { createRequire } from 'node:module';
import { describe, expect, test, vi } from 'vitest';

const require = createRequire(import.meta.url);
const service = require('../src/prompt-service');

describe('runtime prompt reader', () => {
  test('rejects a prompt that is not published', async () => {
    const db = { get: vi.fn().mockResolvedValue({ id: 7, status: 'draft' }) };
    await expect(service.getPublishedPrompt(db, 7)).rejects.toMatchObject({ statusCode: 404 });
  });

  test('returns the current immutable version', async () => {
    const db = { get: vi.fn().mockResolvedValue({
      id: 7,
      status: 'published',
      current_version_id: 11,
      version_no: 3,
      title: '工作总结',
      content: '请总结 {{工作内容}}',
      tags_json: '["通用"]',
    }) };
    await expect(service.getPublishedPrompt(db, 7)).resolves.toMatchObject({
      prompt_id: 7,
      version_no: 3,
      content: '请总结 {{工作内容}}',
    });
  });
});
```

- [ ] **Step 2: 运行并确认 helper 不存在**

Run: `npm --prefix prompt-center/backend test -- --run tests/runtime-prompt.test.mjs`

Expected: FAIL with `service.getPublishedPrompt is not a function`.

- [ ] **Step 3: 实现只返回发布版本的查询**

```javascript
// prompt-center/backend/src/prompt-service.js
const getPublishedPrompt = async (db, id, requestedVersion = null) => {
  const params = [Number(id)];
  const versionClause = requestedVersion ? 'AND v.version_no = ?' : 'AND v.id = p.current_version_id';
  if (requestedVersion) params.push(Number(requestedVersion));
  const row = await db.get(
    `SELECT p.id AS prompt_id, p.status, v.id AS version_id, v.version_no,
            v.title, v.summary, v.content, v.tags_json
       FROM pc_prompts p
       JOIN pc_prompt_versions v ON v.prompt_id = p.id
      WHERE p.id = ? AND p.status = 'published' ${versionClause}`,
    params
  );
  if (!row) throw appError('已发布提示词不存在', 404);
  return {
    prompt_id: Number(row.prompt_id),
    version_id: Number(row.version_id),
    version_no: Number(row.version_no),
    title: row.title,
    summary: row.summary || '',
    content: row.content,
    tags: parseTags(row.tags_json),
    variables: extractPromptVariables(row.content),
  };
};
```

Export `getPublishedPrompt` from `module.exports`.

- [ ] **Step 4: 增加独立的常量时间比较 token middleware**

```javascript
// prompt-center/backend/src/index.js additions before auth-protected router
const crypto = require('node:crypto');
const RUNTIME_TOKEN = String(process.env.PROMPT_CENTER_RUNTIME_TOKEN || '');

const requireRuntimeToken = (req, res, next) => {
  const provided = String(req.get('x-prompt-runtime-token') || '');
  const expected = Buffer.from(RUNTIME_TOKEN);
  const actual = Buffer.from(provided);
  if (expected.length < 32 || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return res.status(401).json({ error: '运行时凭据无效' });
  }
  next();
};

app.get('/api/prompt-center/runtime/prompts/:id/published', requireRuntimeToken, asyncHandler(async (req, res) => {
  res.json(await service.getPublishedPrompt(db, req.params.id, req.query.version || null));
}));
```

This route must be mounted before the existing user-authenticated `/api/prompt-center` router middleware.

- [ ] **Step 5: 注入同一服务间凭据并运行测试**

Task 10 的 Compose 变更必须在 `prompt-center-api.environment` 和 `ai-assistant-api.environment` 注入同一变量名：

```yaml
PROMPT_CENTER_RUNTIME_TOKEN: ${PROMPT_CENTER_RUNTIME_TOKEN}
```

Run: `npm --prefix prompt-center/backend test -- --run tests/runtime-prompt.test.mjs`

Expected: runtime prompt tests PASS; existing prompt-center tests remain green.

- [ ] **Step 6: 提交运行时接口**

```bash
git add prompt-center/backend docker-compose.yml
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 6: 实现内容加密、Prompt 客户端和 prepare/complete 纵切

**Files:**
- Create: `juxin-ai-assistant/server/app/crypto.py`
- Create: `juxin-ai-assistant/server/app/prompt_client.py`
- Create: `juxin-ai-assistant/server/app/generation_service.py`
- Create: `juxin-ai-assistant/server/tests/test_generation_flow.py`
- Modify: `juxin-ai-assistant/server/app/schemas.py`
- Modify: `juxin-ai-assistant/server/app/main.py`

- [ ] **Step 1: 写生成载荷不含模型秘密的失败测试**

```python
# juxin-ai-assistant/server/tests/test_generation_flow.py
def test_prepare_returns_provider_neutral_messages(client, seeded_task) -> None:
    response = client.post(
        "/api/ai/generations/prepare",
        json={"task_uuid": seeded_task.uuid, "inputs": {"work_content": "完成统一登录接入"}},
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["messages"][0]["role"] == "system"
    assert "完成统一登录接入" in payload["messages"][1]["content"]
    forbidden = {"api_key", "base_url", "model", "authorization"}
    assert forbidden.isdisjoint(payload.keys())


def test_complete_rejects_another_user(client, pending_generation) -> None:
    response = client.post(
        f"/api/ai/generations/{pending_generation.uuid}/complete",
        json={"completion_token": "wrong", "output": "结果", "model_display_name": "本地模型", "model_id": "qwen"},
    )
    assert response.status_code == 403
```

- [ ] **Step 2: 运行并确认路由缺失**

Run: `cd juxin-ai-assistant/server && AUTH_DEV_BYPASS=true python3 -m pytest tests/test_generation_flow.py -q`

Expected: FAIL with `404`.

- [ ] **Step 3: 实现 AES-GCM 密文封装**

```python
# juxin-ai-assistant/server/app/crypto.py
import base64
import json
import os
from dataclasses import dataclass

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


@dataclass(frozen=True)
class EncryptedPayload:
    ciphertext: bytes
    nonce: bytes


class ContentCipher:
    def __init__(self, encoded_key: str):
        key = base64.urlsafe_b64decode(encoded_key.encode("ascii"))
        if len(key) != 32:
            raise ValueError("内容加密密钥必须是 32 字节")
        self._cipher = AESGCM(key)

    def encrypt_json(self, value: dict, associated_data: bytes) -> EncryptedPayload:
        nonce = os.urandom(12)
        raw = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        return EncryptedPayload(self._cipher.encrypt(nonce, raw, associated_data), nonce)

    def decrypt_json(self, payload: EncryptedPayload, associated_data: bytes) -> dict:
        raw = self._cipher.decrypt(payload.nonce, payload.ciphertext, associated_data)
        return json.loads(raw.decode("utf-8"))
```

- [ ] **Step 4: 实现 Prompt 运行时客户端和变量替换**

```python
# juxin-ai-assistant/server/app/prompt_client.py
import httpx


class PromptCenterClient:
    def __init__(self, base_url: str, runtime_token: str, timeout_seconds: float = 5.0):
        self.base_url = base_url
        self.runtime_token = runtime_token
        self.timeout_seconds = timeout_seconds

    async def get_published(self, prompt_id: int, version: int | None = None) -> dict:
        params = {"version": version} if version is not None else None
        async with httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout_seconds) as client:
            response = await client.get(
                f"/api/prompt-center/runtime/prompts/{prompt_id}/published",
                params=params,
                headers={"x-prompt-runtime-token": self.runtime_token},
            )
        if response.status_code == 404:
            raise LookupError("任务绑定的已发布 Prompt 不存在")
        response.raise_for_status()
        return response.json()


def render_prompt(template: str, values: dict[str, object]) -> str:
    result = template
    for key, value in values.items():
        result = result.replace("{{" + key + "}}", str(value))
    return result
```

- [ ] **Step 5: 实现 prepare/complete 状态机**

Define request/response types in `schemas.py`:

```python
class PrepareGenerationIn(BaseModel):
    task_uuid: str
    inputs: dict[str, object]


class MessageOut(BaseModel):
    role: str
    content: str


class PrepareGenerationOut(BaseModel):
    generation_uuid: str
    completion_token: str
    messages: list[MessageOut]
    temperature: float = 0.3
    safety_notice: str


class CompleteGenerationIn(BaseModel):
    completion_token: str
    output: str = Field(min_length=1, max_length=2_000_000)
    model_display_name: str = Field(max_length=128)
    model_id: str = Field(max_length=128)
    latency_ms: int = Field(ge=0, le=3_600_000)
    usage: dict[str, int] = Field(default_factory=dict)
```

Implement state rules in `generation_service.py`: `PENDING -> COMPLETED|FAILED|CANCELLED` only; completion token is 32 random bytes, only its SHA-256 hash is stored; owner and constant-time token match are required; `complete` encrypts `{"output": output}` with associated data `generation_uuid.encode()`.

- [ ] **Step 6: 运行生成纵切测试**

Run: `cd juxin-ai-assistant/server && AUTH_DEV_BYPASS=true python3 -m pytest tests/test_generation_flow.py tests/test_models.py -q`

Expected: prepare and complete tests PASS; response serialization contains no `base_url`, `api_key`, `authorization`, or server credential.

- [ ] **Step 7: 提交服务端纵切**

```bash
git add juxin-ai-assistant/server
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 7: 建立 React TypeScript 工作台与 macOS 双主题

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/package.json`
- Create: `juxin-ai-assistant/apps/desktop/tsconfig.json`
- Create: `juxin-ai-assistant/apps/desktop/vite.config.ts`
- Create: `juxin-ai-assistant/apps/desktop/index.html`
- Create: `juxin-ai-assistant/apps/desktop/src/main.tsx`
- Create: `juxin-ai-assistant/apps/desktop/src/App.tsx`
- Create: `juxin-ai-assistant/apps/desktop/src/api/client.ts`
- Create: `juxin-ai-assistant/apps/desktop/src/theme/tokens.css`
- Create: `juxin-ai-assistant/apps/desktop/src/theme/ThemeProvider.tsx`
- Create: `juxin-ai-assistant/apps/desktop/tests/setup.ts`
- Create: `juxin-ai-assistant/apps/desktop/tests/theme.test.tsx`
- Create: `juxin-ai-assistant/apps/desktop/tests/session.test.tsx`

- [ ] **Step 1: 创建 package scripts 和失败测试**

```json
{
  "name": "juxin-ai-assistant-desktop",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0 --port 18093",
    "typecheck": "tsc --noEmit",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "antd": "^5.0.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@playwright/test": "1.60.0",
    "@tauri-apps/cli": "^2.0.0",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.1",
    "@types/node": "^20.19.42",
    "@types/react": "^19.2.5",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.1.1",
    "jsdom": "29.1.1",
    "msw": "^2.0.0",
    "typescript": "6.0.3",
    "vite": "8.0.16",
    "vitest": "4.1.8"
  }
}
```

```typescript
// juxin-ai-assistant/apps/desktop/vite.config.ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: { port: 18093, proxy: { '/api/ai': 'http://localhost:5193' } },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
  },
});
```

```typescript
// juxin-ai-assistant/apps/desktop/tests/setup.ts
import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { setupServer } from 'msw/node';

export const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

```tsx
// juxin-ai-assistant/apps/desktop/tests/theme.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '../src/theme/ThemeProvider';

describe('ThemeProvider', () => {
  it('offers system, light and dark choices', () => {
    render(<ThemeProvider><div>content</div></ThemeProvider>);
    expect(screen.getByRole('button', { name: '跟随系统' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '浅色' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '深色' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行并确认主题模块缺失**

Run: `npm --prefix juxin-ai-assistant/apps/desktop install && npm --prefix juxin-ai-assistant/apps/desktop test`

Expected: FAIL because `ThemeProvider` does not exist.

- [ ] **Step 3: 实现语义 token 和主题选择**

```css
/* juxin-ai-assistant/apps/desktop/src/theme/tokens.css */
:root,
[data-theme='light'] {
  color-scheme: light;
  --background: #f5f5f7;
  --surface: rgba(255, 255, 255, 0.82);
  --surface-elevated: #ffffff;
  --text-primary: #1d1d1f;
  --text-secondary: #6e6e73;
  --border: rgba(60, 60, 67, 0.16);
  --accent: #007aff;
  --danger: #ff3b30;
  --radius-card: 14px;
}

[data-theme='dark'] {
  color-scheme: dark;
  --background: #1c1c1e;
  --surface: rgba(44, 44, 46, 0.82);
  --surface-elevated: #2c2c2e;
  --text-primary: #f5f5f7;
  --text-secondary: #aeaeb2;
  --border: rgba(235, 235, 245, 0.16);
  --accent: #0a84ff;
  --danger: #ff453a;
}

@media (prefers-reduced-transparency: reduce) {
  :root { --surface: var(--surface-elevated); }
}
```

`ThemeProvider` must persist only `system|light|dark` in local storage, react to `prefers-color-scheme`, set `document.documentElement.dataset.theme`, and pass matching Ant Design `ConfigProvider` theme algorithms.

- [ ] **Step 4: 实现会话检查而不是登录页**

```typescript
// juxin-ai-assistant/apps/desktop/src/api/client.ts
export type SessionPayload = {
  user: { id: string | number; username: string; role: string };
  scope: { department: string | null; managedDepartments: string[] };
  apps: string[];
};

export async function getSession(): Promise<SessionPayload> {
  const response = await fetch('/api/ai/session', { credentials: 'include' });
  if (response.status === 401) {
    const returnTo = encodeURIComponent(window.location.href);
    const authUrl = import.meta.env.VITE_AUTH_PUBLIC_URL || 'http://localhost:5180';
    window.location.assign(`${authUrl}/login?system=ai-assistant&return_to=${returnTo}`);
    throw new Error('AUTH_REDIRECT');
  }
  if (!response.ok) throw new Error(`SESSION_${response.status}`);
  return response.json();
}
```

`App.tsx` renders only `正在检查统一登录…`, authenticated shell, 403, or dependency error states. Do not create username/password inputs.

- [ ] **Step 5: 运行测试、类型检查和构建**

Run: `npm --prefix juxin-ai-assistant/apps/desktop test && npm --prefix juxin-ai-assistant/apps/desktop run build`

Expected: tests PASS and production bundle builds.

- [ ] **Step 6: 提交 Web 骨架**

```bash
git add juxin-ai-assistant/apps/desktop
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 8: 实现 Tauri 多模型配置、系统钥匙串和 URL 防护

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/build.rs`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/tauri.conf.json`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/capabilities/remote-main.json`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/src/lib.rs`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/src/model_profiles.rs`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/src/keychain.rs`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/src/model_client.rs`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/src/commands.rs`

- [ ] **Step 1: 写 URL 和密钥不回传的 Rust 测试**

```rust
// juxin-ai-assistant/apps/desktop/src-tauri/src/model_client.rs
#[cfg(test)]
mod tests {
    use super::validate_base_url;

    #[test]
    fn allows_https_and_loopback_http() {
        assert!(validate_base_url("https://api.example.com/v1").is_ok());
        assert!(validate_base_url("http://127.0.0.1:11434/v1").is_ok());
        assert!(validate_base_url("http://localhost:11434/v1").is_ok());
    }

    #[test]
    fn rejects_public_http_and_credential_urls() {
        assert!(validate_base_url("http://api.example.com/v1").is_err());
        assert!(validate_base_url("https://user:pass@example.com/v1").is_err());
        assert!(validate_base_url("file:///tmp/key").is_err());
    }
}
```

- [ ] **Step 2: 创建 Cargo 配置并确认测试失败**

```toml
# juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml
[package]
name = "juxin-ai-assistant"
version = "1.0.0"
edition = "2021"

[lib]
name = "juxin_ai_assistant_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = { version = "1", features = ["v4", "serde"] }
url = "2"
keyring = "3"
reqwest = { version = "0.12", default-features = false, features = ["json", "stream", "rustls-tls"] }
tokio = { version = "1", features = ["sync"] }
futures-util = "0.3"
thiserror = "2"
zeroize = "1"

[dev-dependencies]
tempfile = "3"
maplit = "1"
```

Run: `cargo test --manifest-path juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml`

Expected: FAIL because `validate_base_url` is not implemented.

- [ ] **Step 3: 实现 URL 校验与不可读取密钥的接口**

```rust
// model_client.rs
use url::{Host, Url};

pub fn validate_base_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "模型地址格式无效".to_string())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("模型地址不能包含账号密码".to_string());
    }
    let loopback = matches!(url.host(), Some(Host::Domain("localhost")))
        || matches!(url.host(), Some(Host::Ipv4(ip)) if ip.is_loopback())
        || matches!(url.host(), Some(Host::Ipv6(ip)) if ip.is_loopback());
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err("公网模型地址必须使用 HTTPS".to_string());
    }
    Ok(url)
}
```

```rust
// keychain.rs
pub trait SecretStore: Send + Sync {
    fn set(&self, profile_id: &str, secret: &str) -> Result<(), String>;
    fn get(&self, profile_id: &str) -> Result<Option<String>, String>;
    fn delete(&self, profile_id: &str) -> Result<(), String>;
}

pub struct SystemKeychain;

impl SecretStore for SystemKeychain {
    fn set(&self, profile_id: &str, secret: &str) -> Result<(), String> {
        keyring::Entry::new("com.juxin.ai-assistant", profile_id)
            .map_err(|_| "无法打开系统钥匙串".to_string())?
            .set_password(secret)
            .map_err(|_| "无法保存模型密钥".to_string())
    }

    fn get(&self, profile_id: &str) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new("com.juxin.ai-assistant", profile_id)
            .map_err(|_| "无法打开系统钥匙串".to_string())?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("无法读取模型密钥".to_string()),
        }
    }

    fn delete(&self, profile_id: &str) -> Result<(), String> {
        let entry = keyring::Entry::new("com.juxin.ai-assistant", profile_id)
            .map_err(|_| "无法打开系统钥匙串".to_string())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("无法删除模型密钥".to_string()),
        }
    }
}
```

If the pinned `keyring` 3.x API differs on the target toolchain, update only this adapter and its tests; no React or model client code may depend directly on `keyring::Entry`.

- [ ] **Step 4: 实现多配置元数据和命令返回类型**

Rust 内部 `ModelProfilePublic` contains `id`, `display_name`, `base_url`, `model_id`, `temperature`, `timeout_seconds`, `is_default`, `has_api_key`, and derives `#[serde(rename_all = "camelCase")]` for IPC. It never contains an `api_key` field. Upsert accepts `api_key: Option<String>`, writes it directly to `SecretStore`, then drops the input before serializing the public profile.

- [ ] **Step 5: 限定远程来源和命令能力**

Set `build.frontendDist` to the local fallback bundle and `app.windows[0].url` to `https://ai-assistant.invalid` only as a build-time default overridden by `AI_ASSISTANT_PUBLIC_URL` in platform-specific config generation. In `capabilities/remote-main.json`, specify the exact production origin supplied at build time and only the seven model profile/generate commands. Do not use `https://*` or `http://*` wildcards.

Run: `cargo tauri build --debug --no-bundle`

Expected: Tauri schema validation succeeds; generated capabilities contain one exact remote origin.

- [ ] **Step 6: 运行 Rust 测试和 secret 字段扫描**

Run: `cargo test --manifest-path juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml && ! rg -n 'api_key.*Serialize|pub api_key' juxin-ai-assistant/apps/desktop/src-tauri/src`

Expected: tests PASS and grep exits 0 because no serializable public API key field exists.

- [ ] **Step 7: 提交 Tauri 安全基础**

```bash
git add juxin-ai-assistant/apps/desktop
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 9: 实现本地 OpenAI 兼容流式调用并接入任务 UI

**Files:**
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/src/model_client.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/src/commands.rs`
- Create: `juxin-ai-assistant/apps/desktop/src/types/tauri.ts`
- Create: `juxin-ai-assistant/apps/desktop/src/pages/ModelProfilesPage.tsx`
- Create: `juxin-ai-assistant/apps/desktop/src/pages/TaskRunPage.tsx`
- Create: `juxin-ai-assistant/apps/desktop/tests/task-run.test.tsx`

- [ ] **Step 1: 写前端完整闭环失败测试**

```tsx
// juxin-ai-assistant/apps/desktop/tests/task-run.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';
import { TaskRunPage } from '../src/pages/TaskRunPage';
import { server } from './setup';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

const workSummaryTask = {
  uuid: 'task-1',
  name: '工作总结',
  fields: [{ field_key: 'work_content', label: '工作内容', field_type: 'TEXTAREA', required: true }],
};

it('prepares provider-neutral messages, invokes Tauri and completes history', async () => {
  server.use(
    http.post('/api/ai/generations/prepare', () => HttpResponse.json({
      generation_uuid: 'gen-1',
      completion_token: 'complete-1',
      messages: [{ role: 'user', content: '总结本周工作' }],
      temperature: 0.3,
      safety_notice: '需人工复核',
    }, { status: 201 })),
    http.post('/api/ai/generations/gen-1/complete', () => HttpResponse.json({ status: 'COMPLETED' })),
  );
  invokeMock.mockResolvedValue({ output: '# 本周总结', latencyMs: 120, usage: {} });
  render(<TaskRunPage task={workSummaryTask} />);
  await userEvent.type(screen.getByLabelText('工作内容'), '完成统一登录接入');
  await userEvent.click(screen.getByRole('button', { name: '开始生成' }));
  expect(await screen.findByText('# 本周总结')).toBeInTheDocument();
  expect(invokeMock).toHaveBeenCalledWith('model_generate', expect.objectContaining({ profileId: 'default' }));
});
```

- [ ] **Step 2: 运行并确认页面/命令缺失**

Run: `npm --prefix juxin-ai-assistant/apps/desktop test -- task-run.test.tsx`

Expected: FAIL because `TaskRunPage` and `model_generate` are missing.

- [ ] **Step 3: 实现 Rust 请求与 SSE 解析**

`model_generate` inputs are `profile_id`, `messages`, `temperature`, and `request_id`. Rust reads the selected profile and secret, POSTs `<base_url>/chat/completions` with `stream: true`, sets Bearer only when a key exists, rejects cross-host redirects, emits `model://delta/<request_id>` and `model://done/<request_id>`, and zeroizes the local secret string after request construction. Map status 401/403 to `MODEL_AUTH_FAILED`, 429 to `MODEL_RATE_LIMITED`, timeout to `MODEL_TIMEOUT`, invalid SSE to `MODEL_PROTOCOL_ERROR`.

- [ ] **Step 4: 实现模型配置页和任务页**

`ModelProfilesPage` supports list/upsert/delete/default/test and shows only `密钥已配置` or `未配置`. `TaskRunPage` calls server prepare first, invokes local generation second, and calls complete last. The browser-only branch checks `window.__TAURI_INTERNALS__`; when absent it shows `生成能力仅在聚信 AI 助手桌面客户端中可用` and does not request an API Key.

- [ ] **Step 5: 运行前端、Rust 和类型测试**

Run: `npm --prefix juxin-ai-assistant/apps/desktop test && npm --prefix juxin-ai-assistant/apps/desktop run build && cargo test --manifest-path juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml`

Expected: all commands PASS.

- [ ] **Step 6: 提交端到端生成桥**

```bash
git add juxin-ai-assistant/apps/desktop
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 10: Compose、Nginx、幂等种子和纵切验收

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/Dockerfile`
- Create: `juxin-ai-assistant/apps/desktop/nginx.conf`
- Create: `juxin-ai-assistant/server/scripts/seed.py`
- Create: `scripts/tests/ai-assistant.sh`
- Create: `tests/ai-assistant-compose-source.test.js`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `scripts/tests/run-all.sh`

- [ ] **Step 1: 写 Compose 来源测试**

```javascript
// tests/ai-assistant-compose-source.test.js
const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const compose = fs.readFileSync('docker-compose.yml', 'utf8');

test('compose registers AI assistant against existing platform services', () => {
  assert.match(compose, /^  ai-assistant-api:/m);
  assert.match(compose, /^  web-ai-assistant:/m);
  assert.match(compose, /MYSQL_DATABASE: juxin_ai_assistant/);
  assert.match(compose, /AUTH_SERVICE_URL: "http:\/\/auth:5180"/);
  assert.match(compose, /PROMPT_CENTER_URL: "http:\/\/prompt-center-api:5189"/);
  assert.doesNotMatch(compose, /ai-assistant-sqlite/);
});
```

- [ ] **Step 2: 运行并确认服务缺失**

Run: `node --test tests/ai-assistant-compose-source.test.js`

Expected: FAIL because Compose services are absent.

- [ ] **Step 3: 增加 API/Web 服务**

```yaml
  ai-assistant-db-init:
    build:
      context: ./juxin-ai-assistant/server
    command: ["sh", "-c", "python scripts/bootstrap_db.py && alembic upgrade head"]
    environment:
      MYSQL_HOST: mysql
      MYSQL_PORT: 3306
      MYSQL_DATABASE: juxin_ai_assistant
      MYSQL_USER: ai_assistant_user
      MYSQL_PASSWORD: ${AI_ASSISTANT_MYSQL_PASSWORD}
      MYSQL_ADMIN_USER: root
      MYSQL_ADMIN_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      DATABASE_URL: "mysql+pymysql://ai_assistant_user:${AI_ASSISTANT_MYSQL_PASSWORD}@mysql:3306/juxin_ai_assistant"
      AUTH_DEV_BYPASS: "true"
    depends_on:
      mysql:
        condition: service_healthy
    restart: "no"

  ai-assistant-api:
    build:
      context: ./juxin-ai-assistant/server
    environment:
      APP_VERSION: "1.0.0"
      DATABASE_URL: "mysql+pymysql://ai_assistant_user:${AI_ASSISTANT_MYSQL_PASSWORD}@mysql:3306/juxin_ai_assistant"
      AUTH_SERVICE_URL: "http://auth:5180"
      AUTH_SYSTEM_KEY: "ai-assistant"
      AUTH_COOKIE_NAME: "juxin_auth_token"
      PROMPT_CENTER_URL: "http://prompt-center-api:5189"
      PROMPT_CENTER_RUNTIME_TOKEN: ${PROMPT_CENTER_RUNTIME_TOKEN}
      CONTENT_ENCRYPTION_KEY: ${AI_CONTENT_ENCRYPTION_KEY}
      CONTENT_ENCRYPTION_KEY_VERSION: "v1"
      PUBLIC_URL: "http://${PUBLIC_HOST:-localhost}:18093"
      CORS_ORIGINS: "http://localhost:18093,http://127.0.0.1:18093,http://${PUBLIC_HOST:-localhost}:18093"
    depends_on:
      ai-assistant-db-init:
        condition: service_completed_successfully
      auth:
        condition: service_started
      prompt-center-api:
        condition: service_started
    ports:
      - "5193:5193"

  web-ai-assistant:
    build:
      context: ./juxin-ai-assistant/apps/desktop
      args: *build_args_node_alpine_nginx
    depends_on:
      - ai-assistant-api
      - auth
    ports:
      - "18093:80"
```

Append names-only examples to `.env.example`:

```dotenv
# 聚信 AI 助手：部署时必须替换，禁止提交真实值
AI_ASSISTANT_MYSQL_PASSWORD=change_me_ai_assistant_password
PROMPT_CENTER_RUNTIME_TOKEN=change_me_at_least_32_random_characters
AI_CONTENT_ENCRYPTION_KEY=change_me_urlsafe_base64_encoded_32_bytes
```

Nginx proxies `/api/ai/` to `ai-assistant-api:5193`, disables buffering for streaming-compatible endpoints, forwards Cookie and Origin, sets CSP/frame headers, and serves `index.html` fallback.

- [ ] **Step 4: 实现幂等种子**

`seed.py` upserts assistant code `general`, task code `work-summary`, fields `work_content`, `period`, `audience`, and a configured `WORK_SUMMARY_PROMPT_ID`. It sets the task `ACTIVE` only when that Prompt runtime endpoint returns a published version; otherwise it stays `DRAFT` and exits with a clear nonzero status in production seed mode.

- [ ] **Step 5: 增加一键测试脚本**

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

step "开始执行 ai-assistant 一键测试"
compose_up mysql auth prompt-center-api ai-assistant-api web-ai-assistant
wait_http_status "${AUTH_BASE:-http://localhost:5180}/health" "200" "auth-health"
wait_http_status "${AI_ASSISTANT_API_BASE:-http://localhost:5193}/health" "200" "ai-assistant-api-health"
wait_http_status "${AI_ASSISTANT_WEB_BASE:-http://localhost:18093}" "200" "ai-assistant-web"
run_cmd "AI assistant backend tests" python3 -m pytest "$ROOT_DIR/juxin-ai-assistant/server/tests" -q
run_npm_script_if_exists "juxin-ai-assistant/apps/desktop" "test"
run_npm_script_if_exists "juxin-ai-assistant/apps/desktop" "build"
run_cmd "AI assistant Rust tests" cargo test --manifest-path "$ROOT_DIR/juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml"
log "[OK] ai-assistant 系统一键测试通过"
```

- [ ] **Step 6: 运行阶段 1 全量验收**

Run:

```bash
node --test auth/tests/ai-assistant-portal-source.test.js tests/ai-assistant-compose-source.test.js
npm --prefix prompt-center/backend test
python3 -m pytest juxin-ai-assistant/server/tests -q
npm --prefix juxin-ai-assistant/apps/desktop test
npm --prefix juxin-ai-assistant/apps/desktop run build
cargo test --manifest-path juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml
SKIP_COMPOSE_UP=0 bash scripts/tests/ai-assistant.sh
```

Expected: all unit/build checks PASS; Compose health endpoints return 200; unauthenticated `/api/ai/session` returns 401; the work summary task can be prepared and completed with a mock local OpenAI-compatible server; server logs contain no mock API Key.

- [ ] **Step 7: 更新阶段 1 文档并提交**

README must document prerequisites, existing unified login URL, MySQL reuse, environment variable names, seed command, browser limitation, desktop development command, and the exact phase 1 test command. It must not mention a default AI assistant password.

```bash
git add juxin-ai-assistant docker-compose.yml .env.example README.md scripts/tests/ai-assistant.sh scripts/tests/run-all.sh tests/ai-assistant-compose-source.test.js
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

## 阶段 1 完成定义

- 统一门户出现“聚信 AI 助手”，未登录只跳现有统一登录。
- 没有 AI 助手登录页、密码表、JWT 签发或默认管理员。
- 数据位于现有 MySQL 的 `juxin_ai_assistant` schema。
- “工作总结”从动态表单到 Prompt 中心、Tauri 本地模型和服务端历史完整跑通。
- 用户可以保存多个模型配置；密钥只在系统钥匙串。
- 服务端、前端、Tauri、Prompt 中心和 Compose 测试全部通过。
- 版本保持 `5.87.0`，所有实现提交使用 `fixup!` 并由现有钩子自动推送当前分支。
