# Monitoring and SLO

## Golden Signals
- API latency (p95/p99)
- API error rate (4xx/5xx)
- Kafka publish latency and failed publish count
- Consumer lag
- MySQL query latency and slow query ratio

## Suggested SLO
- Read API availability: 99.9%
- Write API availability: 99.5%
- Event publish success within 60s: 99.9%

## Alerts
- `outbox pending > threshold for 5m`
- `kafka consumer lag high for 10m`
- `mysql error rate > 2% for 5m`
- `p95 latency > 500ms for 10m`
