# Testing Playbook

This guide is the primary scenario validation document.

Complete deployment first via [deployment-guide-k8s-first.md](deployment-guide-k8s-first.md), then run the test scenarios here.

For k8s-first setup, you can bootstrap everything with `make k8s-up`.

**Owner:** Platform Engineering (Demo)  
**Last Updated:** 2026-03-07  
**Applies To:** Local Docker Compose and kind `sb-ledger`

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
- Optional for load test: `k6` (or use Docker `grafana/k6`)

## 3. Runtime Variables

Set variables once, then run all commands with minimal edits:

```bash
export BASE_URL=${BASE_URL:-http://localhost:3000}
export WORKER_METRICS_URL=${WORKER_METRICS_URL:-http://localhost:9100}
export K8S_BASE_URL=${K8S_BASE_URL:-http://localhost:30080}
```

Notes:

- local default: keep `BASE_URL=http://localhost:3000`
- kind default: set `BASE_URL=http://localhost:30080`
- worker metrics in kind usually use port-forward, then set `WORKER_METRICS_URL=http://localhost:19100`

## 4. Happy Path (10-15 Minutes)

Use this quick route before running full scenarios:

If `jq` is not installed, run create order first and copy `data.id` manually.

```bash
ORDER_ID=$(curl -s -X POST ${BASE_URL}/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: quick-create-001' \
  -d '{"userId":"u_quick","merchantId":"m_1","amount":100,"currency":"SGD"}' | jq -r '.data.id')

curl -s -X POST ${BASE_URL}/orders/${ORDER_ID}/confirm \
  -H 'Idempotency-Key: quick-confirm-001'

curl -s ${BASE_URL}/users/u_quick/cashback-balance
```

Pass Criteria:

- create returns an order ID
- confirm returns success response
- balance endpoint is reachable and returns valid envelope

## 5. API Health and Contract Check

1. Health check:

```bash
curl -s ${BASE_URL}/health
```

Expected: response envelope with `data.ok=true`.
Expected: response envelope also includes `data.version` (for example `v1` locally, `v1` from ConfigMap on k8s).

2. Metrics check:

```bash
curl -s ${BASE_URL}/metrics | grep -E 'http_requests_total|http_request_duration_seconds' | head
```

Expected: Prometheus text output (not JSON envelope), including HTTP RED metrics lines.

3. Worker metrics check:

```bash
curl -s ${WORKER_METRICS_URL}/metrics | grep -E 'worker_inbox_|worker_outbox_|worker_dlq_|worker_inbox_retries_total' | head
```

Expected: worker metrics include backlog gauges and retry/DLQ counters.

4. Swagger:

- `${BASE_URL}/docs`

5. Rate-limit quick check (local):

```bash
for i in $(seq 1 1200); do curl -s -o /dev/null -w "%{http_code}\n" -H 'X-User-Id: demo-user-1' ${BASE_URL}/health; done | sort | uniq -c
```

Expected: with single local API instance and same user key, burst traffic should start returning `429`.

Optional mixed-user check:

```bash
for i in $(seq 1 1200); do curl -s -o /dev/null -w "%{http_code}\n" -H "X-User-Id: user-$i" ${BASE_URL}/health; done | sort | uniq -c
```

Expected: `429` should be near zero for mixed-user traffic.

### Pass Criteria

- `/health` returns `data.ok=true` and includes `data.version`
- `/metrics` contains API RED metric families
- worker `/metrics` contains backlog/retry/DLQ metrics
- burst test with one user key produces some `429`

## 6. Idempotent Order Creation API Examples

1. Create order (with idempotency key):

```bash
curl -s -X POST ${BASE_URL}/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: create-001' \
  -d '{"userId":"u_1","merchantId":"m_1","amount":100.5,"currency":"SGD"}'
```

2. Repeat same request (should return same order ID):

```bash
curl -s -X POST ${BASE_URL}/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: create-001' \
  -d '{"userId":"u_1","merchantId":"m_1","amount":100.5,"currency":"SGD"}'
```

3. Reuse same key with different body (should return 409 Conflict):

```bash
curl -i -X POST ${BASE_URL}/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: create-001' \
  -d '{"userId":"u_1","merchantId":"m_1","amount":999,"currency":"SGD"}'
```

### Pass Criteria

- step 1 and step 2 return the same order ID
- step 3 returns `409 Conflict`

## 7. Confirm Order and Idempotent Confirm

1. Create an order and capture `ORDER_ID`:

