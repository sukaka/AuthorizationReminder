# CMDB Implementation Plan (6 Weeks)

## Week 1-2
- Build MySQL schema and migration pipeline
- Implement CI read/write APIs and relation APIs
- Add operation audit and change log writes

## Week 3
- Integrate OIDC SSO and RBAC mapping from IdP groups
- Add request tracing (`trace_id` / `request_id`)

## Week 4
- Build reconcile jobs from discovery raw data into MySQL canonical CI
- Implement outbox relay to Kafka

## Week 5
- Integrate reminder/workorder consumers
- Add event idempotency and version checks

## Week 6
- Load test and failure injection
- Run production readiness checklist and rollout
