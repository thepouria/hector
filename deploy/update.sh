#!/usr/bin/env bash
# Hector production update (shared-host).
#
# Usage (on the server):
#   cd /opt/hector/app
#   ./deploy/update.sh
#
# Automatically: git pull --ff-only → build → backup → migrate → restart api/web
# Never: reset --hard, migrate reset, volume delete, unrelated service restarts.

set -euo pipefail
# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

confirm_update() {
  echo "Update Hector (project hector) on this host."
  echo "Will: git pull --ff-only, rebuild images, backup DB, migrate, recreate api/web."
  echo "Will NOT: touch Bazarbashe, delete volumes, or reverse migrations."
  echo
  read -r -p "Continue? [y/N] " ans
  [[ "${ans:-}" == "y" || "${ans:-}" == "Y" ]] || die "Aborted"
}

assert_installed() {
  compose_hector ps postgres >/dev/null 2>&1 \
    || die "Hector does not appear installed (postgres service missing). Run ./deploy/install.sh first."
  docker volume inspect hector_postgres_data >/dev/null 2>&1 \
    || die "Volume hector_postgres_data missing. Run ./deploy/install.sh first."
}

assert_git_safe() {
  command -v git >/dev/null 2>&1 || die "git is required"
  [[ -d "${REPO_ROOT}/.git" ]] || die "Not a git checkout: ${REPO_ROOT}"
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
    git -C "$REPO_ROOT" status --short
    die "Working tree is dirty. Commit/stash/discard changes before update (no git reset --hard from this script)."
  fi
}

git_pull_ff() {
  yellow "git pull --ff-only…"
  git -C "$REPO_ROOT" pull --ff-only
  green "Git updated: $(git -C "$REPO_ROOT" rev-parse --short HEAD)"
}

main() {
  hector_init
  require_docker
  assert_installed
  confirm_update
  assert_git_safe
  git_pull_ff

  # Re-load helpers after pull (script files may have changed)
  # shellcheck source=common.sh
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
  hector_init
  ensure_simple_image_vars_in_env
  hector_init
  validate_env_secrets
  check_resources

  compose_hector config --quiet
  assert_shared_host_resolved_config

  build_images

  # Ensure postgres is up (do not recreate volume)
  start_postgres
  backup_before_migrate

  # Migrate before replacing running app containers (dies on failure; leaves old api/web up)
  run_migrate

  # Recreate only api/web with new images
  yellow "Recreating API + Web…"
  if ! compose_hector up -d --force-recreate --no-deps api web; then
    red "Failed to recreate api/web — attempting image rollback…"
    rollback_app_images || true
    die "Deploy failed after migrate. DB may be ahead of previous app — do not auto-restore DB."
  fi

  local deadline=$((SECONDS + 180))
  local healthy=0
  while (( SECONDS < deadline )); do
    if curl -fsS "http://127.0.0.1:${HECTOR_API_HOST_PORT:-3101}/health" >/dev/null 2>&1 \
      && curl -fsS "http://127.0.0.1:${HECTOR_WEB_HOST_PORT:-3100}/health" >/dev/null 2>&1; then
      healthy=1
      break
    fi
    sleep 5
  done
  if [[ "$healthy" -ne 1 ]]; then
    red "Health checks failed — attempting app image rollback to :previous…"
    rollback_app_images || true
    die "Update unhealthy after rollback attempt. Investigate logs; DB not auto-restored."
  fi
  green "API + Web healthy"

  print_status
  green "Update finished."
  yellow "App rollback (images only): docker tag hector-api:previous hector-api:latest && docker tag hector-web:previous hector-web:latest && ./deploy/update.sh will not be needed — use compose up -d --force-recreate api web"
  yellow "DB restore is manual — see docs/production-backup-restore.md (never automatic)."
}

main "$@"
