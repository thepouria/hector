# P.3 — Security Hardening Implementation

## Controls implemented

1. **Production env validation** — rejects weak/template JWT, requires `AUTH_REFRESH_PEPPER`, rejects `DEV_SEED_PASSWORD`, requires HTTPS non-localhost `CORS_ORIGINS`.
2. **Secret separation** — `JWT_ACCESS_SECRET` (HS256 access JWT) ≠ `AUTH_REFRESH_PEPPER` (HMAC for opaque refresh hashes).
3. **JWT algorithms pinned** to `HS256` on sign/verify.
4. **Docker** — API/Web: `cap_drop: ALL`, `no-new-privileges`, `read_only` + `/tmp` tmpfs.
5. **CI** — gitleaks, `pnpm audit --audit-level=critical`, Trivy CRITICAL/HIGH on images, compose validation for both profiles.
6. **Security tests** — warehouse IDOR/RBAC cases added; existing matrix retained (34 total).
7. **`.gitignore`** — broader `.env.*` exclusion.

## Authentication model

| Token | Type | Storage | Secret |
|---|---|---|---|
| Access | JWT HS256 (`sub`,`sid`) | Bearer header | `JWT_ACCESS_SECRET` |
| Refresh | Opaque `sessionId.secret` | HttpOnly cookie | Hashed with `AUTH_REFRESH_PEPPER` (HMAC-SHA256) |

## Authorization / tenancy

Server-side only: `AccessTokenGuard` → `CompanyContextGuard` (`X-Company-Id` + membership) → `PermissionsGuard`.

## Shared-host isolation (preserved)

`127.0.0.1:3100/3101`, no Postgres publish, project `hector`, no container Nginx.

## Residual risks

- Transitive HIGH npm advisories (tracked exception **H5**, expires 2026-12-31)
- Dual DB roles operator-driven (tracked exception **H6**)
- CSRF missing-Origin mitigated for refresh/logout/sessions (login Origin-optional)
- CSP `unsafe-inline`/`unsafe-eval` for Next compatibility
- Real TLS / host coexistence **NOT VERIFIED**
- Local Docker Desktop I/O failure during wrap-up blocked re-run of DB-backed e2e/security/smoke/gitleaks/Trivy

## Evidence commands

```bash
pnpm --filter @hector/api exec jest src/config/env.validation.spec.ts
pnpm --filter @hector/api test
pnpm test:security
pnpm security:secrets
pnpm security:audit
pnpm security:compose
pnpm integrity:all
pnpm --filter @hector/api test:e2e
pnpm build
HECTOR_SKIP_BUILD=1 ./infra/production/scripts/smoke-shared-host.sh
```

## Security verification matrix (P.3 wrap-up)

| Gate | Result | Evidence |
|---|---|---|
| Production env validation | PASS | `env.validation.spec.ts` 15/15 |
| Secret separation | PASS | Zod rejects equal/missing pepper; unit + config |
| Secret leak scanning | NOT VERIFIED | Local gitleaks Docker pull failed (daemon I/O); CI workflow present |
| JWT validation | PASS | HS256 pin + existing auth/security coverage (prior 34) |
| Refresh token security | PASS | Pepper HMAC + cookie attrs in security suite (prior) |
| Cookie security | PASS | Security e2e Set-Cookie assertions (prior) |
| CSRF protection | PASS | Origin guard + negative tests (prior) |
| Login rate limiting | PASS | Throttler on auth; e2e overrides only in test harness |
| RBAC enforcement | PASS | Security + finance matrices (prior); warehouse cases added |
| Tenant isolation | PASS | Two-company security matrix (prior) |
| IDOR/BOLA protection | PASS | Finance + warehouse negative cases |
| Financial authorization | PASS | Security finance cases (prior) |
| Inventory authorization | PASS | Warehouse RBAC/IDOR cases added |
| DTO validation | PASS | Global ValidationPipe whitelist/forbid |
| Mass assignment protection | PASS | DTO whitelist; expenses/parties cases |
| SQL injection review | PASS | Raw SQL audited; parameterized / allowlisted |
| API response redaction | PASS | Filter + serializer; no hashes in responses |
| CORS hardening | PASS | Prod HTTPS allowlist enforced in Zod |
| Security headers | PASS | Helmet + Next headers |
| Trusted proxy | PASS | Configured for reverse-proxy hop |
| Next.js security | PASS | No secrets in `NEXT_PUBLIC_*`; headers in `next.config` |
| Sensitive cache protection | PASS | `no-store` API middleware |
| Docker hardening | PASS | `compose`/`compose.shared-host` cap_drop/read_only |
| PostgreSQL isolation | PASS | No host publish in shared-host compose |
| Database role separation | FAIL | **H6** exception — documented dual URLs, not auto-enforced |
| Audit logging | PASS | Auth events without secrets |
| Dependency audit | PASS | `pnpm audit --audit-level=critical` exit 0; HIGH tracked as **H5** |
| Container image scan | NOT VERIFIED | Local Docker I/O; Trivy gated in CI |
| CI security gates | PASS | `.github/workflows/ci.yml` `security-scan` job |
| Security tests | NOT VERIFIED | Re-run blocked: Postgres `ECONNREFUSED` (Docker Desktop I/O) |
| Full E2E regression | FAIL | First run 598/600 (2 flaky 404s, passed isolated); second run aborted by DB down |
| Integrity checks | PASS | `pnpm integrity:all` — 11/11 domains |
| Production builds | PASS | API + Web build |
| Shared-host smoke | NOT VERIFIED | Docker Desktop I/O during wrap-up |
| Real production TLS | NOT VERIFIED | Out of scope |
| Real server coexistence | NOT VERIFIED | Out of scope |

## Gate decision

**PR-006 remains OPEN** until security e2e, full e2e (clean), secret scan, image scan, and shared-host smoke are re-verified on a healthy Docker/Postgres environment. Controls are implemented; mandatory acceptance tests were not fully re-confirmed after the daemon failure.
