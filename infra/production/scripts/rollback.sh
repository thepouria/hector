#!/usr/bin/env bash
# Application rollback to a previous image tag (Hector project only).
# Does NOT reverse Prisma migrations or restore database backups.
# Does NOT touch bazarbashe / Fanoma / unrelated Compose projects.

set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

PREV_TAG="${1:-}"
[[ -n "$PREV_TAG" ]] || die "Usage: rollback.sh <previous-image-tag>"

load_env_file
resolve_deployment_mode
resolve_compose_project
require_production_confirm

yellow "=== Application rollback ==="
yellow "mode=${DEPLOYMENT_MODE} project=${HECTOR_COMPOSE_PROJECT} tag=${PREV_TAG}"
yellow "This does NOT roll back database migrations."
yellow "Only proceed if the previous app version is schema-compatible with the current DB."

if [[ "${HECTOR_ALLOW_ISOLATED:-}" != "1" ]]; then
  read -r -p "Type ROLLBACK to continue: " confirm
  [[ "$confirm" == "ROLLBACK" ]] || die "Rollback aborted"
fi

export HECTOR_IMAGE_TAG="$PREV_TAG"
export HECTOR_API_IMAGE="${HECTOR_API_IMAGE_PREFIX:-hector-api}:${PREV_TAG}"
export HECTOR_WEB_IMAGE="${HECTOR_WEB_IMAGE_PREFIX:-hector-web}:${PREV_TAG}"

docker image inspect "$HECTOR_API_IMAGE" >/dev/null 2>&1 \
  || die "API image not found locally: $HECTOR_API_IMAGE"
docker image inspect "$HECTOR_WEB_IMAGE" >/dev/null 2>&1 \
  || die "Web image not found locally: $HECTOR_WEB_IMAGE"

# Never run migrate on rollback. Never restart unrelated host services.
# shellcheck disable=SC2086
compose up -d $(app_services)

deadline=$((SECONDS + 120))
while (( SECONDS < deadline )); do
  api_h="$(service_health api)"
  web_h="$(service_health web)"
  if [[ "$api_h" == "healthy" && "$web_h" == "healthy" ]]; then
    if [[ "$DEPLOYMENT_MODE" == "dedicated" ]]; then
      ngx_h="$(service_health nginx)"
      [[ "$ngx_h" == "healthy" ]] || { sleep 5; continue; }
    fi
    green "Rollback services healthy at tag=${PREV_TAG}"
    "${SCRIPT_DIR}/status.sh"
    exit 0
  fi
  sleep 5
done

die "Rollback health check failed — inspect logs and consider escalation (see docs/production-rollback.md)"
