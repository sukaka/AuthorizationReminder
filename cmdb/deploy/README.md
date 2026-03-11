# Local Run with Docker Compose

Start full stack (MySQL + Kafka + CMDB):

```bash
cd /Users/zhanglei/Documents/codex-new/cmdb/deploy
export MYSQL_ROOT_PASSWORD=change_me
export CMDB_MYSQL_PASSWORD=change_me
docker compose up -d --build
```

The `cmdb-db-init` one-shot task will:
- apply `/Users/zhanglei/Documents/codex-new/cmdb/migrations/mysql/001_init_cmdb.sql`
- create or reset `cmdb_user`
- grant `cmdb.*` runtime DML privileges

Check services:

```bash
docker compose ps
docker compose logs -f cmdb
docker compose logs -f cmdb-db-init
```

Useful endpoints:
- CMDB API: `http://localhost:8088`
- Health: `http://localhost:8088/healthz`
- Kafka UI: `http://localhost:8089`
- CMDB Web: `http://localhost:8090`

SSO prerequisite:
- CMDB Web uses the unified auth portal at `http://localhost:5180`.
- Ensure the `auth` service is running and the current account has `cmdb` app access.

Stop and clean:

```bash
docker compose down
```

Reset data volumes:

```bash
docker compose down -v
```
