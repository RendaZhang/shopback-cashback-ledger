# ADR-002: Use Outbox Pattern for Publishing Domain Events

## Status

Accepted

## Context

On order confirmation we must emit `OrderConfirmed` for async cashback credit.

A naive approach publishes to Kafka inside the request handler and risks:

- DB commit succeeds but publish fails => downstream misses the event
- publish succeeds but DB commit fails => phantom event

We need reliable event emission with Postgres as source of truth.

## Decision

Adopt the Outbox pattern:

- in the same DB transaction that changes `Order` to `CONFIRMED`, insert `OutboxEvent(type=OrderConfirmed, payload=...)`
- publisher loop reads `OutboxEvent` rows in `PENDING` status and produces to Kafka
- after successful publish, mark row as `SENT` and set `sentAt`
- on failure, retry with backoff and attempt limits

## Rationale

- keeps state transition and event intent atomic
- decouples publish retries from API latency
- makes event emission observable and auditable in DB

## Consequences

- adds one more operational loop (outbox publisher)
- requires outbox retention/cleanup policy
- introduces small async publish delay (acceptable for cashback flow)
- in this demo, publisher and consumer loops run in the same worker process; production commonly splits them into separate deployments

## Alternatives considered

1. Direct dual-write (DB + Kafka in handler):
   - simple path, but non-atomic and failure-prone.
2. Distributed transaction across DB and broker:
   - high complexity and operational burden for limited benefit in this context.
