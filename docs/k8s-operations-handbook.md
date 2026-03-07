# Kubernetes Operations Handbook

This is the Kubernetes-first operations cheat sheet for day-to-day deployment, troubleshooting, and verification.

**Owner:** Platform Engineering (Demo)  
**Last Updated:** 2026-03-07  
**Applies To:** kind cluster `sb-ledger` and namespace `sb-ledger`

## 1. Quick Navigation

- Full resource-by-resource deployment: [deployment-guide-k8s-first.md](deployment-guide-k8s-first.md)
- End-to-end scenario validation: [testing-playbook.md](testing-playbook.md)
- This file: operational shortcuts, diagnostics, and recovery commands

## 2. Minimal Quickstart

### 2.1 One-Command k8s Bootstrap (Recommended)

```bash
make k8s-up
```

Useful toggles:

```bash
SKIP_BUILD=true make k8s-up
ENABLE_MONITORING=false make k8s-up
RUN_SMOKE_TESTS=false make k8s-up
```

CLI-style flags:

```bash
make k8s-up ARGS="--skip-build --skip-monitoring --skip-smoke"
```

Post-bootstrap checks and teardown:

```bash
make k8s-smoke
make k8s-down
make k8s-down ARGS="--prune-docker"
```

### 2.2 Local Development

```bash
pnpm install
make up
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
pnpm db:generate
pnpm db:migrate
pnpm dev:api
pnpm dev:worker
```

Quick checks:

```bash
curl -s http://localhost:3000/health
curl -s http://localhost:3000/metrics | head
curl -s http://localhost:9100/metrics | head
```

### 2.3 kind Quickstart (Manual)

```bash
kind create cluster --name sb-ledger --config infra/k8s/kind-config.yaml
make docker-build
kind load docker-image sb-ledger-api:dev --name sb-ledger
kind load docker-image sb-ledger-worker:dev --name sb-ledger
kubectl apply -k infra/k8s/base
kubectl -n sb-ledger wait --for=condition=complete job/redpanda-topics --timeout=180s
kubectl -n sb-ledger get pods
```

Quick checks:

```bash
curl -s http://localhost:30080/health
kubectl -n sb-ledger exec deploy/redpanda -- rpk topic list
```

## 3. Namespace Setup

```bash
export NS=sb-ledger
```

## 4. Useful Commands

### 4.1 Cluster and Resources

```bash
kubectl get nodes
kubectl -n $NS get pods
kubectl -n $NS get deploy
kubectl -n $NS get svc
kubectl -n $NS get jobs
kubectl -n $NS get events --sort-by=.metadata.creationTimestamp | tail -n 30
```

### 4.2 Rollout and Restart

```bash
kubectl -n $NS rollout restart deploy/api
kubectl -n $NS rollout restart deploy/api-canary
kubectl -n $NS rollout restart deploy/worker

kubectl -n $NS rollout status deploy/api
kubectl -n $NS rollout status deploy/api-canary
kubectl -n $NS rollout status deploy/worker

kubectl -n $NS rollout history deploy/api
```

### 4.3 Logs and Debugging

```bash
kubectl -n $NS logs deploy/api --tail=200
kubectl -n $NS logs deploy/worker --tail=200
kubectl -n $NS logs deploy/redpanda --tail=200
kubectl -n $NS logs job/redpanda-topics --tail=200

kubectl -n $NS describe pod <POD_NAME>
kubectl -n $NS exec -it deploy/postgres -- sh
kubectl -n $NS exec -it deploy/redpanda -- sh
```

### 4.4 Health and Metrics

```bash
curl -s http://localhost:30080/health
curl -s http://localhost:30080/metrics | head -n 30

kubectl -n $NS port-forward deploy/worker 19100:9100
curl -s http://localhost:19100/metrics | grep -E 'worker_inbox_|worker_outbox_|worker_dlq_|worker_inbox_retries_total'
```

### 4.5 Topic and Stream Operations

```bash
kubectl -n $NS exec deploy/redpanda -- rpk topic list
kubectl -n $NS exec deploy/redpanda -- rpk topic consume order.events -n 10
kubectl -n $NS exec deploy/redpanda -- rpk topic consume order.events.dlq -n 10

kubectl -n $NS exec deploy/redpanda -- rpk topic create order.events -p 1 -r 1 || true
kubectl -n $NS exec deploy/redpanda -- rpk topic create order.events.dlq -p 1 -r 1 || true
```

### 4.6 Database Quick Checks

```bash
kubectl -n $NS exec deploy/postgres -- psql -U ledger -d ledger -c '\dt'
kubectl -n $NS exec deploy/postgres -- psql -U ledger -d ledger -c 'SELECT * FROM "OutboxEvent" ORDER BY "createdAt" DESC LIMIT 10;'
kubectl -n $NS exec deploy/postgres -- psql -U ledger -d ledger -c 'SELECT * FROM "InboxEvent" ORDER BY "createdAt" DESC LIMIT 10;'
kubectl -n $NS exec deploy/postgres -- psql -U ledger -d ledger -c 'SELECT * FROM "LedgerEntry" ORDER BY "createdAt" DESC LIMIT 10;'
```

### 4.7 Image Update (kind)

```bash
make docker-build
kind load docker-image sb-ledger-api:dev --name sb-ledger
kind load docker-image sb-ledger-worker:dev --name sb-ledger

kubectl -n $NS rollout restart deploy/api
kubectl -n $NS rollout restart deploy/api-canary
kubectl -n $NS rollout restart deploy/worker
```

### 4.8 Canary Operations

```bash
kubectl -n $NS scale deploy/api --replicas=4
kubectl -n $NS scale deploy/api-canary --replicas=1
kubectl -n $NS get deploy api api-canary

for i in $(seq 1 10); do curl -s http://localhost:30080/health; echo; done

kubectl -n $NS scale deploy/api-canary --replicas=0
```

### 4.9 Monitoring Stack Shortcuts

```bash
kubectl -n monitoring get pods
kubectl -n monitoring get svc
kubectl -n monitoring get servicemonitors -A
kubectl -n monitoring get prometheusrules

PROM_SVC=$(kubectl -n monitoring get svc -o name | grep -E 'prometheus-stack-prometheus$' | head -n 1 | cut -d/ -f2)
[ -n "$PROM_SVC" ] || { echo "Prometheus service not found"; exit 1; }
kubectl -n monitoring port-forward svc/${PROM_SVC} 19090:9090
kubectl -n monitoring port-forward svc/kps-grafana 13000:80
```

## 5. Common Recovery Actions

### 5.1 Recreate Topic Bootstrap Job

```bash
kubectl -n $NS delete job redpanda-topics --ignore-not-found=true
kubectl -n $NS apply -f infra/k8s/base/redpanda-topics-job.yaml
kubectl -n $NS wait --for=condition=complete job/redpanda-topics --timeout=180s
```

### 5.2 Full Workload Restart

```bash
kubectl -n $NS rollout restart deploy/postgres
kubectl -n $NS rollout restart deploy/redis
kubectl -n $NS rollout restart deploy/redpanda
kubectl -n $NS rollout restart deploy/api
kubectl -n $NS rollout restart deploy/api-canary
kubectl -n $NS rollout restart deploy/worker
```

### 5.3 Reset kind Cluster

```bash
kind delete cluster --name sb-ledger
kind create cluster --name sb-ledger --config infra/k8s/kind-config.yaml
```
