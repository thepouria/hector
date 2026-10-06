# Finance Invariants (Phase 4.1)

Architecture locks. Implementation phases enforce them.

## Currency — FIN-CUR-*

| ID | Invariant |
|---|---|
| **FIN-CUR-001** | Every authoritative monetary amount has known currency. |
| **FIN-CUR-002** | Original contractual currency is never lost. |
| **FIN-CUR-003** | FX conversion requires explicit rate/provenance. |
| **FIN-CUR-004** | Exchange rate direction is unambiguous (`1 base = rate quote`). |
| **FIN-CUR-005** | Money arithmetic uses Decimal-safe semantics. |
| **FIN-CUR-006** | Rounding policy is centralized. |

Operational FX detail: **FIN-FX-001…025** in `docs/finance-fx-currency.md` (Phase 4.5).

## Money movements — FIN-MOV-*

Canonical **FIN-MOV-001…028** live in `docs/finance-money-movements.md` (Phase 4.6).

Summary locks:

| ID | Invariant |
|---|---|
| **FIN-MOV-001** | Posted money effects are AccountMovements only. |
| **FIN-MOV-005** | Capital / Loan / FX keep specialized sourceTypes (not Payment/Receipt). |
| **FIN-MOV-006** | Payment purpose SUPPLIER does not settle SupplierPayable (4.9). |
| **FIN-MOV-007** / **008** | Payment ≠ Expense; Receipt ≠ Revenue. |
| **FIN-MOV-014** | Cross-currency transfer forbidden — use FX Conversion. |
| **FIN-MOV-028** | Anti-double-count matrix is authoritative. |

## Funding — FIN-FUND-*

| ID | Invariant |
|---|---|
| **FIN-FUND-001** | Capital Contribution is not Revenue. |
| **FIN-FUND-002** | Loan proceeds are not Revenue. |
| **FIN-FUND-003** | Equity and Debt are distinct. |
| **FIN-FUND-004** | Counterparty identity does not determine funding type. |
| **FIN-FUND-005** | Posted Capital Contribution creates exactly one canonical cash effect. |
| **FIN-FUND-006** | Posted funding truth is immutable. |
| **FIN-FUND-007** | Funding currency must match receiving account currency for direct receipt. |
| **FIN-FUND-008** | Different currencies are never silently aggregated. |

Operational detail: **FIN-LOAN-001…014** in `docs/finance-funding-loans.md` (Phase 4.3).

## Payables — FIN-AP-*

Canonical **FIN-AP-001…025** live in `docs/finance-supplier-payables.md` (Phase 4.4).

Summary locks:

| ID | Invariant |
|---|---|
| **FIN-AP-001** | Supplier Payable is financial liability truth, not `Supplier.balance`. |
| **FIN-AP-002** | Quote never creates Payable. |
| **FIN-AP-003** | Draft PO never creates Payable. |
| **FIN-AP-006** | Partial receipt → liability only for accepted POSTED GRN qty. |
| **FIN-AP-008** | FX_CREDIT principal is not rewritten when FX rates change. |
| **FIN-AP-009** | Payable recognition does not move Cash. |
| **FIN-AP-010** / **011** | Outstanding derived; never manually overwritten. |
| **FIN-AP-016** | Excess return value → Supplier Credit (not negative AP). |
| **FIN-AP-024** | Payable ≠ Loan. |
| **FIN-AP-025** | Payable ≠ Revenue / Capital. |

Recognition point: **FIN-REC-001** (POSTED Goods Receipt accepted qty, incremental).

## Journals / Ledger — FIN-JRN-*

Canonical **FIN-JRN-001…035** live in `docs/finance-ledger-journal.md` (Phase 4.8).

Summary locks:

| ID | Invariant |
|---|---|
| **FIN-JRN-001** / **013** | Cash truth = AccountMovement; journals classify. |
| **FIN-JRN-002** / **003** | Journals balance in Company.baseCurrency (Decimal exact). |
| **FIN-JRN-005** | Manual journal never creates AccountMovement. |
| **FIN-JRN-008** / **009** | Capital → Equity; Loan → Liability. |
| **FIN-JRN-012** / **014** | Payment/Receipt use unclassified clearing — never Expense/Revenue. |
| **FIN-JRN-015** / **016** | Expense recognition vs settlement (no double Expense). |
| **FIN-JRN-020** / **021** | AP journal at GRN post; PO create/approve = no journal. |
| **FIN-JRN-023** | No auto FX gain/loss engine. |
| **FIN-JRN-034** | AP settlement from Payment is Phase 4.9 (FIN-SET); not auto on Payment post. |

