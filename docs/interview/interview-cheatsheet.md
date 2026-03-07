# Interview Cheat Sheet — shopback-cashback-ledger (10–30 min)

## 30s summary

Built a ShopBack-style cashback ledger demo with contract-first API + Idempotency-Key, Outbox->Kafka publishing, Inbox-based retries + DLQ + replay, and idempotent ledger crediting via DB uniqueness. Deployed on kind K8s with rolling/canary, Prometheus/Grafana dashboards + alerts + SLO. Validated with k6 (~385 req/s, p95 ~21ms, 0% errors) and fault drill (worker down -> backlog -> recovery).

## What problem does it solve? (1 min)

Cashback flows must be correct under:
- client/gateway retries
- DB vs message publish inconsistency
- Kafka at-least-once delivery (duplicates)
- operational recovery: retry, DLQ, replay, fault drills

## Architecture walkthrough (2–3 min)

API:
- POST /orders (idempotent optional)
- POST /orders/{id}/confirm:
  - TX: Order -> CONFIRMED
  - TX: write OutboxEvent(OrderConfirmed)
Worker:
- Outbox publisher: poll PENDING -> publish -> mark SENT
- Kafka consumer: upsert InboxEvent(sourceEventId) -> process credit -> mark PROCESSED
- Retry loop: PENDING + availableAt + attempts -> backoff -> FAILED -> DLQ
Ledger:
- unique(orderId,type) ensures idempotent crediting

## Key decisions (pick 3 to dive deeper)

### Idempotency-Key

- store {key, scope, requestHash, responseBody}
- same key+hash => replay
- same key different hash => 409
- defense-in-depth: DB uniqueness (ledger)

### Outbox

- avoids dual-write inconsistency
- atomic: order state + outbox record in one TX
- publisher retries independently

### At-least-once consumer

- duplicates handled by InboxEvent dedupe + ledger unique constraint
- durable retries with backoff
- DLQ for manual intervention
- replay tool to re-run after fixes

## Observability & ops (2 min)

Metrics:
- API RED metrics (/metrics)
- worker backlog/retry/DLQ
Dashboard:
- QPS, p95 latency, 5xx rate
- inbox pending/failed, outbox pending, dlq rate
Alerts:
- 5xx rate > 1% (5m)
- inbox_failed > 0
SLO:
- confirm p95 < 300ms; success rate 99.9% (30d)

## Proof points (30s)

- k6: ~385 req/s, p95 ~21ms, 0% errors
- fault drill:
  - worker replicas=0 => backlog accumulates (outbox/inbox depending on topology)
  - restore => backlog drains to 0, no double credit (idempotent ledger)

## Common follow-ups & short answers

Q: Why not exactly-once?
A: EOS is costly/complex; at-least-once + idempotency is simpler and sufficient for ledger crediting.

Q: Where does backlog accumulate when worker is down?
A: Depends on deployment topology. With combined publisher+consumer, backlog first accumulates in Outbox. With separate publisher/consumer, outbox can drain while inbox accumulates.

Q: How do you prevent double credit?
A: Consumer is idempotent: InboxEvent dedupe by sourceEventId + LedgerEntry unique(orderId,type).

Q: How do you recover from DLQ?
A: Investigate root cause, fix data/config, then replay FAILED inbox events via CLI (FAILED->PENDING) to reprocess.

Q: How to scale?
A: Split publisher vs consumer; scale consumer with HPA; partition Kafka by userId/merchantId; batch writes; partition ledger tables and add reconciliation.

