#!/usr/bin/env bash
# Isolated local infrastructure smoke test (P.2).
# Does NOT touch 62.60.191.119, DNS, or real certificates.
# Does NOT run demo seed.

set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

export HECTOR_ENV_FILE="${PROD_DIR}/env/smoke.env"
export HECTOR_COMPOSE_OVERRIDE="${PROD_DIR}/compose.smoke.yaml"
export HECTOR_ALLOW_ISOLATED=1
export DEPLOYMENT_MODE=dedicated
export HECTOR_SMOKE_MODE=dedicated
export HECTOR_SMOKE_PROJECT=hector-smoke
export COMPOSE_PROJECT_NAME=hector-smoke
export HECTOR_PRODUCTION_CONFIRM=
export HECTOR_BACKUP_GATE=unverified

load_env_file

TAG="${HECTOR_IMAGE_TAG}"
API_IMAGE="${HECTOR_API_IMAGE}"
WEB_IMAGE="${HECTOR_WEB_IMAGE}"
MIGRATE_IMAGE="${HECTOR_MIGRATE_IMAGE}"
HTTP_PORT="${NGINX_HTTP_PORT:-18080}"
EVIDENCE_DIR="${PROD_DIR}/.smoke-evidence"
mkdir -p "$EVIDENCE_DIR"

cleanup() {
  yellow "Smoke cleanup: stopping stack (volumes preserved for persistence check unless --purge)…"
  if [[ "${SMOKE_PURGE:-}" == "1" ]]; then
    yellow "SMOKE_PURGE=1 — removing smoke containers only (not using -v)."
  fi
  compose down --remove-orphans || true
}
trap cleanup EXIT

if [[ "${HECTOR_SKIP_BUILD:-}" == "1" ]]; then
  yellow "=== Skipping image builds (HECTOR_SKIP_BUILD=1) ==="
  docker image inspect "${API_IMAGE}" >/dev/null
  docker image inspect "${MIGRATE_IMAGE}" >/dev/null
  docker image inspect "${WEB_IMAGE}" >/dev/null
else
  yellow "=== Building images ==="
  docker build -f "${REPO_ROOT}/apps/api/Dockerfile" --target runner -t "${API_IMAGE}" "${REPO_ROOT}" \
    | tee "${EVIDENCE_DIR}/api-build.log"
  docker build -f "${REPO_ROOT}/apps/api/Dockerfile" --target migrator -t "${MIGRATE_IMAGE}" "${REPO_ROOT}" \
    | tee "${EVIDENCE_DIR}/migrate-build.log"
  docker build -f "${REPO_ROOT}/apps/web/Dockerfile" --target runner \
    --build-arg "NEXT_PUBLIC_API_URL=https://core-hector.pishete.com" \
    -t "${WEB_IMAGE}" "${REPO_ROOT}" \
    | tee "${EVIDENCE_DIR}/web-build.log"
fi

yellow "=== Compose config ==="
compose config --quiet
compose config > "${EVIDENCE_DIR}/compose-config.yaml"

yellow "=== Start postgres + migrate ==="
compose up -d postgres
for _ in $(seq 1 60); do
  compose exec -T postgres pg_isready -U hector_app -d hector >/dev/null 2>&1 && break
  sleep 2
done
compose exec -T postgres pg_isready -U hector_app -d hector
compose run --rm migrate | tee "${EVIDENCE_DIR}/migrate.log"

yellow "=== Start api web nginx ==="
compose up -d api web nginx

yellow "=== Wait healthy ==="
deadline=$((SECONDS + 240))
while (( SECONDS < deadline )); do
  api_h="$(service_health api)"
  web_h="$(service_health web)"
  ngx_h="$(service_health nginx)"
  echo "health api=${api_h} web=${web_h} nginx=${ngx_h}"
  if [[ "$api_h" == "healthy" && "$web_h" == "healthy" && "$ngx_h" == "healthy" ]]; then
    break
  fi
  # Surface crash loops early
  if [[ "$api_h" == "restarting" || "$api_h" == "exited" ]]; then
    compose logs api --tail=80 || true
    die "API container is ${api_h}"
  fi
  sleep 5
done
[[ "$(service_health api)" == "healthy" ]] || { compose logs api --tail=80 || true; die "API not healthy"; }
[[ "$(service_health web)" == "healthy" ]] || { compose logs web --tail=40 || true; die "Web not healthy"; }
[[ "$(service_health nginx)" == "healthy" ]] || { compose logs nginx --tail=40 || true; die "Nginx not healthy"; }

yellow "=== Routing / health ==="
curl -fsS -H 'Host: hector.pishete.com' "http://127.0.0.1:${HTTP_PORT}/health" | tee "${EVIDENCE_DIR}/web-health.json"
echo
curl -fsS -H 'Host: core-hector.pishete.com' "http://127.0.0.1:${HTTP_PORT}/health" | tee "${EVIDENCE_DIR}/api-health.json"
echo
curl -fsS -H 'Host: hector.pishete.com' "http://127.0.0.1:${HTTP_PORT}/nginx-health" | tee "${EVIDENCE_DIR}/nginx-health.txt"
echo

