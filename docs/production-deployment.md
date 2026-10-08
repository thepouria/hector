# Production Deployment Runbook

**Scope:** Deployment to `62.60.191.119` (shared Ubuntu host).  
**P.4:** Repository prep is complete; do **not** execute against the real server until explicit production-change approval. See `docs/p-4-production-deployment.md`.

## Planned endpoints

| Role | Domain | URL |
|---|---|---|
| Web | `hector.pishete.com` | `https://hector.pishete.com` |
| API | `core-hector.pishete.com` | `https://core-hector.pishete.com` |
| Server | — | `62.60.191.119` |

## Choose deployment mode

| Mode | When | Compose |
|---|---|---|
| `shared-host` | **This server** (host Nginx already on :80) | `compose.shared-host.yaml` |
| `dedicated` | Empty/dedicated server | `compose.yaml` (container Nginx) |

```bash
export DEPLOYMENT_MODE=shared-host   # required for production scripts
```

## Prerequisites (shared host)

- Ubuntu 24.04 LTS, Docker Engine + Compose V2 (leave Compose V1 installed)
- Host Nginx remains the public reverse proxy
- Free loopback ports for Hector (default `127.0.0.1:3100` / `127.0.0.1:3101`) — confirm before deploy
- Disk/RAM headroom for ~1.5 GiB Hector ceiling + existing apps
- Firewall: `:80`/`:443`/restricted `:22` only; never expose Hector DB or app ports publicly
- Directory layout e.g. `/opt/hector/{env,scripts,images}`
- Do not modify Bazarbashe / Fanoma sites, volumes, or containers

## DNS (do not change during P.2.1)

```
A  hector       → 62.60.191.119
A  core-hector  → 62.60.191.119
```

```bash
dig +short hector.pishete.com A
dig +short core-hector.pishete.com A
```

## Environment configuration

1. Copy `infra/production/env/production.env.example` → secure path (never commit).
2. Set `DEPLOYMENT_MODE=shared-host`.
3. Fill secrets: `JWT_ACCESS_SECRET`, `POSTGRES_PASSWORD`, `DATABASE_URL`, `DATABASE_URL_MIGRATE`.
4. Set `HECTOR_IMAGE_TAG` (Git SHA). Prefer `HECTOR_SKIP_BUILD=1` with prebuilt images.
5. Confirm loopback ports and `CORS_ORIGINS=https://hector.pishete.com`.
6. `HECTOR_BACKUP_GATE=verified` only after dump + offsite + restore-verify (`docs/production-backup-restore.md`).
7. `HECTOR_PRODUCTION_CONFIRM=I_UNDERSTAND_PRODUCTION` only on the real server.

## Preferred image workflow (shared host)

Build elsewhere / CI; load on server — avoid monorepo builds on the 4 GB host:

```bash
SHA=$(git rev-parse HEAD)
docker build -f apps/api/Dockerfile --target runner -t hector-api:$SHA .
docker build -f apps/api/Dockerfile --target migrator -t hector-api-migrate:$SHA .
docker build -f apps/web/Dockerfile --target runner \
  --build-arg NEXT_PUBLIC_API_URL=https://core-hector.pishete.com \
  -t hector-web:$SHA .
# transfer images, then:
export HECTOR_SKIP_BUILD=1
```

## Shared-host deploy sequence

1. `./infra/production/scripts/preflight.sh production`
2. Confirm image digests / `HECTOR_IMAGE_TAG`
3. Backup gate (`HECTOR_BACKUP_GATE=verified`)
4. Load prebuilt images (`HECTOR_SKIP_BUILD=1`)
5. `docker compose -p hector -f infra/production/compose.shared-host.yaml --env-file … config`
6. `./infra/production/scripts/migrate.sh` (`prisma migrate deploy` only)
7. `./infra/production/scripts/deploy.sh` (starts postgres/api/web only — **no** container Nginx)
8. Health: `curl -fsS http://127.0.0.1:3100/health` and `:3101/health`
9. Install host Nginx site templates from `infra/production/host-nginx/` (additive)
10. `nginx -t` → reload host Nginx (does not restart Bazarbashe containers)
11. Domain smoke → TLS bootstrap → auth smoke

Forbidden: `docker compose down -v`, `prisma migrate reset`, demo seed, global docker prune, modifying other projects.

## Host Nginx + TLS

See `infra/production/host-nginx/README.md` and `docs/p-2-1-existing-server-compatibility.md`.

HTTP-first bootstrap → ACME → HTTPS templates → HSTS only after verification. Port 443 was not observed listening at last inspection — plan for enabling HTTPS carefully.

## Dedicated-server deploy

Use `DEPLOYMENT_MODE=dedicated` and `infra/production/compose.yaml` (container Nginx). See `docs/p-2-production-infrastructure.md`.

## Post-deploy smoke

```bash
curl -fsS https://hector.pishete.com/health
curl -fsS https://core-hector.pishete.com/health
# Confirm Bazarbashe / Fanoma still healthy (manual)
```

## Backup / bootstrap (P.4)

- Backup: `./infra/production/scripts/backup.sh`
- Restore verify: `./infra/production/scripts/restore-verify.sh`
- Gate: `./infra/production/scripts/mark-backup-gate.sh`
- Cron: `./infra/production/scripts/install-backup-cron.sh`
- Admin: `pnpm db:bootstrap:production` (no demo seed)
- Full runbook: `docs/p-4-production-deployment.md`

## Related open work

PR-006 formal closure (security re-verify) · PR-007 cutover / real business data · production deploy after approval
