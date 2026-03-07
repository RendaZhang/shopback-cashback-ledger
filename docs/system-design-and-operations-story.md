# System Design and Operations Story: Cashback Ledger

Use this as a practical talk track for interviews and architecture reviews.

**Owner:** Platform Engineering (Demo)  
**Last Updated:** 2026-03-07  
**Applies To:** Interview discussions, architecture reviews, and operational design walkthroughs

It combines:

- system design narrative
- reliability mechanisms
- Prisma runtime and migration contract
- release/canary strategy
- SLO and alert framing

## 1. 30-Second Pitch

This system confirms orders synchronously and credits cashback asynchronously.

Key reliability risks are duplicate requests, DB/Kafka dual-write gaps, and at-least-once consumer duplicates. The design handles them with:

- API idempotency keys
- user-based API throttling (`X-User-Id`, fallback IP)
- transactional outbox
- inbox + retry + DLQ + replay
- idempotent ledger constraints
- Redis cashback-rule caching

Primary failure modes this design addresses:

- client retries and duplicate submissions
- inconsistency between DB commit and event publish
- at-least-once delivery duplicates
- day-2 recovery requirements (retry, DLQ, replay, fault drill)

## 2. 2-Minute Architecture Flow

1. Client calls `POST /orders` and `POST /orders/:id/confirm`.
2. API writes order state via Prisma (`@sb/db`) into PostgreSQL.
3. Confirm runs in one transaction:
   - `Order: CREATED -> CONFIRMED`
   - insert `OutboxEvent`
4. Worker publish loop sends pending outbox events to Redpanda/Kafka.
5. Consumer upserts `InboxEvent` by `sourceEventId` for dedupe.
6. Handler computes cashback and inserts `LedgerEntry(CREDIT)`.
7. Retry loop reprocesses transient failures with backoff.
8. Exceeded attempts become `InboxEvent=FAILED` and are sent to DLQ.
9. Replay CLI can reset failed events for controlled reprocessing.

### Contract-First API Snapshot

- OpenAPI docs at `/docs`
- `POST /orders` for order creation (idempotency supported)
- `POST /orders/:id/confirm` for transactional confirm + outbox write
- `GET /users/:id/cashback-balance` for ledger-derived balance
- `POST /merchants/:id/cashback-rule` for cashback rule upsert
- consistent response envelope: `{ requestId, data, error }`

## 3. Data Integrity Invariants

- No duplicate create for same idempotency key + same body.
- No silent event loss between DB commit and Kafka publish.
- No duplicate cashback credit for one order.

Implementation anchors:

- `IdempotencyKey` stores key/scope/hash/response.
- `OutboxEvent` is in the same transaction as confirm.
- `LedgerEntry` uniqueness enforces idempotent credit.

## 4. Why Outbox + Inbox + Retry + DLQ

Outbox solves DB/Kafka dual-write inconsistency by persisting publish intent in DB.

Inbox + retry + DLQ solve operability:

- dedupe with stable source event IDs
- durable status (`PENDING/PROCESSED/FAILED`)
- bounded retries with backoff
- human-operated replay path

This is a practical at-least-once design with explicit failure states.

## 5. API Protection and Performance Guardrails

- Global throttling is user-first (`X-User-Id`) with fallback to IP.
- Demo defaults are configurable by env:
  - `THROTTLE_LIMIT` (default `600`)
  - `THROTTLE_TTL` (default `60` seconds)
- Redis cashback-rule cache reduces DB pressure:
  - API invalidates cache on rule update
  - worker uses read-through cache
  - short lock mitigates cache stampede

## 6. Prisma Runtime and Migration Contract

Runtime contract:

- `packages/db` is the only Prisma boundary package.
- Prisma schema is at `packages/db/prisma/schema.prisma`.
- Generated client is consumed via `@sb/db`.

Build contract:

- API and worker images run `pnpm -C packages/db run generate` at build time.
- This avoids missing Prisma client at runtime.

Migration contract:

- API startup supports `RUN_DB_MIGRATION=true`.
- When enabled, API executes `prisma migrate deploy` before serving traffic.
- Worker never runs migrations.
- No dedicated migration job is required in this demo setup.

Operational implications:

- migration command is idempotent for already-applied migrations
- failed migration causes API fail-fast (check API logs)
- production multi-replica setups can move migrations to a controlled pre-deploy phase

## 7. Release, Canary, and Rollback Strategy

Rolling update notes:

- readiness probe gates traffic
- liveness probe restarts stuck processes
- use rollout status/history for control and diagnosis

