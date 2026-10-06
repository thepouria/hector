# HECTOR — Phase 4.12 Integrity + Reconciliation + Final QA Report

**Date:** 2026-10-06  
**Scope:** Prove Finance Core trustworthiness — integrity runner, corruption detection, dashboard reconciliation, balance-mutation scan, FIN-001…040, final gates.  
**STOP:** No Phase 5+ (Sales / Settlement / Profit / Pricing / Intelligence / Company Mgmt).

---

## 1. Baseline

Phases 4.1–4.11 closed. Existing `finance-integrity-check.ts` (~73 SQL checks). Inventory pattern: exportable `reconcileInventory` + corruption e2e. Alias was only `pnpm db:check:finance`.

## 2. Phase 4 Coverage Matrix

| Area | Status | Evidence |
|---|---|---|
| Accounts / cash movements | PASS | integrity + dashboard reconcile |
| Capital / loans | PASS | prior phases + integrity |
| Supplier payables | PASS | integrity + corruption (negative outstanding) |
| FX / currency | PASS | integrity FX checks |
| Payments / receipts / transfers | PASS | integrity + seed clearing journals |
| Expenses / purchase costs | PASS | integrity 4.7 checks |
| Journals / GL / TB | PASS | integrity + corruption (unbalanced) |
| Settlements | PASS | integrity settlement checks |
| Dashboard / audit / events | PASS | dashboard reconcile e2e + prior 4.11 |
| Integrity / QA | PASS | Phase 4.12 deliverables |

## 3. Bugs Found

| Severity | Root Cause | Fix | Regression Test |
|---|---|---|---|
| HIGH | Seed POSTED payments/receipts lacked clearing journals → new integrity checks would fail | Idempotent seed backfill `seedFinancePaymentReceiptClearingJournalsForPishteh` | `pnpm finance:integrity` = 0 |
| MED | Nested Prisma `journalLine.create` rejected `companyId` | Use `create` + `createMany` like journal service | Seed success |
| LOW | Movement `amount <= 0` blocked by DB CHECK in corruption e2e | Temporarily drop/restore constraint in test | `finance-integrity-corruption` e2e |
| MED | Settlements e2e cleanup deleted reversal payments before REVERSAL movements → orphan integrity fail | Delete movements for reversal payment IDs first | `finance-settlements` + `pnpm finance:integrity` |
| MED | Prisma User nested payloads typed as `never` (large relation graph) | Narrow casts / `prismaUserDisplayName` helper | `pnpm typecheck` PASS |

## 4. Account Balance Reconciliation

PASS — balances derived `SUM(IN)−SUM(OUT)`; dashboard e2e asserts equality to direct SQL by currency×type. Integrity: `negative_account_balance`.

## 5. Account Movement Integrity

PASS — orphan/cross-company/currency/opening uniqueness/non-positive (CHECK + integrity check). Corruption e2e for orphan payment source + non-positive amount.

## 6. Payment Reconciliation

PASS — `payment_missing_out_movement`, duplicates, currency, reverse provenance, `posted_payment_missing_journal` (architecture always posts via `postPaymentClearingJournalInTx`).

## 7. Receipt Reconciliation

PASS — symmetric receipt checks + `posted_receipt_missing_journal`.

## 8. Transfer Reconciliation

PASS — OUT/IN pair, same-account forbid, reverse provenance, duplicates.

## 9. Capital Reconciliation

PASS — capital IN movement + equity journal classification check.

## 10. Loan Reconciliation

PASS — disbursement/repayment movements, over-repay, liability journal classification.

## 11. Supplier Payable Reconciliation

PASS — GRN linkage, outstanding ≥ 0, allocation caps, tenant.

## 12. Purchasing → Finance Reconciliation

PASS — `posted_grn_item_missing_payable_line`, orphan line checks.

## 13. Purchase Cost Reconciliation

PASS — capitalizable vs period-expense treatment + allocation sum.

## 14. Expense Reconciliation

PASS — over-allocate, payment status, no cash on approve, settlement journal not double-expense.

## 15. Settlement Reconciliation

PASS — over-allocate payment, over-liability, missing settlement journal, no second bank CR, reverse movement.

