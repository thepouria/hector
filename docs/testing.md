# Hector Testing

## Commands

| Command | What it runs |
| --- | --- |
| `pnpm typecheck` | Workspace TypeScript |
| `pnpm lint` | Workspace ESLint |
| `pnpm test` | API Jest unit + Web Vitest unit |
| `pnpm test:e2e` | API e2e (PostgreSQL required) |
| `pnpm test:security` | Focused security regression e2e |
| `pnpm build` | Production builds |

API-only equivalents:

```bash
pnpm --filter @hector/api test
pnpm --filter @hector/api test:e2e
pnpm --filter @hector/api test:security
pnpm --filter @hector/web test
```

## Prerequisites for e2e / security

1. PostgreSQL via `docker compose up -d`
2. `pnpm db:generate && pnpm db:migrate && pnpm db:seed`
3. Root `.env` with `DATABASE_URL`, `JWT_ACCESS_SECRET`, `DEV_SEED_PASSWORD`, `CORS_ORIGINS`

E2E suites create additional temporary companies/users (Company B, limited roles) and clean up only where necessary. They are designed to run against the **development/test** database — never production.

## Layers

### Unit

- Permission helpers, error mapping, env validation, audit sanitizer, CORS/origin middleware, query keys

### Integration / E2E (HTTP)

- Auth sessions, company isolation, RBAC escalation, audit/event semantics, Settings-related Foundation APIs
- Located under `apps/api/test/*.e2e-spec.ts`
- Security matrix: `apps/api/test/security.e2e-spec.ts`

### Frontend

- Vitest for pure helpers (no browser E2E harness in Phase 0)
- Manual verification notes in Phase 0 readiness doc for shell/settings UX

## Fixtures

Seeded (`pnpm db:seed`):

- Company `pishteh`
- Users `pouria@hector.local`, `ahmad@hector.local`, `hossein@hector.local`
- Roles `OWNER`, `WAREHOUSE_OPERATOR`
- Password from `DEV_SEED_PASSWORD` (development-only)

Security/e2e suites additionally create:

- Second company (`hector-security-co-b` / `hector-test-co-b`)
- Outsider / limited users with unique emails

## CI

GitHub Actions workflow `.github/workflows/ci.yml` runs typecheck, lint, unit tests, build, and API e2e/security against a Postgres service.
