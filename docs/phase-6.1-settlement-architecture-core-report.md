# HECTOR — Phase 6.1
# Settlement Architecture + Core Report

**Status:** COMPLETE  
**STOP:** Do **not** begin Phase 6.2 automatically.

---

## 1. Baseline

Pre-implementation gates (from prior Phase 5.5.3 closeout / mid-6.1 scaffolding) were green on typecheck/lint/unit. Clean bootstrap for 6.1 completion:

```text
docker compose down -v && docker compose up -d
pnpm db:migrate:deploy   # includes 20261015160000_settlement_allocation_core
pnpm db:generate
pnpm db:seed × 2
```

Integrity after clean bootstrap (all **0 violations**):

| Check | Result |
| --- | --- |
| Catalog | OK |
| Purchasing | OK |
| Warehouse | OK |
| Inventory | OK |
| Valuation | OK |
| Finance | OK |
| Sales | OK |
| Party (+ reconcile) | OK |
| Settlement | OK |

---

## 2. Existing Phase 4 Settlement Foundation

Phase 4.9 already provides **SupplierPaymentAllocation** as the live Supplier AP settle path
(`SettlementService` under `/finance/.../settlements`).

Phase 6.1 **does not replace** that path. It adds a generic Settlement/Item/Allocation core that:

- coexists with 4.9
- shares Payment allocation capacity via `payment-allocation-capacity.ts`
- enables only `MANUAL_OBLIGATION` for allocate-enabled source testing
- defers Supplier / Loan / FX domain workflows to **6.2**

---

## 3. Architecture Decisions

| Decision | Choice |
| --- | --- |
| Core entities | `Settlement`, `SettlementItem`, `SettlementAllocation` (+ `SettlementManualObligation` scaffold) |
| Source refs | Controlled `SettlementSourceType` + adapter registry |
| Finance refs | `SettlementFinanceTxnType` + id; hard FK `paymentId` when PAYMENT |
| Money | Finance `Prisma.Decimal` / `parseMoneyAmount` (no JS float) |
| Status | Derived after OPEN from ACTIVE allocations |
| Capacity | Shared SUM across core + supplier + expense + purchase-cost allocations |
| RBAC | Reuse `finance.settlements.read` / `.manage` |
| Numbering | Race-safe `settlement_sequences` → `STL-######` |

---

## 4. Source-of-Truth Boundaries

```text
Finance     → money movement
Settlement  → matching / allocation
Party       → identity
Source domains → obligation amounts (scaffold exception: MANUAL_OBLIGATION)
```

Settlement never mutates Payment amount, bank balance, loan principal, or Party identity.

---

## 5. Settlement Model

Company-scoped case: number, type, status, optional partyId, working currency, reference/notes, requestId, cancel metadata.

---

## 6. Settlement Item Model

Controlled source reference + attach-time snapshot of currency/originalAmount (audit/display). Allocated/remaining/item status are **derived**.

---

## 7. Source Reference Strategy

Typed enum + `resolveSettleableSource` adapter. Validates existence, company, currency, settleability, party consistency. Arbitrary string polymorphism forbidden.

---

## 8. Finance Transaction Reference

Authoritative 6.1 target: **POSTED Payment**. Receipt enum reserved; not allocate-enabled yet.

---

## 9. Allocation Engine

`SettlementsCoreService.allocate` — single canonical engine: validate, lock, capacity-check, create ACTIVE row, derive status, audit/events, idempotency.

Does **not** create payments, journals, or mutate Finance amounts.

---

## 10. Many-to-Many Allocation

Supported: one Payment → many obligations; one obligation → many Payments; across multiple Settlement records; with global payment capacity.

---

## 11. Partial Settlement

First-class: ACTIVE allocated > 0 ∧ remaining > 0 → `PARTIALLY_SETTLED`.

---

## 12. Multiple Settlement

Multiple allocations complete one obligation; each allocation independently traceable.

---

## 13. Allocation Reversal

`ACTIVE → REVERSED` (actor, timestamp, reason). No hard-delete. Does **not** reverse Finance Payment.

---

## 14. Lifecycle

`DRAFT → OPEN → PARTIALLY_SETTLED → SETTLED` + `CANCELLED` (only with zero ACTIVE allocations).

DRAFT has no economic allocations (plans do not consume capacity).

---

## 15. Status Derivation

After OPEN, status recomputed from SUM(ACTIVE). Clients cannot PATCH status/amounts.

---

## 16. Currency Foundation

Same-currency only in 6.1. Cross-currency rejected (`SETTLEMENT_CURRENCY_MISMATCH`). FX path deferred to 6.2.

---

## 17. Party Integration

Optional `partyId` with composite company FK. Must not contradict source party.

---

## 18. Tenant Isolation

Company-scoped FKs / unique `(id, companyId)` composites. Cross-company payment/obligation/settlement rejected.

---

## 19. Concurrency

Lock order: **Payment → Settlement → SettlementItem** (`FOR UPDATE`). Race e2e proves no over-allocate / over-settle.

---

## 20. Idempotency

`requestId` unique per company. Same payload → replay; different payload → `SETTLEMENT_IDEMPOTENCY_CONFLICT`.

---

## 21. Security

Semantic commands only (no status/amount PATCH). Permission-gated. Tenant IDOR covered in e2e.

---

## 22. Audit / Events Foundation

Audit: `SETTLEMENT_CORE_*`  
Events (post-commit): `settlement.created|opened|allocation.created|allocation.reversed|partially_settled|completed|cancelled`

---