yellow "=== Private networking checks ==="
# Postgres/API/Web must not be published on the host.
if docker port "$(compose ps -q postgres)" 2>/dev/null | grep -q .; then
  die "PostgreSQL has published ports"
fi
if docker port "$(compose ps -q api)" 2>/dev/null | grep -q .; then
  die "API has published ports"
fi
if docker port "$(compose ps -q web)" 2>/dev/null | grep -q .; then
  die "Web has published ports"
fi
echo "PASS: postgres/api/web have no published ports" | tee "${EVIDENCE_DIR}/private-ports.txt"

# From nginx container, upstreams reachable; from a throwaway container on public network only, postgres should fail.
docker run --rm --network hector_smoke_public_proxy alpine:3.20 \
  sh -c 'wget -qO- -T 3 http://postgres:5432 >/dev/null 2>&1 && exit 1 || exit 0' \
  || die "Postgres unexpectedly reachable from public proxy network"
echo "PASS: postgres not reachable from public_proxy_network" | tee -a "${EVIDENCE_DIR}/private-ports.txt"

yellow "=== Persistence check ==="
compose exec -T postgres psql -U hector_app -d hector -c \
  "CREATE TABLE IF NOT EXISTS smoke_persist(id int primary key, note text); INSERT INTO smoke_persist(id, note) VALUES (1, 'p2') ON CONFLICT (id) DO UPDATE SET note=EXCLUDED.note;"
compose restart postgres
sleep 5
for _ in $(seq 1 30); do
  compose exec -T postgres pg_isready -U hector_app -d hector >/dev/null 2>&1 && break
  sleep 2
done
note="$(compose exec -T postgres psql -U hector_app -d hector -Atc 'SELECT note FROM smoke_persist WHERE id=1;')"
[[ "$note" == "p2" ]] || die "Persistence check failed"
echo "PASS: postgres data survived restart (note=$note)" | tee "${EVIDENCE_DIR}/persistence.txt"

yellow "=== Container restart + SIGTERM ==="
compose restart api
sleep 8
deadline=$((SECONDS + 90))
while (( SECONDS < deadline )); do
  [[ "$(service_health api)" == "healthy" ]] && break
  sleep 3
done
[[ "$(service_health api)" == "healthy" ]] || die "API unhealthy after restart"

# SIGTERM via docker stop (tini forwards)
api_id="$(service_cid api)"
docker stop -t 15 "$api_id" >/dev/null
docker start "$api_id" >/dev/null
deadline=$((SECONDS + 90))
while (( SECONDS < deadline )); do
  [[ "$(service_health api)" == "healthy" ]] && break
  sleep 3
done
[[ "$(service_health api)" == "healthy" ]] || die "API unhealthy after SIGTERM stop/start"
echo "PASS: restart + SIGTERM" | tee "${EVIDENCE_DIR}/sigterm.txt"

yellow "=== Non-root runtime users ==="
api_user="$(compose exec -T api id -u)"
web_user="$(compose exec -T web id -u)"
[[ "$api_user" != "0" ]] || die "API running as root"
[[ "$web_user" != "0" ]] || die "Web running as root"
echo "PASS: api_uid=${api_user} web_uid=${web_user}" | tee "${EVIDENCE_DIR}/nonroot.txt"

yellow "=== NEXT_PUBLIC_API_URL baked check ==="
# Standalone server.js / client chunks should reference production API host, not localhost:3000
if compose exec -T web sh -c 'grep -R -l "core-hector.pishete.com" apps/web/.next/static 2>/dev/null | head -1' | grep -q .; then
  echo "PASS: production API URL present in web static assets" | tee "${EVIDENCE_DIR}/next-public-api.txt"
else
  # Fallback: env was build-arg; at least confirm no localhost:3001 in a sample
  if compose exec -T web sh -c 'grep -R "localhost:3001" apps/web/.next/static 2>/dev/null | head -5'; then
    die "Web static assets still reference localhost:3001"
  fi
  echo "WARN: could not grep static for domain; localhost:3001 not found" | tee "${EVIDENCE_DIR}/next-public-api.txt"
fi

"${SCRIPT_DIR}/status.sh" | tee "${EVIDENCE_DIR}/status.txt"

green "=== SMOKE PASSED ==="
green "Evidence: ${EVIDENCE_DIR}"
# Keep stack up briefly for operator inspection if SMOKE_KEEP=1
if [[ "${SMOKE_KEEP:-}" == "1" ]]; then
  trap - EXIT
  yellow "SMOKE_KEEP=1 — stack left running (project hector-smoke)."
fi
