# P.2.1 — Existing Server Compatibility

**Status:** Shared-host deployment profile implemented and smoke-tested in isolation.  
**Production go-live:** NOT authorized. Overall readiness remains **NO-GO**.

## 1. Existing server architecture

| Item | Value |
|---|---|
| IP | `62.60.191.119` |
| OS | Ubuntu 24.04 LTS |
| CPU / RAM / Swap | 2 vCPU / 4 GB / 2 GB |
| Disk | ~37 GB root (~25 GB free at last inspection) |
| Docker | Engine 29.1.3 · Compose V2 2.40.3 · Compose V1 1.29.2 (coexist — do not remove V1) |
| Host Nginx | 1.24.0 on port 80 (443 not observed at inspection) |

Existing apps (untouched): Bazarbashe, Fanoma office, Buy Box / marketplace automation.

Known host listeners include `127.0.0.1:5432` (Postgres), `127.0.0.1:6379` (Redis), `127.0.0.1:3000` (Node). Do not assume this list is complete.

## 2. Hector deployment architecture (shared-host)

```
Internet → Host Nginx :80/:443
              ├─ hector.pishete.com      → 127.0.0.1:3100 → Web container
              └─ core-hector.pishete.com → 127.0.0.1:3101 → API container
                                                      └─ Hector Postgres (private Docker network)
```

Dedicated P.2 profile (containerized Nginx) remains available for empty/dedicated servers.

## 3. Host Nginx integration

Templates: `infra/production/host-nginx/`

- HTTP bootstrap: `hector.pishete.com.conf`, `core-hector.pishete.com.conf`
- HTTPS: `*.https.conf.template` (enable only after certs exist)

Install later under `/etc/nginx/sites-available/` — **not during P.2.1**.

## 4. Port bindings

| Service | Binding |
|---|---|
| Web | `127.0.0.1:${HECTOR_WEB_HOST_PORT:-3100}` |
| API | `127.0.0.1:${HECTOR_API_HOST_PORT:-3101}` |
| Postgres | none (Docker DNS `postgres:5432`) |

Never `0.0.0.0` for this profile. Ports are configurable; conflicts fail preflight (no auto-kill / no random port).

## 5. PostgreSQL isolation

- Image: `postgres:16-alpine`
- Volume: `hector_postgres_data` (not Bazarbashe / current volumes)
- Networks: `hector_db` (`internal: true`, Postgres + DB path) and `hector_edge` (loopback publish for host Nginx)
- No host port publish for Postgres
- No shared credentials with Bazarbashe

## 6. Docker project isolation

| Mode | Project name |
|---|---|
| Shared-host production | `hector` |
| Dedicated production | `hector-production` |
| Dedicated smoke | `hector-smoke` |
| Shared-host smoke | `hector-smoke-shared` |

Scripts refuse forbidden projects: `bazarbashe`, `current`, `empire`.

Forbidden ops: global `docker stop $(docker ps -q)`, `system prune`, `volume prune`, `network prune`, `compose down -v`.

## 7. Resource limits

Initial shared-host ceilings (configurable):

| Service | Memory | CPU |
|---|---|---|
| API | 512 MB | 0.50 |
| Web | 512 MB | 0.50 |
| Postgres | 512 MB | 0.50 |

**Estimated Hector memory budget:** ~1.5 GiB ceiling + OS/Docker overhead — leaves headroom on a 4 GB host for existing apps. Tune after real measurements. Prefer prebuilt images (`HECTOR_SKIP_BUILD=1`).

## 8. Compose V2 compatibility

Use `docker compose` (V2 plugin). Do not remove or alter Compose V1. Do not restart the Docker daemon as part of Hector ops.

## 9. Environment configuration

See `infra/production/env/production.env.example`:

- `DEPLOYMENT_MODE=shared-host|dedicated` (required for production scripts)
- Loopback bind vars, resource limits, backup gate, production confirm

