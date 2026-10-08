#!/usr/bin/env bash
# Validate host prerequisites and Compose configuration before deploy.
# Modes: local | production
# Requires DEPLOYMENT_MODE=dedicated|shared-host (or isolated smoke defaults).

set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

MODE="${1:-local}" # local | production

require_cmd docker
docker info >/dev/null 2>&1 || die "Docker daemon is not reachable"
docker compose version >/dev/null 2>&1 || die "Docker Compose V2 plugin is not available"

# Prefer Compose V2; do not touch Compose V1.
compose_ver="$(docker compose version --short 2>/dev/null || docker compose version | head -n1)"
yellow "Docker Compose V2: ${compose_ver}"

load_env_file
resolve_deployment_mode
resolve_compose_project

yellow "DEPLOYMENT_MODE=${DEPLOYMENT_MODE} project=${HECTOR_COMPOSE_PROJECT}"

[[ -f "${REPO_ROOT}/apps/api/Dockerfile" ]] || die "Missing API Dockerfile"
[[ -f "${REPO_ROOT}/apps/web/Dockerfile" ]] || die "Missing Web Dockerfile"

if [[ "$DEPLOYMENT_MODE" == "shared-host" ]]; then
  [[ -f "$COMPOSE_SHARED" ]] || die "Missing shared-host compose: $COMPOSE_SHARED"
  [[ -f "${PROD_DIR}/host-nginx/hector.pishete.com.conf" ]] || die "Missing host Nginx web template"
  [[ -f "${PROD_DIR}/host-nginx/core-hector.pishete.com.conf" ]] || die "Missing host Nginx API template"
else
  [[ -f "$COMPOSE_DEDICATED" ]] || die "Missing dedicated compose: $COMPOSE_DEDICATED"
  [[ -f "${PROD_DIR}/nginx/nginx.conf" ]] || die "Missing nginx.conf"
  [[ -f "${PROD_DIR}/nginx/conf.d/hector.conf" ]] || die "Missing hector.conf"
fi

[[ -n "${HECTOR_IMAGE_TAG:-}" ]] || die "HECTOR_IMAGE_TAG is required"
is_placeholder "${HECTOR_IMAGE_TAG}" && die "HECTOR_IMAGE_TAG looks like a placeholder"

is_placeholder "${JWT_ACCESS_SECRET:-}" && die "JWT_ACCESS_SECRET is missing or a placeholder"
[[ "${#JWT_ACCESS_SECRET}" -ge 32 ]] || die "JWT_ACCESS_SECRET must be at least 32 characters"
is_placeholder "${AUTH_REFRESH_PEPPER:-}" && die "AUTH_REFRESH_PEPPER is missing or a placeholder"
[[ "${#AUTH_REFRESH_PEPPER}" -ge 32 ]] || die "AUTH_REFRESH_PEPPER must be at least 32 characters"
[[ "${AUTH_REFRESH_PEPPER}" != "${JWT_ACCESS_SECRET}" ]] || die "AUTH_REFRESH_PEPPER must differ from JWT_ACCESS_SECRET"

is_placeholder "${POSTGRES_PASSWORD:-}" && die "POSTGRES_PASSWORD is missing or a placeholder"
is_placeholder "${DATABASE_URL:-}" && die "DATABASE_URL is missing or a placeholder"
is_placeholder "${DATABASE_URL_MIGRATE:-}" && die "DATABASE_URL_MIGRATE is missing or a placeholder"

[[ "${CORS_ORIGINS:-}" == *"hector.pishete.com"* ]] || die "CORS_ORIGINS must include https://hector.pishete.com"
[[ "${HECTOR_WEB_DOMAIN:-}" == "hector.pishete.com" ]] || die "HECTOR_WEB_DOMAIN must be hector.pishete.com"
[[ "${HECTOR_API_DOMAIN:-}" == "core-hector.pishete.com" ]] || die "HECTOR_API_DOMAIN must be core-hector.pishete.com"

# --- Resource report (informational) ---
MIN_DISK_GB="${HECTOR_PREFLIGHT_MIN_DISK_GB:-5}"
MIN_RAM_MB="${HECTOR_PREFLIGHT_MIN_RAM_MB:-1024}"

yellow "=== Resource report ==="
if [[ "$(uname -s)" == "Darwin" ]]; then
  yellow "CPU (logical): $(sysctl -n hw.ncpu 2>/dev/null || echo unknown)"
  yellow "Total RAM: $(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.1f GiB", $1/1024/1024/1024}' || echo unknown)"
