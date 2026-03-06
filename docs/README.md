# Documentation Index

This folder keeps architecture and operations notes for the cashback ledger demo.

## Core Documents

- [interview-story.md](interview-story.md)
  - 5-10 minute narrative for interviews
  - trade-offs, patterns, and extension points

- [prisma-runtime-and-migrations.md](prisma-runtime-and-migrations.md)
  - Prisma packaging strategy
  - migration execution contract
  - guardrails to avoid runtime Prisma errors

- [local-and-kind-runbook.md](local-and-kind-runbook.md)
  - local bring-up and validation steps
  - kind deployment, canary rollout/rollback, and troubleshooting

- [testing-playbook.md](testing-playbook.md)
  - step-by-step test procedures
  - API, idempotency, DB/MQ checks, retry/DLQ/replay

- [monitoring-prometheus-grafana.md](monitoring-prometheus-grafana.md)
  - kube-prometheus-stack installation on kind
  - ServiceMonitor setup, dashboard provisioning, and alerts

## Diagrams

- [diagrams/architecture.mmd](diagrams/architecture.mmd)
- [diagrams/sequence-confirm.mmd](diagrams/sequence-confirm.mmd)
- [diagrams/sequence-failure.mmd](diagrams/sequence-failure.mmd)
