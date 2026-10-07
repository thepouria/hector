# HECTOR — Phase 6.3
# Channel Settlement Report

**Status:** COMPLETE  
**STOP:** Do **not** begin Phase 6.4 (Reconciliation Engine) automatically.

---

## 1. Mission delivered

One canonical, manual-first **Channel Settlement** engine for marketplace and applicable sales-channel
settlements. Khanoumi, Digikala, Snapp Shop, Website, and Manual use the same model via
`SalesChannel.channelId` — no marketplace-specific settlement services.

```text
Gross Sales → Commission / Returns / Fees / Adjustments
  → Expected Net (derived)
  → Finance Receipt allocations
  → Actual Received / Outstanding
```

Expected Net is never silently rewritten to match the bank. Marketplace APIs are intentionally absent.

---

## 2. Architecture

| Layer | Role |
| --- | --- |
| SalesChannel | Channel identity (Phase 5) |
| ChannelSettlement | Statement header: period, currency, expectedNet, status |
| ChannelSettlementComponent | Traceable lines (GROSS_SALES / COMMISSION / RETURN / FEE / ADJUSTMENT) |
| calculateExpectedNet | Deterministic INCREASE − DECREASE |
| Settlement source CHANNEL | Adapter → settleable expected net receivable |
| Finance Receipt | Actual cash SoT |
| SettlementAllocation (RECEIPT) | Matching; many-to-many; reversible |

Wrong direction (Payment → Channel) is rejected. Commission/Fee do not create fake Payments.
Channel RETURN does not mutate Warehouse stock.

---

## 3. Target Khanoumi scenario (verified e2e STL63-001)

```text
Gross 2,000M − Commission 500M − Returns 20M − Fees 10M + Adj 5M
= Expected Net 1,475M IRR

Receipt R001 1,000M → PARTIALLY_RECEIVED (outstanding 475M)
Receipt R002   475M → RECEIVED (outstanding 0)
```

Digikala + Snapp Shop share the same engine (STL63-002). Excess receipt over-allocate fails;
exact expected amount succeeds with unallocated remainder (STL63-003).

---

## 4. API

```text
POST   /api/v1/settlements/channels
GET    /api/v1/settlements/channels
GET    /api/v1/settlements/channels/:id
PUT    /api/v1/settlements/channels/:id/components
POST   /api/v1/settlements/channels/:id/finalize
POST   /api/v1/settlements/channels/:id/allocate-receipt
POST   /api/v1/settlements/channels/:id/cancel
```

RBAC: `finance.settlements.read` / `finance.settlements.manage`.  
Numbering: `CHS-######`. Idempotency via `requestId` on create / allocate.

---

## 5. Lifecycle

`DRAFT` → finalize → `OPEN` → allocations derive `PARTIALLY_RECEIVED` / `RECEIVED`.  
Cancel requires zero ACTIVE allocations. Component replace blocked after allocation / non-DRAFT.

---

## 6. Integrity

`pnpm settlement:integrity` extended for Channel Settlement (tenant channel, period, components,
expectedNet match, over-receipt, RECEIPT direction, cancelled-with-active, soft duplicate-period warn).

Clean bootstrap after implementation:

```text
docker compose down -v && docker compose up -d
pnpm db:migrate:deploy   # includes 20261017190000_channel_settlement
pnpm db:generate
pnpm db:seed × 2
```

Integrity: **0 hard violations** — Catalog, Purchasing, Warehouse, Inventory, Valuation, Finance, Sales, Party, Settlement.

---

## 7. Documentation

- `docs/settlement-architecture.md` — Channel Settlement section + future adapter flow
- `docs/settlement-invariants.md` — STL-051…078

---

## 8. Final regression

```text
pnpm typecheck          OK
pnpm lint               OK
pnpm test               336 passed
pnpm test:security      32 passed
pnpm test:e2e           588 passed (0 failed / 0 skipped / 0 todo)
pnpm build              OK
```

Mandatory Phase 6.3 channel e2e (STL63-001…005): all green.

---

## 9. Completion gate

```text
Generic Channel Settlement implemented?                    YES
Khanoumi / Digikala / Snapp Shop supported?                YES
Website/Manual supported where applicable?                 YES
Separate engine per marketplace?                           NO
Manual settlement entry supported?                         YES
External API integration implemented?                      NO
Settlement period supported?                               YES
Gross / Commission / Returns / Fees / Adjustments?         YES
Expected Net derived?                                      YES
Expected Net manually overrideable?                        NO
Finance Receipt is actual money truth?                     YES
Partial / multiple receipts / many-to-many?                YES
Excess Receipt silently allocated?                         NO
Outstanding derived?                                       YES
Unsafe historical edits allowed?                           NO
Receipt allocation reversible?                             YES
Returns automatically change Warehouse stock?              NO
Commission creates fake Finance Payment?                   NO
Tenant isolation / concurrency / idempotency?              YES
Auditability preserved?                                    YES
Channel API synchronization implemented?                   NO
Automatic reconciliation implemented?                      NO — Phase 6.4
Professional Wholesale settlement / Profit Engine?         NO
```

---

## 10. Explicit deferred

```text
Phase 6.4 Reconciliation Engine
Marketplace APIs / scraping / auto import
Bank auto-matching / discrepancy resolution
Wholesale AR / collections
Profit / COGS / margin
Elaborate Channel Settlement UI (6.5)
```

---

**Hector now has one canonical Channel Settlement engine.**  
Ready for the Reconciliation Engine in Phase 6.4 — but do **not** start it in this lane.