## 10. TLS bootstrap (future — not P.2.1)

1. DNS A records → `62.60.191.119`  
2. Verify :80 / :443 reachability  
3. HTTP-only host Nginx sites  
4. Provision Let’s Encrypt  
5. Enable HTTPS templates  
6. `nginx -t` → reload  
7. Verify certs + renewal  
8. HSTS only after HTTPS verified  

Do not request certs or change firewall in P.2.1.

## 11. Deployment commands

```bash
export HECTOR_ENV_FILE=/secure/path/production.env
export DEPLOYMENT_MODE=shared-host
export HECTOR_SKIP_BUILD=1   # prefer prebuilt images
export HECTOR_PRODUCTION_CONFIRM=I_UNDERSTAND_PRODUCTION
# HECTOR_BACKUP_GATE=verified  # required before migrate (PR-001)

./infra/production/scripts/preflight.sh production
./infra/production/scripts/migrate.sh
./infra/production/scripts/deploy.sh
./infra/production/scripts/status.sh
```

## 12. Rollback commands

```bash
export DEPLOYMENT_MODE=shared-host
./infra/production/scripts/rollback.sh <previous-git-sha>
```

Hector project only; no migration reverse; no volume restore.

## 13. Health checks

- API `GET /health` (includes DB)
- Web `GET /health`
- Container healthchecks unchanged from P.2
- Shared-host: probe via `127.0.0.1:3100` / `:3101` (or host Nginx after install)

## 14. Preflight checks

Shared-host adds: loopback bind enforcement, port conflict detection, resolved-config security (no nginx service, no public 80/443, postgres private), resource report + configurable disk/RAM thresholds.

## 15. Auth / CORS / trust proxy

Unchanged from P.2:

- `CORS_ORIGINS=https://hector.pishete.com` (exact, credentials)
- Host-only refresh cookie, Secure in production, Path `/api/v1/auth`, SameSite=Lax
- `trust proxy = 1` (single hop: host Nginx)
- API not publicly bound — only loopback + host Nginx

## 16. Known risks

- Ports 3100/3101 not yet confirmed free on the real server
- 512 MB ceilings may be tight under load — measure before go-live
- Host Nginx / existing sites not regression-tested on the real host in P.2.1
- HTTPS auth cookie path not verified end-to-end without real TLS
- PR-001 backup still blocks production migrate

## 17. Future server verification (on real host later)

1. Confirm free loopback ports  
2. Install host Nginx sites (additive)  
3. `nginx -t` without breaking Bazarbashe/Fanoma  
4. Start Hector project only  
5. Curl both domains via host Nginx  
6. Confirm Bazarbashe/Fanoma still healthy  
7. TLS bootstrap  
8. Auth smoke over HTTPS  

## 18. Remaining production blockers

PR-001 backup, PR-003 bootstrap, PR-006 hardening, PR-007 cutover, real DNS/TLS/deploy.

## 19. Verification matrix (P.2.1)

| Gate | Result |
|---|---|
| Dedicated Compose still valid | PASS |
| Shared-host Compose valid | PASS |
| No containerized Nginx in shared-host mode | PASS |
| Web loopback binding | PASS |
| API loopback binding | PASS |
| PostgreSQL private networking | PASS |
| Hector project isolation | PASS |
| Hector volume isolation | PASS |
| API Docker build | PASS (prior P.2 image / reuse) |
| Web Docker build | PASS (prior P.2 image / reuse) |
| API health | PASS (isolated smoke) |
| Web health | PASS (isolated smoke) |
| Shared-host smoke test | PASS |
| Port conflict detection | PASS (preflight) |
| Resource preflight | PASS |
| Migration safety | PASS |
| Backup gate preserved | PASS |
| Rollback scope | PASS (docs + scripts project-scoped) |
| Log rotation | PASS (json-file 20m×5) |
| Existing server regression | NOT VERIFIED |
| Real HTTPS authentication | NOT VERIFIED |
