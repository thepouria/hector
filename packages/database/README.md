# `@hector/database`

Framework-agnostic PostgreSQL access for Hector via Prisma.

Owns:

- Prisma schema
- migrations
- seed infrastructure
- generated Prisma Client
- shared `prisma` export

## Commands

From the repository root:

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:migrate:deploy
pnpm db:seed
pnpm db:studio
```

Typical local workflow:

```bash
docker compose up -d
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- `db:migrate` → `prisma migrate dev` (development)
- `db:migrate:deploy` → `prisma migrate deploy` (CI/production)
- Do **not** use `prisma db push` as the normal schema workflow

## Usage

```ts
import { prisma } from '@hector/database';

const users = await prisma.user.findMany();
```

## Conventions

### IDs

UUID primary keys, generated in PostgreSQL with `gen_random_uuid()`.

Human-readable document numbers (`PO-000123`, etc.) are separate future fields.

### Timestamps

Mutable entities use `createdAt` / `updatedAt` as `timestamptz`.

Database timestamps are independent of presentation timezone. Company `timezone` (for example `Asia/Tehran`) controls display/business interpretation only. Jalali calendars are presentation-only and never stored as schema types.

### Soft deletion

`deletedAt` is used only where soft deletion is semantically appropriate:

| Model             | Soft delete              |
| ----------------- | ------------------------ |
| User              | yes                      |
| Company           | yes                      |
| Role              | yes                      |
| Session           | no (`revokedAt` instead) |
| CompanyMember     | no (`status` instead)    |
| Permission        | no                       |
| RolePermission    | no                       |
| CompanyMemberRole | no                       |
| AuditLog          | no (append-only)         |
| Brand / Category / Product / Sku | no (`status` + `archivedAt`) |
| Barcode           | no (explicit manage later) |

### Catalog foundation (Phase 1.1)

Operational identity is **SKU**, not Product. See `docs/catalog-architecture.md`.

- Company-scoped uniqueness for SKU code and barcode value
- Composite FKs keep Brand/Category/Product/SKU/Barcode on the same company
- Partial unique index: at most one primary barcode per SKU
- No stock, cost, price, marketplace IDs, or warehouse fields on Catalog models

### Historical / ledger records

Financial journal rows and inventory movements will **not** support destructive deletion. Corrections will use reversal/correction records. `AuditLog` is already append-only (`createdAt` only).

### Money

Hector must never use floating-point values for monetary calculations. Future finance models will use PostgreSQL/`Decimal` or integer minor-units as appropriate. No money tables exist in Phase 0.2.

`Company.baseCurrency` is a small foundation enum (`IRR`, `USD`) only. Full multi-currency accounts, rates, and ledgers belong to the Finance phase.

### Naming

- Prisma: `CompanyMember`, `createdAt`
- PostgreSQL: `company_members`, `created_at` via `@@map` / `@map`

### Multi-company

Users do not carry `companyId`. Membership is via `CompanyMember`. One user may belong to many companies; one member may hold many roles via `CompanyMemberRole`.

### Cross-company role invariant

A `CompanyMember` from Company A must never receive a `Role` belonging to Company B.

Prisma relations alone do not enforce this. Application-level checks belong to the RBAC phase. Database triggers are intentionally avoided here.

### Soft-deleted role uniqueness

`Role` uniqueness is `@@unique([companyId, key])` including soft-deleted rows. Soft-deleted roles still occupy the key. Partial unique indexes are deferred to keep the schema maintainable.

### Auth sessions (Phase 0.4)

`Session.lastUsedAt` tracks login/refresh activity. Refresh tokens are stored only as hashes (`refreshTokenHash`). See `docs/architecture/authentication.md`.

### Membership status (Phase 0.5)

`CompanyMemberStatus` includes `REMOVED` for access removal while preserving historical membership identity. Reactivation reuses the same row and preserves `joinedAt`. See `docs/architecture/company-context.md`.

### Permission registry (Phase 0.6)

Permission keys live in `src/permissions.ts` (`PERMISSIONS` / `PERMISSION_DEFINITIONS`). Seed runs `syncPermissions` + `syncOwnerRolePermissions` so OWNER roles across companies receive every registered permission. See `docs/architecture/rbac.md`.

### Referential actions

| Relation                          | onDelete |
| --------------------------------- | -------- |
| Session → User                    | Cascade  |
| CompanyMember → Company/User      | Restrict |
| Role → Company                    | Restrict |
| RolePermission → Role             | Cascade  |
| RolePermission → Permission       | Restrict |
| CompanyMemberRole → CompanyMember | Cascade  |
| CompanyMemberRole → Role          | Restrict |
| AuditLog → Company                | Restrict |
| AuditLog → User (actor)           | SetNull  |

Audit history must survive user lifecycle changes (`actorUserId` is nullable for system actions).

### Audit indexes

- `(companyId, createdAt)` — company timeline
- `(companyId, entityType, entityId)` — entity history
- `(actorUserId)` — actor lookup

## Seed notes

Development seed is idempotent (`upsert`).

- Company: Pishteh (`pishteh`, IRR, Asia/Tehran)
- Users: `pouria@hector.local`, `ahmad@hector.local`, `hossein@hector.local`
- Roles: OWNER (all foundation permissions), WAREHOUSE_OPERATOR (no inventory permissions yet)
- `passwordHash` is the placeholder `DEV_ONLY_PASSWORD_HASH_NOT_SET` (not a real hash)

## Prisma Studio

```bash
pnpm db:studio
```
