# Interview Story (5–10 min): Cashback Ledger with Outbox + Inbox Retry

## 0) What problem am I solving?
ShopBack-like systems confirm orders and later credit cashback. Key risks:
- duplicated requests (client retries)
- message delivery failures (DB commit vs message publish)
- consumer at-least-once delivery (duplicates)
- operational needs: retry, DLQ, replay

## 1) High-level architecture (show architecture diagram)
- API writes to Postgres via Prisma
- Confirm order is transactional:
  - update Order status
  - insert OutboxEvent in same TX (Outbox pattern)
- Worker publishes outbox to Kafka (Redpanda)
- Worker consumer processes OrderConfirmed:
  - upsert InboxEvent (dedupe + durable retry queue)
  - compute cashback rule and insert LedgerEntry
  - ledger is idempotent via unique(orderId, type)

## 2) Why contract-first + idempotency?
- REST endpoints are standardized early (Swagger, response envelope, requestId)
- Idempotency-Key:
  - store {key, scope, requestHash, responseBody}
  - same key + same hash => replay same result
  - same key + different hash => 409 conflict

## 3) Why Outbox (avoid dual-write inconsistency)
Without outbox:
- DB commits but Kafka publish fails -> state exists but downstream never credits
With outbox:
- order confirmation and outbox insertion are in one DB transaction
- publisher can retry safely until SENT

## 4) Why Inbox + retries + DLQ (at-least-once + operability)
Kafka is at-least-once:
- duplicates can happen, so consumer must be idempotent
InboxEvent provides:
- durable record of consumed events
- retries with exponential backoff
- DLQ after max attempts for manual investigation
Replay CLI:
- move FAILED back to PENDING to re-run after fix

## 5) Trade-offs / next steps
- Split publisher and consumer into separate deployments
- Add tracing (OTel) and metrics (RED + lag/backlog)
- Reconciliation job: compare Orders vs Ledger for audit
- Partitioning/sharding strategy for large scale ledger

