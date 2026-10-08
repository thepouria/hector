#!/usr/bin/env bash
# Hector PostgreSQL logical backup (pg_dump -Fc).
# Targets ONLY the Compose project for Hector — never Bazarbashe.
#
# Usage:
#   export HECTOR_ENV_FILE=/opt/hector/env/production.env
#   export DEPLOYMENT_MODE=shared-host
#   ./infra/production/scripts/backup.sh
#
# Optional:
#   HECTOR_BACKUP_DIR=/var/backups/hector
#   HECTOR_BACKUP_KEEP_DAILY=7

set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

load_env_file
resolve_deployment_mode
resolve_compose_project
require_cmd docker
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  die "Required command not found: sha256sum or shasum"
fi

BACKUP_ROOT="${HECTOR_BACKUP_DIR:-/var/backups/hector}"
KEEP_DAILY="${HECTOR_BACKUP_KEEP_DAILY:-7}"
KEEP_WEEKLY="${HECTOR_BACKUP_KEEP_WEEKLY:-4}"
DB_NAME="${POSTGRES_DB:-hector}"
DB_USER="${POSTGRES_USER:-hector_app}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST_DIR="${BACKUP_ROOT}/daily"
WEEKLY_DIR="${BACKUP_ROOT}/weekly"
TMP_FILE="${DEST_DIR}/.tmp-hector-${STAMP}.dump"
OUT_FILE="${DEST_DIR}/hector-${DB_NAME}-${STAMP}.dump"
META_FILE="${OUT_FILE}.meta.json"
LOCK_FILE="${BACKUP_ROOT}/.backup.lock"
OFFSITE_OK=false

# Refuse obvious wrong targets
assert_safe_project "$HECTOR_COMPOSE_PROJECT"
[[ "$DB_NAME" != "bazarbashe" && "$DB_NAME" != "postgres" ]] || die "Refusing to dump database name: ${DB_NAME}"

mkdir -p "$DEST_DIR" "$WEEKLY_DIR"
chmod 700 "$BACKUP_ROOT" 2>/dev/null || true
chmod 700 "$DEST_DIR" "$WEEKLY_DIR" 2>/dev/null || true

if [[ -f "$LOCK_FILE" ]]; then
  die "Backup already in progress (lock: ${LOCK_FILE}). Remove only if stale."
fi
echo "$$" >"$LOCK_FILE"
trap 'rm -f "$LOCK_FILE" "$TMP_FILE"' EXIT

pg_cid="$(service_cid postgres)"
[[ -n "$pg_cid" ]] || die "Hector postgres container not running (project=${HECTOR_COMPOSE_PROJECT})"

# Identity check: container must belong to our Compose project
pg_project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$pg_cid" 2>/dev/null || true)"
[[ "$pg_project" == "$HECTOR_COMPOSE_PROJECT" ]] || die "Postgres container project mismatch: got '${pg_project}', expected '${HECTOR_COMPOSE_PROJECT}'"

yellow "Backing up Hector DB '${DB_NAME}' from project '${HECTOR_COMPOSE_PROJECT}'…"

# Use container env for password — never pass on host argv
compose exec -T postgres \
  pg_dump -Fc -U "$DB_USER" -d "$DB_NAME" \
  --no-owner --no-acl \
  >"$TMP_FILE"

[[ -s "$TMP_FILE" ]] || die "Backup file is empty"

BYTES="$(wc -c <"$TMP_FILE" | tr -d ' ')"
if command -v sha256sum >/dev/null 2>&1; then
  CHECKSUM="$(sha256sum "$TMP_FILE" | awk '{print $1}')"
else
  CHECKSUM="$(shasum -a 256 "$TMP_FILE" | awk '{print $1}')"
fi

mv -f "$TMP_FILE" "$OUT_FILE"
chmod 600 "$OUT_FILE"

cat >"$META_FILE" <<EOF
{
  "database": "${DB_NAME}",
  "composeProject": "${HECTOR_COMPOSE_PROJECT}",
  "deploymentMode": "${DEPLOYMENT_MODE}",
  "format": "pg_dump-Fc",
  "createdAtUtc": "${STAMP}",
  "file": "$(basename "$OUT_FILE")",
  "bytes": ${BYTES},
  "sha256": "${CHECKSUM}"
}
EOF
chmod 600 "$META_FILE"

green "Backup OK: ${OUT_FILE} (${BYTES} bytes)"
green "SHA256: ${CHECKSUM}"

# Weekly copy (UTC Sunday = day 0) — only after successful dump
DOW="$(date -u +%w)"
if [[ "$DOW" == "0" ]]; then
  WEEKLY_FILE="${WEEKLY_DIR}/hector-${DB_NAME}-${STAMP}.dump"
  cp -p "$OUT_FILE" "$WEEKLY_FILE"
  cp -p "$META_FILE" "${WEEKLY_FILE}.meta.json"
  chmod 600 "$WEEKLY_FILE" "${WEEKLY_FILE}.meta.json"
  green "Weekly copy: ${WEEKLY_FILE}"
fi

# Retention: prune only after a successful new backup exists
while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  yellow "Pruning old daily backup: $f"
  rm -f "$f" "${f}.meta.json"
done < <(ls -1t "${DEST_DIR}"/hector-*.dump 2>/dev/null | tail -n +"$((KEEP_DAILY + 1))" || true)

while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  yellow "Pruning old weekly backup: $f"
  rm -f "$f" "${f}.meta.json"
done < <(ls -1t "${WEEKLY_DIR}"/hector-*.dump 2>/dev/null | tail -n +"$((KEEP_WEEKLY + 1))" || true)

# Optional offsite hook (no secrets printed)
if [[ -n "${HECTOR_BACKUP_OFFSITE_CMD:-}" ]]; then
  yellow "Running offsite transfer…"
  # shellcheck disable=SC2086
  eval ${HECTOR_BACKUP_OFFSITE_CMD} "\"${OUT_FILE}\"" "\"${META_FILE}\""
  OFFSITE_OK=true
  green "Offsite command finished."
elif [[ -n "${HECTOR_BACKUP_OFFSITE_RSYNC:-}" ]]; then
  require_cmd rsync
  yellow "rsync → ${HECTOR_BACKUP_OFFSITE_RSYNC}"
  rsync -az --chmod=F600 "${OUT_FILE}" "${META_FILE}" "${HECTOR_BACKUP_OFFSITE_RSYNC%/}/"
  OFFSITE_OK=true
  green "Offsite rsync finished."
else
  yellow "No offsite configured (set HECTOR_BACKUP_OFFSITE_RSYNC or HECTOR_BACKUP_OFFSITE_CMD). Local dump only — NOT sufficient for gate."
fi

# Refresh meta with offsite flag (never print secrets)
python3 - "$META_FILE" "$OFFSITE_OK" <<'PY' || true
import json, sys
path, offsite = sys.argv[1], sys.argv[2] == "true"
with open(path) as f:
    meta = json.load(f)
meta["offsiteAttempted"] = offsite
meta["offsiteOk"] = offsite
with open(path, "w") as f:
    json.dump(meta, f, indent=2)
    f.write("\n")
PY
chmod 600 "$META_FILE"

echo "BACKUP_FILE=${OUT_FILE}"
echo "BACKUP_SHA256=${CHECKSUM}"
echo "OFFSITE_OK=${OFFSITE_OK}"
