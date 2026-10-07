# Settlement Architecture (Phase 6.1 + 6.2 + 6.3)

**Status:** Settlement Allocation Core (6.1) + Payables / Loans / FX (6.2) + Channel Settlement (6.3) complete.  
Phase 6.4 Reconciliation Engine is documented in `docs/reconciliation.md`.
Phase 6.5 Settlement Center UI / Dashboard is documented in `docs/settlement-ui.md`.

---

## 1. Responsibility

```text
Finance     = Money Truth (payments, receipts, accounts, journals, loans, FX rates)
Settlement  = Matching / Allocation Truth
Purchasing  = Supplier Payable origin / purchase adjustments
Sales       = Channel / order operational truth
Party       = Counterparty identity
```

A Finance Payment or Receipt does **not** automatically mean any particular obligation was settled.
Settlement establishes that relationship via Allocation.

---

## 2. Source-of-truth boundaries

| Domain | Owns |
| --- | --- |
| Purchasing | Purchase / supplier obligation origin + adjustments / returns |
| Warehouse | Physical inventory |
| Sales | Sales / channel operational truth |
| Finance | Payments / receipts / accounts / currency / journal / loans |
| Party | Counterparty identity |
| Settlement | Allocation between obligations and finance transactions |

Settlement must **never** become SoT for payment amount, receipt amount, bank balance, loan principal, purchase amount, sales amount, or party identity.

---

## 3. Relationship to Phase 4.9

Phase 4.9 **SupplierPaymentAllocation** remains a live Supplier AP settle path
(`POST /finance/payments/:id/settlements`, etc.).

Phase 6.2 domain commands (`POST /settlements/payables/:id/settle`, etc.) use the
**generic SettlementAllocation** engine and write supplier liability movements with
`sourceType = SETTLEMENT_ALLOCATION`. Capacity is shared across all allocation tables
(STL-007). Do **not** dual-write the same economic settle into both tables.

---

## 4. Core model

```text
Settlement (case / process)
  ├── SettlementItem (obligation reference + attach-time snapshot)
  └── SettlementAllocation (append-only matching evidence)
        └── SettlementAllocationFxDetail? (cross-currency only)
```

Allocate-enabled sources:

```text
MANUAL_OBLIGATION   → SettlementManualObligation (scaffold)
SUPPLIER_PAYABLE    → SupplierPayable (+ liability movements)
LOAN                → Loan (principal via disbursements/repayments + core allocations)
CHANNEL             → ChannelSettlement (expected net receivable ← Finance Receipt)
```

---

## 5. Channel Settlement (Phase 6.3) — manual-first, channel-agnostic

### 5.1 Principle

One generic engine. Do **not** create Khanoumi/Digikala/Snapp-specific settlement services.

```text
SalesChannel
      ↓
ChannelSettlement
      ↓
ChannelSettlementComponent[]
      ↓
Expected Net (derived)
      ↓
SettlementAllocation (RECEIPT)
      ↓
Finance Receipt
```

Khanoumi, Digikala, Snapp Shop, Website, Manual, and future marketplaces share the same model.
Channel identity is `channelId` → existing `SalesChannel` (Phase 5). No duplicate marketplace enum.

### 5.2 Manual-first / API-ready

Today operators enter period + components manually. Tomorrow marketplace adapters may populate the
**same** canonical model after normalizing statement data. Adapters must **not** bypass Expected Net
calculation or write Finance/Settlement with marketplace-specific money logic.

```text
Marketplace API / Import
          ↓
Channel Adapter (future — NOT implemented in 6.3)
          ↓
Normalized Settlement Input
          ↓
Canonical ChannelSettlement + Components
          ↓
Expected Net
          ↓
Finance Receipt → Allocation
```

Explicitly **not** in 6.3: Khanoumi/Digikala/Snapp APIs, scraping, statement download automation,
automatic commission fetching, bank auto-matching (→ 6.4).

### 5.3 Components

| Type | Typical effect | Notes |
| --- | --- | --- |
| GROSS_SALES | INCREASE | Gross basis — not net receipt |
| COMMISSION | DECREASE | Separately traceable |
| RETURN | DECREASE | Financial statement deduction only — does **not** mutate Warehouse stock |
| FEE | DECREASE | Generic fee; description required |
| ADJUSTMENT | INCREASE or DECREASE | Direction + description required |

Amounts are always **positive**; economic direction is `INCREASE` / `DECREASE` (never ambiguous signed-only amounts).

```text
Expected Net = Σ(INCREASE amounts) − Σ(DECREASE amounts)
```

Server derives Expected Net. Client-supplied `expectedNet` / `actualReceived` / `outstanding` are rejected.
Negative Expected Net blocks normal finalization. Zero Expected Net is allowed (auditable; may be RECEIVED without Receipt).

Commission/Fee deductions do **not** create fake Finance Payments.

### 5.4 Period vs payment date

`periodStart` / `periodEnd` describe the settlement statement window.
Actual cash date lives on the Finance Receipt. Do not mutate period to match payment date.

### 5.5 Actual money = Finance Receipt

```text
actualReceived = SUM(ACTIVE allocations with financeTxnType = RECEIPT)
outstanding    = expectedNet − actualReceived
difference     = actualReceived − expectedNet   (informational; 6.4 owns discrepancy workflow)
```

Normal flow rejects over-receipt beyond Expected Net. Excess Receipt capacity remains unallocated until
an Adjustment or another settlement explains it. Finance Payment → Channel Settlement is rejected.

Partial receipts, multiple receipts per settlement, and one receipt → multiple settlements are mandatory
(reuse Phase 6.1 many-to-many + locking).

