# HECTOR — Phase 4.1 Finance Architecture Report

**Date:** 2026-10-05  
**Scope:** Architecture, contracts, money/currency primitives, RBAC namespace — **no** operational Finance workflows.

---

## 1. Baseline

| Item | State entering 4.1 |
|------|-------------------|
| Phase 0–3 | CLOSED |
| Phase 3.18 | Warehouse integrity READY FOR PHASE 4 |
| `Company.baseCurrency` | Already on schema (`CurrencyCode` IRR \| USD) |
| Purchasing FX | Original foreign obligation + reference rate |
| Warehouse FIFO | Cost provenance owned by Warehouse |
| Finance module | Did not exist |

---

## 2. Existing Repository Reviewed

Reviewed before changes:

- `packages/database/prisma/schema.prisma` — Company, CurrencyCode, Purchasing money/FX fields, Warehouse FIFO
- `packages/database/src/permissions.ts` — RBAC + OWNER sync
- Purchasing: `docs/fx-purchases.md`, purchase-order money helpers, purchase types
- Warehouse: goods receipt POSTED contract, FIFO / valuation docs
- Phase 0: company context, idempotency, audit, domain events patterns
- Web: `apps/web/src/lib/permissions/keys.ts` + `presentation.ts`

---

## 3. Finance Domain Boundary

Finance owns money, obligations, equity/debt, journals (later), reconciliation.  
Does **not** own Product, PO commercial truth, physical stock, Sales, Settlement, or Profit.

Code root: `apps/api/src/modules/finance/`

---

## 4. Source-of-Truth Map

See `docs/finance-domain-boundaries.md`.

| Fact | Owner |
|---|---|
| Product/SKU/Barcode | Catalog |
| Supplier / PO commercial / FX ref / costs / return auth | Purchasing |
| Physical receipt / stock / FIFO / valuation | Warehouse |
| Accounts / cash / capital / loans / payables / payments / expenses / journal | Finance |
| Sales orders | Future Sales |
| Marketplace settlement | Future Settlement |
| Profit / COGS | Future Profit Engine |

---

## 5. Money Model

```ts
Money { amount: Prisma.Decimal; currency: CurrencyCode }
```

`apps/api/src/modules/finance/money/money.ts` — parse, add, subtract, round.  
No JS floating point for authoritative math.

---

## 6. Currency Model

Prisma `CurrencyCode`: IRR, USD (extensible). Prefer `amount` + `currency`. No `amountIrr`/`amountUsd` columns.

---

## 7. Base Currency

`Company.baseCurrency` (existing). Default business IRR via seed/settings — not hard-coded globally in Finance. **No new migration in 4.1.**

---

## 8. FX Rate Semantics

`FxRateQuote`: `1 baseCurrency = rate quoteCurrency`.  
Example: USD/IRR rate `250000` ⇒ `1 USD = 250,000 IRR` (`describeFxQuote`).  
Conversion via Decimal only (`fx-rate.ts`).

---

## 9. Original Currency Principle

Contractual liabilities (USD payable, USD loan) remain in original currency until settlement. Reference IRR is measurement only; market FX changes do not rewrite principal.

---

## 10. Cash Architecture

Direction for 4.2: one account = one currency; balance = opening + posted movements; same-currency transfer preserves Company total cash; MONEY_IN ≠ Revenue; MONEY_OUT ≠ Expense. **Not implemented in 4.1.**

---

## 11. Equity Architecture

Explicit `FundingType`: `OWNER_EQUITY` | `PARTNER_EQUITY` | … Capital ≠ Revenue. Counterparty identity does not decide equity vs debt.

---

## 12. Debt / Loan Architecture

Direction for 4.3: lender, currency, principal, outstanding from repayments, optional interest/fees, original currency retained, partial repayment, possible cross-currency settlement later (4.9). **Not implemented in 4.1.**

---

## 13. Supplier Payable Architecture

Recognition locked:

```text
POSTED Goods Receipt → accepted qty → incremental payable recognition
DRAFT PO / DRAFT GRN / ordered-only → no payable
```

Outstanding reconcilable from obligation + settlements. FX_CREDIT retains foreign denomination.

---

## 14. Purchasing → Finance Contract

`docs/finance-purchasing-contract.md` + `contracts/purchasing-finance.contract.ts`  
Finance reads commercial facts; never mutates PO truth; never duplicates Supplier master.

---

## 15. Warehouse → Finance Contract

`docs/finance-warehouse-contract.md` + `contracts/warehouse-finance.contract.ts`  
Finance may read GRN / return dispatch / valuation / FIFO provenance; never mutates Movement, StockBalance, or FIFO layers.

---

## 16. Acquisition Cost Boundary

Warehouse owns FIFO acquisition layers. Purchasing owns commercial purchase costs. Finance later posts capitalization vs period expense **explicitly**. No overwrite of Warehouse cost layers.

---

## 17. Expense Boundary

Payment ≠ Expense. Purchase cost ≠ automatically Expense. FIFO consumption ≠ automatically COGS. Classification is explicit later.

---

## 18. Financial Transaction Model Direction

Layered: Business Document → Financial Transaction/Obligation → Journal → Ledger → Read models. Provenance via `sourceType` / `sourceId` (`FINANCE_SOURCE_TYPES`). Directions: MONEY_IN / MONEY_OUT / ACCOUNT_TRANSFER (nature not inferred from direction alone).

---

## 19. Journal / Double-Entry Direction