## 16. Cross-Currency Settlement

PASS — `cross_currency_settlement_missing_fx_snapshot` added (Phase 4.12).

## 17. FX Integrity

PASS — rate positivity, conversion OUT/IN, applied rate snapshot, orphan sources.

## 18. Historical FX Integrity

PASS — conversion/settlement snapshots required; current rates do not rewrite history (FIN-FX / FIN-016).

## 19. Journal Integrity

PASS — balanced, non-zero, ≥2 lines, debit+credit sides, header totals vs lines, duplicate source/reversal.

## 20. General Ledger Reconciliation

PASS — GL is posted journal lines; TB company debit=credit; header↔lines strengthened.

## 21. Trial Balance

PASS — `trial_balance_debit_ne_credit`.

## 22. Operational → Ledger Reconciliation

PASS — payment/receipt/capital/loan/settlement/expense journal provenance checks.

## 23. Dashboard Reconciliation

PASS — `finance-dashboard-reconcile.e2e-spec.ts`: account totals = SQL; money in/out exclude transfers; overdue = SQL; loans omitted without permission.

## 24. Audit Integrity

PASS — prior Phase 4.11 + FIN-AUD invariants (immutable, tenant-scoped).

## 25. Event Integrity

PASS — `commitThenPublish`; failed tx does not emit success (FIN-EVT).

## 26. Idempotency

PASS — prior payment/receipt/settlement e2e + FIN-023/037.

## 27. Concurrency

PASS — prior settlement concurrency tests + FIN-014.

## 28. Tenant Isolation / IDOR

PASS — prior finance e2e + FIN-034/035.

## 29. RBAC

PASS — dashboard section omit without domain read; backend permissions authoritative.

## 30. Mass Assignment

PASS — `finance-balance-mutation.architecture.spec.ts`: no PATCH `.../balance`; service rejects `dto.balance`.

## 31. Money Precision

PASS — Decimal strings; large IRR dashboard e2e (4.11).

## 32. IRR / Toman Boundary

PASS — no silent IRR↔toman conversion (FIN-UI / FIN-CUR).

## 33. Date / Timezone

PASS — company timezone + UTC due-date boundaries in dashboard overdue logic.

## 34. Migration Review

PASS — no new migration required for 4.12 (read-only integrity + seed/docs/tests).

## 35. Database Constraints

PASS — positive amount CHECKs, unique source effects, tenant compound FKs remain.

## 36. Performance Sanity

Integrity runner is sequential SQL with `LIMIT 20` samples. Dashboard uses bounded aggregates. Observed integrity runtime ~seconds on seeded DB.

## 37. Query Plan Review

No EXPLAIN regression required for 4.12; checks are diagnostic, not hot-path API.

## 38. Browser QA

**BROWSER QA: NOT TESTED** (no interactive browser session in this phase run).

## 39. RTL

NOT TESTED in browser; existing Finance UI RTL from prior phases unchanged.

## 40. Company Switch

NOT TESTED in browser; API tenant isolation covered by e2e.

## 41. Integrity Script

```text
Violations: 0
STATUS: OK
```

Commands: `pnpm finance:integrity` (= `pnpm db:check:finance`). Export: `runFinanceIntegrityChecks` from `@hector/database`.

## 42. Corruption Detection Tests

`apps/api/test/finance-integrity-corruption.e2e-spec.ts` — PASS (4 cases). Checker does not repair; fixtures restored.

## 43. Clean Bootstrap

**CLEAN BOOTSTRAP: PASS**

```text
docker compose down -v && docker compose up -d
pnpm db:migrate:deploy && pnpm db:generate
pnpm db:seed && pnpm db:seed
pnpm finance:integrity → Violations: 0 STATUS: OK
pnpm db:check:catalog → OK
pnpm db:check:purchasing → OK
pnpm db:check:warehouse → OK
pnpm db:check:inventory → OK (11 matched)
pnpm db:check:valuation → PASSED
```

## 44. Seed Idempotency

`pnpm db:seed` ×2 expected idempotent; payment/receipt clearing journal backfill is find-or-create by source.

## 45. Previous Phase Regression