## UI / API coherence — FIN-UI-*

Canonical **FIN-UI-001…024** live in `docs/finance-api-ui.md` (Phase 4.10).

Summary locks:

| ID | Invariant |
|---|---|
| **FIN-UI-001…006** | Authoritative calcs + balances/outstanding/settlement/journal totals are server-derived. |
| **FIN-UI-007…009** | Decimal-safe money; explicit currency; no silent IRR↔toman. |
| **FIN-UI-010…012** | Loan ≠ Capital; Receipt ≠ Revenue; Payment ≠ Expense without classification. |
| **FIN-UI-013…015** | Cross-currency FX visible; idempotent mutations; no double-submit duplicates. |
| **FIN-UI-016…018** | Company-scoped query keys; no stale company data; frontend RBAC is UX only. |
| **FIN-UI-019…024** | Posted journal immutable (reverse only); no hard-delete; no Profit/Sales fabrication. |

## Dashboard / Audit / Events — FIN-DASH / FIN-AUD / FIN-EVT

Canonical **FIN-DASH-001…014**, **FIN-AUD-001…010**, **FIN-EVT-001…010** live in `docs/finance-dashboard-audit-events.md` (Phase 4.11).

Summary locks:

| ID | Invariant |
|---|---|
| **FIN-DASH-001…005** | Canonical truth; no cross-currency sum; Money In ≠ Revenue; Money Out ≠ Expense; cash ≠ Profit. |
| **FIN-DASH-006…011** | Capital/loan ≠ Revenue; loan ≠ Expense; transfers excluded; outstanding/overdue from truth. |
| **FIN-DASH-012…014** | Tenant-scoped; RBAC not bypassed; Decimal-safe. |
| **FIN-AUD-001…010** | Material mutations audited; immutable; tenant/actor-safe; no secrets; no cross-company. |
| **FIN-EVT-001…010** | Committed facts only; tenant + Decimal; idempotent; Audit ≠ Events; no entity dumps. |

## Cash — FIN-CASH-*

| ID | Invariant |
|---|---|
| **FIN-CASH-001** | Account balance is not freely editable. |
| **FIN-CASH-002** | Posted money movement is immutable. |
| **FIN-CASH-003** | Same-currency internal transfer preserves Company total cash. |
| **FIN-CASH-004** | Cross-currency transfer requires explicit FX information. |
| **FIN-CASH-005** | Money In does not imply Revenue. |
| **FIN-CASH-006** | Money Out does not imply Expense. |
| **FIN-CASH-007** | Opening balance is traceable financial history. |

Account operational detail: **FIN-ACC-001…020** in `docs/finance-accounts.md` (Phase 4.2).

Money-movement operational detail: **FIN-MOV-001…028** in `docs/finance-money-movements.md` (Phase 4.6).

## Journal — FIN-JRN-*

| ID | Invariant |
|---|---|
| **FIN-JRN-001** | Every posted Journal balances. |
| **FIN-JRN-002** | Journal posting is atomic. |
| **FIN-JRN-003** | Posted Journal is immutable. |
| **FIN-JRN-004** | Corrections use reversal/corrective posting. |
| **FIN-JRN-005** | Journal retains source provenance. |
| **FIN-JRN-006** | Journal does not replace operational financial objects. |

## Tenant — FIN-TEN-*

| ID | Invariant |
|---|---|
| **FIN-TEN-001** | Every Company-owned financial object is tenant scoped. |
| **FIN-TEN-002** | Nested references belong to same Company. |
| **FIN-TEN-003** | Client cannot choose financial Company ownership. |
| **FIN-TEN-004** | Cross-company financial IDOR is forbidden. |
| **FIN-TEN-005** | Financial Audit remains tenant scoped. |

## Boundary extras

| ID | Invariant |
|---|---|
| **FIN-BND-001** | Finance does not mutate Purchasing commercial truth. |
| **FIN-BND-002** | Finance does not mutate Warehouse stock/FIFO truth. |
| **FIN-BND-003** | Phase 4 does not calculate Profit from Cash. |
| **FIN-BND-004** | Phase 4 does not classify every inventory issue as COGS. |
| **FIN-BND-005** | Audit is not a substitute for Financial Ledger. |
| **FIN-REC-001** | Supplier payable recognition = POSTED Goods Receipt accepted qty (incremental). |