Target 4.8: balanced Debit=Credit, atomic post, immutability, reversal. Journal does not replace operational Loan/Payable/Payment objects. Chart of Accounts not built in 4.1.

---

## 20. Immutability / Reversal

DRAFT editable; POSTED immutable; corrections via reversal/corrective posting; no normal hard-delete of posted money/journals.

---

## 21. Idempotency

Reuse Hector idempotency for all money-changing commands (4.2+). No Finance-only incompatible system.

---

## 22. Concurrency

Anticipate dual payments/repayments/transfers against same outstanding; DB transactional protection in implementation phases.

---

## 23. Tenant Isolation

All Finance objects company-scoped; nested reference validation; client cannot choose `companyId`; actors from auth context.

---

## 24. RBAC

20 `finance.*` permissions registered in `@hector/database` + web keys/presentation (group `finance`). OWNER sync via `ALL_PERMISSION_KEYS`. Finance data more sensitive than Warehouse qty — backend RBAC required.

---

## 25. Audit

Material mutations will emit audit (who/what/when/why). **Audit ≠ Financial Ledger.**

---

## 26. Domain Events

Planned names in `FINANCE_DOMAIN_EVENT_TYPES` (`finance.capital.injected`, `finance.loan.received`, …). Not emitted in 4.1.

---

## 27. Opening Balance Strategy

Controlled opening with `OPENING_BALANCE` provenance later. **Do not** invent balances from PO/stock/FIFO in 4.1.

---

## 28. Future Sales Contract

Sales owns commercial sales lifecycle; Finance consumes financial facts. No Sales implementation in Phase 4.

---

## 29. Future Settlement Contract

Marketplace settlement Phase 6; Finance must accept settlement facts without redesign.

---

## 30. Future Profit Engine Contract

Phase 7 owns Revenue/COGS/margins. Finance + FIFO provenance are inputs only. No Profit-from-cash in Phase 4.

---

## 31. Architecture Invariants

Documented in `docs/finance-invariants.md` (FIN-CUR-*, FIN-FUND-*, FIN-AP-*, FIN-CASH-*, FIN-JRN-*, FIN-TEN-*, FIN-BND-*, FIN-REC-001).

Negative gate: all FALSE (cash≠revenue, loan≠equity, no free balance overwrite, no Finance overwrite of PO/FIFO, no Profit-from-cash, …).  
Positive gate: all YES (multi-currency accounts, capital/loans, original USD, partial repayments, double-entry future, tenant isolation, …).

---

## 32. Schema / Migration Changes

**None.** `Company.baseCurrency` and `CurrencyCode` already existed. No Phase 4 tables created (Accounts, Loans, Payables, Journals deferred).

---

## 33. Tests

| Suite | Coverage |
|-------|----------|
| `money/money.spec.ts` | Decimal Money + FX direction/conversion/original currency |
| `architecture/finance-phase41.architecture.spec.ts` | Permissions, recognition lock, docs presence, ± gates |

No fake tests for unimplemented Loan/Payable/Account models.

---

## 34. Regression Results

| Command | Result |
|---------|--------|
| `pnpm db:generate` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test` | API **243** + Web **89** = **332 passed**, 0 skipped/todo |
| `pnpm test:security` | **28 passed** |
| `pnpm test:e2e` | **412 passed** (43 suites; 0 skipped/todo) |
| `pnpm build` | PASS |

New unit coverage vs Phase 3.18 baseline (+20 API tests): Finance money/FX + Phase 4.1 architecture gates.

Transient e2e flakes observed mid-run on unrelated Warehouse/Catalog suites (`putaways` GRN post 404 under suite pressure); confirmed clean full e2e: **412/412**.

---

## 35. Known Limitations

- No FinancialAccount / Loan / Payable / Payment / Expense / Journal persistence
- No emitters for Finance domain events
- No opening-balance UI/workflow
- Cross-currency transfer / FX settlement deferred to 4.5/4.6/4.9
- Approval engine for large payments not built (foundation only)

---

## 36. Technical Debt

- Web permission presentation still groups many Warehouse keys under `other` (pre-existing; Finance group added)
- Purchase-cost capitalization policy not yet enumerated as enum (intentional — 4.7)
- Chart of Accounts structure deferred to 4.8

---

## 37. Readiness for 4.2

Architecture, money/FX primitives, RBAC namespace, Purchasing/Warehouse contracts, and documentation are in place. Phase 4.2 may implement Financial Accounts (CASH/BANK/WALLET, one currency per account) without redesigning boundaries.

### Acceptance scenarios (architecture)

| Scenario | Expected |
|----------|----------|
| A Equity 1B IRR | Asset +1B, Equity +1B, Revenue 0, Debt 0 |
| B IRR loan 500M | Cash +500M, Loan +500M, Equity 0, Revenue 0 |
| C USD loan 10k @ 250k | USD cash +10k, Principal 10k USD; FX change keeps principal USD |
| D FX purchase 1k USD | Liability 1k USD; ref IRR measurement only |
| E Partial repay 3k of 10k | Outstanding 7k USD; no Revenue/Expense from principal |
| F Same person equity vs loan | FundingType decides Equity vs Debt |

### STOP rule

Not implemented: Accounts, Capital workflows, Loans, Payables, Payments, FX settlement, Transfers, Expenses, Journals, Dashboard, Profit, Revenue, COGS, Marketplace Settlement.

---

## Final Status

```text
PHASE 4.1 STATUS: READY FOR 4.2
```
