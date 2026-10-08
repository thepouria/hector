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

### Finance (Phase 4.10 — API + UI Coherence)

**Status: Phase 4.10 COMPLETE — READY FOR 4.11** (Finance dashboard; do not invent Profit here)

Sales (Phase 5.1) owns Channel + Customer master only — Receivables / marketplace settlement remain Finance (later) / Phase 6. See `docs/sales-architecture.md`.

- `docs/finance-api-ui.md` — FIN-UI-001…024 + navigation/API map
- `docs/phase-4.10-finance-api-ui-report.md` — Phase 4.10 report (45 sections)
- `docs/finance-liability-settlement.md` — FIN-SET-001…014 (Phase 4.9)
- `docs/phase-4.9-liability-settlement-report.md` — Phase 4.9 report
- `docs/finance-ledger-journal.md` — FIN-JRN-001…035 + PO/GRN/AP/Inventory timing
- `docs/phase-4.8-financial-ledger-journal-report.md` — Phase 4.8 report (49 sections)
- `docs/finance-money-movements.md` — FIN-MOV-001…028 + anti-double-count matrix + APIs
- `docs/phase-4.6-payments-receipts-transfers-report.md` — Phase 4.6 report (§156 STATUS)
- `docs/finance-fx-currency.md` — FIN-FX-001…025 + APIs
- `docs/phase-4.5-fx-currency-report.md` — Phase 4.5 report (46 sections)
- `docs/finance-supplier-payables.md` — FIN-AP-001…025
- `docs/phase-4.4-supplier-payables-report.md` — Phase 4.4 report (44 sections)
- `docs/finance-funding-loans.md` — FIN-FUND-001…008 + FIN-LOAN-001…014 + APIs
- `docs/phase-4.3-capital-loans-report.md` — Phase 4.3 report (43 sections)
- `docs/finance-accounts.md` — FIN-ACC-001…020 + APIs (Phase 4.2)
- `docs/phase-4.2-accounts-report.md` — Phase 4.2 report
- `docs/finance-architecture.md` — Finance Core architecture
- `docs/finance-invariants.md` — FIN-CUR / FIN-FX / FIN-FUND / FIN-LOAN / FIN-AP / FIN-MOV / FIN-CASH / FIN-JRN / FIN-UI / FIN-TEN
- `docs/finance-domain-boundaries.md` — ownership matrix + recognition matrix
- `docs/finance-currency-and-money.md` — Money / Currency / FX / rounding
- `docs/finance-purchasing-contract.md` — Purchasing → Finance (recognition live)
- `docs/finance-warehouse-contract.md` — Warehouse → Finance
- `docs/phase-4.1-finance-architecture-report.md` — Phase 4.1 report

```bash
pnpm db:check:finance     # Finance integrity (Phase 4.12; 0 violations expected)
pnpm finance:integrity    # alias for db:check:finance
pnpm db:check:warehouse   # warehouse + inventory workflow integrity (0 violations expected)
pnpm db:check:inventory   # StockBalance = SUM(Ledger) per position
pnpm db:check:valuation   # reservations + FIFO + valuation
pnpm inventory:reconcile  # unified Phase 3.18 read-only gate (exit 0 = OK)
pnpm db:check:sales       # Sales integrity
pnpm sales:integrity      # alias
pnpm party:integrity      # Party + domain-link integrity (Phase 5.5.2)
pnpm settlement:integrity # Settlement integrity (Phase 6.1 + 6.2 + 6.3)
pnpm reconciliation:integrity # Reconciliation integrity (Phase 6.4)
pnpm phase6:integrity         # Settlement + Reconciliation aggregate
pnpm integrity:all            # All domain integrity checkers (read-only; CI post-E2E gate)
pnpm ci:verify                # Local CI equivalent: generate → typecheck → lint → unit → security → e2e → integrity:all → build

# Critical: do NOT reset the DB between `pnpm test:e2e` and integrity.
# `test:e2e` already runs integrity:all after Jest against the same database.
# Why: CI must prove the suite itself left Hector internally consistent.
pnpm finance:reconcile        # Finance + Settlement + Reconciliation
pnpm party:reconcile      # read-only cross-domain Party reconciliation
pnpm party:migrate --dry-run
pnpm party:migrate --apply
```

