# Production Rollback Runbook

## Principles

1. **Application rollback ≠ database rollback.**
2. Prisma migrations are **forward-only** in production.
3. Never automatically reverse migrations or restore backups.
4. Data restoration requires an **explicit operator decision** (PR-001).
5. Rollback scripts operate **only** on the Hector Compose project (`hector` or `hector-production`).

## Scope (shared-host)

Rollback may restart Hector `api` / `web` (and dedicated-mode `nginx`) only.

Must **not** restart or modify:

- `bazarbashe-postgres`, `bazarbashe-redis`
- Fanoma / Buy Box Node processes
- Host Nginx process (config reload is a separate operator step if needed)
- Unrelated Compose projects (`bazarbashe`, `current`, `empire`)

## Application rollback procedure

```bash
export HECTOR_ENV_FILE=/opt/hector/env/production.env
export DEPLOYMENT_MODE=shared-host   # or dedicated
export HECTOR_PRODUCTION_CONFIRM=I_UNDERSTAND_PRODUCTION
./infra/production/scripts/rollback.sh <previous-git-sha>
```

What it does:

- Selects previous `hector-api` / `hector-web` images
- `compose -p <hector-project> up -d` for Hector app services only
- Does **not** run migrations
- Does **not** touch Postgres volumes
- Waits for health

## Schema compatibility

Before rolling back:

1. Inspect `_prisma_migrations` head
2. Confirm previous release is compatible with current schema
3. If a new migration is incompatible with the previous app → fix forward or restore from backup under change control — do **not** app-rollback blindly

## Migration failure handling

1. Stop deploy — do not start new API/Web
2. Capture migrator logs (`./infra/production/scripts/logs.sh`)
3. Leave `hector_postgres_data` intact
4. Fix and retry migrate job
5. Never `migrate reset` on production

## Health-check failure handling

1. `./infra/production/scripts/status.sh` + `logs.sh api|web`
2. Schema-compatible previous images → `rollback.sh <prev>`
3. Otherwise escalate (do not touch other tenants’ containers)

## Database recovery escalation

See `docs/production-backup-restore.md` (P.4).

1. Confirm a verified dump (`*.meta.json` + checksum + offsite copy).
2. Restore into a **disposable** DB first (`restore-verify.sh`).
3. Live restore only with explicit change-control approval.
4. Never auto-restore; never drop `hector_postgres_data` casually; never touch Bazarbashe volumes.

## Retained for rollback readiness

| Asset | Practice |
|---|---|
| Previous app images | Keep prior `hector-api:<sha>` / `hector-web:<sha>` on the host |
| Compose files | Git-tagged; do not overwrite host copies blindly |
| Env file | Secure copy of last-known-good `production.env` (0600) off-box |
| Migrations | Forward-only; assess compatibility before app rollback |

## Limitations

- No automatic DB rollback
- No `down -v`
- No global Docker cleanup
- Host Nginx site/TLS issues are not fixed by image rollback alone