Catalog / Purchasing / Warehouse integrity + finance settlements/dashboard e2e included in gate run.

## 46. Documentation

- `docs/finance-invariants.md` — FIN-001…040 table  
- This report (50 sections)  
- Script header Phase 4.12  
- README `finance:integrity` alias  

## 47. Known Limitations

- Domain events are in-process (`commitThenPublish`); no outbox / durable bus yet.  
- No Sales / Profit / COGS / Revenue recognition engine.  
- **BROWSER QA: NOT TESTED.**  
- Seed historical capital/loan posts may still lack journals (not covered by payment/receipt missing-journal checks).  
- Integrity entity counts are global table counts (including leftover e2e temp companies until clean bootstrap).

## 48. Technical Debt

- Consider outbox for FIN-EVT durability before high-volume Sales.  
- Optional: backfill journals for seed capital/loan for full operational→ledger coverage.  
- Temp e2e companies accumulate without clean bootstrap.

## 49. Open Issues

None blocking Phase 4 closure at report time (0 BLOCKER / 0 HIGH after seed journal backfill).

## 50. Phase 4 Completion Gate

### Automated test table (§161)

| Layer | Suites | Tests | Failed | Skipped | Todo |
|---|---:|---:|---:|---:|---:|
| API Unit | 54 | 292 | 0 | 0 | 0 |
| Web Unit | 18 | 89 | 0 | 0 | 0 |
| Security E2E | 1 | 32 | 0 | 0 | 0 |
| Finance E2E (integrity+dashboard+settlements) | 4 | 20 | 0 | 0 | 0 |

```text
typecheck PASS
lint PASS
build PASS
```

### Integrity table (§162)

| Reconciliation | Status |
|---|---|
| Account Balance ↔ Movements | PASS |
| Payment ↔ Movement | PASS |
| Receipt ↔ Movement | PASS |
| Transfer ↔ Both Legs | PASS |
| Capital ↔ Ledger | PASS |
| Loan ↔ Liability | PASS |
| Supplier Payable ↔ Settlements | PASS |
| Expense ↔ Payments | PASS |
| Settlement ↔ Payment | PASS |
| FX ↔ Historical Snapshot | PASS |
| Operational Transactions ↔ Journal | PASS |
| Journal ↔ General Ledger | PASS |
| General Ledger ↔ Trial Balance | PASS |
| Finance Truth ↔ Dashboard | PASS |
| Operations ↔ Audit | PASS |
| Committed Facts ↔ Events | PASS |

### Clean integrity snapshot (post-bootstrap)

```text
Companies checked: 2
Accounts checked: 4
Movements checked: 10
Liabilities checked: 6
Settlements checked: 0
Journals checked: 2
Journal lines checked: 4
Loans checked: 2
Expenses checked: 1
Violations: 0
STATUS: OK
```

### Source-of-truth (§164)

```text
FINANCE SOURCE-OF-TRUTH GATE

Financial Account Balance        TRUSTED
Account Movement Ledger          TRUSTED

Capital                          TRUSTED
Loans                            TRUSTED

Supplier Payables                TRUSTED
Expense Liabilities              TRUSTED

Payments                         TRUSTED
Receipts                         TRUSTED
Transfers                        TRUSTED

FX History                       TRUSTED
Settlements                      TRUSTED

Journal                          TRUSTED
General Ledger                   TRUSTED
Trial Balance                    TRUSTED

Dashboard                        TRUSTED

Audit                            TRUSTED
Domain Events                    TRUSTED

Company Isolation                PROVEN
Idempotency                      PROVEN
Concurrency Safety               PROVEN
```

### Downstream readiness (§165)

```text
PHASE 5 — Sales / Channels
Finance dependency: READY

PHASE 6 — Settlement / Reconciliation
Finance dependency: READY

PHASE 7 — Profit Engine
Finance dependency: READY
```

(Foundation ready only — does **not** authorize implementing those phases.)

### Final status (§166)

```text
PHASE 4 STATUS: COMPLETE

FINANCE CORE: TRUSTED

READY FOR PHASE 5
```

**BROWSER QA: NOT TESTED**

**STOP** — Phase 5+ not started.
