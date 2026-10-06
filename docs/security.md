# Hector Security

Actionable Phase 0 security model for authentication, tenancy, RBAC, and browser/API boundaries.

## Trust boundaries

```text
Browser (untrusted)
  → Next.js shell (UX only; never authoritative for authz)
  → NestJS API (authoritative)
  → Company context + RBAC guards
  → Application services + Prisma transactions
  → PostgreSQL
```

**Never trust the browser for authorization.** Frontend `can()` checks are UX only.

## Authentication model

- Passwords: **Argon2id** (see `PasswordHasher`)
- Access token: short-lived Bearer JWT (`sub`, `sid` only) kept in **memory**
- Refresh token: opaque `sessionId.secret` in **HttpOnly** cookie `hector_refresh`
- Cookie: `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/api/v1/auth`
- Session validity is re-checked on every authenticated request (revoked/expired → 401)
- Login errors use a single `INVALID_CREDENTIALS` message (no email enumeration)
- Login/refresh endpoints are throttled (`@Throttle`)

### Session lifecycle

1. Login creates a new session + rotates cookie (session fixation safe)
2. Refresh rotates the refresh hash atomically
3. Reuse of a rotated refresh token **revokes the session**
4. Logout / logout-all / revoke-session invalidate server-side sessions

## CSRF strategy

Deployment assumption: Hector web origin is listed in `CORS_ORIGINS` and shares a same-site or trusted first-party relationship with the API.

Defense layers:

1. Most mutations use **Bearer** access tokens (not cookies) → not CSRF-vulnerable
2. Cookie surface is limited to `/api/v1/auth` with **SameSite=Lax**
3. State-changing auth routes additionally reject untrusted **Origin/Referer** against the CORS allowlist

No separate CSRF token framework in Phase 0.

## CORS strategy

- Explicit allowlist from `CORS_ORIGINS` (comma-separated absolute origins)
- `credentials: true`
- Rejects `*`, `null`, and non-HTTP(S) origins at startup validation

## Company isolation

- Company scope requires authenticated user + `X-Company-Id` + **active** membership
- Missing header → `400 COMPANY_CONTEXT_REQUIRED`
- Foreign / unknown company → `404 COMPANY_NOT_FOUND` (prevents membership enumeration)
- Suspended → `403 MEMBERSHIP_SUSPENDED`
- Removed → `403 MEMBERSHIP_REMOVED`
- Resource reads/mutations are company-scoped (foreign member/role/audit IDs → 404)

## RBAC

- Permission keys from `@hector/database` registry
- Escalation prevention: cannot grant permissions/roles beyond actor effective set
- System roles are immutable for delete/key/permission replacement
- Last active OWNER protected under company row lock (`SELECT … FOR UPDATE`)

Frontend permissions are a rendering optimization; backend always re-evaluates.

## Audit

- Append-only via Nest APIs (GET list/detail only)
- Written in the same DB transaction as the business mutation
- Failed mutations do not leave success audit rows
- Snapshots sanitized (`audit-sanitizer`) — passwords/tokens/cookies redacted
- Company-scoped; pagination bounded (`MAX_PAGE_SIZE=100`)

## Domain events

- Emitted only after successful commit (`commitThenPublish`)
- Payloads are IDs/status/keys — no secrets
- In-process bus (not durable); outbox deferred

## Secret handling

- `.env` / `.env.local` gitignored
- Production rejects placeholder JWT secrets
- Seed passwords require `DEV_SEED_PASSWORD` and refuse `NODE_ENV=production`
- No secrets in `NEXT_PUBLIC_*`

## Security testing

```bash
pnpm test:security   # focused API security regression e2e
pnpm test:e2e        # full API e2e suite
pnpm test            # unit tests (api + web)
```

## Production assumptions

- API and web served over HTTPS
- PostgreSQL is not publicly exposed
- `CORS_ORIGINS` lists only trusted web origins
- Swagger is **disabled in production**
- Helmet + `Cache-Control: no-store` on API responses
- Next.js sets baseline security headers / CSP
