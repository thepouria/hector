# Production Environment Inventory

Never commit real secrets. Generate with:

```bash
openssl rand -base64 48
```

## Core variables

| Name | Purpose | Sensitive | Required (prod) | Consumer |
|---|---|---|---|---|
| `NODE_ENV` | Runtime mode | No | `production` | API, Web |
| `API_PORT` | Nest listen port | No | Yes (default 3001) | API |
| `DATABASE_URL` | Runtime Prisma URL | **Yes** | Yes | API |
| `DATABASE_URL_MIGRATE` | Migrate job URL | **Yes** | Yes | Migrator |
| `JWT_ACCESS_SECRET` | Access JWT HMAC | **Yes** | Yes (≥32, high entropy) | API |
| `AUTH_REFRESH_PEPPER` | Refresh hash HMAC pepper | **Yes** | Yes (≠ access secret) | API |
| `JWT_ACCESS_TTL` | Access TTL | No | Optional (`15m`) | API |
| `AUTH_SESSION_TTL_DAYS` | Refresh session days | No | Optional (`30`) | API |
| `AUTH_REFRESH_COOKIE_NAME` | Cookie name | No | Optional | API |
| `CORS_ORIGINS` | Exact origin allowlist | No | Yes (`https://hector.pishete.com`) | API |
| `SWAGGER_ENABLED` | Ignored/forced off in prod | No | Optional | API |
| `LOG_LEVEL` | Pino level | No | Optional | API |
| `NEXT_PUBLIC_API_URL` | Browser API base (build-time) | No (public) | Build arg | Web image |
| `DEV_SEED_PASSWORD` | Demo seed only | **Yes** | **Must be unset** | Seed script |
| `HECTOR_WEB_BIND_IP` / `HOST_PORT` | Shared-host loopback | No | Shared-host | Compose |
| `HECTOR_API_BIND_IP` / `HOST_PORT` | Shared-host loopback | No | Shared-host | Compose |
| `DEPLOYMENT_MODE` | `dedicated` \| `shared-host` | No | Scripts | Ops |
| `HECTOR_BACKUP_GATE` | Migrate blocker | No | `verified` for prod migrate | Scripts |
| `HECTOR_PRODUCTION_CONFIRM` | Deploy confirm | No | Literal confirm string | Scripts |
| `HECTOR_BACKUP_DIR` | Local backup root | No | Optional (`/var/backups/hector`) | `backup.sh` |
| `HECTOR_BACKUP_KEEP_DAILY` | Daily retention | No | Optional (`7`) | `backup.sh` |
| `HECTOR_BACKUP_KEEP_WEEKLY` | Weekly retention | No | Optional (`4`) | `backup.sh` |
| `HECTOR_BACKUP_OFFSITE_RSYNC` | Offsite rsync target | **Yes** (path/host) | One of offsite vars for gate | `backup.sh` |
| `HECTOR_BACKUP_OFFSITE_CMD` | Custom offsite command | **Yes** | Alt to rsync | `backup.sh` |
| `HECTOR_BOOTSTRAP_ADMIN_EMAIL` | First OWNER email | No | Bootstrap only | `db:bootstrap:production` |
| `HECTOR_BOOTSTRAP_ADMIN_PASSWORD` | Temp admin password | **Yes** | Bootstrap only (≥16) | `db:bootstrap:production` |

Independent secrets (never reuse the same value):

1. `JWT_ACCESS_SECRET`
2. `AUTH_REFRESH_PEPPER`
3. `POSTGRES_PASSWORD` / migrator password
4. Bootstrap admin password (temporary)

Generate each with `openssl rand -base64 48` (admin password may use `openssl rand -base64 24`).

## Validation

Zod schema: `apps/api/src/config/env.validation.ts` — production startup **fails closed** on unsafe config.  
Template: `infra/production/env/production.env.example`.

## Secret file handling (shared server)

1. Store `/opt/hector/env/production.env` mode `0600`, directory `0700`, owner deploy user.
2. Never pass secrets on CLI argv.
3. Docker env is visible to Docker daemon admins — not a substitute for host admin trust.
4. Rotate via new values + rolling restart; revoke sessions after JWT secret rotation.
5. Unset `HECTOR_BOOTSTRAP_ADMIN_PASSWORD` after successful bootstrap.
6. Keep backup directory off the web root; Nginx must not alias `/var/backups`.
