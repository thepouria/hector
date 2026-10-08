# P.2 — Production Infrastructure (PR-002)

**Status:** Implementation complete for artifacts + isolated validation.  
**Production go-live:** NOT authorized. P.1 overall remains **NO-GO**.

## 1. Architecture

Single-server Docker Compose:

```
Internet
   |
   | HTTPS (after TLS activation)
   v
Nginx (public :80/:443 only)
   |
   +---- hector.pishete.com --------→ Next.js Web (internal)
   |
   +---- core-hector.pishete.com ---→ NestJS API (internal)
                                           |
                                           v
                                      PostgreSQL 16 (internal only)
```

Planned public URLs:

- Frontend: `https://hector.pishete.com`
- Backend: `https://core-hector.pishete.com`
- Server IPv4 (planned): `62.60.191.119`

P.2 does **not** SSH to that host, change DNS, request certificates, or run production migrations.

## 2. Network diagram

| Network | Purpose | Members |
|---|---|---|
| `public_proxy_network` | Edge / published Nginx ports | nginx, web |
| `internal_application_network` (`internal: true`) | App + DB only | nginx, api, web, postgres, migrate |

PostgreSQL, API, and Web publish **no** host ports. Only Nginx publishes `80/443`.

## 3. Services

| Service | Image | Role |
|---|---|---|
| `nginx` | `nginx:1.27-alpine` | Reverse proxy, ACME HTTP-01, TLS termination (when enabled) |
| `web` | `hector-web:<tag>` | Next.js standalone |
| `api` | `hector-api:<tag>` | NestJS (`node dist/main.js`) |
| `postgres` | `postgres:16-alpine` | Persistent DB |
| `migrate` | `hector-api-migrate:<tag>` | One-off `prisma migrate deploy` (Compose profile) |

## 4. Dockerfiles

- `apps/api/Dockerfile` — multi-stage: `deps` → `build` → `runner` + `migrator`
- `apps/web/Dockerfile` — multi-stage standalone; `NEXT_PUBLIC_API_URL` **build-time**

Build from repo root:

```bash
SHA=$(git rev-parse --short HEAD)
docker build -f apps/api/Dockerfile --target runner -t hector-api:$SHA .
docker build -f apps/api/Dockerfile --target migrator -t hector-api-migrate:$SHA .
docker build -f apps/web/Dockerfile --target runner \
  --build-arg NEXT_PUBLIC_API_URL=https://core-hector.pishete.com \
  -t hector-web:$SHA .
```

## 5. Compose structure

- Production: `infra/production/compose.yaml`
- Isolated smoke overlay: `infra/production/compose.smoke.yaml`
- Env template: `infra/production/env/production.env.example`
- Smoke env (disposable): `infra/production/env/smoke.env`

Dev Postgres remains: root `docker-compose.yml` (unchanged).

## 6. Environment variables

See `infra/production/env/production.env.example` for name, purpose, secret/public, and consumers.

Mandatory API production vars (Zod-validated): `NODE_ENV`, `API_PORT`, `DATABASE_URL`, `JWT_ACCESS_SECRET` (≥32, no weak markers), `CORS_ORIGINS` (must include `https://hector.pishete.com`, no `*`).

## 7. Domain routing

Nginx vhosts in `infra/production/nginx/conf.d/hector.conf`:

- `hector.pishete.com` → `web:3000`
- `core-hector.pishete.com` → `api:3001`

Preserved headers: `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`.

## 8. TLS strategy

1. Start HTTP-only (default configs) so Nginx boots without cert files.
2. ACME HTTP-01 via `/.well-known/acme-challenge/` → `/var/www/certbot`.
3. After certs exist, enable `hector.https.conf.template` → `hector.https.conf`.
4. Enable HTTP→HTTPS redirect + HSTS only after HTTPS verified.

P.2 does not request real certificates.

## 9. PostgreSQL persistence

Named volume `hector_prod_postgres_data`. Survives container restart/recreation. Never `docker compose down -v` in production workflows.

## 10. Migration strategy

- Explicit one-off: `infra/production/scripts/migrate.sh` / Compose profile `migrate`
- Command: `prisma migrate deploy` only
- Not on API startup; not every replica
- No seed, no reset, no `db push`
- Real production requires `HECTOR_PRODUCTION_CONFIRM` + `HECTOR_BACKUP_GATE=verified` (PR-001)

## 11. Deployment strategy

See `docs/production-deployment.md` and `infra/production/scripts/deploy.sh`.

Image identity: Git SHA / release tag via `HECTOR_IMAGE_TAG` (avoid sole reliance on `latest`).

## 12. Rollback strategy

See `docs/production-rollback.md`. Application image rollback ≠ database rollback. Migrations are forward-only.