Canary notes:

- stable: `api` (`VERSION=v1`)
- canary: `api-canary` (`VERSION=v2-canary`)
- one Service selects both by `app=api`
- traffic share is controlled by replica ratio (for example `1:4` ~ 20%)

Rollback:

- immediate rollback by scaling canary to zero
- or `kubectl rollout undo deploy/api -n sb-ledger` for stable deployment rollback

## 8. Observability and SLO Framing

### API RED Metrics

- request rate: `http_requests_total`
- error rate: 5xx fraction from `http_requests_total{status=~"5.."}`
- latency: `http_request_duration_seconds` histogram (p95 by quantile)
- throttling visibility: `http_requests_total{status="429"}`

### Worker Metrics

- backlog: `worker_inbox_pending`, `worker_outbox_pending`
- failures: `worker_inbox_failed`
- pressure: `worker_inbox_retries_total`, `worker_dlq_produced_total`
- cache effectiveness: `worker_cashback_rule_cache_hits_total`, `worker_cashback_rule_cache_misses_total`
- handler latency: `worker_order_confirmed_handler_duration_seconds` (track p95 by `outcome`)

### SLO Proposal

Confirm API (30-day window):

- success rate (non-5xx): `99.9%`
- p95 latency for `POST /orders/:id/confirm`: `< 300ms`

Error budget intuition:

- `99.9%` allows ~`43.2` minutes of error time in 30 days (proxy framing)

Worker pipeline operational target:

- `worker_inbox_failed` should stay `0` in normal operation
- outbox/inbox backlog should not grow unbounded in steady state

Alert examples:

- API 5xx ratio > 1% for 5 minutes
- `worker_inbox_failed > 0` for 1 minute

## 9. 1-2 Minute Demo Script

1. Hit `/health` repeatedly and show `version` switching under canary.
2. Create and confirm an order.
3. Check API and worker `/metrics` endpoints.
4. Open Grafana dashboard and point to QPS/p95/error panels.
5. Show alert rules loaded in Prometheus.

## 10. Common Interview Questions

### Q1: Why not publish Kafka directly in confirm API?

Direct publish reintroduces dual-write risk. Outbox keeps order state and publish intent atomic in DB.

### Q2: How do you prevent duplicate cashback credit?

Inbox dedupe by source event ID plus DB uniqueness on ledger credit.

### Q3: Why not exactly-once across the whole pipeline?

Exactly-once across boundaries is expensive and complex. At-least-once plus strong idempotency is pragmatic and reliable.

### Q4: How do you investigate incidents?

Correlate metrics, logs, and DB states (`OutboxEvent`, `InboxEvent`, `LedgerEntry`), then replay controlled failed events after fixes.

## 11. Honest Trade-offs

- This repo optimizes clarity and interview readability.
- Startup migrations are acceptable for kind/local demo, but often moved to pre-deploy control in production.
- Replica-ratio canary is simple; production may use weighted ingress/service mesh.

## 12. Strong Closing

The system is designed for real failure modes: retries, crashes, duplicates, and partial outages.

Core principle: accept at-least-once delivery, enforce idempotency in storage, and make failure states observable and recoverable.

## 13. Fault Drill: Worker Down -> Backlog -> Recovery

### Goal

Demonstrate eventual consistency and operability:

- worker down => backlog increases
- worker back => backlog drains to near zero
- no data loss; ledger idempotency prevents double credit

### Steps (kind)

1. Generate create+confirm traffic continuously.
2. Scale worker to zero:
   - `kubectl -n sb-ledger scale deploy/worker --replicas=0`
3. Keep generating traffic while worker is down.
4. Scale worker back:
   - `kubectl -n sb-ledger scale deploy/worker --replicas=1`
   - `kubectl -n sb-ledger rollout status deploy/worker`

### Evidence

- Grafana:
  - in current topology (single worker process doing outbox publish + consume): `worker_outbox_pending` rises during downtime, then drains after recovery
  - `worker_inbox_failed` should stay at `0`
- SQL:
  - `select status, count(*) from "OutboxEvent" group by status order by status;`
  - `select status, count(*) from "InboxEvent" group by status order by status;`

### Key Design Points

- Outbox ensures confirmed orders persist publish intent durably.
- Inbox + retry provide durable processing with backoff and replayability.
- Ledger uniqueness (`orderId`, `type`) keeps credit idempotent under at-least-once delivery.
- If publisher/consumer are split into separate deployments, downtime signal focus can shift from outbox backlog to inbox backlog/lag.