```bash
ORDER_ID=$(curl -s -X POST ${BASE_URL}/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: create-confirm-001' \
  -d '{"userId":"u_1","merchantId":"m_1","amount":100,"currency":"SGD"}' | jq -r '.data.id')
echo "$ORDER_ID"
```

2. Confirm order:

```bash
curl -s -X POST ${BASE_URL}/orders/${ORDER_ID}/confirm \
  -H 'Idempotency-Key: confirm-001'
```

Expected:

- response includes `data.outboxEventId` when transitioning `CREATED -> CONFIRMED`
- confirm writes order + outbox in transaction; ledger credit is async via worker consumer

3. Replay confirm with same key (should return same response):

```bash
curl -s -X POST ${BASE_URL}/orders/${ORDER_ID}/confirm \
  -H 'Idempotency-Key: confirm-001'
```

4. Check balance:

```bash
curl -s ${BASE_URL}/users/u_1/cashback-balance
```

### Pass Criteria

- first confirm returns success and includes `outboxEventId` on transition
- replay confirm with same key is idempotent (stable response)

## 8. Cashback Processing Flow

1. Set merchant cashback rule to 5%:

```bash
curl -s -X POST ${BASE_URL}/merchants/m_1/cashback-rule \
  -H 'Content-Type: application/json' \
  -d '{"rate":0.05}'
```

2. Create a new order:

```bash
NEW_ORDER_ID=$(curl -s -X POST ${BASE_URL}/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: create-002' \
  -d '{"userId":"u_1","merchantId":"m_1","amount":100,"currency":"SGD"}' | jq -r '.data.id')
echo "$NEW_ORDER_ID"
```

3. Confirm order:

```bash
curl -s -X POST ${BASE_URL}/orders/${NEW_ORDER_ID}/confirm \
  -H 'Idempotency-Key: confirm-002'
```

4. Check balance immediately (often still 0 before consumer finishes):

```bash
curl -s ${BASE_URL}/users/u_1/cashback-balance
```

5. Check again after 1-2 seconds (should become 5):

```bash
sleep 2
curl -s ${BASE_URL}/users/u_1/cashback-balance
```

### Pass Criteria

- balance is unchanged immediately after confirm (async path)
- balance increases after worker processing delay

### 8.1 Cashback Rule Cache Verification (Redis)

1. Upsert merchant rule and confirm Redis key exists:

```bash
curl -s -X POST ${BASE_URL}/merchants/m_1/cashback-rule \
  -H 'Content-Type: application/json' \
  -d '{"rate":0.07}'

docker exec -i sb-redis redis-cli GET cashback_rule:m_1
```

2. Trigger worker path (create + confirm), then read cache again:

```bash
CACHE_ORDER_ID=$(curl -s -X POST ${BASE_URL}/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: cache-create-001' \
  -d '{"userId":"u_cache","merchantId":"m_1","amount":100,"currency":"SGD"}' | jq -r '.data.id')

curl -s -X POST ${BASE_URL}/orders/${CACHE_ORDER_ID}/confirm \
  -H 'Idempotency-Key: cache-confirm-001'

sleep 1
docker exec -i sb-redis redis-cli GET cashback_rule:m_1
```

Expected: key `cashback_rule:m_1` is present and payload reflects latest rule (`rate`/`cap`).

3. Update rule again and verify API invalidates cache:

```bash
curl -s -X POST ${BASE_URL}/merchants/m_1/cashback-rule \
  -H 'Content-Type: application/json' \
  -d '{"rate":0.09}'

docker exec -i sb-redis redis-cli GET cashback_rule:m_1
```

Expected: immediately after update, key may be empty (`(nil)`) until next read repopulates cache.

### Pass Criteria

- Redis key `cashback_rule:m_1` is created/read during flow
- upsert invalidates key and next read repopulates it

## 9. Event Processing Workflow

1. Trigger a new confirmation flow:

