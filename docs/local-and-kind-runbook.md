# Local and kind Runbook

## Local Development Runbook

1. Install dependencies:

```bash
pnpm install
```

2. Start infra services:

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
```

6. Run processes:

```bash
export VERSION=v1
pnpm dev:api
pnpm dev:worker
```

7. Validate:

- Swagger: [http://localhost:3000/docs](http://localhost:3000/docs)
- Health: `curl -s http://localhost:3000/health`
- Expected: response envelope includes `data.version` (for example `v1`)
- Metrics: `curl -s http://localhost:3000/metrics | grep -E 'http_requests_total|http_request_duration_seconds' | head`
- Expected: Prometheus text output with HTTP RED metrics

## kind Runbook

1. Create cluster:

```bash
kind create cluster --name sb-ledger --config infra/k8s/kind-config.yaml
```

2. Build and load images:

```bash
make docker-build
kind load docker-image sb-ledger-api:dev --name sb-ledger
kind load docker-image sb-ledger-worker:dev --name sb-ledger
```

3. Apply manifests:

```bash
kubectl apply -k infra/k8s/base
kubectl -n sb-ledger get pods
```

4. Create topics in cluster:

```bash
kubectl -n sb-ledger exec deploy/redpanda -- rpk topic create order.events -p 1 -r 1 || true
kubectl -n sb-ledger exec deploy/redpanda -- rpk topic create order.events.dlq -p 1 -r 1 || true
```

5. Validate API endpoint:

- Swagger: [http://localhost:30080/docs](http://localhost:30080/docs)
- Health: `curl -s http://localhost:30080/health`
- Expected: response envelope includes `data.version`, sourced from `sb-ledger-config.VERSION`
- Metrics: `curl -s http://localhost:30080/metrics | grep -E 'http_requests_total|http_request_duration_seconds' | head`
- Expected: Prometheus text output with HTTP RED metrics

## Canary Runbook (Same Service Selector)

### Goal

- keep `api` as stable
- run `api-canary` as canary
- route traffic through the same `api` Service (`selector: app=api`)
- control canary ratio by replica count

### Steps

1. Apply resources (including `api-canary`):

```bash
kubectl apply -k infra/k8s/base
kubectl -n sb-ledger get deploy
```

2. Set ratio example (stable 4, canary 1):

```bash
kubectl -n sb-ledger scale deploy/api --replicas=4
kubectl -n sb-ledger scale deploy/api-canary --replicas=1
kubectl -n sb-ledger get deploy api api-canary
```

3. Verify mixed responses:

```bash
for i in $(seq 1 10); do curl -s http://localhost:30080/health; echo; done
```

Expected:

- most responses return `data.version=v1`
- occasional responses return `data.version=v2-canary`

4. Rollback demo (disable canary):

```bash
kubectl -n sb-ledger scale deploy/api-canary --replicas=0
```

5. Verify stable-only traffic:

```bash
for i in $(seq 1 10); do curl -s http://localhost:30080/health; echo; done
```

## Troubleshooting

### API CrashLoopBackOff with Prisma errors

Check API logs:

```bash
kubectl -n sb-ledger logs deploy/api --tail=200
```

Expected behavior:

- API image already includes Prisma client from build stage.
- API startup runs `prisma migrate deploy` when `RUN_DB_MIGRATION=true`.

### Worker CrashLoopBackOff with Prisma errors

Check worker logs:

```bash
kubectl -n sb-ledger logs deploy/worker --tail=200
```

Expected behavior:

- Worker image includes Prisma client from build stage.
- Worker should not depend on API runtime migration logic.

### Verify no migration Job exists

```bash
kubectl -n sb-ledger get jobs
```

Expected behavior:

- No `db-migrate-job`.

## Cleanup

Local:

```bash
make down
```

Full reset:

```bash
make reset
```

docker:

```bash
docker rmi <image id>
docker system prune
```

kind:

```bash
kind delete cluster --name sb-ledger
```

## Daily Commands

```bash
# Rebuild the image and load it into kind:
make docker-build
kind load docker-image sb-ledger-api:dev --name sb-ledger
# Perform a rolling update of the API (since the image tag hasn't changed, we need to force a restart):
kubectl -n sb-ledger rollout restart deploy/api
kubectl -n sb-ledger rollout status deploy/api
# Verify:
curl -s http://localhost:30080/health
```
