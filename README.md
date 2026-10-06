# Hector

Hector is a Business Operating System designed to unify commerce, inventory, finance, purchasing, marketplace operations and company management.

This repository is a pnpm + Turborepo monorepo. Phase 0.1 establishes the development foundation only — no business features yet.

## Requirements

- Node.js 22
- pnpm
- Docker
- Docker Compose

## Installation

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

## Services

| Service    | URL / address                  |
| ---------- | ------------------------------ |
| Web        | http://localhost:3000          |
| API        | http://localhost:3001          |
| Health     | http://localhost:3001/health   |
| Swagger    | http://localhost:3001/api/docs |
| PostgreSQL | localhost:5432                 |

## Useful commands

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm format
pnpm format:check

pnpm db:generate
pnpm db:migrate
pnpm db:migrate:deploy
pnpm db:seed
pnpm db:studio

docker compose up -d
docker compose down
docker compose logs -f postgres
```

## Database

PostgreSQL access lives in `@hector/database` (Prisma). See `packages/database/README.md`.

Development seed creates the Pishteh company, local users (`*@hector.local`), OWNER / WAREHOUSE_OPERATOR roles, and foundation permissions.

## PostgreSQL persistence

PostgreSQL data is stored in a named Docker volume (`hector_postgres_data`).

- `docker compose down` stops containers but **keeps** the volume and data.
- Data is removed only when the volume is explicitly deleted (for example `docker compose down -v`).

## Health endpoint

The API uses a global prefix of `/api/v1` for versioned business routes.

`GET /health` is intentionally excluded from that prefix so infrastructure probes can use a stable, unversioned path. The health check includes a lightweight PostgreSQL connectivity probe.

OpenAPI docs (when `SWAGGER_ENABLED=true`): http://localhost:3001/api/docs

Backend architecture notes: `docs/architecture/backend.md`.
Company context notes: `docs/architecture/company-context.md`.
RBAC notes: `docs/architecture/rbac.md`.
Audit notes: `docs/architecture/audit.md`.

## Catalog (Phase 1)

Canonical commerce identity lives in Catalog. Start here:

- `docs/catalog-invariants.md` — **required reading** for Warehouse / Inventory / Purchasing / Sales
- `docs/catalog-architecture.md`
- `docs/catalog-audit-events.md`
- `docs/catalog-bulk-operations.md`
- `docs/catalog-search.md`
- `docs/catalog-api.md` / `docs/catalog-ui.md`

Read-only integrity check (does not mutate):

```bash
pnpm --filter @hector/database exec tsx scripts/catalog-integrity-check.ts
```

## Purchasing (Phase 2)

**Status: CLOSED (2.16 Final QA)** — commercial buy commitments through Audit + Events.
Physical receipt / barcode scanner = **Phase 3 Warehouse** (not implemented here).

Capabilities:

- Supplier master, contacts, notes (company-scoped)
- Supplier offers / historical quotes
- Purchase Orders: `CASH` · `TERM_CREDIT` · `FX_CREDIT`
- Credit terms + contractual due dates (not payment status)
- Purchase costs, corrections, discrepancies, short-close, return **intent**
- Lifecycle: `DRAFT → APPROVED → ORDERED` (+ `CANCELLED`)
- Receiving **contract** for Phase 3 (no GoodsReceipt tables yet)
- Operator UI + purchasing dashboard
- Audit + in-process domain events

Docs (start here):

- `docs/purchasing-invariants.md` — **required reading** for Warehouse / Finance
- `docs/purchasing-architecture.md`
- `docs/supplier-master.md` / `docs/supplier-offers.md`
- `docs/purchase-orders.md` / `docs/purchase-types.md` / `docs/fx-purchases.md`
- `docs/credit-terms.md` / `docs/purchase-costs.md` / `docs/purchase-lifecycle.md`
- `docs/purchase-receiving-contract.md` / `docs/purchase-returns-corrections.md`
- `docs/purchasing-api.md` / `docs/purchasing-ui.md` / `docs/purchase-dashboard.md`
- `docs/purchasing-audit.md` / `docs/purchasing-events.md`

Useful scripts:

```bash
pnpm db:check:purchasing   # read-only integrity (0 violations expected)
pnpm db:check:catalog      # Phase 1 catalog integrity
pnpm test                  # unit
pnpm test:security
pnpm test:e2e
```

## Warehouse (Phase 3)

**Status: Phase 3 COMPLETE — READY FOR PHASE 4** — Warehouse is the physical inventory source of truth (Movement ledger → Balance projection → Reservations / FIFO / Valuation).  
No Finance GL, Sales orders, Marketplace, Settlement, or Profit Engine yet.

Docs:

- `docs/inventory-reconciliation.md` — Phase 3.18 read-only reconcile gate (`pnpm inventory:reconcile`)
- `docs/inventory-dashboard.md` — Phase 3.17 dashboard
- `docs/warehouse-audit.md` / `docs/warehouse-domain-events.md` — Phase 3.17
- `docs/inventory-reservations.md` / `docs/fifo-cost-layers.md` / `docs/inventory-valuation.md` — Phase 3.15
- `docs/supplier-return-execution.md` — Phase 3.14 supplier return dispatch
- `docs/inventory-adjustments.md` — Phase 3.13 manual adjustments
- `docs/stock-counts.md` — Phase 3.13 stock / cycle counts
- `docs/stock-issue.md` — Phase 3.12 non-sales outbound
- `docs/stock-classification.md` — Phase 3.12 classification
- `docs/stock-transfer.md` — Phase 3.11 internal transfer
- `docs/stock-balance.md` — Phase 3.10 On Hand projection
- `docs/inventory-ledger.md` — Phase 3.9 Inventory Movement Ledger
- `docs/putaway.md` — Phase 3.8 Putaway
- `docs/batch-management.md` — Phase 3.7 Batch / Lot
- `docs/barcode-scanner-receiving.md` — Phase 3.6 scanner receiving
- `docs/purchase-receiving.md` — Phase 3.5 Purchase Receiving workflow
- `docs/goods-receipts.md` — Phase 3.4 Goods Receipt / GRN
- `docs/warehouse-locations.md` — Phase 3.3 semantics
- `docs/warehouse-master.md` — Phase 3.2 semantics
- `docs/warehouse-architecture.md`
- `docs/warehouse-invariants.md` — includes WH-INT-001…030
- `docs/warehouse-purchasing-contract.md`
- `docs/warehouse-sales-contract.md`
- `docs/phase-3.18-final-qa-report.md` — Final QA report

### Finance (Phase 4.5 — FX + Currency Ledger)

**Status: Phase 4.5 COMPLETE — READY FOR 4.6**

- `docs/finance-fx-currency.md` — FIN-FX-001…025 + APIs + settlement contract note for 4.9
- `docs/phase-4.5-fx-currency-report.md` — Phase 4.5 report (46 sections)
- `docs/finance-supplier-payables.md` — FIN-AP-001…025 + allocation/FX contracts
- `docs/phase-4.4-supplier-payables-report.md` — Phase 4.4 report (44 sections)
- `docs/finance-funding-loans.md` — FIN-FUND-001…008 + FIN-LOAN-001…014 + APIs
- `docs/phase-4.3-capital-loans-report.md` — Phase 4.3 report (43 sections)
- `docs/finance-accounts.md` — FIN-ACC-001…020 + APIs (Phase 4.2)
- `docs/phase-4.2-accounts-report.md` — Phase 4.2 report
- `docs/finance-architecture.md` — Finance Core architecture
- `docs/finance-invariants.md` — FIN-CUR / FIN-FX / FIN-FUND / FIN-LOAN / FIN-AP / FIN-CASH / FIN-JRN / FIN-TEN
- `docs/finance-domain-boundaries.md` — ownership matrix + recognition matrix
- `docs/finance-currency-and-money.md` — Money / Currency / FX / rounding
- `docs/finance-purchasing-contract.md` — Purchasing → Finance (recognition live)
- `docs/finance-warehouse-contract.md` — Warehouse → Finance
- `docs/phase-4.1-finance-architecture-report.md` — Phase 4.1 report

```bash
pnpm db:check:finance     # accounts + capital/loans + payables integrity (0 violations expected)
pnpm db:check:warehouse   # warehouse + inventory workflow integrity (0 violations expected)
pnpm db:check:inventory   # StockBalance = SUM(Ledger) per position
pnpm db:check:valuation   # reservations + FIFO + valuation
pnpm inventory:reconcile  # unified Phase 3.18 read-only gate (exit 0 = OK)
```

Phase 2 receiving port (already implemented): `apps/api/src/modules/purchasing/contracts/`.

Ownership: Catalog = what · Purchasing = ordered · Warehouse = physical · Finance = money · Sales = orders.

Auth docs: `docs/architecture/authentication.md`.

```bash
# After seed, login with a development user and DEV_SEED_PASSWORD from .env
curl -c cookies.txt -X POST http://localhost:3001/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"pouria@hector.local","password":"'"$DEV_SEED_PASSWORD"'"}'

# Use accessToken from the response
curl http://localhost:3001/api/v1/auth/me \
  -H "authorization: Bearer <accessToken>"

curl -b cookies.txt -c cookies.txt -X POST http://localhost:3001/api/v1/auth/refresh
```

Company-scoped routes also require a validated membership header (see `docs/architecture/company-context.md`):

```bash
curl http://localhost:3001/api/v1/companies \
  -H "authorization: Bearer <accessToken>"

curl http://localhost:3001/api/v1/members \
  -H "authorization: Bearer <accessToken>" \
  -H "x-company-id: <companyUuid>"
```

Seed credentials are development-only and must never be used in production.

## Local development workflow

1. Start infrastructure with Docker Compose (`postgres`).
2. Run applications as local Node processes with `pnpm dev`.

Frontend and backend stay outside containers in Phase 0.1 for faster iteration.
