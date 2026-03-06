# Testing Playbook

This guide provides step-by-step test flows for local Docker Compose and kind Kubernetes environments.

## 1. Scope

This playbook covers:

- service startup validation
- idempotent order APIs
- cashback processing end-to-end
- event processing and outbox/inbox checks
- retry, DLQ, and replay workflows
- DB and Kafka verification (interactive and one-line)
- basic automated checks

## 2. Prerequisites

- Node.js 22+
- pnpm 10+
- Docker
- Optional: `jq` for easier JSON parsing
- Optional for k8s: `kind`, `kubectl`

## 3. Local Bring-up

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

6. Start API and worker in separate terminals:

```bash
export VERSION=v1
pnpm dev:api
pnpm dev:worker
```

## 4. API Health and Contract Check

1. Health check:

```bash
curl -s http://localhost:3000/health
```

Expected: response envelope with `data.ok=true`.
Expected: response envelope also includes `data.version` (for example `v1` locally, `v1` from ConfigMap on k8s).

2. Swagger:

- [http://localhost:3000/docs](http://localhost:3000/docs)

## 5. Idempotent Order Creation API Examples

1. Create order (with idempotency key):

```bash
curl -s -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: create-001' \
  -d '{"userId":"u_1","merchantId":"m_1","amount":100.5,"currency":"SGD"}'
```

2. Repeat same request (should return same order ID):

```bash
curl -s -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: create-001' \
  -d '{"userId":"u_1","merchantId":"m_1","amount":100.5,"currency":"SGD"}'
```

3. Reuse same key with different body (should return 409 Conflict):

```bash
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: create-001' \
  -d '{"userId":"u_1","merchantId":"m_1","amount":999,"currency":"SGD"}'
```

## 6. Confirm Order and Idempotent Confirm

1. Create an order and capture `ORDER_ID`:

```bash
ORDER_ID=$(curl -s -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: create-confirm-001' \
  -d '{"userId":"u_1","merchantId":"m_1","amount":100,"currency":"SGD"}' | jq -r '.data.id')
echo "$ORDER_ID"
```

2. Confirm order:

```bash
curl -s -X POST http://localhost:3000/orders/${ORDER_ID}/confirm \
  -H 'Idempotency-Key: confirm-001'
```

Expected:

- response includes `data.outboxEventId` when transitioning `CREATED -> CONFIRMED`
- confirm writes order + outbox in transaction; ledger credit is async via worker consumer

3. Replay confirm with same key (should return same response):

```bash
curl -s -X POST http://localhost:3000/orders/${ORDER_ID}/confirm \
  -H 'Idempotency-Key: confirm-001'
```

4. Check balance:

```bash
curl -s http://localhost:3000/users/u_1/cashback-balance
```

## 7. Cashback Processing Flow

1. Set merchant cashback rule to 5%:

```bash
curl -s -X POST http://localhost:3000/merchants/m_1/cashback-rule \
  -H 'Content-Type: application/json' \
  -d '{"rate":0.05}'
```

2. Create a new order:

```bash
NEW_ORDER_ID=$(curl -s -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: create-002' \
  -d '{"userId":"u_1","merchantId":"m_1","amount":100,"currency":"SGD"}' | jq -r '.data.id')
echo "$NEW_ORDER_ID"
```

3. Confirm order:

```bash
curl -s -X POST http://localhost:3000/orders/${NEW_ORDER_ID}/confirm \
  -H 'Idempotency-Key: confirm-002'
```

4. Check balance immediately (often still 0 before consumer finishes):

```bash
curl -s http://localhost:3000/users/u_1/cashback-balance
```

5. Check again after 1-2 seconds (should become 5):

```bash
sleep 2
curl -s http://localhost:3000/users/u_1/cashback-balance
```

## 8. Event Processing Workflow

1. Trigger a new confirmation flow:

```bash
EVENT_ORDER_ID=$(curl -s -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: create-003' \
  -d '{"userId":"u_2","merchantId":"m_1","amount":200,"currency":"SGD"}' | jq -r '.data.id')

curl -s -X POST http://localhost:3000/orders/${EVENT_ORDER_ID}/confirm \
  -H 'Idempotency-Key: confirm-003'
```

2. Check topic message (`OrderConfirmed` expected):

```bash
docker exec -i sb-redpanda rpk topic consume order.events -n 1
```

3. Check outbox status (should include `SENT`):

```bash
docker exec -i sb-postgres psql -U ledger -d ledger -c 'SELECT id,status,attempts,"sentAt" FROM "OutboxEvent" ORDER BY "createdAt" DESC LIMIT 10;'
```

## 9. Retry and DLQ Test

1. Ensure worker is running (if already running, skip this step):

```bash
pnpm dev:worker
```

2. Inject a non-existent order ID into topic:

```bash
docker exec -it sb-redpanda rpk topic produce order.events
```

Then paste and send:

```json
{"id":"evt_bad_1","type":"OrderConfirmed","aggregateId":"bad","payload":{"orderId":"00000000-0000-0000-0000-000000000000"}}
```

3. Observe inbox rows:

```bash
docker exec -i sb-postgres psql -U ledger -d ledger -c 'SELECT "sourceEventId",status,attempts,"lastError" FROM "InboxEvent" ORDER BY "createdAt" DESC LIMIT 10;'
```

4. Wait until attempts reach `MAX_ATTEMPTS` and status becomes `FAILED`, then verify DLQ:

```bash
docker exec -i sb-redpanda rpk topic consume order.events.dlq -n 1
```

## 10. Replay Verification

1. Reset FAILED inbox event back to PENDING:

```bash
pnpm -C apps/worker replay:inbox -- --sourceEventId evt_bad_1 --resetAttempts true
```

2. Verify event is reset:

```bash
docker exec -i sb-postgres psql -U ledger -d ledger -c "SELECT \"sourceEventId\",status,attempts,\"lastError\" FROM \"InboxEvent\" WHERE \"sourceEventId\"='evt_bad_1';"
```

Expected:

- `status=PENDING`
- `attempts=0`

Since the referenced order does not exist, retry loop will eventually fail it again and push to DLQ again.

## 11. DB Verification

### Method A: Interactive Access (Recommended)

1. Enter psql shell:

```bash
docker exec -it sb-postgres psql -U ledger -d ledger
```

2. Common psql commands (inside shell):

```sql
\l
\du
\conninfo
\c ledger
\dt
\d "Order"
\d "OutboxEvent"
\d "InboxEvent"
\d "LedgerEntry"
SELECT * FROM "Order" ORDER BY "createdAt" DESC LIMIT 10;
SELECT * FROM "OutboxEvent" ORDER BY "createdAt" DESC LIMIT 10;
SELECT * FROM "InboxEvent" ORDER BY "createdAt" DESC LIMIT 10;
SELECT * FROM "LedgerEntry" ORDER BY "createdAt" DESC LIMIT 10;
\q
```

### Method B: One-Line Quick Checks

```bash
docker exec -i sb-postgres psql -U ledger -d ledger -c "\l"
docker exec -i sb-postgres psql -U ledger -d ledger -c "\dt"
docker exec -i sb-postgres psql -U ledger -d ledger -c 'SELECT * FROM "Order" LIMIT 5;'
docker exec -i sb-postgres psql -U ledger -d ledger -c 'SELECT * FROM "OutboxEvent" LIMIT 5;'
docker exec -i sb-postgres psql -U ledger -d ledger -c 'SELECT * FROM "InboxEvent" LIMIT 5;'
docker exec -i sb-postgres psql -U ledger -d ledger -c 'SELECT * FROM "LedgerEntry" LIMIT 5;'
docker exec -i sb-postgres psql -U ledger -d ledger -c "SELECT version();"
docker exec -i sb-postgres env | grep POSTGRES
```

## 12. Kafka Verification and Topic Management

1. List topics:

```bash
docker exec -i sb-redpanda rpk topic list
```

2. Create topics:

```bash
docker exec -i sb-redpanda rpk topic create order.events -p 1 -r 1 || true
docker exec -i sb-redpanda rpk topic create order.events.dlq -p 1 -r 1 || true
```

3. Delete topics:

```bash
docker exec -i sb-redpanda rpk topic delete order.events
docker exec -i sb-redpanda rpk topic delete order.events.dlq
```

4. Consume messages:

```bash
docker exec -i sb-redpanda rpk topic consume order.events -n 10
docker exec -i sb-redpanda rpk topic consume order.events.dlq -n 10
```

5. Cluster checks:

```bash
docker exec -i sb-redpanda rpk cluster info
docker exec -i sb-redpanda rpk cluster health
```

## 13. kind Kubernetes Test Flow

1. Create cluster:

```bash
kind create cluster --name sb-ledger --config infra/k8s/kind-config.yaml
kubectl cluster-info
```

2. Build and load images:

```bash
make docker-build
kind load docker-image sb-ledger-api:dev --name sb-ledger
kind load docker-image sb-ledger-worker:dev --name sb-ledger
```

3. Deploy:

```bash
kubectl apply -k infra/k8s/base
kubectl -n sb-ledger get pods
```

4. Create topics in cluster:

```bash
kubectl -n sb-ledger exec deploy/redpanda -- rpk topic create order.events -p 1 -r 1 || true
kubectl -n sb-ledger exec deploy/redpanda -- rpk topic create order.events.dlq -p 1 -r 1 || true
kubectl -n sb-ledger exec deploy/redpanda -- rpk topic list
```

5. Run API tests against NodePort:

- base URL: `http://localhost:30080`
- Swagger: [http://localhost:30080/docs](http://localhost:30080/docs)

6. Observe logs:

```bash
kubectl -n sb-ledger logs deploy/api --tail=200
kubectl -n sb-ledger logs deploy/worker --tail=200
```

7. Verify no migration job:

```bash
kubectl -n sb-ledger get jobs
```

## 14. Canary Traffic Mixing and Rollback

1. Confirm deployments exist:

```bash
kubectl -n sb-ledger get deploy api api-canary
```

2. Set stable/canary ratio (4:1 ~= 20%):

```bash
kubectl -n sb-ledger scale deploy/api --replicas=4
kubectl -n sb-ledger scale deploy/api-canary --replicas=1
```

3. Verify mixed traffic via the same Service:

```bash
for i in $(seq 1 10); do curl -s http://localhost:30080/health; echo; done
```

Expected:

- most responses contain `data.version=v1`
- some responses contain `data.version=v2-canary`

4. Roll back canary:

```bash
kubectl -n sb-ledger scale deploy/api-canary --replicas=0
```

5. Verify all responses are stable:

```bash
for i in $(seq 1 10); do curl -s http://localhost:30080/health; echo; done
```

## 15. Automated Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## 16. Cleanup

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
