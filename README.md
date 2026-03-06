# shopback-cashback-ledger

A simplified cashback/rewards ledger system for backend and system-design interviews.

## What This Project Demonstrates

- Contract-first API design with a consistent response envelope
- Idempotent order creation and confirmation (`Idempotency-Key`)
- Outbox pattern for reliable event publishing
- Inbox + retry + DLQ flow for at-least-once consumers
- Prisma + PostgreSQL data model for order and ledger consistency

## Tech Stack

- API: NestJS
- Worker: Node.js + TypeScript
- Database: PostgreSQL + Prisma
- Cache: Redis
- Event streaming: Redpanda (Kafka API)
- Local infra: Docker Compose
- Kubernetes: kind + kustomize

## Repository Layout

```text
apps/
  api/        # NestJS HTTP API
  worker/     # outbox publisher + consumer + replay CLI
packages/
  db/         # Prisma schema, migrations, generated client (@sb/db)
infra/
  docker/     # Dockerfiles for API and worker
  docker-compose/
  k8s/
docs/
```

## Prerequisites

- Node.js 22+
- pnpm 10+
- Docker
- Optional for k8s: `kind`, `kubectl`
- Optional for monitoring stack: `helm`

## Quickstart (Local)

1. Install dependencies:

```bash
pnpm install
```

2. Start infra:

```bash
make up
```

3. Prepare env files:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
```

4. Generate Prisma client and apply migrations:

```bash
pnpm db:generate
pnpm db:migrate
```

5. Create topics:

```bash
docker exec -i sb-redpanda rpk topic create order.events -p 1 -r 1 || true
docker exec -i sb-redpanda rpk topic create order.events.dlq -p 1 -r 1 || true
docker exec -i sb-redpanda rpk topic list
```

6. Run API and worker in separate terminals:

```bash
export VERSION=v1
pnpm dev:api
pnpm dev:worker
```

7. Open Swagger:

- [http://localhost:3000/docs](http://localhost:3000/docs)

## Local API Smoke Test

Create order:

```bash
curl -s -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: create-001' \
  -d '{"userId":"u_1","merchantId":"m_1","amount":100,"currency":"SGD"}'
```

Confirm order:

```bash
curl -s -X POST http://localhost:3000/orders/<ORDER_ID>/confirm \
  -H 'Idempotency-Key: confirm-001'
```

Read balance:

```bash
curl -s http://localhost:3000/users/u_1/cashback-balance
```

## Local kind + Kubernetes Deployment

1. Create cluster:

```bash
kind create cluster --name sb-ledger --config infra/k8s/kind-config.yaml
kubectl cluster-info
```

2. Build images from repository root:

```bash
make docker-build
```

3. Load images into kind:

```bash
kind load docker-image sb-ledger-api:dev --name sb-ledger
kind load docker-image sb-ledger-worker:dev --name sb-ledger
```

4. Deploy manifests:

```bash
kubectl apply -k infra/k8s/base
kubectl -n sb-ledger get pods
```

5. Create Kafka topics in-cluster:

```bash
kubectl -n sb-ledger exec deploy/redpanda -- rpk topic create order.events -p 1 -r 1 || true
kubectl -n sb-ledger exec deploy/redpanda -- rpk topic create order.events.dlq -p 1 -r 1 || true
kubectl -n sb-ledger exec deploy/redpanda -- rpk topic list
```

6. Open Swagger:

- [http://localhost:30080/docs](http://localhost:30080/docs)

7. Verify health version:

```bash
curl -s http://localhost:30080/health
```

Expected: response envelope includes `data.version` (from `sb-ledger-config.VERSION`).

8. Verify Prometheus metrics endpoint:

```bash
curl -s http://localhost:30080/metrics | grep -E 'http_requests_total|http_request_duration_seconds' | head
```

Expected: plain-text Prometheus output with `http_requests_total` and `http_request_duration_seconds`.

9. Verify worker metrics (port-forward):

```bash
kubectl -n sb-ledger port-forward deploy/worker 19100:9100
```

Open another terminal:

```bash
curl -s http://localhost:19100/metrics | grep -E 'worker_inbox_|worker_outbox_|worker_dlq_|worker_inbox_retries_total' | head
```

Expected: plain-text Prometheus output with worker business metrics, for example:

- `worker_inbox_pending`
- `worker_inbox_failed`
- `worker_outbox_pending`
- `worker_dlq_produced_total`
- `worker_inbox_retries_total`

## Canary Demo (Second Deployment + Same Service)

Canary setup in this repository:

- `api` is stable (`VERSION=v1` from ConfigMap)
- `api-canary` is canary (`VERSION=v2-canary`)
- Both pods share label `app: api`
- Service selector remains `app: api`, so traffic is mixed across stable and canary pods

1. Apply manifests and check deployments:

```bash
kubectl apply -k infra/k8s/base
kubectl -n sb-ledger get deploy
```

2. Optional: set stable/canary ratio for demonstration (4:1 ~= 20%):

```bash
kubectl -n sb-ledger scale deploy/api --replicas=4
kubectl -n sb-ledger scale deploy/api-canary --replicas=1
kubectl -n sb-ledger get deploy api api-canary
```

3. Verify mixed traffic by calling health 10 times:

```bash
for i in $(seq 1 10); do curl -s http://localhost:30080/health; echo; done
```

Expected: most responses show `v1`, and some show `v2-canary`.

4. Roll back canary quickly:

```bash
kubectl -n sb-ledger scale deploy/api-canary --replicas=0
```

5. Verify all traffic is back to stable:

```bash
for i in $(seq 1 10); do curl -s http://localhost:30080/health; echo; done
```

## Monitoring Stack (Prometheus + Grafana)

Install and wire monitoring for API/worker metrics, dashboards, and alerts:

- follow [docs/monitoring-prometheus-grafana.md](docs/monitoring-prometheus-grafana.md)
- includes kube-prometheus-stack install, ServiceMonitors, Prometheus target verification, Grafana dashboard provisioning, and PrometheusRule alerts

## Prisma and Migration Runtime Contract

- Prisma schema and generated client live in `packages/db` and are consumed via `@sb/db`.
- Both Docker images run `pnpm -C packages/db run generate` during build, so Prisma client is included in the image at build time.
- API startup can run schema migrations via `prisma migrate deploy` when `RUN_DB_MIGRATION=true`.
- Kubernetes currently enables this in `infra/k8s/base/api.yaml`.
- Kubernetes ConfigMap includes `VERSION` for API/worker runtime version tagging and canary comparisons.
- There is no dedicated `db-migrate-job` and no Prisma initContainer in API/worker deployments.

## Useful Commands

Docker Compose:

```bash
make ps
make logs
make down
make reset
```

Kubernetes:

```bash
kubectl -n sb-ledger get pods
kubectl -n sb-ledger logs deploy/api --tail=200
kubectl -n sb-ledger logs deploy/worker --tail=200
```

## Quality Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Further Documentation

- [docs/README.md](docs/README.md)
- [docs/interview-story.md](docs/interview-story.md)
- [docs/prisma-runtime-and-migrations.md](docs/prisma-runtime-and-migrations.md)
- [docs/local-and-kind-runbook.md](docs/local-and-kind-runbook.md)
- [docs/testing-playbook.md](docs/testing-playbook.md)
