#!/usr/bin/env bash
# Shared helpers for ./deploy/install.sh and ./deploy/update.sh
# shellcheck shell=bash

set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${DEPLOY_DIR}/.." && pwd)"
PROD_SCRIPTS="${REPO_ROOT}/infra/production/scripts"
COMPOSE_FILE="${REPO_ROOT}/infra/production/compose.shared-host.yaml"
DEFAULT_ENV_FILE="/opt/hector/env/production.env"
HOST_NGINX_SRC="${REPO_ROOT}/infra/production/host-nginx"

# shellcheck source=../infra/production/scripts/lib.sh
source "${PROD_SCRIPTS}/lib.sh"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
die() { red "ERROR: $*" >&2; exit 1; }

hector_env_file() {
  echo "${HECTOR_ENV_FILE:-$DEFAULT_ENV_FILE}"
}

hector_init() {
  export DEPLOYMENT_MODE="${DEPLOYMENT_MODE:-shared-host}"
  export HECTOR_ENV_FILE
  HECTOR_ENV_FILE="$(hector_env_file)"
  [[ -f "$HECTOR_ENV_FILE" ]] || die "Missing env file: ${HECTOR_ENV_FILE}
Copy template:
  sudo mkdir -p /opt/hector/env && sudo chmod 700 /opt/hector/env
  sudo cp ${REPO_ROOT}/infra/production/env/production.env.example ${HECTOR_ENV_FILE}
  sudo chmod 600 ${HECTOR_ENV_FILE}
  # then edit secrets"
  load_env_file
  export DEPLOYMENT_MODE=shared-host
  # Simple local image defaults (operator should not manage Git SHAs)
  export HECTOR_IMAGE_TAG="${HECTOR_IMAGE_TAG:-latest}"
  export HECTOR_API_IMAGE="${HECTOR_API_IMAGE:-hector-api:latest}"
  export HECTOR_WEB_IMAGE="${HECTOR_WEB_IMAGE:-hector-web:latest}"
  export HECTOR_MIGRATE_IMAGE="${HECTOR_MIGRATE_IMAGE:-hector-api-migrate:latest}"
  export HECTOR_PRODUCTION_CONFIRM="${HECTOR_PRODUCTION_CONFIRM:-I_UNDERSTAND_PRODUCTION}"
  export HECTOR_BACKUP_DIR="${HECTOR_BACKUP_DIR:-/var/backups/hector}"
  resolve_compose_project
  cd "$REPO_ROOT"
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die "docker is required"
  docker compose version >/dev/null 2>&1 || die "Docker Compose V2 is required (docker compose)"
  docker info >/dev/null 2>&1 || die "Docker daemon is not reachable"
}

