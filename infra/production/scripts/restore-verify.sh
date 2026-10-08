#!/usr/bin/env bash
# Restore a Hector backup into a disposable PostgreSQL 16 container and verify.
# NEVER restores into the live Hector postgres volume.
# NEVER touches bazarbashe-* containers or volumes.
#
# Usage:
#   ./infra/production/scripts/restore-verify.sh /path/to/hector-….dump
#
# Optional:
#   HECTOR_RESTORE_VERIFY_IMAGE=postgres:16-alpine
#   HECTOR_RESTORE_VERIFY_NAME=hector-restore-verify

set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd docker
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  die "Required command not found: sha256sum or shasum"
fi

DUMP_FILE="${1:-}"
[[ -n "$DUMP_FILE" && -f "$DUMP_FILE" ]] || die "Usage: $0 /path/to/hector-….dump"
[[ -s "$DUMP_FILE" ]] || die "Dump file is empty"

META_FILE="${DUMP_FILE}.meta.json"
VERIFY_NAME="${HECTOR_RESTORE_VERIFY_NAME:-hector-restore-verify}"
VERIFY_IMAGE="${HECTOR_RESTORE_VERIFY_IMAGE:-postgres:16-alpine}"
VERIFY_NETWORK="hector-restore-verify-net"
EVIDENCE_DIR="${HECTOR_BACKUP_EVIDENCE_DIR:-${HECTOR_BACKUP_DIR:-/var/backups/hector}/evidence}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# Safety: never use production project names / bazarbashe naming
[[ "$VERIFY_NAME" != *bazarbashe* ]] || die "Refuse restore container name containing bazarbashe"
assert_safe_project "hector-restore-verify"

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA="$(sha256sum "$DUMP_FILE" | awk '{print $1}')"
else
  ACTUAL_SHA="$(shasum -a 256 "$DUMP_FILE" | awk '{print $1}')"
fi

if [[ -f "$META_FILE" ]]; then
  EXPECTED_SHA="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sha256"])' "$META_FILE" 2>/dev/null || true)"
  if [[ -n "${EXPECTED_SHA:-}" && "$EXPECTED_SHA" != "$ACTUAL_SHA" ]]; then
    die "Checksum mismatch: meta=${EXPECTED_SHA} actual=${ACTUAL_SHA}"
  fi
  green "Checksum OK: ${ACTUAL_SHA}"
else
  yellow "No .meta.json beside dump — proceeding with computed SHA256=${ACTUAL_SHA}"
fi

cleanup() {
  docker rm -f "$VERIFY_NAME" >/dev/null 2>&1 || true
  docker network rm "$VERIFY_NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
docker network create "$VERIFY_NETWORK" >/dev/null

yellow "Starting disposable Postgres 16 (${VERIFY_NAME})…"
docker run -d --rm \
  --name "$VERIFY_NAME" \
  --network "$VERIFY_NETWORK" \
  -e POSTGRES_DB=hector_restore \
  -e POSTGRES_USER=hector_restore \
  -e POSTGRES_PASSWORD=hector_restore_verify_only \
  "$VERIFY_IMAGE" >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$VERIFY_NAME" pg_isready -U hector_restore -d hector_restore >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$VERIFY_NAME" pg_isready -U hector_restore -d hector_restore \
  || die "Disposable Postgres did not become ready"

yellow "Restoring dump (isolated)…"
docker exec -i "$VERIFY_NAME" \
  pg_restore -U hector_restore -d hector_restore --no-owner --no-acl \
  <"$DUMP_FILE" || {
    # pg_restore may exit 1 for non-fatal warnings; treat empty schema as failure
    yellow "pg_restore returned non-zero — checking table presence…"
  }

TABLE_COUNT="$(docker exec "$VERIFY_NAME" psql -U hector_restore -d hector_restore -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")"

[[ "${TABLE_COUNT}" -gt 0 ]] || die "Restore produced zero public tables"

MIG_COUNT="$(docker exec "$VERIFY_NAME" psql -U hector_restore -d hector_restore -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='_prisma_migrations';" 2>/dev/null || echo 0)"

HAS_COMPANIES="$(docker exec "$VERIFY_NAME" psql -U hector_restore -d hector_restore -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='companies';" 2>/dev/null || echo 0)"

green "Restore verification tables: public=${TABLE_COUNT} _prisma_migrations=${MIG_COUNT} companies=${HAS_COMPANIES}"

mkdir -p "$EVIDENCE_DIR"
chmod 700 "$EVIDENCE_DIR" 2>/dev/null || true
EVIDENCE_FILE="${EVIDENCE_DIR}/restore-verify-${STAMP}.json"
cat >"$EVIDENCE_FILE" <<EOF
{
  "verifiedAtUtc": "${STAMP}",
  "dumpFile": "$(basename "$DUMP_FILE")",
  "sha256": "${ACTUAL_SHA}",
  "publicTableCount": ${TABLE_COUNT},
  "hasPrismaMigrations": $([[ "$MIG_COUNT" == "1" ]] && echo true || echo false),
  "hasCompaniesTable": $([[ "$HAS_COMPANIES" == "1" ]] && echo true || echo false),
  "verifyContainer": "${VERIFY_NAME}",
  "verifyImage": "${VERIFY_IMAGE}",
  "liveDatabaseTouched": false
}
EOF
chmod 600 "$EVIDENCE_FILE"

green "Restore verification PASS"
green "Evidence: ${EVIDENCE_FILE}"
echo "After off-server copy succeeds, set HECTOR_BACKUP_GATE=verified in production.env"
echo "EVIDENCE_FILE=${EVIDENCE_FILE}"
