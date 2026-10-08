#!/usr/bin/env bash
# Reproducible Hector deploy (dedicated | shared-host).
# Prefer prebuilt images on shared production hosts (HECTOR_SKIP_BUILD=1).
# Never target 62.60.191.119 from isolated/smoke flows.

set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

load_env_file
resolve_deployment_mode
resolve_compose_project
require_production_confirm

TAG="${HECTOR_IMAGE_TAG:?HECTOR_IMAGE_TAG is required}"
API_IMAGE="${HECTOR_API_IMAGE:-hector-api:${TAG}}"
WEB_IMAGE="${HECTOR_WEB_IMAGE:-hector-web:${TAG}}"
MIGRATE_IMAGE="${HECTOR_MIGRATE_IMAGE:-hector-api-migrate:${TAG}}"
API_URL_BUILD="${NEXT_PUBLIC_API_URL:-https://core-hector.pishete.com}"

yellow "=== Hector deploy ==="
yellow "mode=${DEPLOYMENT_MODE} project=${HECTOR_COMPOSE_PROJECT} tag=${TAG}"

if [[ "${HECTOR_ALLOW_ISOLATED:-}" == "1" ]]; then
  "${SCRIPT_DIR}/preflight.sh" local
else
  "${SCRIPT_DIR}/preflight.sh" production
fi

if [[ "${HECTOR_SKIP_BUILD:-}" != "1" ]]; then
  if [[ "$DEPLOYMENT_MODE" == "shared-host" && "${HECTOR_ALLOW_ISOLATED:-}" != "1" ]]; then
    yellow "Shared-host production: prefer prebuilt images. Set HECTOR_SKIP_BUILD=1 after loading images."
  fi
  yellow "Building API image ${API_IMAGE}…"
  docker build -f "${REPO_ROOT}/apps/api/Dockerfile" --target runner -t "${API_IMAGE}" "${REPO_ROOT}"

  yellow "Building migrator image ${MIGRATE_IMAGE}…"
  docker build -f "${REPO_ROOT}/apps/api/Dockerfile" --target migrator -t "${MIGRATE_IMAGE}" "${REPO_ROOT}"

  yellow "Building Web image ${WEB_IMAGE} (NEXT_PUBLIC_API_URL=${API_URL_BUILD})…"
  docker build -f "${REPO_ROOT}/apps/web/Dockerfile" --target runner \
    --build-arg "NEXT_PUBLIC_API_URL=${API_URL_BUILD}" \
    -t "${WEB_IMAGE}" "${REPO_ROOT}"
fi

export HECTOR_API_IMAGE="$API_IMAGE"
export HECTOR_WEB_IMAGE="$WEB_IMAGE"
export HECTOR_MIGRATE_IMAGE="$MIGRATE_IMAGE"

yellow "Validating Compose…"
compose config --quiet
if [[ "$DEPLOYMENT_MODE" == "shared-host" ]]; then
  assert_shared_host_resolved_config
fi

yellow "Starting PostgreSQL (Hector project only)…"
compose up -d postgres

yellow "Waiting for PostgreSQL health…"
for _ in $(seq 1 60); do
  if compose exec -T postgres pg_isready -U "${POSTGRES_USER:-hector_app}" -d "${POSTGRES_DB:-hector}" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
compose exec -T postgres pg_isready -U "${POSTGRES_USER:-hector_app}" -d "${POSTGRES_DB:-hector}" \
  || die "PostgreSQL did not become ready"

if [[ "${HECTOR_SKIP_MIGRATE:-}" != "1" ]]; then
  require_backup_gate_for_migrate
  yellow "Running migration job…"
  compose run --rm migrate
fi

# shellcheck disable=SC2046
yellow "Starting application services: $(app_services)"
# Intentional word-split of service list
# shellcheck disable=SC2086
compose up -d $(app_services)

yellow "Waiting for health…"
deadline=$((SECONDS + 180))
while (( SECONDS < deadline )); do
  api_h="$(service_health api)"
  web_h="$(service_health web)"
  if [[ "$DEPLOYMENT_MODE" == "shared-host" ]]; then
    if [[ "$api_h" == "healthy" && "$web_h" == "healthy" ]]; then
      green "API + Web healthy (shared-host; host Nginx is external)."
      "${SCRIPT_DIR}/status.sh"
      green "Deploy complete. Image tag: ${TAG}"
      exit 0
    fi
  else
    ngx_h="$(service_health nginx)"
    if [[ "$api_h" == "healthy" && "$web_h" == "healthy" && "$ngx_h" == "healthy" ]]; then
      green "All services healthy."
      "${SCRIPT_DIR}/status.sh"
      green "Deploy complete. Image tag: ${TAG}"
      exit 0
    fi
  fi
  sleep 5
done

red "Timed out waiting for healthy services."
compose ps
die "Deploy failed health gate — see logs via scripts/logs.sh"
