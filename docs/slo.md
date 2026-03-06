# SLO (Service Level Objectives)

## Service: Confirm Order API

### SLI

- Availability / correctness proxy: HTTP success rate (non-5xx)
- Latency: p95 of confirm endpoint duration

### Proposed SLO

- **Success rate:** 99.9% of requests are non-5xx over 30 days
- **Latency:** p95 < 300ms for `POST /orders/:id/confirm` over 30 days

### Error Budget

- 99.9% availability => 0.1% error budget
- Over 30 days, error budget allows:
  - 30d * 24h * 60m = 43,200 minutes
  - 0.1% of 43,200 minutes = **43.2 minutes** of error time (rough proxy)

### Alerting (examples)

- High 5xx rate > 1% for 5m: early warning for burning budget quickly
- Inbox failed > 0: critical, requires manual investigation / replay

## Worker: Async Credit Pipeline

### SLI

- Inbox backlog: `worker_inbox_pending`
- Failed events: `worker_inbox_failed`
- DLQ rate: `worker_dlq_produced_total`

### Operational Target (not strict SLO)

- Inbox pending should not continuously increase (steady-state)
- Inbox failed should be 0 in normal operation
