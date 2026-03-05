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

## Prisma and Migration Runtime Contract

- Prisma schema and generated client live in `packages/db` and are consumed via `@sb/db`.
- Both Docker images run `pnpm -C packages/db run generate` during build, so Prisma client is included in the image at build time.
- API startup can run schema migrations via `prisma migrate deploy` when `RUN_DB_MIGRATION=true`.
- Kubernetes currently enables this in `infra/k8s/base/api.yaml`.
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
