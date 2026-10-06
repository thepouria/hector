# Finance Dashboard + Audit + Events (Phase 4.11)

Operational finance dashboard, finance-scoped audit API/UI, and domain-event hygiene. **Not** Profit / Revenue / Sales / COGS.

## Snapshot vs period

| Section | Window | Source of truth |
|---|---|---|
| Account balances | As-of now | `SUM(IN) − SUM(OUT)` AccountMovements on ACTIVE accounts |
| Supplier / loan / expense outstanding | As-of now | Movement-derived / payment-allocation-derived |
| Due soon / overdue | As-of today (+7 days) | Outstanding > 0 with dueDate |
| Money In / Money Out | Period `[from, to]` | POSTED Receipts / Payments only |
| Expenses recorded / by category | Period | Approved expenses by `expenseDate` |
| Cash movement trend | Period + one `chartCurrency` | Receipts vs Payments buckets |
| Recent activity | Last N | Finance-filtered AuditLog rows |

Default period: last **30** calendar days inclusive. Presets: `today`, `1d`, `7d`, `30d`, `this_month`, `custom`.

## Currency separation

- Never sum IRR + USD (or any distinct currencies) into one total.
- Money amounts remain Decimal-safe strings.
- Trend series is single-currency (`chartCurrency`).
- Top suppliers ranked **within** each currency group.

## Money In / Out semantics

| Label | Meaning | Not |
|---|---|---|
| Money In | POSTED Receipts in period | Revenue |
| Money Out | POSTED Payments in period | Expense |
| Cash movement trend | Money In vs Money Out | Profit |
| Internal transfer | AccountTransfer POSTED | Excluded from Money In/Out |

Loan disbursement cash uses specialized AccountMovement source types (not Receipt). A Receipt with `sourceType=LOAN` still counts as Money In — and is **still not Revenue**.

## RBAC strip (FIN-DASH)

Caller must have `finance.dashboard.read`. Sections omitted (not zero-faked) when missing:

- `finance.accounts.read` → accounts
- `finance.payables.read` → payables / top suppliers
- `finance.loans.read` → loans
- `finance.expenses.read` → expense snapshot + period expense metrics
- `finance.payments.read` / `finance.receipts.read` → money out / in + trend
- `finance.audit.read` **or** `audit.read` → recentActivity

## Finance audit (FIN-AUD)

- `GET /finance/audit` + `GET /finance/audit/:id` require `finance.audit.read`
- Entity types restricted to finance set (`FINANCE_AUDIT_ENTITY_TYPES`)
- Non-finance `entityType` filter → **400**
- Read-only (no edit/delete)
- UI: `/app/finance/audit` + `FinanceEntityHistory` on payment / receipt / expense / loan / payable detail

## Domain events (FIN-EVT)

Catalog: `FINANCE_DOMAIN_EVENT_TYPES` ↔ `DOMAIN_EVENTS` finance.* keys in `domain-events.registry.ts`.

Deprecated aliases documented in `FINANCE_DOMAIN_EVENT_TYPES` / `FINANCE_DOMAIN_EVENT_DEPRECATED_ALIASES` (not separate registry keys).

**Known limitation:** events are in-process (`commitThenPublish` → DomainEventBus). No durable outbox, no Kafka in Phase 4.

## Invariants

### FIN-DASH-001…014

| ID | Rule |
|---|---|
| **FIN-DASH-001** | Dashboard values come from canonical Finance truth. |
| **FIN-DASH-002** | Currencies are never implicitly summed. |
| **FIN-DASH-003** | Money In is not Revenue. |
| **FIN-DASH-004** | Money Out is not Expense. |
| **FIN-DASH-005** | Cash movement is not Profit. |
| **FIN-DASH-006** | Capital contribution is not Revenue. |
| **FIN-DASH-007** | Loan receipt is not Revenue. |
| **FIN-DASH-008** | Loan principal is Liability, not Expense. |
| **FIN-DASH-009** | Internal transfers are not external company inflow/outflow. |
| **FIN-DASH-010** | Outstanding liabilities use current canonical outstanding. |
| **FIN-DASH-011** | Fully settled liabilities do not count as overdue. |
| **FIN-DASH-012** | Dashboard aggregation is tenant-scoped. |
| **FIN-DASH-013** | Dashboard does not bypass underlying RBAC (sections omitted). |
| **FIN-DASH-014** | Dashboard financial aggregation is Decimal-safe. |

Implementation notes: due-soon window = `FINANCE_LIABILITY_DUE_SOON_DAYS` (7); Money In/Out = POSTED Receipts/Payments; snapshot ≠ period.

### FIN-AUD-001…010

| ID | Rule |
|---|---|
| **FIN-AUD-001** | Material Finance mutations are auditable. |
| **FIN-AUD-002** | Audit records are immutable to normal users. |
| **FIN-AUD-003** | Audit records are tenant-scoped. |
| **FIN-AUD-004** | Audit actor comes from authenticated context. |
| **FIN-AUD-005** | Audit financial amounts preserve currency and exact precision. |
| **FIN-AUD-006** | Financial corrections create new audit actions rather than rewriting history. |
| **FIN-AUD-007** | Audit metadata contains no credentials/secrets. |
| **FIN-AUD-008** | Audit and business records can be correlated. |
| **FIN-AUD-009** | Reads do not generate noisy mutation audit logs. |
| **FIN-AUD-010** | Cross-company audit access is impossible. |

Finance-scoped API: `GET /finance/audit` requires `finance.audit.read`; entity types restricted to finance set; non-finance filter → 400.

### FIN-EVT-001…010

| ID | Rule |
|---|---|
| **FIN-EVT-001** | Finance events represent committed business facts. |
| **FIN-EVT-002** | Failed transactions do not emit committed success events. |
| **FIN-EVT-003** | Events are tenant-scoped. |
| **FIN-EVT-004** | Money in event payloads is Decimal-safe and currency-explicit. |
| **FIN-EVT-005** | Idempotent business requests do not produce duplicate canonical events. |
| **FIN-EVT-006** | Events have unique identities. |
| **FIN-EVT-007** | Audit and Events remain separate concepts. |
| **FIN-EVT-008** | Event payloads do not dump entire DB entities. |
| **FIN-EVT-009** | JournalLine-level event storms are avoided. |
| **FIN-EVT-010** | Future consumers can subscribe without changing Finance domain truth. |

**Known limitation:** in-process `commitThenPublish` only — no durable outbox / Kafka in Phase 4.

## Event catalog (finance.*)

See `FINANCE_DOMAIN_EVENT_TYPES` in `apps/api/src/modules/finance/finance.constants.ts` and matching keys in `domain-events.registry.ts` (accounts, transfers, capital, loans, payables/settlements, FX, payments, receipts, expenses, purchase costs, journals).