else
  yellow "CPU (logical): $(nproc 2>/dev/null || echo unknown)"
  if [[ -r /proc/meminfo ]]; then
    awk '/MemTotal|MemAvailable|SwapTotal|SwapFree/{print}' /proc/meminfo | while read -r line; do yellow "$line"; done
  fi
fi
if command -v df >/dev/null 2>&1; then
  df -h / | while read -r line; do yellow "disk: $line"; done
fi
if command -v docker >/dev/null 2>&1; then
  docker system df 2>/dev/null | while read -r line; do yellow "docker-df: $line"; done || true
fi

# Disk threshold (hard fail in production; warn-only in isolated smoke)
if command -v df >/dev/null 2>&1 && [[ "$MIN_DISK_GB" -gt 0 ]]; then
  avail_kb="$(df -Pk / | awk 'NR==2 {print $4}')"
  need_kb=$((MIN_DISK_GB * 1024 * 1024))
  if [[ "${avail_kb:-0}" -lt "$need_kb" ]]; then
    msg="Insufficient disk: need ≥${MIN_DISK_GB}GiB free on / (HECTOR_PREFLIGHT_MIN_DISK_GB); have $((avail_kb/1024))MiB reported"
    if [[ "${HECTOR_ALLOW_ISOLATED:-}" == "1" ]]; then
      yellow "Warning: $msg"
    else
      die "$msg"
    fi
  fi
fi

# RAM threshold (Linux MemAvailable; hard fail in production)
if [[ -r /proc/meminfo ]]; then
  avail_mb="$(awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo)"
  yellow "MemAvailable: ${avail_mb} MiB (threshold ${MIN_RAM_MB} MiB)"
  if [[ "${MIN_RAM_MB}" -gt 0 && "${avail_mb:-0}" -lt "$MIN_RAM_MB" ]]; then
    msg="Insufficient available RAM: need ≥${MIN_RAM_MB} MiB (HECTOR_PREFLIGHT_MIN_RAM_MB)"
    if [[ "${HECTOR_ALLOW_ISOLATED:-}" == "1" ]]; then
      yellow "Warning: $msg"
    else
      die "$msg"
    fi
  fi
else
  yellow "MemAvailable check skipped on this OS (threshold ${MIN_RAM_MB} MiB applies on Linux hosts)."
fi

# --- Mode-specific port / binding checks ---
if [[ "$DEPLOYMENT_MODE" == "shared-host" ]]; then
  WEB_IP="${HECTOR_WEB_BIND_IP:-127.0.0.1}"
  API_IP="${HECTOR_API_BIND_IP:-127.0.0.1}"
  WEB_PORT_HOST="${HECTOR_WEB_HOST_PORT:-3100}"
  API_PORT_HOST="${HECTOR_API_HOST_PORT:-3101}"
  assert_bind_is_loopback "$WEB_IP" "HECTOR_WEB_BIND_IP"
  assert_bind_is_loopback "$API_IP" "HECTOR_API_BIND_IP"
  assert_loopback_port_available "$WEB_IP" "$WEB_PORT_HOST" "Web"
  assert_loopback_port_available "$API_IP" "$API_PORT_HOST" "API"
else
  if command -v lsof >/dev/null 2>&1; then
    for port in "${NGINX_HTTP_PORT:-80}" "${NGINX_HTTPS_PORT:-443}"; do
      if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
        yellow "Warning: port $port appears to be in use (dedicated Nginx publish)"
      fi
    done
  fi
fi

yellow "Validating Compose (project=${HECTOR_COMPOSE_PROJECT})…"
compose config --quiet
green "Compose configuration is valid."

if [[ "$DEPLOYMENT_MODE" == "shared-host" ]]; then
  assert_shared_host_resolved_config
fi

if [[ "$MODE" == "production" ]]; then
  require_production_confirm
  yellow "Production mode: DNS checks are informational only…"
  if command -v dig >/dev/null 2>&1; then
    dig +short hector.pishete.com A || true
    dig +short core-hector.pishete.com A || true
  else
    yellow "dig not installed; skip DNS checks"
  fi
  if [[ "${HECTOR_BACKUP_GATE:-}" != "verified" ]]; then
    yellow "HECTOR_BACKUP_GATE is not verified — real migrate+deploy will be blocked (PR-001)."
  fi
fi

green "Preflight OK (mode=$MODE deployment=$DEPLOYMENT_MODE project=$HECTOR_COMPOSE_PROJECT)."
