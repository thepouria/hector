#!/usr/bin/env bash
# Shared helpers for Hector production scripts.
# Supports DEPLOYMENT_MODE=dedicated | shared-host

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PROD_DIR}/../.." && pwd)"
COMPOSE_DEDICATED="${PROD_DIR}/compose.yaml"
COMPOSE_SHARED="${PROD_DIR}/compose.shared-host.yaml"
DEFAULT_ENV_FILE="${PROD_DIR}/env/production.env"

# Forbidden Compose / Docker project names (never target these).
FORBIDDEN_PROJECTS=(bazarbashe current empire)

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

die() {
  red "ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

resolve_deployment_mode() {
  local mode="${DEPLOYMENT_MODE:-${HECTOR_DEPLOYMENT_MODE:-}}"
  if [[ -z "$mode" ]]; then
    if [[ "${HECTOR_ALLOW_ISOLATED:-}" == "1" ]]; then
      # Isolated smoke may set mode explicitly; default dedicated for legacy smoke.
      mode="${HECTOR_SMOKE_MODE:-dedicated}"
    else
      die "DEPLOYMENT_MODE is required (dedicated|shared-host). No ambiguous production default."
    fi
  fi
  case "$mode" in
    dedicated|shared-host) ;;
    *) die "Invalid DEPLOYMENT_MODE='$mode' (expected dedicated|shared-host)" ;;
  esac
  DEPLOYMENT_MODE="$mode"
  export DEPLOYMENT_MODE
}

resolve_compose_project() {
  resolve_deployment_mode
  if [[ -n "${COMPOSE_PROJECT_NAME:-}" ]]; then
    HECTOR_COMPOSE_PROJECT="$COMPOSE_PROJECT_NAME"
  elif [[ -n "${HECTOR_COMPOSE_PROJECT:-}" ]]; then
    :
  elif [[ "${HECTOR_ALLOW_ISOLATED:-}" == "1" ]]; then
    if [[ "$DEPLOYMENT_MODE" == "shared-host" ]]; then
      HECTOR_COMPOSE_PROJECT="${HECTOR_SMOKE_PROJECT:-hector-smoke-shared}"
    else
      HECTOR_COMPOSE_PROJECT="${HECTOR_SMOKE_PROJECT:-hector-smoke}"
    fi
  else
    if [[ "$DEPLOYMENT_MODE" == "shared-host" ]]; then
      HECTOR_COMPOSE_PROJECT="hector"
    else
      HECTOR_COMPOSE_PROJECT="hector-production"
    fi
  fi
  export HECTOR_COMPOSE_PROJECT
  assert_safe_project "$HECTOR_COMPOSE_PROJECT"
}

assert_safe_project() {
  local project="$1"
  [[ -n "$project" ]] || die "Compose project name is empty"
  local forbidden
  for forbidden in "${FORBIDDEN_PROJECTS[@]}"; do
    if [[ "$project" == "$forbidden" ]]; then
      die "Refusing to operate on forbidden Compose project: $project"
    fi
  done
  # Never allow empty/global targeting
  if [[ "$project" == "*" || "$project" == "all" ]]; then
    die "Refusing unsafe Compose project name: $project"
  fi
}

compose_files() {
  resolve_deployment_mode
  local -a files=()
  if [[ "$DEPLOYMENT_MODE" == "shared-host" ]]; then
    files=(-f "$COMPOSE_SHARED")
  else
    files=(-f "$COMPOSE_DEDICATED")
  fi
  if [[ -n "${HECTOR_COMPOSE_OVERRIDE:-}" ]]; then
    files+=(-f "$HECTOR_COMPOSE_OVERRIDE")
  fi
  printf '%s\n' "${files[@]}"
}

compose() {
  resolve_compose_project
  local env_file="${HECTOR_ENV_FILE:-$DEFAULT_ENV_FILE}"
  local -a files=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && files+=("$line")
  done < <(compose_files)
  docker compose -p "$HECTOR_COMPOSE_PROJECT" "${files[@]}" --env-file "$env_file" "$@"
}

app_services() {
  resolve_deployment_mode
  if [[ "$DEPLOYMENT_MODE" == "shared-host" ]]; then
    echo "api web"
  else
    echo "api web nginx"
  fi
}

is_placeholder() {
  local value="${1:-}"
  [[ -z "$value" ]] && return 0
  [[ "$value" == REPLACE_* ]] && return 0
  [[ "$value" == *REPLACE_WITH* ]] && return 0
  [[ "$value" == *change-me* ]] && return 0
  [[ "$value" == *CHANGE_ME* ]] && return 0
  return 1
}

require_production_confirm() {
  if [[ "${HECTOR_ALLOW_ISOLATED:-}" == "1" ]]; then
    yellow "Isolated mode (HECTOR_ALLOW_ISOLATED=1) — production confirm skipped."
    return 0
  fi
  if [[ "${HECTOR_PRODUCTION_CONFIRM:-}" != "I_UNDERSTAND_PRODUCTION" ]]; then
    die "Refusing production-targeted action. Set HECTOR_PRODUCTION_CONFIRM=I_UNDERSTAND_PRODUCTION (or HECTOR_ALLOW_ISOLATED=1 for local smoke)."
  fi
}

