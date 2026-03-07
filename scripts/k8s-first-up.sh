#!/usr/bin/env bash
set -Eeuo pipefail

# Kubernetes-first one-command bootstrap for the cashback ledger demo.
# Design goals:
# - idempotent and re-runnable after interruption
# - explicit dependency order with rollout/wait checks
# - clear failure points with actionable logs
# - optional smoke verification at the end

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLUSTER_NAME="${CLUSTER_NAME:-sb-ledger}"
NAMESPACE="${NAMESPACE:-sb-ledger}"
MONITORING_NAMESPACE="${MONITORING_NAMESPACE:-monitoring}"
KIND_CONFIG="${KIND_CONFIG:-infra/k8s/kind-config.yaml}"
ENABLE_MONITORING="${ENABLE_MONITORING:-true}"
RUN_SMOKE_TESTS="${RUN_SMOKE_TESTS:-true}"
SKIP_BUILD="${SKIP_BUILD:-false}"

RETRY_ATTEMPTS="${RETRY_ATTEMPTS:-3}"
RETRY_SLEEP_SECONDS="${RETRY_SLEEP_SECONDS:-8}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-300s}"

usage() {
  cat <<'USAGE'
Usage: scripts/k8s-first-up.sh [options]

Options:
  --skip-build                  Skip docker build + kind image load
  --skip-monitoring             Skip monitoring install/resources
  --skip-smoke                  Skip end-of-run smoke verification
  --cluster-name <name>         kind cluster name (default: sb-ledger)
  --namespace <name>            app namespace (default: sb-ledger)
  --monitoring-namespace <name> monitoring namespace (default: monitoring)
  --kind-config <path>          kind config path relative to repo root
  --retry-attempts <n>          retry attempts for rollout commands
  --retry-sleep <seconds>       retry sleep seconds
  --rollout-timeout <duration>  kubectl rollout timeout (e.g. 300s)
  -h, --help                    Show this help

Environment variables remain supported:
  SKIP_BUILD, ENABLE_MONITORING, RUN_SMOKE_TESTS, CLUSTER_NAME, NAMESPACE,
  MONITORING_NAMESPACE, KIND_CONFIG, RETRY_ATTEMPTS, RETRY_SLEEP_SECONDS, ROLLOUT_TIMEOUT
USAGE
}

log() {
  printf '[k8s-up] %s\n' "$*"
}

warn() {
  printf '[k8s-up][warn] %s\n' "$*" >&2
}

