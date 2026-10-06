# Authentication

## Authentication model

```text
Email + Password
        ↓
Argon2id password verify
        ↓
Session row + opaque refresh token (HttpOnly cookie)
        ↓
Short-lived JWT access token (Bearer)
```

Phase 0.4 implements **authentication only** (who you are).

Company context is resolved separately in Phase 0.5 via `X-Company-Id` after membership validation — JWT claims stay `sub` / `sid` only. See `docs/architecture/company-context.md`.

RBAC is deferred to Phase 0.6.

## Access token

- Algorithm: signed JWT (`@nestjs/jwt`)
- Default TTL: `15m` (`JWT_ACCESS_TTL`)
- Claims: `sub` (userId), `sid` (sessionId), plus standard `iat` / `exp`
- Returned in JSON login/refresh responses
- Keep in frontend memory — **do not** store long-lived secrets in `localStorage`

Protected requests verify:

1. JWT signature + expiry
2. Session exists, not revoked, not expired
3. User is `ACTIVE`

So logout/revoke invalidates access immediately (one DB lookup per authenticated request).

## Refresh token

- Format: `sessionId.secret` (UUID + high-entropy secret)
- Transport: HttpOnly cookie (`AUTH_REFRESH_COOKIE_NAME`, default `hector_refresh`)
- Storage: **SHA-256 hash of the secret only** (`Session.refreshTokenHash`)
- Raw token is never persisted
- Rotated on every successful refresh
- Session TTL default: 30 days (`AUTH_SESSION_TTL_DAYS`)

Lookup is O(1) via `sessionId`; authenticity requires secret hash match.

### Concurrent refresh

Rotation uses conditional `updateMany`:

```text
WHERE id = sessionId AND refresh_token_hash = expectedHash AND not revoked/expired
```

Only one concurrent refresh wins (`count === 1`). The loser receives `INVALID_REFRESH_TOKEN`.

### Reuse of rotated tokens

Presenting a refresh token that no longer matches the stored hash is rejected and the **session is revoked** (reuse detection). Concurrent refresh still uses conditional rotation: only the loser of `updateMany` fails without revoke.

## Cookie policy

| Property | Value                                           |
| -------- | ----------------------------------------------- |
| HttpOnly | `true`                                          |
| Secure   | `true` in production; `false` on localhost HTTP |
| SameSite | `lax`                                           |
| Path     | `/api/v1/auth`                                  |
| Max-Age  | session TTL                                     |

Assumptions:

- Frontend origin is configured in `CORS_ORIGINS` with `credentials: true`
- Same-site local/dev topology (or same-site production deployment)
- Restrictive CORS + SameSite reduces CSRF risk for cookie-authenticated refresh/logout
- Additional Origin/Referer allowlist check on cookie-auth state-changing routes (Phase 0.11)
- See `docs/security.md` for the full CSRF/CORS strategy

## Password hashing

- Argon2id (`memoryCost: 19456`, `timeCost: 2`, `parallelism: 1`)
- Encapsulated in `PasswordHasher`
- Login uses a dummy verify path when the email is unknown (timing hardening)
- Invalid email and wrong password both return `INVALID_CREDENTIALS`

## Sessions

- Multiple concurrent devices allowed
- `lastUsedAt` updated on login create and refresh rotation
- List/revoke scoped to authenticated `userId`
- Cross-user revoke attempts return `404`
- Logout revokes current session; logout-all revokes **all** user sessions including current

## Endpoints

```text
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
POST   /api/v1/auth/logout-all
GET    /api/v1/auth/me
GET    /api/v1/auth/sessions
DELETE /api/v1/auth/sessions/:sessionId
```

Public routes use `@Public()` (global `AccessTokenGuard`). `/health`, login, and refresh are public.

## Development seed

`DEV_SEED_PASSWORD` hashes are written for:

```text
pouria@hector.local
ahmad@hector.local
hossein@hector.local
```

Seed credentials are **development-only** and must never be used in production.

## Deferred

```text
Domain Events → Phase 0.8
```

Also deferred: registration, password reset, OAuth, 2FA, Redis session cache.