validate_env_secrets() {
  local missing=0
  local key
  for key in \
    JWT_ACCESS_SECRET AUTH_REFRESH_PEPPER POSTGRES_PASSWORD \
    DATABASE_URL DATABASE_URL_MIGRATE CORS_ORIGINS NODE_ENV
  do
    local val="${!key:-}"
    if [[ -z "$val" ]] || is_placeholder "$val"; then
      red "Missing or placeholder: ${key}"
      missing=1
    fi
  done
  [[ "$NODE_ENV" == "production" ]] || die "NODE_ENV must be production"
  [[ "$CORS_ORIGINS" == "https://hector.pishete.com" || "$CORS_ORIGINS" == https://hector.pishete.com,* ]] \
    || yellow "Warning: CORS_ORIGINS is '${CORS_ORIGINS}' (expected https://hector.pishete.com)"
  [[ "$JWT_ACCESS_SECRET" != "$AUTH_REFRESH_PEPPER" ]] || die "JWT_ACCESS_SECRET must differ from AUTH_REFRESH_PEPPER"
  [[ -z "${DEV_SEED_PASSWORD:-}" ]] || die "DEV_SEED_PASSWORD must not be set in production"
  [[ "$missing" -eq 0 ]] || die "Fix ${HECTOR_ENV_FILE} and re-run"
}

check_ports_free_or_ours() {
  assert_loopback_port_available "${HECTOR_WEB_BIND_IP:-127.0.0.1}" "${HECTOR_WEB_HOST_PORT:-3100}" "Web"
  assert_loopback_port_available "${HECTOR_API_BIND_IP:-127.0.0.1}" "${HECTOR_API_HOST_PORT:-3101}" "API"
}

check_resources() {
  if command -v free >/dev/null 2>&1; then
    local avail_mb
    avail_mb="$(free -m | awk '/^Mem:/ {print $7}')"
    if [[ -n "${avail_mb:-}" && "$avail_mb" -lt 800 ]]; then
      yellow "Warning: low available RAM (${avail_mb} MiB). Builds may be slow or OOM."
    fi
  fi
  local avail_gb
  avail_gb="$(df -BG / | awk 'NR==2 {gsub(/G/,""); print $4}')"
  if [[ -n "${avail_gb:-}" && "$avail_gb" -lt 5 ]]; then
    die "Less than 5 GiB free on /. Free disk before continuing."
  fi
}

compose_hector() {
  docker compose -p "${HECTOR_COMPOSE_PROJECT:-hector}" \
    -f "$COMPOSE_FILE" \
    --env-file "$HECTOR_ENV_FILE" \
    "$@"
}

ensure_simple_image_vars_in_env() {
  # Soft-normalize production.env image lines to :latest without printing secrets
  local envf="$HECTOR_ENV_FILE"
  if grep -q '^HECTOR_API_IMAGE=' "$envf"; then
    sed -i.bak \
      -e 's|^HECTOR_IMAGE_TAG=.*|HECTOR_IMAGE_TAG=latest|' \
      -e 's|^HECTOR_API_IMAGE=.*|HECTOR_API_IMAGE=hector-api:latest|' \
      -e 's|^HECTOR_WEB_IMAGE=.*|HECTOR_WEB_IMAGE=hector-web:latest|' \
      -e 's|^HECTOR_MIGRATE_IMAGE=.*|HECTOR_MIGRATE_IMAGE=hector-api-migrate:latest|' \
      "$envf"
    rm -f "${envf}.bak"
    chmod 600 "$envf"
  fi
  export HECTOR_IMAGE_TAG=latest
  export HECTOR_API_IMAGE=hector-api:latest
  export HECTOR_WEB_IMAGE=hector-web:latest
  export HECTOR_MIGRATE_IMAGE=hector-api-migrate:latest
}

build_images() {
  local api_url="${NEXT_PUBLIC_API_URL:-https://core-hector.pishete.com}"
  yellow "Building images sequentially (local tags :latest; never pull from Hub)…"

  # Keep previous tags for app rollback (best-effort)
  docker image inspect hector-api:latest >/dev/null 2>&1 \
    && docker tag hector-api:latest hector-api:previous || true
  docker image inspect hector-web:latest >/dev/null 2>&1 \
    && docker tag hector-web:latest hector-web:previous || true
  docker image inspect hector-api-migrate:latest >/dev/null 2>&1 \
    && docker tag hector-api-migrate:latest hector-api-migrate:previous || true

  docker pull postgres:16-alpine

  yellow "→ hector-api-migrate:latest"
  docker build -f "${REPO_ROOT}/apps/api/Dockerfile" --target migrator \
    -t hector-api-migrate:latest "$REPO_ROOT"

  yellow "→ hector-api:latest"
  docker build -f "${REPO_ROOT}/apps/api/Dockerfile" --target runner \
    -t hector-api:latest "$REPO_ROOT"

  yellow "→ hector-web:latest"
  docker build -f "${REPO_ROOT}/apps/web/Dockerfile" --target runner \
    --build-arg "NEXT_PUBLIC_API_URL=${api_url}" \
    -t hector-web:latest "$REPO_ROOT"

  green "Images ready:"
  docker images --format 'table {{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}' \
    | grep -E 'REPOSITORY|hector-api|hector-web' || true
}

start_postgres() {
  yellow "Starting Hector PostgreSQL…"
  compose_hector up -d postgres
  local i
  for i in $(seq 1 60); do
    if compose_hector exec -T postgres \
      pg_isready -U "${POSTGRES_USER:-hector_app}" -d "${POSTGRES_DB:-hector}" >/dev/null 2>&1; then
      green "PostgreSQL healthy"
      return 0
    fi
    sleep 2
  done
  die "PostgreSQL did not become healthy"
}

backup_before_migrate() {
  mkdir -p "${HECTOR_BACKUP_DIR}/daily" "${HECTOR_BACKUP_DIR}/evidence"
  chmod 700 "${HECTOR_BACKUP_DIR}" 2>/dev/null || true
  yellow "Taking pre-migration backup…"
  # Local-only pilot acknowledgment (same-server risk)
  if [[ "${HECTOR_BACKUP_ALLOW_LOCAL_ONLY:-}" != "I_ACCEPT_SAME_SERVER_RISK" \
     && -z "${HECTOR_BACKUP_OFFSITE_RSYNC:-}" \
     && -z "${HECTOR_BACKUP_OFFSITE_CMD:-}" ]]; then
    yellow "No offsite configured — enabling same-server backup acknowledgment for this host."
    yellow "WARNING: disk loss can destroy DB and backups together. Copy dumps off-box when you can."
    if ! grep -q '^HECTOR_BACKUP_ALLOW_LOCAL_ONLY=' "$HECTOR_ENV_FILE"; then
      printf '\nHECTOR_BACKUP_ALLOW_LOCAL_ONLY=I_ACCEPT_SAME_SERVER_RISK\n' >>"$HECTOR_ENV_FILE"
      chmod 600 "$HECTOR_ENV_FILE"
    fi
    export HECTOR_BACKUP_ALLOW_LOCAL_ONLY=I_ACCEPT_SAME_SERVER_RISK
  fi

  "${PROD_SCRIPTS}/backup.sh"
  local latest
  latest="$(ls -1t "${HECTOR_BACKUP_DIR}/daily"/hector-*.dump 2>/dev/null | head -n1 || true)"
  [[ -n "$latest" && -s "$latest" ]] || die "Backup file missing after backup.sh"
  yellow "Verifying backup restore (disposable)…"
  "${PROD_SCRIPTS}/restore-verify.sh" "$latest"

  if [[ "${HECTOR_BACKUP_GATE:-}" != "verified" ]]; then
    export HECTOR_PRODUCTION_CONFIRM=I_UNDERSTAND_PRODUCTION
    "${PROD_SCRIPTS}/mark-backup-gate.sh" --apply
    load_env_file
  fi
  green "Backup gate ready (HECTOR_BACKUP_GATE=${HECTOR_BACKUP_GATE:-unknown})"
}

run_migrate() {
  yellow "Running prisma migrate deploy…"
  compose_hector up -d postgres
  compose_hector run --rm --no-deps migrate
  green "Migrations applied"
}

start_apps() {
  yellow "Starting API + Web…"
  compose_hector up -d api web
  local deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do
    if curl -fsS "http://127.0.0.1:${HECTOR_API_HOST_PORT:-3101}/health" >/dev/null 2>&1 \
      && curl -fsS "http://127.0.0.1:${HECTOR_WEB_HOST_PORT:-3100}/health" >/dev/null 2>&1; then
      green "API + Web healthy"
      return 0
    fi
    sleep 5
  done
  compose_hector ps
  die "API/Web health checks failed — see: docker compose -p hector logs api web"
}

rollback_app_images() {
  yellow "Rolling back API/Web images to :previous (DB untouched)…"
  docker image inspect hector-api:previous >/dev/null 2>&1 || die "No hector-api:previous image"
  docker image inspect hector-web:previous >/dev/null 2>&1 || die "No hector-web:previous image"
  docker tag hector-api:previous hector-api:latest
  docker tag hector-web:previous hector-web:latest
  compose_hector up -d --force-recreate api web
  yellow "Rolled back app containers. Database was not restored automatically."
}

print_status() {
  echo
  green "=== Hector status ==="
  compose_hector ps
  echo
  echo "Web (loopback):  http://127.0.0.1:${HECTOR_WEB_HOST_PORT:-3100}/health"
  echo "API (loopback):  http://127.0.0.1:${HECTOR_API_HOST_PORT:-3101}/health"
  echo "Frontend URL:    https://hector.pishete.com"
  echo "API URL:         https://core-hector.pishete.com"
  echo "Env file:        ${HECTOR_ENV_FILE}"
  echo "Compose:         -p hector -f infra/production/compose.shared-host.yaml"
  echo
  yellow "Logs:  docker compose -p hector -f infra/production/compose.shared-host.yaml --env-file ${HECTOR_ENV_FILE} logs -f api web"
  yellow "Backup: ${PROD_SCRIPTS}/backup.sh"
}