### 5.6 Lifecycle

| Status | Meaning |
| --- | --- |
| DRAFT | Preparing components; not allocateable |
| OPEN | Finalized; Expected Net frozen for allocation |
| PARTIALLY_RECEIVED | received > 0 and outstanding > 0 (derived) |
| RECEIVED | outstanding = 0 (derived; including zero-net finalize) |
| CANCELLED | No ACTIVE allocations (reverse first) |

After ACTIVE allocations exist, component edits that would rewrite Expected Net history are blocked.
Corrections use explicit ADJUSTMENT (or reverse allocations then correct in controlled flow).

### 5.7 Duplicate protection

Scoped uniqueness: `company + channel + externalReference` when reference is present.
Integrity soft-warns suspicious same channel/period/expectedNet duplicates without auto-merge.

---

## 6. Critical currency principle (6.2)

**Never confuse obligation currency with reference / reporting valuation.**

Channel Settlement components must match settlement currency (no cross-currency channel settlement in 6.3).

---

## 7. Capacity / concurrency

Capacity checks consider **payment/receipt currency amount** and **obligation currency outstanding**
atomically. Concurrent over-settlement / over-allocation / over-receipt is rejected (STL-007 / STL-008 / STL-064).

---

## 8. Reversal

```text
ACTIVE → REVERSED (+ reason, actor, timestamp)
```

- Restores obligation outstanding in **original obligation currency**
- Does **not** reverse the Finance Payment / Receipt
- FX historical evidence retained on the reversed allocation + FX detail

---

## 9. Lifecycle / status derivation (core Settlement case)

| Status | Meaning |
| --- | --- |
| DRAFT | Preparing; no ACTIVE allocations |
| OPEN | Zero ACTIVE allocated |
| PARTIALLY_SETTLED | ACTIVE > 0 and remaining > 0 |
| SETTLED | remaining = 0 |
| CANCELLED | No ACTIVE allocations |

Supplier payable: `OPEN` / `PARTIALLY_PAID` / `PAID` from movement outstanding.  
Loan: `ACTIVE` / `PARTIALLY_REPAID` / `SETTLED` from principal outstanding.  
Channel: see §5.6.

Clients cannot PATCH economic status/amounts.

---

## 10. Outstanding queries

```text
GET /settlements/outstanding/payables
GET /settlements/outstanding/loans
GET /settlements/channels?outstandingOnly=true
```

Filters: party/channel, currency, status, period. Paginated. Totals **grouped by currency**.

---

## 11. Minimal API

### Core + 6.2

```text
POST   /settlements
GET    /settlements/:id
POST   /settlements/manual-obligations
POST   /settlements/:id/items
POST   /settlements/:id/open
POST   /settlements/:id/allocations
POST   /settlements/:id/allocations/:allocationId/reverse
POST   /settlements/:id/cancel

POST   /settlements/payables/:payableId/settle
GET    /settlements/payables/:payableId/summary
POST   /settlements/loans/:loanId/repay
GET    /settlements/loans/:loanId/summary
GET    /settlements/outstanding/payables
GET    /settlements/outstanding/loans
```

### Channel (6.3)

```text
POST   /settlements/channels
GET    /settlements/channels
GET    /settlements/channels/:id
PUT    /settlements/channels/:id/components
POST   /settlements/channels/:id/finalize
POST   /settlements/channels/:id/allocate-receipt
POST   /settlements/channels/:id/cancel
```

Receipt allocation reversal reuses core:
`POST /settlements/:settlementId/allocations/:allocationId/reverse`.

RBAC: `finance.settlements.read` / `finance.settlements.manage` (Receipt allocate / reverse require manage).

No elaborate Channel Settlement UI in 6.3 (deferred to 6.5).

---

## 12. Audit / events

Channel audits (naming follows audit constants): Created / Updated / Finalized / Cancelled + component changes.
Domain events: ChannelSettlementOpened / PartiallyReceived / Received / Cancelled where useful.
Generic Settlement allocation events cover Receipt allocate/reverse — avoid duplicate semantic pairs.

Idempotent retries do not re-emit economic events.

---

## 13. Integrity

```bash
pnpm settlement:integrity
```

Read-only. Includes Channel Settlement checks: SalesChannel tenant match, period validity, component
currency/amount, expectedNet vs components, over-receipt, RECEIPT txn direction, cancelled-with-active,
suspicious duplicate periods (soft warning). Never auto-repairs.

---

## 14. Explicit deferred scope

```text
Marketplace APIs / scraping / auto import
Professional Wholesale settlement / AR aging / collections
Profit Engine / COGS / margin
Payment-gateway Website reconciliation automation
Bank feed / ML reconciliation
```

## 15. Phase 6.5 — Settlement Center

Operator navigation under **تسویه**: Overview dashboard, Payables, Loans, Channel Settlements,
Reconciliation Center, Audit timeline.

```bash
GET /api/v1/settlements/dashboard
```

Currency-aware KPIs + attention queue. Frontend never becomes financial SoT (`docs/settlement-ui.md`).

Integrity:

```bash
pnpm settlement:integrity
pnpm reconciliation:integrity
pnpm phase6:integrity
pnpm finance:reconcile   # finance + settlement + reconciliation
```

## 16. Final source-of-truth boundaries (Phase 6 CLOSED)

```text
Product Master     → product identity
Purchasing         → purchase commitment / supplier commercial truth
Warehouse          → physical stock truth
Finance            → actual money truth
Sales              → sales/order truth
Party              → person/organization identity truth
Settlement         → obligation/allocation truth
Reconciliation     → expected-vs-actual review/resolution truth
```
