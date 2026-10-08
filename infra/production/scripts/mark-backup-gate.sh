#!/usr/bin/env bash
# Validate backup gate evidence, then print how to set HECTOR_BACKUP_GATE=verified.
# Does NOT write secrets. Does NOT auto-edit production.env unless --apply is passed
# with HECTOR_PRODUCTION_CONFIRM.
#
# Usage:
#   ./infra/production/scripts/mark-backup-gate.sh
#   ./infra/production/scripts/mark-backup-gate.sh --apply   # updates env file only

set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

load_env_file
BACKUP_ROOT="${HECTOR_BACKUP_DIR:-/var/backups/hector}"
EVIDENCE_DIR="${HECTOR_BACKUP_EVIDENCE_DIR:-${BACKUP_ROOT}/evidence}"
DAILY_DIR="${BACKUP_ROOT}/daily"

latest_dump="$(ls -1t "${DAILY_DIR}"/hector-*.dump 2>/dev/null | head -n1 || true)"
[[ -n "$latest_dump" && -s "$latest_dump" ]] || die "No non-empty daily backup under ${DAILY_DIR}"

meta="${latest_dump}.meta.json"
[[ -f "$meta" ]] || die "Missing meta: ${meta}"

offsite="$(python3 -c 'import json,sys; m=json.load(open(sys.argv[1])); print("true" if m.get("offsiteOk") else "false")' "$meta" 2>/dev/null || echo false)"
LOCAL_ONLY_ACK="${HECTOR_BACKUP_ALLOW_LOCAL_ONLY:-}"
OFFSITE_MODE="remote"
if [[ "$offsite" == "true" ]]; then
  OFFSITE_MODE="remote"
elif [[ "$LOCAL_ONLY_ACK" == "I_ACCEPT_SAME_SERVER_RISK" ]]; then
  # Pilot / small-team exception: same-server dump + restore-verify only.
  # Disk loss destroys DB and backups together — operator must copy off-box manually.
  OFFSITE_MODE="local-acknowledged"
  yellow "OFFSITE DEFERRED: same-server backup only (HECTOR_BACKUP_ALLOW_LOCAL_ONLY set)."
  yellow "Copy dumps off this host manually when possible. Do not treat this as full DR."
else
  die "Latest backup meta offsiteOk!=true. Configure HECTOR_BACKUP_OFFSITE_RSYNC / HECTOR_BACKUP_OFFSITE_CMD, or set HECTOR_BACKUP_ALLOW_LOCAL_ONLY=I_ACCEPT_SAME_SERVER_RISK for same-server-only pilot."
fi

latest_evidence="$(ls -1t "${EVIDENCE_DIR}"/restore-verify-*.json 2>/dev/null | head -n1 || true)"
[[ -n "$latest_evidence" ]] || die "No restore-verify evidence under ${EVIDENCE_DIR}. Run restore-verify.sh first."

# Optional: ensure evidence references same SHA as latest dump
dump_sha="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sha256"])' "$meta")"
ev_sha="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("sha256",""))' "$latest_evidence")"
if [[ -n "$ev_sha" && "$ev_sha" != "$dump_sha" ]]; then
  yellow "Warning: restore evidence SHA (${ev_sha}) != latest dump SHA (${dump_sha})."
  yellow "Prefer re-running restore-verify.sh against the latest dump."
fi

green "Backup gate evidence OK"
echo "  dump=${latest_dump}"
echo "  evidence=${latest_evidence}"
echo "  offsiteMode=${OFFSITE_MODE}"
echo "  offsiteOk=${offsite}"

ENV_FILE="${HECTOR_ENV_FILE:-$DEFAULT_ENV_FILE}"

if [[ "$APPLY" -eq 1 ]]; then
  require_production_confirm
  [[ -f "$ENV_FILE" ]] || die "Env file not found: $ENV_FILE"
  if grep -q '^HECTOR_BACKUP_GATE=' "$ENV_FILE"; then
    # portable in-place edit
    tmp="$(mktemp)"
    sed 's/^HECTOR_BACKUP_GATE=.*/HECTOR_BACKUP_GATE=verified/' "$ENV_FILE" >"$tmp"
    mv "$tmp" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
  else
    printf '\nHECTOR_BACKUP_GATE=verified\n' >>"$ENV_FILE"
    chmod 600 "$ENV_FILE"
  fi
  green "Updated ${ENV_FILE}: HECTOR_BACKUP_GATE=verified"
else
  yellow "Evidence ready. To mark the gate (after operator review):"
  echo "  export HECTOR_PRODUCTION_CONFIRM=I_UNDERSTAND_PRODUCTION"
  echo "  export HECTOR_ENV_FILE=${ENV_FILE}"
  echo "  ./infra/production/scripts/mark-backup-gate.sh --apply"
  echo "Or set HECTOR_BACKUP_GATE=verified manually in the env file (mode 0600)."
fi
