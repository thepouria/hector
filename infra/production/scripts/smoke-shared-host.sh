#!/usr/bin/env bash
# Isolated shared-host smoke (P.2.1).
# Project: hector-smoke-shared only. Never touches hector/bazarbashe/current/empire.
# Does NOT SSH, change DNS, request certs, or run demo seed.

set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

export HECTOR_ENV_FILE="${PROD_DIR}/env/smoke.shared-host.env"
export HECTOR_COMPOSE_OVERRIDE="${PROD_DIR}/compose.shared-host.smoke.yaml"
export HECTOR_ALLOW_ISOLATED=1
export DEPLOYMENT_MODE=shared-host
export HECTOR_SMOKE_MODE=shared-host
export HECTOR_SMOKE_PROJECT=hector-smoke-shared
export COMPOSE_PROJECT_NAME=hector-smoke-shared
export HECTOR_PRODUCTION_CONFIRM=
export HECTOR_BACKUP_GATE=unverified

load_env_file
resolve_deployment_mode
resolve_compose_project

[[ "$HECTOR_COMPOSE_PROJECT" == "hector-smoke-shared" ]] \
  || die "Refusing smoke with unexpected project: $HECTOR_COMPOSE_PROJECT"

TAG="${HECTOR_IMAGE_TAG}"
API_IMAGE="${HECTOR_API_IMAGE}"
WEB_IMAGE="${HECTOR_WEB_IMAGE}"
MIGRATE_IMAGE="${HECTOR_MIGRATE_IMAGE}"
WEB_HOST_PORT="${HECTOR_WEB_HOST_PORT:-13100}"
API_HOST_PORT="${HECTOR_API_HOST_PORT:-13101}"
EVIDENCE_DIR="${PROD_DIR}/.smoke-evidence-shared"
mkdir -p "$EVIDENCE_DIR"

cleanup() {
  yellow "Smoke cleanup: project=${HECTOR_COMPOSE_PROJECT} only (no -v; no global prune)…"
  assert_safe_project "$HECTOR_COMPOSE_PROJECT"
  [[ "$HECTOR_COMPOSE_PROJECT" == "hector-smoke-shared" ]] || die "Cleanup abort: unexpected project"
  compose down --remove-orphans || true
}
trap cleanup EXIT

"${SCRIPT_DIR}/preflight.sh" local | tee "${EVIDENCE_DIR}/preflight.txt"

if [[ "${HECTOR_SKIP_BUILD:-}" == "1" ]]; then
  yellow "=== Skipping image builds ==="
  docker image inspect "${API_IMAGE}" >/dev/null
  docker image inspect "${MIGRATE_IMAGE}" >/dev/null
  docker image inspect "${WEB_IMAGE}" >/dev/null
else
  yellow "=== Building images ==="
  docker build -f "${REPO_ROOT}/apps/api/Dockerfile" --target runner -t "${API_IMAGE}" "${REPO_ROOT}"
  docker build -f "${REPO_ROOT}/apps/api/Dockerfile" --target migrator -t "${MIGRATE_IMAGE}" "${REPO_ROOT}"
  docker build -f "${REPO_ROOT}/apps/web/Dockerfile" --target runner \
    --build-arg "NEXT_PUBLIC_API_URL=https://core-hector.pishete.com" \
    -t "${WEB_IMAGE}" "${REPO_ROOT}"
fi

yellow "=== Compose config (resolved) ==="
compose config --quiet
compose config > "${EVIDENCE_DIR}/compose-config.yaml"
assert_shared_host_resolved_config | tee "${EVIDENCE_DIR}/resolved-security.txt"

# Confirm no nginx service in project
compose config --services | tee "${EVIDENCE_DIR}/services.txt"
compose config --services | grep -qx nginx && die "nginx must not be in shared-host services"

yellow "=== Start postgres + migrate ==="
compose up -d postgres
for _ in $(seq 1 60); do
  compose exec -T postgres pg_isready -U hector_app -d hector >/dev/null 2>&1 && break
  sleep 2
done
compose exec -T postgres pg_isready -U hector_app -d hector
compose run --rm migrate | tee "${EVIDENCE_DIR}/migrate.log"

yellow "=== Start api + web (no nginx) ==="
compose up -d api web

deadline=$((SECONDS + 240))
while (( SECONDS < deadline )); do
  api_h="$(service_health api)"
  web_h="$(service_health web)"
  echo "health api=${api_h} web=${web_h}"
  if [[ "$api_h" == "healthy" && "$web_h" == "healthy" ]]; then
    break
  fi
  if [[ "$api_h" == "restarting" || "$api_h" == "exited" ]]; then
    compose logs api --tail=80 || true
    die "API ${api_h}"
  fi
  sleep 5
done
[[ "$(service_health api)" == "healthy" ]] || die "API not healthy"
[[ "$(service_health web)" == "healthy" ]] || die "Web not healthy"

yellow "=== Loopback health ==="
curl -fsS "http://127.0.0.1:${WEB_HOST_PORT}/health" | tee "${EVIDENCE_DIR}/web-health.json"
echo
curl -fsS "http://127.0.0.1:${API_HOST_PORT}/health" | tee "${EVIDENCE_DIR}/api-health.json"
echo

yellow "=== Binding isolation ==="
# Published ports must be 127.0.0.1 only
api_ports="$(docker port "$(service_cid api)")"
web_ports="$(docker port "$(service_cid web)")"
echo "$api_ports" | tee "${EVIDENCE_DIR}/api-ports.txt"
echo "$web_ports" | tee "${EVIDENCE_DIR}/web-ports.txt"
echo "$api_ports" | grep -q '127.0.0.1:' || die "API not bound to 127.0.0.1"
echo "$web_ports" | grep -q '127.0.0.1:' || die "Web not bound to 127.0.0.1"
echo "$api_ports" | grep -E '0\.0\.0\.0:|:::' && die "API published on non-loopback"
echo "$web_ports" | grep -E '0\.0\.0\.0:|:::' && die "Web published on non-loopback"
docker port "$(service_cid postgres)" 2>/dev/null | grep -q . && die "PostgreSQL has published ports"
echo "PASS: loopback-only API/Web; postgres private" | tee "${EVIDENCE_DIR}/private-ports.txt"

# Ensure we did not create a containerized nginx
docker ps -a --filter "label=com.docker.compose.project=${HECTOR_COMPOSE_PROJECT}" --format '{{.Names}}' \
  | tee "${EVIDENCE_DIR}/project-containers.txt"
docker ps -a --filter "label=com.docker.compose.project=${HECTOR_COMPOSE_PROJECT}" --format '{{.Names}}' \
  | grep -qi nginx && die "Found nginx container under Hector smoke project"

"${SCRIPT_DIR}/status.sh" | tee "${EVIDENCE_DIR}/status.txt"

green "=== SHARED-HOST SMOKE PASSED ==="
green "Evidence: ${EVIDENCE_DIR}"
if [[ "${SMOKE_KEEP:-}" == "1" ]]; then
  trap - EXIT
  yellow "SMOKE_KEEP=1 — stack left running (project hector-smoke-shared)."
fi
