# P.3 — Security Audit

**Date:** 2026-10-08  
**Scope:** Repository controls for production readiness (PR-006)  
**Server:** Not accessed (`62.60.191.119` untouched)

## Summary

Hector already had a strong Phase-0 security baseline (Argon2id, opaque rotating refresh cookies, RBAC, company scoping, ValidationPipe whitelist, helmet, CORS allowlist, CSRF Origin guard, security e2e). P.3 closed production env fail-fast gaps, secret separation for refresh hashing, Docker container lockdown, and CI supply-chain gates.

## Findings

### CRITICAL

None remaining after P.3 remediations.

### HIGH

| ID | Finding | Status |
|---|---|---|
| H1 | Production accepted template JWT (`REPLACE_WITH…`) | **FIXED** — weak markers + entropy checks |
| H2 | No independent refresh crypto material | **FIXED** — `AUTH_REFRESH_PEPPER` (HMAC; refresh is opaque, not JWT) |
| H3 | Compose lacked `cap_drop` / `no-new-privileges` / `read_only` | **FIXED** for API/Web |
| H4 | No secret/dependency/image scanning in CI | **FIXED** — gitleaks + audit + Trivy gates |
| H5 | Transitive HIGH npm advisories (prisma mysql2, next/postcss, braces) | **OPEN — exception** (see below) |
| H6 | Dual DB roles not auto-enforced in Compose | **OPEN — exception** (documented; private network compensating) |

**H5 exception:** Owner=platform; expires=2026-12-31; compensating: mysql2 unused (Postgres adapter); braces/postcss primarily build/dev or Next transitive — track upgrades without major-version blind bumps.  
**H6 exception:** Owner=ops; expires=P.4/ops bootstrap; compensating: no host `5432`, internal Docker network, separate `DATABASE_URL` / `DATABASE_URL_MIGRATE` supported.

### MEDIUM

| ID | Finding | Status |
|---|---|---|
| M1 | Production CORS could default to localhost | **FIXED** — explicit HTTPS origins required |
| M2 | CSRF allows missing Origin | **MITIGATED** — refresh/logout/sessions require Origin/Referer; login Origin-optional |
| M3 | Incomplete IDOR e2e beyond finance | **PARTIAL** — warehouse cases added |
| M4 | In-memory throttler only | Residual until multi-replica |
| M5 | CSP `unsafe-inline`/`unsafe-eval` | Residual (Next compatibility) |
| M6 | `DEV_SEED_PASSWORD` allowed in production env | **FIXED** — rejected |

### LOW / INFORMATIONAL

Savepoint-only `$executeRawUnsafe`; health unauthenticated DB ping; host-nginx HSTS deferred until TLS verified; no file uploads (N/A).

## Already solid (pre-P.3)

- Argon2id passwords; login enumeration-safe messages  
- Access JWT + DB session re-check; refresh rotation + reuse revoke  
- Cookie: HttpOnly, Secure(prod), SameSite=Lax, Path=`/api/v1/auth`, host-only  
- `PermissionsGuard` + `CompanyContextGuard`  
- Finance IDOR/RBAC in `security.e2e-spec.ts`  
- Pino/audit redaction; Swagger forced off in production  
- Shared-host loopback binds; Postgres unpublished  

## Verification notes

Do not treat documentation alone as closure. See `docs/p-3-security-hardening.md` for implemented controls and the verification matrix.

**Wrap-up blocker (2026-10-08):** Local Docker Desktop developed overlay2/containerd I/O errors; `localhost:5432` became `ECONNREFUSED` despite a stale “healthy” container listing. Security e2e re-run, gitleaks Docker run, Trivy, and shared-host smoke could not be completed in this environment. Integrity (11/11), API unit (348), env validation unit (15), critical audit, and production builds did pass. Full e2e first pass was 598/600 with two flaky suites that passed when re-run alone.

**PR-006 status:** OPEN until DB-backed and Docker-backed gates are re-verified.
