# P.4 — Simple Production Deployment & Backup

**Status:** PREPARED (repository artifacts). Real server deploy is **blocked** until explicit approval.  
**Server:** `62.60.191.119` (shared Ubuntu 24.04)  
**Mode:** `DEPLOYMENT_MODE=shared-host`  
**Compose:** `infra/production/compose.shared-host.yaml` (`-p hector`)  
**Frontend:** `https://hector.pishete.com` → `127.0.0.1:3100`  
**Backend:** `https://core-hector.pishete.com` → `127.0.0.1:3101`

## What P.4 delivers (repo)

| Area | Artifact |
|---|---|
| Daily backup | `infra/production/scripts/backup.sh` |
| Restore verify | `infra/production/scripts/restore-verify.sh` |
| Gate marking | `infra/production/scripts/mark-backup-gate.sh` |
| Cron helper | `infra/production/scripts/install-backup-cron.sh` |
| Read-only server checks | `infra/production/scripts/server-readonly-preflight.sh` |
| First admin | `pnpm db:bootstrap:production` → `packages/database/scripts/production-bootstrap.ts` |
| Runbooks | `docs/production-backup-restore.md`, updated env/rollback/deploy docs |

## Hard stop (no production changes yet)

Do **not** without a separate written approval:

- SSH / deploy / migrate on `62.60.191.119`
- DNS changes
- Host Nginx install/reload
- TLS issuance
- Real admin account creation on production
- Real business data entry

## Shared-host architecture (unchanged)

```
Internet → Host Nginx → 127.0.0.1:3100 (web) / 127.0.0.1:3101 (api)
                              ↓
                     Hector Postgres (private Docker network + volume)
```

No container Nginx. No public Postgres. Project name `hector` only.

## Chicken-egg: first backup gate

Production migrate requires `HECTOR_BACKUP_GATE=verified`. For a **brand-new** empty Hector DB:

1. Prepare `/opt/hector/env/production.env` (secrets, mode `shared-host`, gate still `unverified`).
2. Load prebuilt images; set `HECTOR_SKIP_BUILD=1`.
3. Start Postgres only (no migrate):

```bash
export DEPLOYMENT_MODE=shared-host
export HECTOR_ENV_FILE=/opt/hector/env/production.env
export HECTOR_PRODUCTION_CONFIRM=I_UNDERSTAND_PRODUCTION
export HECTOR_SKIP_MIGRATE=1
# Prefer starting postgres via deploy with skip, or:
docker compose -p hector -f infra/production/compose.shared-host.yaml \
  --env-file "$HECTOR_ENV_FILE" up -d postgres
```

4. Configure offsite (`HECTOR_BACKUP_OFFSITE_RSYNC` or `…_CMD`).
5. `./infra/production/scripts/backup.sh` (empty schema dump is OK for first gate).
6. `./infra/production/scripts/restore-verify.sh <dump>`
7. `./infra/production/scripts/mark-backup-gate.sh --apply`
8. `./infra/production/scripts/migrate.sh` (`prisma migrate deploy` only).
9. `./infra/production/scripts/deploy.sh` (or unset `HECTOR_SKIP_MIGRATE` and deploy).
10. Bootstrap admin (approved): `pnpm db:bootstrap:production` with bootstrap env vars (password via env, not argv).
11. Host Nginx HTTP sites → ACME → HTTPS templates.
12. Auth / permissions smoke (pilot accounts only).
13. Re-run backup after schema exists; re-verify restore; keep gate `verified`.

Never: `prisma migrate reset`, `db:seed`, `docker compose down -v`, `docker system prune`.

## Operator sequence after approval

Exact scripts (already in repo):

| Step | Command |
|---|---|
| Read-only preflight | `./infra/production/scripts/server-readonly-preflight.sh` |
| Preflight (deploy) | `./infra/production/scripts/preflight.sh production` |
| Migrate | `./infra/production/scripts/migrate.sh` |
| Deploy | `./infra/production/scripts/deploy.sh` |
| Status / logs | `./infra/production/scripts/status.sh` / `logs.sh api\|web\|postgres` |
| Backup | `./infra/production/scripts/backup.sh` |
| Restore verify | `./infra/production/scripts/restore-verify.sh <dump>` |
| Rollback app | `./infra/production/scripts/rollback.sh <prev-sha>` |

Nginx templates: `infra/production/host-nginx/` (additive). See `host-nginx/README.md`.

## Admin bootstrap

```bash
export NODE_ENV=production
export DATABASE_URL='…'   # runtime URL into Hector DB
export HECTOR_BOOTSTRAP_ADMIN_EMAIL='…'
export HECTOR_BOOTSTRAP_ADMIN_PASSWORD='…'  # openssl rand -base64 24; min 16
# unset after use
pnpm db:bootstrap:production
```

Creates company + OWNER + WAREHOUSE_OPERATOR roles + system transit. No demo catalog/finance/stock.  
Schema has no forced password-change flag — rotate via UI after first login.

## Smoke tests (after deploy)

**Auth:** login / invalid reject / refresh / reload / logout / cookie HttpOnly+Secure / CORS.  
**Permissions:** OWNER admin paths; WAREHOUSE_OPERATOR warehouse-only; restricted user gets 403 on finance.  
**Workflows:** prefer staging DB or explicitly approved disposable pilot rows with cleanup — do not contaminate live books before backup gate VERIFIED on post-migrate data.

## Existing services

Must remain up: Bazarbashe (postgres/redis), Fanoma, Buy Box. Regress-check after every Hector change.

## Related docs

- `docs/production-backup-restore.md`
- `docs/production-deployment.md`
- `docs/production-rollback.md`
- `docs/production-environment.md`
- `docs/p-2-1-existing-server-compatibility.md`
