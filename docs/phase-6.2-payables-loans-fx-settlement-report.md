# HECTOR — Phase 6.2
# Payables + Loans + FX Settlement Report

**Status:** COMPLETE  
**STOP:** Do **not** begin Phase 6.3 (Channel Settlement) automatically.

---

## 1. Baseline

Pre-implementation baseline (mid-session, prior to final 6.2 closeout) ran generate / typecheck / lint / unit successfully. Final closeout used clean bootstrap:

```text
docker compose down -v && docker compose up -d
pnpm db:migrate:deploy   # includes 20261016180000 + 20261016180100 (no-op)
pnpm db:generate
pnpm db:seed × 2
```

Integrity after clean bootstrap: **0 hard violations** for Catalog, Purchasing, Warehouse, Inventory, Valuation, Finance, Sales, Party (+ reconcile), Settlement.

---

## 2. Architecture Review

Extended Phase 6.1 Allocation Core — did **not** invent parallel Supplier/Loan/FX settlement engines.

| Layer | Role |
| --- | --- |
| Finance Payment | Money movement SoT |
| SettlementAllocation | Matching SoT (`amount` = obligation; `paymentAmount` = capacity) |
| SettlementAllocationFxDetail | Cross-currency evidence only |
| Source adapters | SUPPLIER_PAYABLE / LOAN / MANUAL_OBLIGATION |
| Domain effects | Payable liability movements + loan status refresh |

Phase 4.9 `SupplierPaymentAllocation` remains live and **shares** payment capacity; domain 6.2 commands use core allocations (no dual-write of the same settle).

---

## 3. Supplier Payables

`SUPPLIER_PAYABLE` adapter resolves party, currency, settleable outstanding from liability movements (purchase adjustments / returns already reflected). Domain command: `POST /settlements/payables/:id/settle`.

---

## 4. Supplier Payments

Settlements consume authoritative Finance Payments only. No `SupplierPaymentAmount` money SoT.

---

## 5. Partial Settlement

Supported. Outstanding = adjusted settleable − ACTIVE allocations (obligation currency).

---

## 6. Multi-Payment

One payable ← many payments; one payment → many payables. Independently traceable allocations.

---

## 7. Loans

`LOAN` adapter: outstanding = posted disbursements − posted principal repayments − ACTIVE core allocations. Core settle does **not** create cash `LoanRepayment` (Payment already moved cash). Status: ACTIVE / PARTIALLY_REPAID / SETTLED.

---

## 8. Loan vs Capital

Capital contributions remain equity funding. Same Party may be PARTNER + LENDER; types stay distinct (STL-033). Regression covered in e2e STL62-004.

---

## 9. IRR Liabilities

Same-currency allocation; no FX detail.

---

## 10. USD / FX Liabilities

Obligation remains USD. Reference IRR valuation is historical context only (STL-034…036).

---

## 11. Obligation Currency

Primary denomination for outstanding / settled / status derivation.

---

## 12. Reference Valuation

Purchase / loan reference rates preserved; never overwritten by settlement rates (STL-040).

---

## 13. Same-Currency Settlement

`paymentAmount = amount`; FX detail forbidden.

---

## 14. Cross-Currency Settlement

IRR → USD requires explicit FX input (rate, base/quote pair, date, source). No silent conversion / no “today’s rate” default (STL-038, STL-043).

---

## 15. FX Rate Model

`1 rateBaseCurrency = rate × rateQuoteCurrency`. Decimal precision. Rounding difference stored when payment ≠ exact obligation×rate.

---

## 16. Historical FX Evidence

Each allocation keeps its own rate on `SettlementAllocationFxDetail`. Immutable except via reverse.

---

## 17. Mixed-Currency Repayment

USD liability may be settled by USD payments + IRR payments at different rates (STL62-005 / target loan example).

---

## 18. Outstanding Balances

```text
GET /settlements/outstanding/payables
GET /settlements/outstanding/loans
```

Grouped by currency; never IRR+USD summed. Due / overdue buckets supported for dashboard readiness.

---

## 19. Reversal

Restores obligation currency outstanding; Payment untouched; FX historical row retained (STL-050).

---

## 20. Party Integration

Canonical Party via Supplier / Lender FKs. Cross-counterparty silent settle rejected.

---

## 21. Tenant Isolation

Company-scoped FKs + adapter checks. Cross-company payment/payable/loan/FX rejected (STL62-007).

---

## 22. RBAC

Reuses `finance.settlements.read` / `finance.settlements.manage` (FX settle requires manage).

---

## 23. Concurrency

Lock order: Payment → Source → Settlement → Item. Race tests for payable / loan / FX / payment capacity (STL62-009 + core).

---

## 24. Idempotency

`requestId` unique per company; retries return same economic effect (STL62-008).

---

## 25. Audit

Settlement Core audit actions + domain status effects. FX detail captures payment/obligation dims, rate, date, source, actor.

---

## 26. Events

Core settlement events after commit; not re-emitted on idempotent retry. Payable/loan status derived economically.

---

## 27. Integrity

`pnpm settlement:integrity` extended for:

- cross-currency FX detail presence / consistency
- payment capacity via `payment_amount`
- supplier/loan source presence
- PAID / SETTLED vs outstanding contradictions
- FX rate pair validity

Read-only; no auto-repair.

---

## 28. Purchasing Regression

PO / FX_CREDIT / TERM_CREDIT / payables / returns paths covered by full e2e + purchasing integrity OK.

---

## 29. Finance Regression

Accounts / payments / capital / loans / FX / journal covered by full e2e + finance integrity OK.

