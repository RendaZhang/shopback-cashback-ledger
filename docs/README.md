# Documentation Index

This folder keeps architecture, operations, reliability, and observability notes for the cashback ledger demo.

## Architecture and Design

- [interview-story.md](interview-story.md)
  - 5-10 minute interview narrative
  - design trade-offs and extension ideas

- [diagrams/architecture.mmd](diagrams/architecture.mmd)
- [diagrams/sequence-confirm.mmd](diagrams/sequence-confirm.mmd)
- [diagrams/sequence-failure.mmd](diagrams/sequence-failure.mmd)

## Data and Runtime Contract

- [prisma-runtime-and-migrations.md](prisma-runtime-and-migrations.md)
  - Prisma packaging strategy
  - migration execution contract
  - guardrails to avoid runtime Prisma errors

## Environment and Validation Runbooks

- [local-and-kind-runbook.md](local-and-kind-runbook.md)
  - local bring-up and validation steps
  - kind deployment, canary rollout/rollback, troubleshooting

- [testing-playbook.md](testing-playbook.md)
  - step-by-step test procedures
  - API, idempotency, DB/MQ checks, retry/DLQ/replay

## Observability

- [monitoring-prometheus-grafana.md](monitoring-prometheus-grafana.md)
  - kube-prometheus-stack installation on kind
  - ServiceMonitor setup, dashboard provisioning, alert rules

- [slo.md](slo.md)
  - SLI/SLO proposals for API and worker pipeline
  - error budget and alerting intent

- [loadtest-baseline.md](loadtest-baseline.md)
  - k6 baseline scenario and measured results
  - includes both original baseline and post-protection (rate-limit enabled) profile

## Release and Rollout

- [release-strategy.md](release-strategy.md)
  - rolling update strategy and probes notes
  - replica-based canary strategy and rollback
