#!/usr/bin/env bash
set -Eeuo pipefail

# Teardown helper for kind-based demo environments.
# Safe to rerun. Useful after local tests or CI runs.

CLUSTER_NAME="${CLUSTER_NAME:-sb-ledger}"
PRUNE_DOCKER="${PRUNE_DOCKER:-false}"

usage() {
  cat <<'USAGE'
Usage: scripts/k8s-down.sh [options]

Options:
  --cluster-name <name>   kind cluster name to delete (default: sb-ledger)
  --prune-docker          run docker system prune -af after cluster delete
  --no-prune-docker       disable docker prune
  -h, --help              Show this help

Environment variables:
  CLUSTER_NAME, PRUNE_DOCKER
USAGE
}

log() {
  printf '[k8s-down] %s\n' "$*"
}

fail() {
  printf '[k8s-down][error] %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "Required command not found: ${cmd}"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --cluster-name)
        shift
        [[ $# -gt 0 ]] || fail '--cluster-name requires a value'
        CLUSTER_NAME="$1"
        ;;
      --prune-docker)
        PRUNE_DOCKER=true
        ;;
      --no-prune-docker)
        PRUNE_DOCKER=false
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

main() {
  parse_args "$@"
  require_cmd kind

  if kind get clusters | grep -qx "$CLUSTER_NAME"; then
    log "Deleting kind cluster: ${CLUSTER_NAME}"
    kind delete cluster --name "$CLUSTER_NAME"
  else
    log "Cluster not found, nothing to delete: ${CLUSTER_NAME}"
  fi

  if [[ "$PRUNE_DOCKER" == "true" ]]; then
    require_cmd docker
    log 'Running docker system prune -af'
    docker system prune -af
  fi

  log 'Teardown complete.'
}

main "$@"