fail() {
  printf '[k8s-up][error] %s\n' "$*" >&2
  exit 1
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skip-build)
        SKIP_BUILD=true
        ;;
      --skip-monitoring)
        ENABLE_MONITORING=false
        ;;
      --skip-smoke)
        RUN_SMOKE_TESTS=false
        ;;
      --cluster-name)
        shift
        [[ $# -gt 0 ]] || fail '--cluster-name requires a value'
        CLUSTER_NAME="$1"
        ;;
      --namespace)
        shift
        [[ $# -gt 0 ]] || fail '--namespace requires a value'
        NAMESPACE="$1"
        ;;
      --monitoring-namespace)
        shift
        [[ $# -gt 0 ]] || fail '--monitoring-namespace requires a value'
        MONITORING_NAMESPACE="$1"
        ;;
      --kind-config)
        shift
        [[ $# -gt 0 ]] || fail '--kind-config requires a value'
        KIND_CONFIG="$1"
        ;;
      --retry-attempts)
        shift
        [[ $# -gt 0 ]] || fail '--retry-attempts requires a value'
        RETRY_ATTEMPTS="$1"
        ;;
      --retry-sleep)
        shift
        [[ $# -gt 0 ]] || fail '--retry-sleep requires a value'
        RETRY_SLEEP_SECONDS="$1"
        ;;
      --rollout-timeout)
        shift
        [[ $# -gt 0 ]] || fail '--rollout-timeout requires a value'
        ROLLOUT_TIMEOUT="$1"
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail "Unknown option: $1"
        ;;
    esac
    shift
  done
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "Required command not found: ${cmd}"
}

retry() {
  local attempts="$1"
  local sleep_seconds="$2"
  shift 2

  local try=1
  while true; do
    if "$@"; then
      return 0
    fi

    if (( try >= attempts )); then
      return 1
    fi

    warn "Command failed (attempt ${try}/${attempts}), retrying in ${sleep_seconds}s: $*"
    sleep "${sleep_seconds}"
    ((try++))
  done
}

wait_deploy() {
  local ns="$1"
  local name="$2"
  retry "$RETRY_ATTEMPTS" "$RETRY_SLEEP_SECONDS" \
    kubectl -n "$ns" rollout status "deploy/${name}" --timeout="$ROLLOUT_TIMEOUT"
}

wait_sts_if_exists() {
  local ns="$1"
  local sts_name="$2"
  if kubectl -n "$ns" get "statefulset/${sts_name}" >/dev/null 2>&1; then
    retry "$RETRY_ATTEMPTS" "$RETRY_SLEEP_SECONDS" \
      kubectl -n "$ns" rollout status "statefulset/${sts_name}" --timeout="$ROLLOUT_TIMEOUT"
  else
    warn "StatefulSet not found, skipping wait: ${ns}/${sts_name}"
  fi
}

check_prerequisites() {
  log 'Checking prerequisites'

  require_cmd docker
  require_cmd kind
  require_cmd kubectl
  require_cmd helm
  require_cmd make
  require_cmd curl

  docker info >/dev/null 2>&1 || fail 'Docker daemon is not reachable. Start Docker first.'
}

ensure_kind_cluster() {
  log "Ensuring kind cluster exists: ${CLUSTER_NAME}"

  if kind get clusters | grep -qx "${CLUSTER_NAME}"; then
    log "Cluster already exists, reusing: ${CLUSTER_NAME}"
  else
    log "Creating cluster: ${CLUSTER_NAME}"
    kind create cluster --name "${CLUSTER_NAME}" --config "${ROOT_DIR}/${KIND_CONFIG}"
  fi

  kubectl config use-context "kind-${CLUSTER_NAME}" >/dev/null
  kubectl cluster-info >/dev/null
}

build_and_load_images() {
  if [[ "${SKIP_BUILD}" == "true" ]]; then
    log 'Skipping image build/load (SKIP_BUILD=true)'
    return
  fi

  log 'Building API/worker images'
  make -C "${ROOT_DIR}" docker-build

  log 'Loading images into kind'
  kind load docker-image sb-ledger-api:dev --name "${CLUSTER_NAME}"
  kind load docker-image sb-ledger-worker:dev --name "${CLUSTER_NAME}"
}

apply_base_config() {
  log 'Applying namespace/config/secret'
  kubectl apply -f "${ROOT_DIR}/infra/k8s/base/namespace.yaml"
  kubectl apply -f "${ROOT_DIR}/infra/k8s/base/config.yaml"
  kubectl apply -f "${ROOT_DIR}/infra/k8s/base/secret.yaml"
}

deploy_core_infra() {
  log 'Deploying core infra (postgres/redis/redpanda)'
  kubectl apply -f "${ROOT_DIR}/infra/k8s/base/postgres.yaml"
  kubectl apply -f "${ROOT_DIR}/infra/k8s/base/redis.yaml"
  kubectl apply -f "${ROOT_DIR}/infra/k8s/base/redpanda.yaml"

  wait_deploy "$NAMESPACE" postgres
  wait_deploy "$NAMESPACE" redis
  wait_deploy "$NAMESPACE" redpanda
}

topic_exists() {
  local topic="$1"
  kubectl -n "$NAMESPACE" exec deploy/redpanda -- rpk topic list 2>/dev/null | awk '{print $1}' | grep -qx "$topic"
}

ensure_topics() {
  log 'Ensuring Kafka topics exist (order.events, order.events.dlq)'

  if topic_exists order.events && topic_exists order.events.dlq; then
    log 'Topics already exist, skipping bootstrap job'
    return
  fi

  kubectl apply -f "${ROOT_DIR}/infra/k8s/base/redpanda-topics-job.yaml"

  if ! kubectl -n "$NAMESPACE" wait --for=condition=complete job/redpanda-topics --timeout=180s; then
    warn 'Topic bootstrap job did not complete in time. Recreating job once.'
    kubectl -n "$NAMESPACE" delete job redpanda-topics --ignore-not-found=true
    kubectl apply -f "${ROOT_DIR}/infra/k8s/base/redpanda-topics-job.yaml"
    kubectl -n "$NAMESPACE" wait --for=condition=complete job/redpanda-topics --timeout=180s || fail 'Topic bootstrap job failed after retry'
  fi

  kubectl -n "$NAMESPACE" logs job/redpanda-topics --tail=100 || true

  topic_exists order.events || fail 'Topic missing after bootstrap: order.events'
  topic_exists order.events.dlq || fail 'Topic missing after bootstrap: order.events.dlq'
}

deploy_app_workloads() {
  log 'Deploying app workloads (api/api-canary/worker/worker-metrics service)'
  kubectl apply -f "${ROOT_DIR}/infra/k8s/base/api.yaml"
  kubectl apply -f "${ROOT_DIR}/infra/k8s/base/api-canary.yaml"
  kubectl apply -f "${ROOT_DIR}/infra/k8s/base/worker.yaml"
  kubectl apply -f "${ROOT_DIR}/infra/k8s/base/worker-metrics.yaml"

  wait_deploy "$NAMESPACE" api
  wait_deploy "$NAMESPACE" api-canary
  wait_deploy "$NAMESPACE" worker
}

install_monitoring_stack() {
  if [[ "${ENABLE_MONITORING}" != "true" ]]; then
    log 'Skipping monitoring install (ENABLE_MONITORING!=true)'
    return
  fi

  log 'Installing/Updating kube-prometheus-stack'
  helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null 2>&1 || true
  helm repo update >/dev/null

  helm upgrade --install kps prometheus-community/kube-prometheus-stack \
    -n "$MONITORING_NAMESPACE" --create-namespace \
    -f "${ROOT_DIR}/infra/monitoring/kps-values.yaml"

  wait_deploy "$MONITORING_NAMESPACE" kps-kube-prometheus-stack-operator
  wait_deploy "$MONITORING_NAMESPACE" kps-grafana
  wait_sts_if_exists "$MONITORING_NAMESPACE" prometheus-kps-kube-prometheus-stack-prometheus
  wait_sts_if_exists "$MONITORING_NAMESPACE" alertmanager-kps-kube-prometheus-stack-alertmanager
}

apply_monitoring_resources() {
  if [[ "${ENABLE_MONITORING}" != "true" ]]; then
    return
  fi

  log 'Applying ServiceMonitors, dashboard provisioning, and alerts'
  kubectl apply -f "${ROOT_DIR}/infra/monitoring/monitors"
  kubectl apply -f "${ROOT_DIR}/infra/monitoring/grafana/provisioning.yaml"
  kubectl apply -f "${ROOT_DIR}/infra/monitoring/alerts/sb-ledger-alerts.yaml"

  # Restart Grafana so latest dashboard config map is loaded deterministically.
  kubectl -n "$MONITORING_NAMESPACE" rollout restart deploy/kps-grafana
  wait_deploy "$MONITORING_NAMESPACE" kps-grafana
}

smoke_verify() {
  if [[ "${RUN_SMOKE_TESTS}" != "true" ]]; then
    log 'Skipping smoke tests (RUN_SMOKE_TESTS!=true)'
    return
  fi

  log 'Running smoke verification'

  kubectl -n "$NAMESPACE" get pods

  retry 20 3 bash -lc "curl -fsS http://localhost:30080/health | grep -q '\"ok\":true'"
  retry 20 3 bash -lc "curl -fsS http://localhost:30080/metrics | grep -q 'http_requests_total'"

  # Worker metrics are behind deployment port, verify via temporary port-forward.
  kubectl -n "$NAMESPACE" port-forward deploy/worker 19100:9100 >/tmp/sb-worker-metrics-pf.log 2>&1 &
  local pf_pid=$!
  sleep 2

  if ! retry 20 2 bash -lc "curl -fsS http://localhost:19100/metrics | grep -q 'worker_inbox_pending'"; then
    kill "$pf_pid" >/dev/null 2>&1 || true
    wait "$pf_pid" 2>/dev/null || true
    fail 'Worker metrics smoke check failed'
  fi

  kill "$pf_pid" >/dev/null 2>&1 || true
  wait "$pf_pid" 2>/dev/null || true

  if [[ "${ENABLE_MONITORING}" == "true" ]]; then
    kubectl -n "$NAMESPACE" get servicemonitors | grep -q sb-ledger-api || fail 'ServiceMonitor missing: sb-ledger-api'
    kubectl -n "$NAMESPACE" get servicemonitors | grep -q sb-ledger-worker || fail 'ServiceMonitor missing: sb-ledger-worker'
    kubectl -n "$MONITORING_NAMESPACE" get prometheusrules | grep -q sb-ledger-alerts || fail 'PrometheusRule missing: sb-ledger-alerts'
  fi

  topic_exists order.events || fail 'Smoke check failed: order.events missing'
  topic_exists order.events.dlq || fail 'Smoke check failed: order.events.dlq missing'
}

print_summary() {
  log 'Bootstrap complete.'
  log 'Quick checks:'
  log '  curl -s http://localhost:30080/health'
  log '  curl -s http://localhost:30080/metrics | head -n 20'
  log '  kubectl -n sb-ledger get pods'
  if [[ "${ENABLE_MONITORING}" == "true" ]]; then
    log '  kubectl -n monitoring get pods'
  fi
  log 'Run full scenarios from docs/testing-playbook.md'
}

main() {
  parse_args "$@"
  check_prerequisites
  ensure_kind_cluster
  build_and_load_images
  apply_base_config
  deploy_core_infra
  ensure_topics
  deploy_app_workloads
  install_monitoring_stack
  apply_monitoring_resources
  smoke_verify
  print_summary
}

main "$@"