---

## 30. Party Regression

Party integrity + reconcile OK; multi-role lender/partner preserved.

---

## 31. Phase 6.1 Regression

`settlement-core.e2e-spec.ts` updated for FX-required error code + CHANNEL unsupported source; all core cases green.

---

## 32. Performance

Outstanding queries batch by company filters; adapters avoid N+1 for single-source settle. No new unbounded scans introduced.

---

## 33. Index Review

Existing indexes retained/used: company+status, company+party/supplier, dueDate, sourceType+sourceId, paymentId+status, FX obligation currency. Composite unique `(allocation_id, company_id)` on FX detail for tenant-safe 1:1 FK. No speculative indexes added.

---

## 34. Clean Bootstrap

Verified. Migration `20261016180100` is a deliberate no-op (composite unique already in `20261016180000`) to keep deploy history contiguous after an earlier draft conflict.

---

## 35. Automated Tests

### Unit

| Metric | Count |
| --- | --- |
| Suites | 64 |
| Tests | 332 |
| Failed | 0 |
| Skipped | 0 |
| Todo | 0 |

### Security e2e

| Metric | Count |
| --- | --- |
| Suites | 1 |
| Tests | 32 |
| Failed | 0 |

### Full e2e (final gate)

| Metric | Count |
| --- | --- |
| Suites | 64 |
| Tests | 583 |
| Failed | 0 |
| Skipped | 0 |
| Todo | 0 |

Mandatory Phase 6.2 suite `settlement-payables-loans-fx.e2e-spec.ts` (STL62-001…009) + `settlement-core.e2e-spec.ts`: **all passed**.

Note: one earlier full-run flake in `goods-receipt-scanner` (404 on PO create under shared DB pollution) passed on isolated retry and on the final full gate.

---

## 36. Build

`pnpm typecheck` / `pnpm lint` / `pnpm build` — **PASS**.

---

## 37. Documentation

| Doc | Update |
| --- | --- |
| `docs/settlement-architecture.md` | 6.2 architecture + FX + APIs |
| `docs/settlement-invariants.md` | STL-001…050 (STL-020 supersede) |
| `docs/finance-settlement-payables-loans-fx.md` | **new** economic companion |
| `README.md` | Phase 6.2 section |
| This report | Phase 6.2 closeout |

---

## 38. Bugs Found

1. **Migration duplicate unique** — `20261016180100` re-added composite unique already in `…180000` → fixed as no-op.
2. **Integrity false positives for FX** — payment capacity used obligation `amount`; currency-vs-payment compared obligation currency → fixed to `payment_amount` / `payment_currency`.
3. **6.1 e2e stale expectations** — cross-currency now returns `SETTLEMENT_FX_RATE_REQUIRED`; SUPPLIER_PAYABLE is allocate-enabled → CORE-012 switched to CHANNEL.

---

## 39. Known Limitations

- Phase 4.9 and 6.2 settlement paths both exist; operators should not dual-allocate the same economic settle.
- Full FX gain/loss accounting / fake expense — **deferred**.
- Channel settlement — **Phase 6.3**.
- Reconciliation engine — **Phase 6.4**.
- Professional wholesale UI / aging suite — **later (6.5+)**.
- Live FX market APIs — not built.
- Interest engine — not built (principal focus).

---

## 40. Technical Debt

- Long-term: migrate/deprecate Phase 4.9 SupplierPaymentAllocation into core-only path once Channel/Reconciliation land.
- Optional: stronger integrity SQL for payable outstanding using exact REVERSAL-aware movement formula (current PAID check matches simple INCREASE−DECREASE which is outstanding-correct).
- UI for settle/repay/outstanding — Phase 6.5.

---

## 41. Completion Gate

```text
Supplier Payable settlement works?                         YES
Partial Supplier settlement?                               YES
Multiple Supplier Payments?                                YES
One Payment → multiple Payables?                           YES
One Payable → multiple Payments?                           YES
Supplier outstanding derived correctly?                    YES
IRR Loan repayment?                                        YES
USD Loan repayment?                                        YES
Partial Loan repayment?                                    YES
Multiple Loan repayments?                                  YES
Loan vs Capital isolated?                                  YES
USD liability remains USD obligation?                      YES
Purchase reference rate preserved?                         YES
IRR → USD settlement supported?                            YES
Explicit settlement FX rate required?                      YES
Different settlement rates per allocation?                 YES
Mixed USD + IRR repayment supported?                       YES
FX historical evidence preserved?                          YES
Outstanding primarily shown in obligation currency?        YES
Multi-currency totals grouped correctly?                   YES
Over-settlement impossible?                                YES
Payment over-allocation impossible?                        YES
Cross-tenant settlement impossible?                        YES
Concurrency protected?                                     YES
Idempotency protected?                                     YES
Reversal restores outstanding?                             YES
Full FX gain/loss accounting implemented?                  NO — deferred
Channel Settlement implemented?                            NO — Phase 6.3
Reconciliation Engine implemented?                         NO — Phase 6.4
Professional Wholesale settlement implemented?             NO
```

---

## Final objective (met)

Hector can settle real supplier and loan liabilities using Finance Payments while preserving obligation currency.

IRR stays IRR. USD stays USD. IRR→USD requires explicit FX evidence per allocation. Partial / multi / mixed-currency settlement works. Outstanding is reconstructable from allocation truth. Loans stay separate from Partner Capital. Tenant-safe, concurrency-safe, idempotent, reversible, auditable.

**Ready for Channel Settlement in Phase 6.3 — but do not start it in this lane.**