## 13. Health checks

| Target | Probe |
|---|---|
| API | `GET /health` (includes DB ping) |
| Web | `GET /health` (liveness only) |
| Nginx | `GET /nginx-health` |
| Postgres | `pg_isready` |

## 14. Logging

Stdout/stderr via Docker `json-file` with rotation (`max-size=20m`, `max-file=5`). API uses structured Pino. Secrets redacted in Nest logger config. Full observability = P.6.

## 15. Security defaults (P.2)

- No public DB/API/Web ports
- Internal Docker network for data plane
- Non-root app users (uid 10001)
- `server_tokens off`; baseline proxy headers
- CORS exact origin; credentials enabled
- Refresh cookie: HttpOnly, Secure in production, SameSite=Lax, Path=`/api/v1/auth`, host-only (no `.pishete.com` Domain)
- Nest `trust proxy = 1` in production
- HSTS only in HTTPS template

Full hardening = P.3 (PR-006 open).

## 16. Server prerequisites

Documented in `docs/production-deployment.md`. Not assumed installed.

## 17. DNS instructions (planned — do not change in P.2)

```
A  core-hector  → 62.60.191.119
A  hector       → 62.60.191.119
```

Verify later: `dig core-hector.pishete.com`, `dig hector.pishete.com`.

## 18. Firewall instructions (planned)

Inbound: `22` (restricted), `80`, `443`. Do not expose `5432` or app ports. Do not modify firewall in P.2.

## 19. Verification commands

```bash
./infra/production/scripts/preflight.sh local
HECTOR_ENV_FILE=infra/production/env/smoke.env \
  HECTOR_COMPOSE_OVERRIDE=infra/production/compose.smoke.yaml \
  HECTOR_ALLOW_ISOLATED=1 \
  ./infra/production/scripts/smoke-local.sh
```

## 20. Frontend API URL strategy

**Build-time** `NEXT_PUBLIC_API_URL=https://core-hector.pishete.com`.  
Browser bundles must never call `localhost` or Docker DNS names. Rebuild Web image to change the public API URL.

## 21. Cross-origin auth

`hector.pishete.com` and `core-hector.pishete.com` are same-site (eTLD+1 `pishete.com`) but different origins. CORS allowlist is exact. Cookies are host-only on the API host. Prefer HTTPS so `Secure` cookies work.

## 22. Known limitations

- Resource limits are starting points; finalize after server inspection
- Least-privilege DB roles documented; smoke uses a single app role
- Auth browser smoke over HTTP with `NODE_ENV=production` is limited by `Secure` cookies
- Backup system (PR-001), bootstrap (PR-003), hardening (PR-006), cutover (PR-007) remain open

## 23. Remaining blockers (production GO)

PR-001 backup, PR-003 bootstrap, PR-006 security hardening, PR-007 cutover, real DNS/TLS/server deploy, verified sizing.

## 24. Required test matrix (P.2 evidence)

| Check | Result | Evidence |
|---|---|---|
| API Docker build | PASS | `docker build … --target runner -t hector-api:smoke-local` |
| Web Docker build | PASS | `docker build … -t hector-web:smoke-local` with `NEXT_PUBLIC_API_URL=https://core-hector.pishete.com` |
| Production Compose validation | PASS | `docker compose … config --quiet` + `preflight.sh local` |
| PostgreSQL health | PASS | smoke stack `pg_isready` / healthy |
| API health | PASS | `GET /health` via Nginx Host `core-hector.pishete.com` → `database:ok` |
| Web health | PASS | `GET /health` via Nginx Host `hector.pishete.com` |
| Nginx routing | PASS | Host-based routing smoke on `:18080` |
| HTTPS configuration validation | PASS | `nginx -t` with HTTP + HTTPS template + disposable certs (not production CA) |
| Database private networking | PASS | no published ports; unreachable from `public_proxy_network` |
| API/Web private networking | PASS | no published ports |
| PostgreSQL persistence | PASS | `smoke_persist` row survived Postgres restart |
| Prisma migration job | PASS | migrator `prisma migrate deploy` on disposable DB |
| Production environment validation | PASS | Zod env via API start + `production.env.example` / `smoke.env` |
| Authentication smoke | NOT VERIFIED | no demo seed / no disposable users in production path |
| Container restart | PASS | `compose restart api` → healthy |
| SIGTERM shutdown | PASS | `docker stop`/`start` API with tini → healthy |
| CI compatibility | PASS | `.github/workflows/ci.yml` `docker-production` job added; local build+compose equivalent executed |

## 25. PR-002 gate

PR-002 **CLOSED** against isolated validation criteria. Real production server unchanged.
