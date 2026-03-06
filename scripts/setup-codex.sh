#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

REQUIRED_NODE_MAJOR=22
PACKAGE_MANAGER="$(node -p "require('./package.json').packageManager || ''" 2>/dev/null || true)"
PACKAGE_MANAGER="${PACKAGE_MANAGER:-pnpm@10}"
PNPM_VERSION="${PACKAGE_MANAGER#pnpm@}"
PNPM_BIN="pnpm"

echo "[setup] Project root: ${ROOT_DIR}"

if ! command -v node >/dev/null 2>&1; then
  echo "[setup] Node.js is not installed. Please install Node.js ${REQUIRED_NODE_MAJOR}+." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if (( NODE_MAJOR < REQUIRED_NODE_MAJOR )); then
  if [[ "${SETUP_STRICT_NODE:-0}" == "1" ]]; then
    echo "[setup] Node.js $(node -v) is too old. Please use Node.js ${REQUIRED_NODE_MAJOR}+." >&2
    exit 1
  fi
  echo "[setup] Warning: Node.js $(node -v) < ${REQUIRED_NODE_MAJOR}. Continue because SETUP_STRICT_NODE is not enabled."
fi

if command -v corepack >/dev/null 2>&1; then
  echo "[setup] Enabling corepack and activating ${PACKAGE_MANAGER}..."
  corepack enable
  corepack prepare "${PACKAGE_MANAGER}" --activate
else
  echo "[setup] Warning: corepack is unavailable, skip activation."
fi

if command -v pnpm >/dev/null 2>&1; then
  PNPM_BIN="pnpm"
elif [[ -x ./node_modules/.bin/pnpm ]]; then
  PNPM_BIN="./node_modules/.bin/pnpm"
else
  if ! command -v npm >/dev/null 2>&1; then
    echo "[setup] pnpm is unavailable and npm is missing, cannot bootstrap pnpm." >&2
    exit 1
  fi
  echo "[setup] Bootstrapping pnpm@${PNPM_VERSION} via npm (project-local)..."
  if command -v timeout >/dev/null 2>&1; then
    if ! timeout "${SETUP_BOOTSTRAP_TIMEOUT_SEC:-45}" npm install --no-save "pnpm@${PNPM_VERSION}"; then
      echo "[setup] pnpm bootstrap failed or timed out. Please check network/npm registry access." >&2
      exit 1
    fi
  elif ! npm install --no-save "pnpm@${PNPM_VERSION}"; then
    echo "[setup] pnpm bootstrap failed. Please check npm availability and network access." >&2
    exit 1
  fi
  PNPM_BIN="./node_modules/.bin/pnpm"
fi

echo "[setup] pnpm version: $("${PNPM_BIN}" --version)"
"${PNPM_BIN}" config set store-dir .pnpm-store --location project >/dev/null

if [[ ! -d node_modules || "${SETUP_FORCE_INSTALL:-0}" == "1" ]]; then
  echo "[setup] Installing dependencies..."
  "${PNPM_BIN}" install --frozen-lockfile
else
  echo "[setup] node_modules exists, skip install (use SETUP_FORCE_INSTALL=1 to force)."
fi

if [[ "${SETUP_PREPARE_ENV:-1}" == "1" ]]; then
  [[ -f apps/api/.env || ! -f apps/api/.env.example ]] || cp apps/api/.env.example apps/api/.env
  [[ -f apps/worker/.env || ! -f apps/worker/.env.example ]] || cp apps/worker/.env.example apps/worker/.env
fi

if [[ "${SETUP_DB_GENERATE:-0}" == "1" ]]; then
  echo "[setup] Running Prisma generate..."
  "${PNPM_BIN}" db:generate
fi

echo "[setup] Done."
