# Architecture

## Architecture

Hector starts as a:

```text
Modular Monolith
```

A single NestJS backend hosts future domain modules. Services are not split into microservices at this stage.

## Repository

```text
pnpm workspace + Turborepo
```

- `apps/*` — runnable applications
- `packages/*` — shared libraries (placeholders in Phase 0.1)

## Applications

```text
Next.js frontend
NestJS backend
```

| App           | Path       | Default port        |
| ------------- | ---------- | ------------------- |
| `@hector/web` | `apps/web` | `3000` (`WEB_PORT`) |
| `@hector/api` | `apps/api` | `3001` (`API_PORT`) |

### API routing

- Global prefix: `/api/v1` (future business endpoints)
- Health check: `GET /health` (excluded from the global prefix)

Decision: keep `/health` outside `/api/v1` so readiness/liveness probes remain stable across API version changes.

See also:

- `docs/architecture/backend.md` — NestJS core infrastructure
- `docs/architecture/authentication.md` — auth + sessions (Phase 0.4)
- `docs/architecture/company-context.md` — company isolation (Phase 0.5)
- `docs/architecture/rbac.md` — permissions (Phase 0.6)
- `docs/architecture/audit.md` — durable audit trail (Phase 0.7)
- `docs/architecture/domain-events.md` — post-commit domain events (Phase 0.8)
- `docs/architecture/frontend.md` — Next.js application shell (Phase 0.9)
- `docs/catalog-architecture.md` — Catalog domain foundation (Phase 1.1)
- `docs/purchasing-architecture.md` — Purchasing domain foundation (Phase 2.1)
- `docs/supplier-master.md` — Supplier Master (Phase 2.2)
- `docs/supplier-offers.md` — Supplier Offers / Price Quotes (Phase 2.3)
- `docs/finance-architecture.md` — Finance Core architecture (Phase 4.1)
- `docs/finance-invariants.md` / `docs/finance-domain-boundaries.md` / `docs/finance-currency-and-money.md`

## Database

```text
PostgreSQL + Prisma (`@hector/database`)
```

PostgreSQL 16 runs via Docker Compose. Prisma owns schema, migrations, seed, and the shared client export.

### Foundation domain (Phase 0.2)

```text
User / Session
Company / CompanyMember
Role / Permission / RolePermission / CompanyMemberRole
AuditLog
```

Key invariants:

- Multi-company via `CompanyMember` (not `companyId` on User)
- Multi-role via `CompanyMemberRole`
- Permissions are global; roles are company-scoped
- Cross-company role assignment is forbidden (enforced in RBAC app logic later)
- AuditLog is append-only; actor may be null for system actions
- Never use floating-point for money (Finance phase)
- Timestamps are timezone-safe (`timestamptz`); company timezone is presentation/business context
- Financial/inventory history will not use destructive deletes (reversal/correction later)

See `packages/database/README.md` for commands and detailed conventions.

## Infrastructure philosophy

For local development:

```text
Infrastructure → Docker
Applications → local Node processes
```

Expected workflow:

```bash
docker compose up -d
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

## Future modules

Architectural context only — not implemented in Phase 0.1:

```text
Identity
Companies
Products
Purchasing
Inventory
Orders
Finance
Settlements
Pricing
Intelligence
Audit
Integrations
```
