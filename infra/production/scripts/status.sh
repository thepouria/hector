#!/usr/bin/env bash
# Show Hector container state only (no secrets; project-scoped).

set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

load_env_file
resolve_deployment_mode
resolve_compose_project

echo "=== Hector status ==="
echo "Env file: ${HECTOR_ENV_FILE:-$DEFAULT_ENV_FILE}"
echo "DEPLOYMENT_MODE: ${DEPLOYMENT_MODE}"
echo "Compose project: ${HECTOR_COMPOSE_PROJECT}"
echo "Image tag: ${HECTOR_IMAGE_TAG:-unknown}"
echo

compose ps --format 'table {{.Name}}\t{{.Service}}\t{{.Status}}\t{{.Image}}' || compose ps

echo
echo "=== Health / restarts ==="
services=(postgres api web)
[[ "$DEPLOYMENT_MODE" == "dedicated" ]] && services+=(nginx)
for svc in "${services[@]}"; do
  if [[ -z "$(service_cid "$svc")" ]]; then
    echo "$svc: not present"
    continue
  fi
  echo "$svc: health=$(service_health "$svc") restarts=$(service_restarts "$svc") image=$(service_image "$svc")"
done

echo
if command -v docker >/dev/null 2>&1; then
  echo "=== Resource usage (docker stats, 1 sample, Hector CIDs only) ==="
  ids="$(compose ps -q 2>/dev/null || true)"
  if [[ -n "$ids" ]]; then
    # shellcheck disable=SC2086
    docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' $ids || true
  fi
fi
