# Documentation Index

This folder keeps the canonical deployment, testing, operations, and architecture docs for the cashback ledger demo.

**Owner:** Platform Engineering (Demo)  
**Last Updated:** 2026-03-07  
**Applies To:** Documentation under `docs/` and root `README.md`

Project high-level overview (why, architecture snapshot, API/data model, reliability patterns) is in root [README.md](../README.md). This `docs/` folder focuses on deployment, testing, operations, and interview story depth.

## Recommended Reading Order

1. [deployment-guide-k8s-first.md](deployment-guide-k8s-first.md)
   - includes one-command bootstrap (`make k8s-up`), smoke/teardown helpers, and manual path
2. [testing-playbook.md](testing-playbook.md)
   - run all validation and test scenarios in one place
3. [k8s-operations-handbook.md](k8s-operations-handbook.md)
   - day-2 operations and useful command lookup
4. [system-design-and-operations-story.md](system-design-and-operations-story.md)
   - interview/system-design narrative plus runtime, release, and SLO framing

## Quick Entry by Role

- Developer (implement + validate features):
  1. [deployment-guide-k8s-first.md](deployment-guide-k8s-first.md)
  2. [testing-playbook.md](testing-playbook.md)
- Operator (deploy + troubleshoot + recover):
  1. [deployment-guide-k8s-first.md](deployment-guide-k8s-first.md)
  2. [k8s-operations-handbook.md](k8s-operations-handbook.md)
- Interview Preparation (story + trade-offs + metrics):
  1. [system-design-and-operations-story.md](system-design-and-operations-story.md)
  2. [loadtest-baseline.md](loadtest-baseline.md)

## Core Runbooks

- [deployment-guide-k8s-first.md](deployment-guide-k8s-first.md)
- [testing-playbook.md](testing-playbook.md)
- [k8s-operations-handbook.md](k8s-operations-handbook.md)

## Architecture and Design

- [system-design-and-operations-story.md](system-design-and-operations-story.md)
- [diagrams/architecture.mmd](diagrams/architecture.mmd)
- [diagrams/sequence-confirm.mmd](diagrams/sequence-confirm.mmd)
- [diagrams/sequence-failure.mmd](diagrams/sequence-failure.mmd)

## Performance and Baseline Data

- [loadtest-baseline.md](loadtest-baseline.md)
  - structured k6 run registry for longitudinal comparison

## Historical and Decision Notes

- [adr/README.md](adr/README.md)
- [adr/ADR-001-idempotency.md](adr/ADR-001-idempotency.md)
- [adr/ADR-002-outbox.md](adr/ADR-002-outbox.md)
- [adr/ADR-003-at-least-once.md](adr/ADR-003-at-least-once.md)

## Documentation Quality Gate

- run `make docs-check` from repo root to validate:
  - broken local links in markdown
  - heading hierarchy jumps and H1 presence
- CI bootstrap validation workflow:
  - `.github/workflows/k8s-bootstrap.yml` (scheduled + manual trigger)
