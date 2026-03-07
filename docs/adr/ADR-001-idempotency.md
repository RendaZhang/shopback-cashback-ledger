# ADR-001: Idempotency Strategy for Order APIs

## Status

Accepted

## Context

Order creation and confirmation endpoints are subject to:

- client retries (mobile networks, timeouts)
- gateway retries
- at-least-once semantics from upstream integrations

We must ensure repeated requests do not create duplicate orders or duplicate side effects.

## Decision

Implement `Idempotency-Key` for write endpoints:

- client sends `Idempotency-Key` header
- server stores `{ key, scope, requestHash, responseBody, expiresAt }` in `IdempotencyKey`
- on replay:
  - same key + same request hash => return cached response
  - same key + different request hash => return `409 Conflict`
- also rely on DB uniqueness (for example `unique(orderId,type)` in ledger) as defense-in-depth

Scopes:

- `POST:/orders`
- `POST:/orders/:id/confirm`

## Rationale

- returning the same response supports safe retries without extra client coordination
- request hash prevents accidental key reuse with a different payload
- cached response avoids re-running business logic during retry storms
- DB unique constraints add a second safety net for side effects

## Consequences

- requires persistent idempotency storage and TTL/cleanup policy
- cached response shape should remain stable across API evolution
- response-body storage adds overhead (acceptable for this demo)

## Alternatives considered

1. Rely only on DB unique constraints:
   - simpler, but does not guarantee same response replay and still executes business logic repeatedly.
2. Exactly-once end-to-end processing:
   - much higher complexity; unnecessary for this scope when at-least-once + idempotency is sufficient.