### Local CI / integrity investigation

Reproduce GitHub Actions gates locally (Postgres via Docker, migrate deploy, seed, then verify):

```bash
docker compose down -v && docker compose up -d
# wait until: docker compose exec -T postgres pg_isready -U hector -d hector
pnpm db:migrate:deploy
pnpm db:seed
pnpm ci:verify   # or step through: typecheck → lint → test → test:security → test:e2e → build
```

- E2E only: `pnpm test:e2e` (Jest `--runInBand`, then `integrity:all`, no DB reset between).
- Integrity only (after a green E2E, same DB): `pnpm integrity:all`.
- Single domain: `pnpm purchasing:integrity`, `pnpm finance:integrity`, etc.
- On `[FAIL] <Domain>`, re-run that domain command for the full violation list; do not repair/reset before diagnosing.
- To add a gate: implement a read-only script under `packages/database/scripts/`, wire `package.json` + `run-all-integrity.ts`, document hard vs warning exit semantics. See `docs/p-1-2-ci-integrity-hardening.md`.


### Sales (Phase 5 — CLOSED) + Party Master (Phase 5.5 — COMPLETE)

**Phase 5 Sales: CLOSED.** **Phase 5.5 Party Master: COMPLETE** (5.5.1–5.5.3).

- UI: `/app/parties` — list, create, detail (identity / contacts / addresses / roles / related entities / activity)
- API: `/api/v1/parties` — semantic ops, `POST /duplicate-check`, `GET /:id/related-entities` (RBAC-aware)
- `docs/sales-architecture.md` — ownership + SalesOrder/Return/Fulfillment + formulas + lifecycle
- `docs/sales-recognition.md` — fulfillment-scoped AR recognition policy
- `docs/sales-invariants.md` — SALE-001…052
- `docs/party-architecture.md` — Party Master + domain linking
- `docs/party-domain-linking.md` — Supplier/Customer/Partner/Finance Party FKs
- `docs/party-migration.md` — migrate / integrity / reconcile
- `docs/party-invariants.md` — PARTY-001… + PARTY-LINK-001…025
- `docs/phase-5.5.3-party-master-final-qa-report.md` — final QA gate

### Settlement / Reconciliation (Phase 6 — CLOSED)

Generic Settlement / Item / Allocation foundation with Supplier Payable, Loan, FX,
**Channel Settlement**, **Reconciliation Engine**, and **Settlement Center UI/Dashboard**.

- UI: `/app/settlements` — overview, payables, loans, channels, reconciliation, audit
- API: `/api/v1/settlements` — core + payables/loans + channels + `dashboard`
- API: `/api/v1/reconciliations` — open, match, candidates, close-matching, discrepancies, resolve
- `docs/settlement-architecture.md` — ownership + FX + Channel + Reconciliation + SoT boundaries
- `docs/settlement-invariants.md` — STL-001…078 + REC-001…030 + SET-001…025
- `docs/settlement-ui.md` — operator UI map
- `docs/reconciliation.md` — Phase 6.4 engine
- `docs/phase-6-settlement-reconciliation-final-report.md` — Phase 6 final report
- Integrity: `pnpm settlement:integrity` · `pnpm reconciliation:integrity` · `pnpm phase6:integrity`

Phase 2 receiving port (already implemented): `apps/api/src/modules/purchasing/contracts/`.

Ownership: Catalog = what · Purchasing = ordered · Warehouse = physical · Finance = money · Sales = channels/customers/orders/execution · Party = identity · **Settlement = allocation/matching**.

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
