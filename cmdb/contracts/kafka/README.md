# Kafka Contracts

## Topics
- `cmdb.ci.created`
- `cmdb.ci.updated`
- `cmdb.ci.relation.changed`
- `cmdb.ci.deleted`
- `cmdb.ci.reconciled`

Partition key: `ci_uid`

## Event Envelope
All topics share the same envelope with domain-specific payload in `data`.

```json
{
  "event_id": "d3d6164b-7f8f-4fb9-8e99-3f4a3c081a3b",
  "event_type": "cmdb.ci.updated",
  "event_version": "1.0",
  "occurred_at": "2026-02-15T08:00:00Z",
  "producer": "cmdb-service",
  "trace_id": "c9ad7e21af3f40b987f6f9a70f68efbe",
  "data": {
    "ci_uid": "01JKB2CAVN8F77JQ67HKE7VZN9",
    "version": 7,
    "changed_fields": ["owner", "status"],
    "operator_sub": "u-1024"
  }
}
```

## Consumer Rules
- Deduplicate by `event_id`.
- Ignore stale events when local `version >= event.data.version`.
- Use dead-letter topic for malformed payloads.
