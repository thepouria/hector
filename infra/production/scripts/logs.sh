#!/usr/bin/env bash
# Tail Compose logs for Hector services only (project-scoped).

set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

load_env_file
resolve_deployment_mode
resolve_compose_project

SERVICE="${1:-all}"
LINES="${2:-200}"

case "$SERVICE" in
  api|web|postgres)
    compose logs --tail="$LINES" -f "$SERVICE"
    ;;
  nginx)
    [[ "$DEPLOYMENT_MODE" == "dedicated" ]] || die "nginx logs only apply to DEPLOYMENT_MODE=dedicated (host Nginx is external in shared-host)"
    compose logs --tail="$LINES" -f nginx
    ;;
  all)
    compose logs --tail="$LINES" -f
    ;;
  *)
    die "Usage: logs.sh [api|web|nginx|postgres|all] [tail-lines]"
    ;;
esac
