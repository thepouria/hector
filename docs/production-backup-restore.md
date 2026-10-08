# Production Backup & Restore

**Scope:** Hector PostgreSQL only (Compose project `hector` / `hector-production`).  
**Never** dump or restore Bazarbashe / Fanoma databases.

## Goals

| Requirement | Implementation |
|---|---|
| Daily logical backup | `infra/production/scripts/backup.sh` (`pg_dump -Fc`) |
| Off-server copy | `HECTOR_BACKUP_OFFSITE_RSYNC` or `HECTOR_BACKUP_OFFSITE_CMD` |
| Retention | 7 daily + 4 weekly (configurable) |
| Checksum | SHA-256 in `*.meta.json` |
| Restore verification | `restore-verify.sh` → disposable Postgres 16 |
| Gate | `HECTOR_BACKUP_GATE=verified` only after dump + offsite + restore evidence |

## Locations

| Item | Default path |
|---|---|
| Local backups | `/var/backups/hector/daily/` |
| Weekly copies | `/var/backups/hector/weekly/` |
| Restore evidence | `/var/backups/hector/evidence/` |
| Cron log | `/var/log/hector-backup.log` |

Permissions: directory `0700`, dump/meta `0600`.

## Schedule

Default cron: **03:00 server-local** (`HECTOR_BACKUP_CRON_SCHEDULE=0 3 * * *`).

```bash
export HECTOR_ENV_FILE=/opt/hector/env/production.env
export HECTOR_PRODUCTION_CONFIRM=I_UNDERSTAND_PRODUCTION
./infra/production/scripts/install-backup-cron.sh           # preview
./infra/production/scripts/install-backup-cron.sh --install # install
```

Overlapping jobs are blocked by `/var/backups/hector/.backup.lock`.

## Configuration

In `production.env` (never commit secrets):

```bash
HECTOR_BACKUP_DIR=/var/backups/hector
HECTOR_BACKUP_KEEP_DAILY=7
HECTOR_BACKUP_KEEP_WEEKLY=4
# Prefer SSH rsync to a separate host (encrypted transport):
HECTOR_BACKUP_OFFSITE_RSYNC=backup-user@backup-host:/backups/hector/
# Or:
# HECTOR_BACKUP_OFFSITE_CMD='aws s3 cp'
```

Password for `pg_dump` stays inside the Hector postgres container env — never on host argv.

## Run a backup

```bash
export DEPLOYMENT_MODE=shared-host
export HECTOR_ENV_FILE=/opt/hector/env/production.env
./infra/production/scripts/backup.sh
```

Success prints `BACKUP_FILE=…`, `BACKUP_SHA256=…`, `OFFSITE_OK=true|false`.

## List / verify checksums

```bash
ls -lh /var/backups/hector/daily/
sha256sum /var/backups/hector/daily/hector-*.dump | head
python3 -c 'import json; print(json.load(open("/var/backups/hector/daily/<file>.meta.json")))'
```

## Restore verification (disposable — never live)

```bash
./infra/production/scripts/restore-verify.sh /var/backups/hector/daily/hector-hector-<stamp>.dump
```

Creates ephemeral container `hector-restore-verify`, restores with `pg_restore`, checks public tables, writes evidence JSON, then removes the test container/network.

**Never** restore over the live Hector volume. **Never** use Bazarbashe Postgres for tests.

## Mark backup gate

```bash
./infra/production/scripts/mark-backup-gate.sh
# after review:
export HECTOR_PRODUCTION_CONFIRM=I_UNDERSTAND_PRODUCTION
./infra/production/scripts/mark-backup-gate.sh --apply
```

Gate requires: non-empty dump, `offsiteOk=true` in meta, and a restore-verify evidence file.

## Disaster recovery (live restore — explicit approval only)

1. Stop Hector API/Web (Compose project `hector` only):  
   `docker compose -p hector -f infra/production/compose.shared-host.yaml --env-file … stop api web`
2. Keep `postgres` up or recreate **only** Hector volume after confirmed loss (operator decision).
3. Prefer restore into a **new** volume / DB name, validate, then cut over.
4. Example restore into a **non-live** DB name:

```bash
# Inside Hector postgres container — example only; change DB name first
docker compose -p hector … exec -T postgres \
  pg_restore -U hector_app -d hector_restore_tmp --clean --if-exists --no-owner --no-acl \
  < /path/to/hector-….dump
```

5. Point `DATABASE_URL` only after validation. Do **not** automate this in scripts.
6. Re-run `prisma migrate deploy` only if needed for schema drift (forward-only).
7. Restart API/Web; smoke auth; confirm Bazarbashe untouched.

## Detect failures

- Cron log: `tail -n 100 /var/log/hector-backup.log`
- Missing new daily file after 03:00 → failure
- `OFFSITE_OK=false` → gate cannot be marked verified
- Lock file stuck → investigate; remove only if process dead

## Rotate backup / offsite credentials

1. Issue new SSH key or object-storage credentials off-box.
2. Update `HECTOR_BACKUP_OFFSITE_*` in `production.env` (`0600`).
3. Run one manual `backup.sh` and confirm offsite receipt.
4. Revoke old credentials.

## Encryption

- Transport: SSH (rsync) or TLS (S3 API).
- At rest: rely on destination disk encryption / bucket SSE; dumps are DB-sensitive — restrict access.
- Do not email dumps or store them in world-readable paths.
