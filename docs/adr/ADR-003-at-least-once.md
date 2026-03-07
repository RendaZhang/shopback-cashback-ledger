# ADR-003: At-least-once Consumer with Inbox Retry and DLQ

## Status

Accepted

## Context

Kafka provides at-least-once delivery. Consumers can observe:

- duplicate messages
- transient processing failures (DB contention, dependency hiccups)
- repeated reprocessing during failures/restarts

We need:

- idempotent cashback credit (no double credit)
- durable retry with backoff
- DLQ path for events exceeding retry budget
- replay mechanism after operational fixes

## Decision

Use an `InboxEvent` table as durable consumption state:

- on consume, upsert `InboxEvent(sourceEventId)` for dedupe
- try immediate processing once; if it fails, keep event `PENDING`
- retry loop scans `PENDING` rows based on `availableAt` with exponential backoff
- once attempts exceed `MAX_ATTEMPTS`, mark `FAILED` and publish summary payload to `order.events.dlq`
- replay CLI can reset `FAILED -> PENDING` for controlled reprocessing

Idempotent side effect guarantee:

- `LedgerEntry` enforces `unique(orderId,type)` so duplicated deliveries cannot double-credit ledger balance

## Rationale

- durable retry state improves recoverability and operational control
- DLQ isolates poison/failing events from normal flow
- replay path shortens incident recovery time
- DB uniqueness makes at-least-once consumption safe for crediting

## Consequences

- requires inbox retention/cleanup policy
- retry loop adds DB load and needs tuning (batch size, polling interval, indexes)
- production topology usually splits outbox publisher and consumer/retry workers for independent scaling

## Alternatives considered

1. Re-consume directly from Kafka for retries:
   - less control over retry schedule, can block partitions and amplify noisy failures.
2. Kafka EOS end-to-end:
   - higher complexity and stricter operational constraints; idempotent consumer design is simpler and sufficient for this system.