```bash
EVENT_ORDER_ID=$(curl -s -X POST ${BASE_URL}/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: create-003' \
  -d '{"userId":"u_2","merchantId":"m_1","amount":200,"currency":"SGD"}' | jq -r '.data.id')

curl -s -X POST ${BASE_URL}/orders/${EVENT_ORDER_ID}/confirm \
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

### Pass Criteria

- `order.events` contains `OrderConfirmed` message
- newest outbox row is `SENT`

## 10. Retry and DLQ Test

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

### Pass Criteria

- inbox row transitions to `FAILED` after retries
- DLQ topic receives the failed message

## 11. Replay Verification

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

### Pass Criteria

- replay command resets event to `PENDING` and `attempts=0`
- event can be reprocessed by retry loop

## 12. DB Verification

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

### Pass Criteria

- required tables are visible
- recent rows can be queried from Order/Outbox/Inbox/Ledger tables

## 13. Kafka Verification and Topic Management

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

### Pass Criteria

- topic list/consume commands work
- topic create/delete commands behave as expected
- cluster health command returns healthy status

## 14. Monitoring Stack Verification (Prometheus + Grafana)

Precondition: monitoring stack and monitors are already installed via [deployment-guide-k8s-first.md](deployment-guide-k8s-first.md).

1. Verify ServiceMonitors and alert rules:

```bash
kubectl -n sb-ledger get servicemonitors
kubectl -n monitoring get prometheusrules | grep sb-ledger
```

2. Verify Prometheus targets:

```bash
kubectl -n monitoring get svc | grep prometheus
PROM_SVC=$(kubectl -n monitoring get svc -o name | grep -E 'prometheus-stack-prometheus$' | head -n 1 | cut -d/ -f2)
[ -n "$PROM_SVC" ] || { echo "Prometheus service not found"; exit 1; }
kubectl -n monitoring port-forward svc/${PROM_SVC} 19090:9090
```

Then open:

- [http://localhost:19090/targets](http://localhost:19090/targets)

Expected:

- `sb-ledger-api` target is `UP`
- `sb-ledger-worker` target is `UP`

3. Verify loaded alerts:

- open [http://localhost:19090/alerts](http://localhost:19090/alerts)

4. Verify Grafana dashboard:

```bash
kubectl -n monitoring port-forward svc/kps-grafana 13000:80
```

Then open:

- [http://localhost:13000](http://localhost:13000)
- username: `admin`
- password: `admin`

In Dashboards, search `ShopBack Cashback Ledger (Demo)`.

Expected:

- one dashboard with 6 panels

5. Optional datasource UID mismatch check (when panels are empty):

```bash
curl -s -u admin:admin http://localhost:13000/api/datasources | grep -o '"uid":"[^"]*"'
```

If UID differs from `infra/monitoring/grafana/sb-ledger-dashboard.json`, update the JSON UID, re-embed it into `infra/monitoring/grafana/provisioning.yaml`, and reapply.

### Pass Criteria

- Prometheus targets for API/worker are `UP`
- Grafana dashboard `ShopBack Cashback Ledger (Demo)` is visible
- alert rules are loaded in Prometheus

## 15. Load Test Baseline (k6)

1. Use script:

- `infra/loadtest/k6-create-confirm.js`

2. Run baseline with local k6:

```bash
k6 version
k6 run -e BASE_URL=${BASE_URL} infra/loadtest/k6-create-confirm.js
```

3. Run baseline with Docker k6 (recommended):

```bash
docker run --rm --network host -i grafana/k6 run --quiet -e BASE_URL=${BASE_URL} - < infra/loadtest/k6-create-confirm.js
```

4. During the run, watch Grafana panels:

- API QPS
- API p95 latency
- API 5xx rate

5. Record key output to baseline doc:

- `http_req_duration`
- `http_req_failed`
- `iterations`
- request rate (`http_reqs`)

See:

- [loadtest-baseline.md](loadtest-baseline.md)

Note:

- With user-based throttling (`THROTTLE_LIMIT=600`, `THROTTLE_TTL=60s`) and per-VU `X-User-Id`, this scenario should keep `429` close to zero.
- To intentionally demonstrate throttling, reuse one fixed `X-User-Id` in all requests.

### Pass Criteria

- k6 run completes without script errors
- threshold expectations match the target profile for the run
- key metrics are recorded into `docs/loadtest-baseline.md`

## 16. Canary Traffic Mixing and Rollback

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
for i in $(seq 1 10); do curl -s ${K8S_BASE_URL}/health; echo; done
```

### Pass Criteria

- with `api-canary` replicas > 0, `/health` occasionally shows `v2-canary`
- after scaling canary to 0, `/health` returns only stable version

Expected:

- most responses contain `data.version=v1`
- some responses contain `data.version=v2-canary`

4. Roll back canary:

```bash
kubectl -n sb-ledger scale deploy/api-canary --replicas=0
```

5. Verify all responses are stable:

```bash
for i in $(seq 1 10); do curl -s ${K8S_BASE_URL}/health; echo; done
```

## 17. Automated Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
```

### Pass Criteria

- all commands exit with status `0`

## 18. Cleanup

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
docker system prune -af
```

kind:

```bash
kind delete cluster --name sb-ledger
```
