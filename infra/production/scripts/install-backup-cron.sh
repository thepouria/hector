#!/usr/bin/env bash
# Install (or print) a daily Hector backup cron entry.
# Default: 03:00 server-local time. Does not touch other users' crontabs.
#
# Usage:
#   ./infra/production/scripts/install-backup-cron.sh           # print only
#   ./infra/production/scripts/install-backup-cron.sh --install  # install for current user

set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

INSTALL=0
[[ "${1:-}" == "--install" ]] && INSTALL=1

REPO="${REPO_ROOT}"
ENV_FILE="${HECTOR_ENV_FILE:-/opt/hector/env/production.env}"
SCHEDULE="${HECTOR_BACKUP_CRON_SCHEDULE:-0 3 * * *}"
LOG_FILE="${HECTOR_BACKUP_CRON_LOG:-/var/log/hector-backup.log}"
MARKER="hector-backup-daily"

ENTRY="${SCHEDULE} DEPLOYMENT_MODE=shared-host HECTOR_ENV_FILE=${ENV_FILE} ${REPO}/infra/production/scripts/backup.sh >>${LOG_FILE} 2>&1 # ${MARKER}"

yellow "Proposed cron entry:"
echo "$ENTRY"
echo
yellow "Requirements:"
echo "  - Scripts executable; env file mode 0600"
echo "  - Offsite optional for pilot; or HECTOR_BACKUP_ALLOW_LOCAL_ONLY=I_ACCEPT_SAME_SERVER_RISK"
echo "  - Log dir writable (touch ${LOG_FILE})"
echo "  - Never schedule overlapping jobs (lock file prevents concurrent runs)"

if [[ "$INSTALL" -ne 1 ]]; then
  yellow "Dry-run only. Re-run with --install to add to current user crontab."
  exit 0
fi

require_production_confirm
require_cmd crontab

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
crontab -l 2>/dev/null | grep -v "$MARKER" >"${tmpdir}/cron" || true
echo "$ENTRY" >>"${tmpdir}/cron"
crontab "${tmpdir}/cron"
green "Installed Hector backup cron for $(whoami)"
crontab -l | grep "$MARKER" || true
