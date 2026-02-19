# CMDB Service (Independent Domain)

This directory contains an independent CMDB implementation blueprint and starter service.

## Stack
- Language: Go 1.22+
- Web: Gin
- Auth: OIDC SSO (token verification middleware)
- Datastores: MySQL (source of truth) + MongoDB (flexible/raw snapshots)
- Messaging: Kafka (event integration with reminder/workorder systems)

## Boundary
- CMDB manages CI entities, relationships, lifecycle state, and change/audit history.
- Reminder/Workorder systems only reference `ci_uid` and consume CMDB events.
- No direct cross-service database access.

## Directory
- `cmd/cmdb`: service bootstrap
- `internal`: app code (config, db, handlers, services, events, auth)
- `migrations/mysql`: MySQL DDL
- `schemas/mongo`: MongoDB collection design and JSON schemas
- `contracts/kafka`: topic/event contracts
- `api/openapi`: REST API contract (V1 minimal)
- `docs`: architecture and rollout notes
- `deploy`: local docker-compose stack
- `web`: CMDB frontend (React + Vite + Nginx)

## Quick Start (Local Binary)
1. Create MySQL schema and run `/Users/zhanglei/Documents/codex-new/cmdb/migrations/mysql/001_init_cmdb.sql`.
2. Create MongoDB collections according to `/Users/zhanglei/Documents/codex-new/cmdb/schemas/mongo/README.md`.
3. Create Kafka topics listed in `/Users/zhanglei/Documents/codex-new/cmdb/contracts/kafka/README.md`.
4. Copy `.env.example` to `.env` and fill values.
5. Start service:

```bash
cd /Users/zhanglei/Documents/codex-new/cmdb
go mod tidy
go run ./cmd/cmdb
```

## Quick Start (Docker Compose)

```bash
cd /Users/zhanglei/Documents/codex-new/cmdb/deploy
docker compose up -d --build
```

See `/Users/zhanglei/Documents/codex-new/cmdb/deploy/README.md` for operations.

Frontend URL:
- `http://localhost:8090`

Frontend local dev:

```bash
cd /Users/zhanglei/Documents/codex-new/cmdb/web
npm install
npm run dev
```

## V1 APIs
- `GET /healthz`
- `GET /api/v1/ci/:ci_uid`
- `POST /api/v1/ci`
- `PATCH /api/v1/ci/:ci_uid`
- `POST /api/v1/ci/:ci_uid/relations`

## Unified Login
- `cmdb/web` reuses Juxin unified login portal (`/portal`) and uses auth service issued HttpOnly session cookie.
- Backend API introspects bearer token or cookie token via `AUTH_SERVICE_URL`, and verifies app access includes `cmdb`.

## API Smoke Test

```bash
TOKEN=dummy-token

curl -X POST http://localhost:8088/api/v1/ci \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "X-Actor-Sub: user-1001" \
  -d '{
    "ci_type_key": "application",
    "name": "order-service",
    "unique_key": "order-service.prod",
    "status": "active",
    "owner": "platform-team"
  }'
```

## Core Integration Rules
- CI write path: MySQL transaction + outbox insert.
- Outbox relay publishes to Kafka and marks event status.
- Consumers must deduplicate by `event_id`.
- Every mutating API call writes to `operation_audit` and `ci_change_log`.
