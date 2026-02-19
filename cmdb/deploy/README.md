# Local Run with Docker Compose

Start full stack (MySQL + MongoDB + Kafka + CMDB):

```bash
cd /Users/zhanglei/Documents/codex-new/cmdb/deploy
docker compose up -d --build
```

Check services:

```bash
docker compose ps
docker compose logs -f cmdb
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
