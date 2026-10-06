# Phase 0 Readiness

Hector Foundation (Phases 0.1–0.11) status as of Phase 0.11 security hardening.

## Capabilities delivered

| Area | Status |
| --- | --- |
| Monorepo + Docker PostgreSQL | Ready |
| Prisma schema + migrations + seed | Ready |
| NestJS API core (validation, errors, request IDs, logging) | Ready |
| Auth + sessions (Argon2id, JWT access, HttpOnly refresh) | Ready |
| Company / membership / X-Company-Id | Ready |
| RBAC + escalation prevention + last-owner lock | Ready |
| Audit (transactional, redacted, company-scoped) | Ready |
| Domain events (commit-then-publish) | Ready |
| Next.js shell + Settings UI (Persian/RTL) | Ready |
| Security hardening + regression suite | Ready |

## Security gate summary

- Multi-company isolation enforced server-side for Foundation resources
- Cookie auth CSRF mitigated via SameSite=Lax + Origin allowlist on auth routes
- CORS allowlist validated (no credentialed `*`)
- Refresh-token reuse revokes the session
- Production Swagger disabled; production JWT placeholders rejected
- Security regression e2e covers the Phase 0.11 matrix for applicable APIs

See `docs/security.md` and `docs/testing.md`.

## Acceptable Phase 0 limitations

These are intentional deferrals, not open Critical bugs:

- No 2FA / SSO / passkeys / OAuth
- No Redis-backed distributed rate limiter (in-process Nest throttler only)
- No durable outbox / BullMQ for domain events
- No browser Playwright/Cypress E2E harness (API e2e + web unit only)
- No business-domain permissions (warehouse/finance/sales) yet
- Audit table UPDATE/DELETE not revoked at PostgreSQL role level (API is GET-only)
- CSP allows `'unsafe-inline'` / `'unsafe-eval'` for Next.js compatibility

## Production checklist before enabling real traffic

1. Strong unique `JWT_ACCESS_SECRET` (no placeholders)
2. Explicit `CORS_ORIGINS` for the real web origin(s)
3. HTTPS everywhere; Secure cookies enabled (`NODE_ENV=production`)
4. PostgreSQL not publicly exposed
5. Do not run seed in production
6. Confirm Swagger remains disabled
7. Run `pnpm test`, `pnpm test:security`, `pnpm test:e2e`, `pnpm build`

## Phase 0 readiness verdict

Foundation gates for Phase 0 are **ready to proceed to Phase 1 business domains** only after the final Phase 0.11 verification report shows all mandatory security matrix items PASS or documented N/A, with no unresolved Critical/High isolation or auth vulnerabilities.