## 23. Integrity

```bash
pnpm settlement:integrity
```

Read-only checks for orphans, cross-company, over-allocation (shared capacity), over-settlement, currency mismatch, status contradictions, reversal metadata, unsupported ACTIVE sources.

---

## 24. Database Constraints

- Unique settlement number / requestId per company
- Allocation `amount > 0` CHECK
- Composite FKs for settlement/item/payment/party
- Polymorphic source validity enforced in app + integrity (not DB FK to all domains)

---

## 25. Indexes

`companyId+number`, status/type, settlementId, itemId, financeTxn, paymentId, sourceType+sourceId, allocation status — as defined in schema.

---

## 26. Purchasing Regression

Purchasing integrity OK on clean bootstrap. Phase 4.9 AP settle path unchanged.

---

## 27. Finance Regression

Finance integrity OK. Shared capacity wired into Phase 4.9 settlement service. Full e2e suite passed including finance suites.

---

## 28. Party Regression

`party:integrity` + `party:reconcile` OK on clean bootstrap.

---

## 29. Clean Bootstrap

Executed successfully; all domain integrity checks **0 violations** including Settlement.

---

## 30. Automated Tests

### Unit (`pnpm test`)

```text
@hector/api: Test Suites: 64 passed, 64 total
@hector/api: Tests:       332 passed, 332 total
Failed = 0 | Skipped = 0 | Todo = 0
```

(Includes `settlement-numbering.spec.ts`.)

### Security

```text
Test Suites: 1 passed
Tests:       32 passed
Failed = 0 | Skipped = 0 | Todo = 0
```

### E2E (`pnpm test:e2e`) — full suite after clean seed

```text
Test Suites: 63 passed, 63 total
Tests:       574 passed, 574 total
Failed = 0 | Skipped = 0 | Todo = 0
```

Settlement core suite (`settlement-core.e2e-spec.ts`): **12/12 passed**  
(partial, multi-pay, multi-obligation, capacity, reverse, cancel, tenant, currency, idempotency, payment race, obligation race, unsupported source).

---

## 31. Build

```text
pnpm build — Tasks: 7 successful, 7 total
```

---

## 32. Documentation

- `docs/settlement-architecture.md`
- `docs/settlement-invariants.md` (STL-001…030)
- README updated with `settlement:integrity` + Phase 6.1 section

---

## 33. Bugs Found

1. **STL-CORE-003 test assertion** initially expected over-allocate on an already-SETTLED settlement (got `SETTLEMENT_INVALID_STATUS`). Fixed test to use a third OPEN settlement — engine behavior correct.
2. Unused `ExpensePaymentAllocationStatus` import left after capacity refactor in Phase 4.9 service — removed (TS6133).

---

## 34. Known Limitations

- Only `MANUAL_OBLIGATION` allocate-enabled; domain sources registered but rejected until 6.2+
- Receipt finance txn type not enabled
- No FX conversion / gain-loss
- No production Settlement UI (6.5)
- Full e2e on shared DB can leave warehouse/valuation dirty until reseed/rebuild (pre-existing; clean bootstrap remains 0)

---

## 35. Technical Debt

- Dual settlement paths (4.9 SupplierPaymentAllocation + 6.1 core) until 6.2 migration
- Manual obligation is a temporary scaffold, not a long-term domain entity
- Polymorphic source FKs cannot be fully expressed in DB

---

## 36. Open Issues

None blocking Phase 6.1. Ready for 6.2 domain adapters (Supplier Payable / Loan / FX) with care not to conflate IRR purchase amounts with USD obligations.

---

## 37. Completion Gate

| Question | Answer |
| --- | --- |
| Does Finance remain money source-of-truth? | **YES** |
| Does Settlement own allocation truth? | **YES** |
| Can one Payment settle multiple obligations? | **YES** |
| Can one obligation be settled by multiple Payments? | **YES** |
| Can an obligation be partially settled? | **YES** |
| Can a Payment be partially allocated? | **YES** |
| Can multiple allocations complete one obligation? | **YES** |
| Can allocation exceed Payment amount? | **NO** |
| Can allocation exceed obligation amount? | **NO** |
| Can allocation be zero/negative? | **NO** |
| Can allocation be hard-deleted after economic effect? | **NO** |
| Can an allocation be reversed? | **YES** |
| Does allocation reversal automatically reverse the Finance Payment? | **NO** |
| Can settlement status contradict remaining amount? | **NO** |
| Is SETTLED derived from zero remaining? | **YES** |
| Are cross-company allocations possible? | **NO** |
| Are monetary calculations floating-point based? | **NO** |
| Are allocation races protected? | **YES** |
| Are retries protected against duplicate allocation? | **YES** |
| Is full FX settlement implemented? | **NO — Phase 6.2** |
| Is Supplier-specific settlement implemented? | **NO — Phase 6.2** |
| Is Loan-specific settlement implemented? | **NO — Phase 6.2** |
| Is Channel settlement implemented? | **NO — Phase 6.3** |
| Is Reconciliation Engine implemented? | **NO — Phase 6.4** |
| Is professional Wholesale settlement implemented? | **NO** |
| Can future Wholesale reuse this foundation? | **YES** |

---

## Final Architecture

```text
SOURCE OBLIGATION → SettlementItem → Allocation ← Finance Transaction (Payment)
```

Many-to-many matching with append-only ACTIVE/REVERSED evidence. Finance remains money SoT; Settlement remains matching SoT.

**Phase 6.1 STOP.** Do not begin 6.2 in this lane.
