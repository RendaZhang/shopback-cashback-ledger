# Deployment Guide (Kubernetes-First with Local Option)

This is the canonical deployment guide for this project.

- primary path: Kubernetes on kind
- secondary path: local Docker Compose

After deployment, run scenario checks from [testing-playbook.md](testing-playbook.md).

**Owner:** Platform Engineering (Demo)  
**Last Updated:** 2026-03-07  
**Applies To:** kind cluster `sb-ledger` and local Docker Compose

## 1. Prerequisites

- Docker
- kind
- kubectl
- helm
- Node.js 22+
- pnpm 10+

## 2. Kubernetes Path (Primary)

### 2.1 Create Cluster

```bash
kind create cluster --name sb-ledger --config infra/k8s/kind-config.yaml
kubectl cluster-info
```

### 2.2 Build and Load Images

```bash
make docker-build
kind load docker-image sb-ledger-api:dev --name sb-ledger
kind load docker-image sb-ledger-worker:dev --name sb-ledger
```

### 2.3 Apply Namespace, Config, and Secrets

```bash
kubectl apply -f infra/k8s/base/namespace.yaml
kubectl apply -f infra/k8s/base/config.yaml
kubectl apply -f infra/k8s/base/secret.yaml
kubectl -n sb-ledger get configmap sb-ledger-config
kubectl -n sb-ledger get secret sb-ledger-secret
```

### 2.4 Deploy Core Infrastructure

```bash
kubectl apply -f infra/k8s/base/postgres.yaml
kubectl apply -f infra/k8s/base/redis.yaml
kubectl apply -f infra/k8s/base/redpanda.yaml

kubectl -n sb-ledger rollout status deploy/postgres
kubectl -n sb-ledger rollout status deploy/redis
kubectl -n sb-ledger rollout status deploy/redpanda
```

### 2.5 Bootstrap Kafka Topics

The bootstrap job creates both topics:

- `order.events`
- `order.events.dlq`

```bash
kubectl apply -f infra/k8s/base/redpanda-topics-job.yaml
kubectl -n sb-ledger wait --for=condition=complete job/redpanda-topics --timeout=180s
kubectl -n sb-ledger logs job/redpanda-topics
kubectl -n sb-ledger exec deploy/redpanda -- rpk topic list
```

### 2.6 Deploy Application Workloads

```bash
kubectl apply -f infra/k8s/base/api.yaml
kubectl apply -f infra/k8s/base/api-canary.yaml
kubectl apply -f infra/k8s/base/worker.yaml
kubectl apply -f infra/k8s/base/worker-metrics.yaml

kubectl -n sb-ledger rollout status deploy/api
kubectl -n sb-ledger rollout status deploy/api-canary
kubectl -n sb-ledger rollout status deploy/worker
```

### 2.7 Verify Core Runtime

```bash
kubectl -n sb-ledger get pods
kubectl -n sb-ledger get svc
kubectl -n sb-ledger get deploy
```

```bash
curl -s http://localhost:30080/health
curl -s http://localhost:30080/metrics | grep -E 'http_requests_total|http_request_duration_seconds' | head
```

### 2.8 Install Monitoring Stack

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

helm upgrade --install kps prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  -f infra/monitoring/kps-values.yaml

kubectl -n monitoring get pods
```

### 2.9 Apply Monitoring Resources

```bash
kubectl apply -f infra/monitoring/monitors
kubectl apply -f infra/monitoring/grafana/provisioning.yaml
kubectl apply -f infra/monitoring/alerts/sb-ledger-alerts.yaml

kubectl -n sb-ledger get servicemonitors
kubectl -n monitoring get prometheusrules | grep sb-ledger
kubectl -n monitoring rollout restart deploy/kps-grafana
kubectl -n monitoring rollout status deploy/kps-grafana
```

### 2.10 Verify Prometheus and Grafana

Prometheus:

```bash
kubectl -n monitoring get svc | grep prometheus
PROM_SVC=$(kubectl -n monitoring get svc -o name | grep -E 'prometheus-stack-prometheus$' | head -n 1 | cut -d/ -f2)
[ -n "$PROM_SVC" ] || { echo "Prometheus service not found"; exit 1; }
kubectl -n monitoring port-forward svc/${PROM_SVC} 19090:9090
```

Open:

- [http://localhost:19090/targets](http://localhost:19090/targets)
- [http://localhost:19090/alerts](http://localhost:19090/alerts)

Expected targets:

- `sb-ledger-api` is `UP`
- `sb-ledger-worker` is `UP`

Grafana:

```bash
kubectl -n monitoring port-forward svc/kps-grafana 13000:80
```

Open [http://localhost:13000](http://localhost:13000) with `admin/admin`, then verify dashboard `ShopBack Cashback Ledger (Demo)` exists.

If dashboard panels show no data, verify Grafana datasource UID and update `infra/monitoring/grafana/sb-ledger-dashboard.json` to match before reapplying `infra/monitoring/grafana/provisioning.yaml`.

## 3. Local Path (Secondary, Non-Kubernetes)

Use this path when you only need local development or local scenario checks.

### 3.1 Start Infra and Prepare Environment

```bash
pnpm install
make up
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
pnpm db:generate
pnpm db:migrate
```

### 3.2 Create Topics

```bash
docker exec -i sb-redpanda rpk topic create order.events -p 1 -r 1 || true
docker exec -i sb-redpanda rpk topic create order.events.dlq -p 1 -r 1 || true
docker exec -i sb-redpanda rpk topic list
```

### 3.3 Start API and Worker

Run in two terminals:

```bash
export VERSION=v1
pnpm dev:api
```

```bash
pnpm dev:worker
```

### 3.4 Verify Local Runtime

```bash
curl -s http://localhost:3000/health
curl -s http://localhost:3000/metrics | grep -E 'http_requests_total|http_request_duration_seconds' | head
curl -s http://localhost:9100/metrics | grep -E 'worker_inbox_|worker_outbox_|worker_dlq_|worker_inbox_retries_total' | head
```

## 4. Next Step

Run [testing-playbook.md](testing-playbook.md) for full scenario validation and test data checks.