## Core invariants — FIN-001…040 (Phase 4.12)

Canonical closure table. Detailed namespaces above (FIN-CUR-*, FIN-MOV-*, FIN-AP-*, FIN-JRN-*, FIN-DASH-*, etc.) remain authoritative for operational detail.

| ID | Invariant | Maps to |
|---|---|---|
| **FIN-001** | Every financial amount has explicit currency. | FIN-CUR-001 |
| **FIN-002** | Financial arithmetic is Decimal-safe. | FIN-CUR-005 |
| **FIN-003** | Account balances reconcile to Account Movements. | FIN-CASH-001 / FIN-ACC |
| **FIN-004** | Account balance cannot be arbitrarily overwritten. | FIN-CASH-001 |
| **FIN-005** | Capital contribution is Equity, not Revenue. | FIN-FUND-001 / FIN-JRN-008 |
| **FIN-006** | Borrowed funds are Liability, not Equity or Revenue. | FIN-FUND-002 / FIN-JRN-009 |
| **FIN-007** | Loan principal repayment is not Expense. | FIN-LOAN |
| **FIN-008** | Receipt is not automatically Revenue. | FIN-MOV-008 / FIN-JRN-012 |
| **FIN-009** | Payment is not automatically Expense. | FIN-MOV-007 / FIN-JRN-012 |
| **FIN-010** | Internal transfer is neither Revenue nor Expense. | FIN-MOV-014 / FIN-DASH |
| **FIN-011** | Supplier outstanding reconciles to original obligation and settlements. | FIN-AP-010 / 011 |
| **FIN-012** | Expense outstanding reconciles to payments/settlements. | FIN-EXP |
| **FIN-013** | Settlement cannot exceed current outstanding. | FIN-SET |
| **FIN-014** | Settlement is concurrency-safe. | FIN-SET |
| **FIN-015** | Historical FX snapshots are immutable. | FIN-FX |
| **FIN-016** | Current FX rates cannot rewrite historical transactions. | FIN-FX / FIN-AP-008 |
| **FIN-017** | Posted Journal is immutable. | FIN-JRN-003 |
| **FIN-018** | Every posted Journal is balanced. | FIN-JRN-001 / 002 |
| **FIN-019** | General Ledger reconciles to posted Journal Lines. | FIN-JRN |
| **FIN-020** | Trial Balance reconciles to General Ledger. | FIN-JRN |
| **FIN-021** | Reversals preserve original history. | FIN-JRN-004 |
| **FIN-022** | Financial economic records are not hard-deleted. | FIN-CASH-002 |
| **FIN-023** | Critical financial writes are idempotent. | FIN-UI-014 |
| **FIN-024** | Critical multi-effect operations are atomic. | FIN-JRN-002 |
| **FIN-025** | Dashboard derives from canonical Finance truth. | FIN-DASH-001 |
| **FIN-026** | Dashboard never implicitly combines currencies. | FIN-DASH-002 |
| **FIN-027** | Money In is not Revenue. | FIN-DASH-003 / FIN-CASH-005 |
| **FIN-028** | Money Out is not Expense. | FIN-DASH-004 / FIN-CASH-006 |
| **FIN-029** | Cash Flow is not Profit. | FIN-DASH-005 / FIN-BND-003 |
| **FIN-030** | Material Finance mutations are auditable. | FIN-AUD |
| **FIN-031** | Audit records are immutable to normal users. | FIN-AUD |
| **FIN-032** | Domain Events represent committed business facts. | FIN-EVT |
| **FIN-033** | Failed transactions do not emit committed success events. | FIN-EVT |
| **FIN-034** | Company isolation applies to every Finance entity/read model. | FIN-TEN-001 |
| **FIN-035** | Client-supplied companyId never establishes tenant ownership. | FIN-TEN-003 |
| **FIN-036** | Frontend RBAC never replaces backend RBAC. | FIN-UI-018 |
| **FIN-037** | Idempotent retries cannot duplicate economic effects. | FIN-UI-014 |
| **FIN-038** | Reconciliation scripts are read-only. | `pnpm finance:integrity` |
| **FIN-039** | Purchasing obligations reconcile with Finance liabilities. | FIN-AP / FIN-REC-001 |
| **FIN-040** | Finance does not depend on future Sales/Profit domains to remain internally correct. | FIN-BND-003 |
