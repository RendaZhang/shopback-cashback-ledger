#!/usr/bin/env bash
set -Eeuo pipefail

# Smoke verification script for an already deployed kind environment.
# This script is intentionally read-only and idempotent.

CLUSTER_NAME="${CLUSTER_NAME:-sb-ledger}"
NAMESPACE="${NAMESPACE:-sb-ledger}"
MONITORING_NAMESPACE="${MONITORING_NAMESPACE:-monitoring}"
ENABLE_MONITORING="${ENABLE_MONITORING:-auto}"

RETRY_ATTEMPTS="${RETRY_ATTEMPTS:-20}"
RETRY_SLEEP_SECONDS="${RETRY_SLEEP_SECONDS:-3}"

WORKER_METRICS_PORT="${WORKER_METRICS_PORT:-19100}"

usage() {
  cat <<'USAGE'
Usage: scripts/k8s-smoke.sh [options]

Options:
  --cluster-name <name>         kind cluster name (default: sb-ledger)
  --namespace <name>            app namespace (default: sb-ledger)
  --monitoring-namespace <name> monitoring namespace (default: monitoring)
  --monitoring                  force monitoring checks on
  --no-monitoring               force monitoring checks off
  --retry-attempts <n>          retry attempts for endpoint checks
  --retry-sleep <seconds>       retry interval between checks
  -h, --help                    Show this help
USAGE
}

log() {
  printf '[k8s-smoke] %s\n' "$*"
}

fail() {
  printf '[k8s-smoke][error] %s\n' "$*" >&2
  exit 1
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
    sleep "$sleep_seconds"
    ((try++))
  done
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
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
      --monitoring)
        ENABLE_MONITORING=true
        ;;
      --no-monitoring)
        ENABLE_MONITORING=false
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

ensure_context() {
  if kind get clusters | grep -qx "$CLUSTER_NAME"; then
    kubectl config use-context "kind-${CLUSTER_NAME}" >/dev/null
  else
    fail "kind cluster not found: ${CLUSTER_NAME}"
  fi
}

detect_monitoring_mode() {
  if [[ "$ENABLE_MONITORING" == "auto" ]]; then
    if kubectl get namespace "$MONITORING_NAMESPACE" >/dev/null 2>&1; then
      ENABLE_MONITORING=true
    else
      ENABLE_MONITORING=false
    fi
  fi
}

topic_exists() {
  local topic="$1"
  kubectl -n "$NAMESPACE" exec deploy/redpanda -- rpk topic list 2>/dev/null | awk '{print $1}' | grep -qx "$topic"
}

start_pf() {
  local ns="$1"
  local resource="$2"
  local map_port="$3"
  local log_file="$4"

  kubectl -n "$ns" port-forward "$resource" "$map_port" >"$log_file" 2>&1 &
  local pid=$!
  sleep 2
  echo "$pid"
}

stop_pf() {
  local pid="$1"
  kill "$pid" >/dev/null 2>&1 || true
  wait "$pid" 2>/dev/null || true
}

check_core() {
  log 'Checking core deployments and endpoints'

  kubectl -n "$NAMESPACE" rollout status deploy/postgres --timeout=300s >/dev/null
  kubectl -n "$NAMESPACE" rollout status deploy/redis --timeout=300s >/dev/null
  kubectl -n "$NAMESPACE" rollout status deploy/redpanda --timeout=300s >/dev/null
  kubectl -n "$NAMESPACE" rollout status deploy/api --timeout=300s >/dev/null
  kubectl -n "$NAMESPACE" rollout status deploy/api-canary --timeout=300s >/dev/null
  kubectl -n "$NAMESPACE" rollout status deploy/worker --timeout=300s >/dev/null

  retry "$RETRY_ATTEMPTS" "$RETRY_SLEEP_SECONDS" \
    bash -lc "curl -fsS http://localhost:30080/health | grep -q '\"ok\":true'"
  retry "$RETRY_ATTEMPTS" "$RETRY_SLEEP_SECONDS" \
    bash -lc "curl -fsS http://localhost:30080/metrics | grep -q 'http_requests_total'"

  local worker_pf_pid
  worker_pf_pid=$(start_pf "$NAMESPACE" deploy/worker "${WORKER_METRICS_PORT}:9100" /tmp/sb-worker-smoke-pf.log)
  if ! retry "$RETRY_ATTEMPTS" "$RETRY_SLEEP_SECONDS" \
    bash -lc "curl -fsS http://localhost:${WORKER_METRICS_PORT}/metrics | grep -q 'worker_inbox_pending'"; then
    stop_pf "$worker_pf_pid"
    fail 'Worker metrics check failed'
  fi
  stop_pf "$worker_pf_pid"

  topic_exists order.events || fail 'Missing topic: order.events'
  topic_exists order.events.dlq || fail 'Missing topic: order.events.dlq'
}

check_monitoring() {
  if [[ "$ENABLE_MONITORING" != "true" ]]; then
    log 'Skipping monitoring checks'
    return
  fi

  log 'Checking monitoring resources and endpoints'

  kubectl -n "$NAMESPACE" get servicemonitors | grep -q sb-ledger-api || fail 'Missing ServiceMonitor: sb-ledger-api'
  kubectl -n "$NAMESPACE" get servicemonitors | grep -q sb-ledger-worker || fail 'Missing ServiceMonitor: sb-ledger-worker'
  kubectl -n "$MONITORING_NAMESPACE" get prometheusrules | grep -q sb-ledger-alerts || fail 'Missing PrometheusRule: sb-ledger-alerts'

  kubectl -n "$MONITORING_NAMESPACE" rollout status deploy/kps-grafana --timeout=300s >/dev/null
  kubectl -n "$MONITORING_NAMESPACE" rollout status statefulset/prometheus-kps-kube-prometheus-stack-prometheus --timeout=300s >/dev/null
  kubectl -n "$MONITORING_NAMESPACE" rollout status statefulset/alertmanager-kps-kube-prometheus-stack-alertmanager --timeout=300s >/dev/null

  kubectl -n "$MONITORING_NAMESPACE" get svc kps-grafana >/dev/null

  local prom_svc
  prom_svc=$(kubectl -n "$MONITORING_NAMESPACE" get svc -o name | grep -E 'prometheus-stack-prometheus$' | head -n 1 | cut -d/ -f2)
  [[ -n "$prom_svc" ]] || fail 'Prometheus service not found'
}

main() {
  parse_args "$@"
  require_cmd kind
  require_cmd kubectl
  require_cmd curl

  ensure_context
  detect_monitoring_mode

  check_core
  check_monitoring

  log 'Smoke checks passed.'
}

main "$@"
