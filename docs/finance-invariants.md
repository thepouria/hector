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


Operational detail: **FIN-AP-001…025** in `docs/finance-supplier-payables.md` (Phase 4.4).

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
