# Prometheus, Grafana, Dashboards, and Alerts on kind

This guide installs Prometheus Operator + Prometheus + Grafana, configures automatic scraping for API and worker metrics, provisions a Grafana dashboard, and applies alert rules.

## Prerequisites

- kind cluster is running
- `kubectl` is configured to the target cluster
- `helm` is installed
- API `/metrics` and worker `/metrics` are already exposed

## 1. Prepare Services for ServiceMonitor Discovery

ServiceMonitor selects Kubernetes Services by label and endpoint port name.

Apply base manifests (includes `api` Service label/port name and `worker-metrics` Service):

```bash
kubectl apply -k infra/k8s/base
kubectl -n sb-ledger get svc api worker-metrics
```

Expected:

- `api` service has label `app=api` and endpoint port name `http`
- `worker-metrics` service has label `app=worker-metrics` and endpoint port name `metrics`

## 2. Install kube-prometheus-stack

Create values file (`infra/monitoring/kps-values.yaml`).

Install chart:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

helm upgrade --install kps prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  -f infra/monitoring/kps-values.yaml
```

Check pods:

```bash
kubectl -n monitoring get pods
```

## 3. Create ServiceMonitors

API ServiceMonitor (`infra/monitoring/monitors/sm-api.yaml`).

Worker ServiceMonitor (`infra/monitoring/monitors/sm-worker.yaml`).

Apply and verify:

```bash
kubectl apply -f infra/monitoring/monitors
kubectl -n sb-ledger get servicemonitors
```

## 4. Verify Prometheus Targets

List service names:

```bash
kubectl -n monitoring get svc | grep prometheus
```

Port-forward Prometheus:

```bash
kubectl -n monitoring port-forward svc/kps-kube-prometheus-stack-prometheus 19090:9090
```

Open:

- [http://localhost:19090/targets](http://localhost:19090/targets)

Expected:

- target group for `sb-ledger-api` is `UP`
- target group for `sb-ledger-worker` is `UP`

## 5. Access Grafana

Port-forward Grafana:

```bash
kubectl -n monitoring port-forward svc/kps-grafana 13000:80
```

Open:

- [http://localhost:13000](http://localhost:13000)

Credentials:

- username: `admin`
- password: `admin`

## 6. Provision Grafana Dashboard

Create dashboard files:

```bash
mkdir -p infra/monitoring/grafana
```

- dashboard JSON: `infra/monitoring/grafana/sb-ledger-dashboard.json`
- provisioning ConfigMap: `infra/monitoring/grafana/provisioning.yaml`

Embed dashboard JSON into ConfigMap and apply:

```bash
kubectl apply -f infra/monitoring/grafana/provisioning.yaml
kubectl -n monitoring rollout restart deploy/kps-grafana
kubectl -n monitoring rollout status deploy/kps-grafana
```

Verify in Grafana:

- open [http://localhost:13000](http://localhost:13000)
- Dashboards -> search `ShopBack Cashback Ledger (Demo)`
- dashboard should contain 6 panels

### Datasource UID mismatch fix

If panels show no data and datasource UID differs from dashboard JSON:

```bash
kubectl -n monitoring port-forward svc/kps-grafana 13000:80
```

In another terminal, check actual Prometheus datasource UID:

```bash
curl -s -u admin:admin http://localhost:13000/api/datasources | grep -o '\"uid\":\"[^\"]*\"'
```

Then update `sb-ledger-dashboard.json` datasource UID, regenerate `provisioning.yaml`, reapply, and restart Grafana.

## 7. Apply Prometheus Alerts

Create alert rules:

```bash
mkdir -p infra/monitoring/alerts
```

- rules file: `infra/monitoring/alerts/sb-ledger-alerts.yaml`
- metadata label `release: kps` is required for this chart default `ruleSelector`
- includes:
  - `SBLedgerApiHigh5xxRate` (5xx ratio > 1% for 5m)
  - `SBLedgerInboxFailedNonZero` (`worker_inbox_failed > 0` for 1m)

Apply and verify:

```bash
kubectl apply -f infra/monitoring/alerts/sb-ledger-alerts.yaml
kubectl -n monitoring get prometheusrules | grep sb-ledger
```

Optional check in Prometheus UI:

- [http://localhost:19090/alerts](http://localhost:19090/alerts)

## 8. Troubleshooting

Prometheus pod `ImagePullBackOff`:

- check events: `kubectl -n monitoring describe pod <prometheus-pod>`
- common cause: temporary pull/network timeout from image registry
- retry by waiting and checking rollout status:

```bash
kubectl -n monitoring rollout status statefulset/prometheus-kps-kube-prometheus-stack-prometheus --timeout=300s
```
