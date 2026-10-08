#!/usr/bin/env bash
# One-off Prisma migration job: prisma migrate deploy only (Hector DB only).
# Never seeds. Never resets. Backup gate required for production.

set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

load_env_file
resolve_deployment_mode
resolve_compose_project
require_production_confirm
require_backup_gate_for_migrate

HECTOR_IMAGE_TAG="${HECTOR_IMAGE_TAG:-latest}"
HECTOR_MIGRATE_IMAGE="${HECTOR_MIGRATE_IMAGE:-hector-api-migrate:${HECTOR_IMAGE_TAG}}"
export HECTOR_IMAGE_TAG HECTOR_MIGRATE_IMAGE

yellow "Running prisma migrate deploy via ${HECTOR_MIGRATE_IMAGE}…"
yellow "mode=${DEPLOYMENT_MODE} project=${HECTOR_COMPOSE_PROJECT}"
compose up -d postgres
compose run --rm --no-deps migrate
green "Migration job completed."
