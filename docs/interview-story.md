# Interview Story: Cashback Ledger (Outbox + Inbox + Retry)

Use this as a practical talk track in interviews. It is optimized for 5-10 minute system-design conversations plus follow-up Q&A.

## 1) How to Use This Document

- If the interviewer asks for a quick overview, use the **30-second pitch**.
- If the interviewer asks for architecture, use the **2-minute flow**.
- If the interviewer asks for reliability and trade-offs, use the **5-minute deep dive**.
- If the interviewer challenges details, use **Q&A cheat sheet**.

## 2) 30-Second Pitch

This system confirms an order synchronously and credits cashback asynchronously.

The hard parts are reliability and idempotency:

- duplicate client requests
- DB/Kafka dual-write inconsistency
- at-least-once consumer duplicates
- operational recovery after failures

I solve those with:

- API idempotency keys
- API global rate limiting (user-first key: `X-User-Id`, fallback IP; `600 req / 60s` default in demo) to protect confirm path
- transactional outbox for reliable publish
- inbox + retry + DLQ + replay for durable consumption
- idempotent ledger writes using DB uniqueness constraints
- Redis cashback-rule cache (API invalidation + worker read-through) to reduce DB pressure

## 3) 2-Minute Architecture Flow

1. Client calls `POST /orders` and `POST /orders/:id/confirm`.
2. API writes to PostgreSQL via Prisma (`@sb/db`).
3. Confirm runs in one DB transaction:
   - order status `CREATED -> CONFIRMED`
   - insert `OutboxEvent`
4. Worker publish loop polls `OutboxEvent(PENDING)` and pushes `OrderConfirmed` to Kafka/Redpanda.
5. Worker consumer reads event and upserts `InboxEvent` by `sourceEventId` for dedupe.
6. Business handler computes cashback and inserts `LedgerEntry(CREDIT)`.
   - worker reads cashback rule via Redis cache; cache miss falls back to DB
7. Retry loop handles transient failures with exponential backoff.
8. After max attempts, mark `InboxEvent=FAILED` and push to DLQ.
9. Replay CLI can move failed events back to `PENDING` after fix.

## 4) 5-Minute Deep Dive (Suggested Script)

### 4.1 Problem and Constraints

The product requirement is simple: once order is confirmed, user eventually gets cashback.

The system requirement is not simple:

- confirm endpoint must be responsive
- crediting must be reliable under retries and crashes
- operator must be able to inspect and recover failed events

### 4.2 Data Integrity Invariants

I explicitly protect these invariants:

- no duplicate order creation for same idempotency key and same request body
- no silent message loss between DB commit and Kafka publish
- no duplicate ledger credit for one confirmed order

Implementation points:

- `IdempotencyKey` table stores `{key, scope, requestHash, responseBody}`
- `OutboxEvent` is written in same transaction as order confirmation
- `LedgerEntry` has unique `(orderId, type)` to enforce idempotent credit

### 4.3 Why Outbox

Without outbox, DB commit may succeed but Kafka publish fails.

That causes permanent inconsistency: order is confirmed but no downstream credit.

With outbox:

- confirm transaction commits both order update and outbox row
- worker keeps retrying outbox publish until success or failure policy
- state transition is explicit and auditable

### 4.4 Why Inbox + Retry + DLQ

Kafka is at-least-once, so duplicates happen.

Inbox gives two benefits:

- dedupe key by source event id
- durable work queue with status/attempts/lastError

Retry loop gives operability:

- bounded retries with backoff
- DLQ for manual triage
- replay command for controlled recovery

### 4.5 Runtime and Deployment Contract

For Prisma/runtime stability:

- Prisma client is generated during Docker build for API and worker
- API can run `prisma migrate deploy` on startup (`RUN_DB_MIGRATION=true`)
- no extra Prisma initContainer or migration job required for this demo

### 4.6 Protection and Performance Guardrails

- global throttling is configured per user in demo (`THROTTLE_LIMIT=600`, `THROTTLE_TTL=60s`)
- this protects DB + Kafka from burst retries on `confirm`
- trade-off: if a single user key is hammered, 429 rises quickly; mixed-user traffic is much healthier
- cashback-rule lookup uses Redis cache with TTL and short lock to reduce DB hits and avoid cache stampede

## 5) Metrics and SLO Talk Track

### API RED metrics

- request rate: `http_requests_total`
- error rate: `status=5xx` fraction
- latency: `http_request_duration_seconds` (p95 via histogram quantile)
- throttling visibility: `http_requests_total{status="429"}` (verify on a single pod to avoid Service load-balancing ambiguity)

### Worker health metrics

- backlog: `worker_inbox_pending`, `worker_outbox_pending`
- failure: `worker_inbox_failed`
- operational pressure: `worker_inbox_retries_total`, `worker_dlq_produced_total`

### SLO framing

- API availability objective (non-5xx) and p95 latency
- async pipeline objective: `inbox_failed` should stay near zero in normal conditions
- alert examples:
  - API 5xx ratio > 1% for 5m
  - `worker_inbox_failed > 0` for 1m

## 6) Canary and Rollback Talk Track

This repo demonstrates a simple canary without service mesh:

- stable deployment: `api` (`VERSION=v1`)
- canary deployment: `api-canary` (`VERSION=v2-canary`)
- both selected by same Service (`app=api`)
- traffic ratio controlled by replica ratio

Rollback is immediate:

- scale canary to zero

## 7) Demo Script (1-2 Minutes)

1. Call `/health` repeatedly and show version changes during canary.
2. Create and confirm an order.
3. Show `/metrics` for API and worker.
4. Show Grafana dashboard panels.
5. Show alert rules in Prometheus.

This sequence proves both business correctness and operational maturity.

## 8) Common Interviewer Questions and Good Answers

### Q1: Why not write directly to Kafka in confirm API?

Because it reintroduces dual-write risk. Outbox keeps DB state and publish intent atomic.

### Q2: How do you prevent duplicate cashback credit?

At consumer side and DB side:

- inbox dedupe by source event id
- ledger uniqueness `(orderId, type)`

### Q3: What if worker crashes after consuming but before crediting?

Inbox row remains pending/failed, then retry loop reprocesses. Processing is idempotent.

### Q4: Why not exactly-once semantics end-to-end?

Exactly-once is costly and complex across boundaries. At-least-once + idempotency gives practical reliability.

### Q5: How would you scale this design?

- split publisher and consumer into separate deployments
- partition topics by order/user key
- scale consumers by partition count
- add reconciliation job for audit correctness

### Q6: How do you investigate incidents quickly?

Use metrics + logs + DB state together:

- spike in retries or failed inbox
- inspect corresponding inbox/outbox rows and errors
- replay failed subset after bug/config fix

## 9) Trade-offs and Honest Limitations

- This demo prefers clarity over full production hardness.
- Migration on API startup is acceptable for local/kind demo, but production may require dedicated pre-deploy migration control.
- Canary by replica ratio is simple; production may require weighted ingress/mesh routing.

## 10) Strong Closing Statement

I designed this system to be reliable under retries, crashes, and duplicates, while keeping it operable for humans.

The key idea is: **accept at-least-once reality, enforce idempotency in storage, and make failure states explicit and recoverable**.
