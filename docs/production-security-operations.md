# Production Security Operations

## Generate secrets

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # AUTH_REFRESH_PEPPER (must differ)
openssl rand -base64 32   # DB passwords
```

## Provision secrets

1. Write to `production.env` offline.
2. `chmod 600` the file; do not commit.
3. Load via Compose `--env-file` only.

## Rotate JWT access secret

1. Deploy new `JWT_ACCESS_SECRET`.
2. All access tokens invalidate immediately.
3. Users refresh via cookie (if refresh pepper unchanged) or re-login.

## Rotate refresh pepper

1. Schedule maintenance: all sessions must re-login (stored hashes become unverifiable).
2. Deploy new `AUTH_REFRESH_PEPPER`.
3. Optionally `UPDATE sessions SET revoked_at = now()`.

## Rotate database credentials

1. Create new role/password in Postgres.
2. Update `DATABASE_URL` / `DATABASE_URL_MIGRATE`.
3. Rolling restart API/migrator.
4. Drop old password.

## Revoke sessions

- User logout / logout-all endpoints.
- Or DB: mark sessions revoked for `userId`.

## Investigate auth failures

```bash
./infra/production/scripts/logs.sh api 500
# Look for INVALID_CREDENTIALS, FORBIDDEN, COMPANY_NOT_FOUND (no secrets in logs)
```

## Leaked credential response

1. Rotate the leaked secret immediately.
2. Revoke sessions if auth material leaked.
3. Audit recent privileged actions.
4. Do not rely on deleting a file from Git history alone.

## Validate production config

```bash
export DEPLOYMENT_MODE=shared-host
export HECTOR_ENV_FILE=/opt/hector/env/production.env
./infra/production/scripts/preflight.sh production
```

API process must refuse to boot if Zod validation fails.