require_backup_gate_for_migrate() {
  if [[ "${HECTOR_ALLOW_ISOLATED:-}" == "1" ]]; then
    return 0
  fi
  if [[ "${HECTOR_BACKUP_GATE:-}" != "verified" ]]; then
    die "Backup gate not verified (HECTOR_BACKUP_GATE=verified required). PR-001 backup system is a production rollout dependency."
  fi
}

load_env_file() {
  local env_file="${HECTOR_ENV_FILE:-$DEFAULT_ENV_FILE}"
  [[ -f "$env_file" ]] || die "Env file not found: $env_file"
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
  # Env file may set DEPLOYMENT_MODE; re-resolve after load.
  if [[ -n "${DEPLOYMENT_MODE:-}" || -n "${HECTOR_DEPLOYMENT_MODE:-}" ]]; then
    resolve_deployment_mode
  fi
}

service_cid() {
  compose ps -q "$1" 2>/dev/null | head -n1
}

service_health() {
  local cid
  cid="$(service_cid "$1")"
  if [[ -z "$cid" ]]; then
    echo "missing"
    return
  fi
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo "unknown"
}

service_image() {
  local cid
  cid="$(service_cid "$1")"
  [[ -n "$cid" ]] || { echo "n/a"; return; }
  docker inspect --format '{{.Config.Image}}' "$cid" 2>/dev/null || echo "n/a"
}

service_restarts() {
  local cid
  cid="$(service_cid "$1")"
  [[ -n "$cid" ]] || { echo "n/a"; return; }
  docker inspect --format '{{.RestartCount}}' "$cid" 2>/dev/null || echo "n/a"
}

# Returns 0 if IP:PORT is free OR owned by a container in HECTOR_COMPOSE_PROJECT.
assert_loopback_port_available() {
  local ip="$1"
  local port="$2"
  local label="$3"
  resolve_compose_project

  local listeners=""
  if command -v lsof >/dev/null 2>&1; then
    # Portable: match LISTEN on this port, then require loopback / exact IP in the address.
    listeners="$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | awk -v ip="$ip" '
      NR==1 {next}
      {
        addr=$9
        # Examples: 127.0.0.1:3100  *:3100  [::1]:3100
        if (addr ~ (ip ":" port "$") || (ip=="127.0.0.1" && addr ~ /^127\.0\.0\.1:/) || (ip=="127.0.0.1" && addr ~ /^\*:/)) {
          print
        }
      }' port="$port" || true)"
    # Fallback without awk filter if nothing matched but something listens on the port at all on loopback
    if [[ -z "$listeners" ]]; then
      listeners="$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | grep -E "127\.0\.0\.1:${port}|\\*:${port}|\\[::1\\]:${port}" || true)"
    fi
  elif command -v ss >/dev/null 2>&1; then
    listeners="$(ss -ltn "( sport = :${port} )" 2>/dev/null | grep -E "${ip}|0.0.0.0|\\*" || true)"
  fi

  if [[ -z "$listeners" ]]; then
    return 0
  fi

  # Allow if our project's published port already owns it (upgrade path).
  local cid
  for svc in api web; do
    cid="$(service_cid "$svc" || true)"
    if [[ -n "$cid" ]]; then
      if docker port "$cid" 2>/dev/null | grep -q "${ip}:${port}"; then
        yellow "$label ${ip}:${port} already owned by Hector service '$svc' (upgrade OK)."
        return 0
      fi
    fi
  done

  red "$label port conflict: ${ip}:${port} is already in use by an unrelated process."
  echo "$listeners" >&2
  die "Set HECTOR_WEB_HOST_PORT / HECTOR_API_HOST_PORT explicitly. Do not kill the process."
}

assert_bind_is_loopback() {
  local ip="$1"
  local name="$2"
  if [[ "$ip" != "127.0.0.1" && "$ip" != "::1" ]]; then
    die "$name must bind to loopback (127.0.0.1), got: $ip"
  fi
}

resolved_compose_yaml() {
  compose config
}

assert_shared_host_resolved_config() {
  local cfg_json
  if cfg_json="$(compose config --format json 2>/dev/null)"; then
    printf '%s' "$cfg_json" | python3 -c '
import json, sys
cfg = json.load(sys.stdin)
services = cfg.get("services") or {}
if "nginx" in services:
    raise SystemExit("nginx service present in shared-host resolved config")
pg = services.get("postgres") or {}
if pg.get("ports"):
    raise SystemExit("postgres publishes ports in shared-host resolved config")
for name in ("api", "web"):
    svc = services.get(name) or {}
    ports = svc.get("ports") or []
    if not ports:
        raise SystemExit(f"{name} missing published ports")
    for p in ports:
        hip = p.get("host_ip") or ""
        published = str(p.get("published") or "")
        if hip and hip not in ("127.0.0.1", "::1"):
            raise SystemExit(f"{name} host_ip must be loopback, got {hip}")
        if published in ("80", "443"):
            raise SystemExit(f"{name} must not publish {published}")
print("ok")
' || die "Shared-host resolved Compose security checks failed"
  else
    local cfg
    cfg="$(resolved_compose_yaml)"
    echo "$cfg" | grep -Eq '^  nginx:' && die "Resolved shared-host config still contains nginx service"
    yellow "Compose JSON format unavailable; YAML nginx check only."
  fi
  green "Resolved shared-host Compose: no nginx, loopback API/Web, postgres private."
}
