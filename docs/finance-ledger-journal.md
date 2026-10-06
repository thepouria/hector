# Finance Ledger + Journal Foundation (Phase 4.8)

Operational truth ≠ AccountMovement (cash) ≠ Journal (accrual/classification).

## Truth boundaries

| Layer | Owns |
|---|---|
| Operational docs | Capital, Loan, Payment, Expense, GRN, PO cost |
| AccountMovement | Cash/bank balances only (FIN-JRN-001 / FIN-JRN-013) |
| Journal | Accrual CoA in **Company.baseCurrency** |

Manual journal **never** creates AccountMovement and never mutates Warehouse / SupplierPayable ops.

## Timing table (PO / GRN / AP / Inventory)

| Event | Journal? | Notes |
|---|---|---|
| PO create / approve | **NO** | Commercial only |
| GRN POST | **YES** — `SUPPLIER_AP_RECOGNITION` | Same TX as `recognizeFromPostedGoodsReceiptInTx`: DR **INVENTORY** · CR **SUPPLIER_PAYABLE** (matches Phase 4.4 liability timing; quantity still Warehouse-owned) |
| Putaway / FIFO layer | NO journal in 4.8 | Inventory qty/layers Warehouse-owned |
| CAPITALIZABLE cost allocate | **YES** — DR INVENTORY · CR FINANCE_CLEARING | Same TX as allocate |
| PERIOD_EXPENSE cost (`setTreatment`) | **YES** — Expense create (APPROVED) + `EXPENSE_RECOGNITION` in same TX | No capitalize journal; recognition via Expense only (FIN-JRN-019) |
| Payment (any purpose) | **YES** — DR UNCLASSIFIED_PAYMENTS · CR Bank | Never Expense; SUPPLIER = clearing only (AP settle is separate 4.9 journal) |
| Supplier AP settle | **YES** — DR SUPPLIER_PAYABLE · CR UNCLASSIFIED_PAYMENTS (+ FX) | No second Bank CR; source SUPPLIER_PAYMENT_ALLOCATION |
| Receipt | **YES** — DR Bank · CR UNCLASSIFIED_RECEIPTS | Never Revenue |
| Expense approve | **YES** — DR ExpenseCategory · CR EXPENSE_PAYABLE | No cash |
| Expense allocate | **YES** — DR EXPENSE_PAYABLE · CR UNCLASSIFIED_PAYMENTS | Reclass; no second Expense |
| Capital post | DR Bank · CR CAPITAL_EQUITY | |
| Loan disburse | DR Bank · CR LOAN_PAYABLE | Never Equity |
| Loan repay principal | DR LOAN_PAYABLE · CR Bank | Not Expense |
| Transfer | DR Dest Bank CoA · CR Source Bank CoA | |

Prefer generating journals going forward. Seed does **not** backfill historical capital/loan/transfer journals.

## Invariants FIN-JRN-001…035

| ID | Invariant |
|---|---|
| **FIN-JRN-001** | Cash truth is AccountMovement only. |
| **FIN-JRN-002** | Journal balances in Company.baseCurrency. |
| **FIN-JRN-003** | Posted journal debit base = credit base (Decimal exact). |
| **FIN-JRN-004** | Posted journal has ≥2 lines and non-zero totals. |
| **FIN-JRN-005** | Manual journal never creates AccountMovement. |
| **FIN-JRN-006** | Manual journal never mutates Warehouse / SupplierPayable ops. |
| **FIN-JRN-007** | Unique (companyId, sourceType, sourceId, effectType) for automatic journals. |
| **FIN-JRN-008** | Capital post credits CAPITAL_EQUITY (never LOAN_PAYABLE / Revenue). |
| **FIN-JRN-009** | Loan disburse credits LOAN_PAYABLE (never Equity). |
| **FIN-JRN-010** | Loan principal repay debits LOAN_PAYABLE (not Expense). |
| **FIN-JRN-011** | Transfer is DR dest CoA · CR source CoA. |
| **FIN-JRN-012** | Payment clearing uses UNCLASSIFIED_PAYMENTS — never Expense. |
| **FIN-JRN-013** | AccountMovement remains cash truth; journals classify. |
| **FIN-JRN-014** | Receipt clearing uses UNCLASSIFIED_RECEIPTS — never Revenue. |
| **FIN-JRN-015** | Expense recognition: DR expense ledger · CR EXPENSE_PAYABLE. |
| **FIN-JRN-016** | Expense settlement does not re-recognize Expense. |
| **FIN-JRN-017** | Settlement reclasses payable vs payment clearing (no double Bank credit). |
| **FIN-JRN-018** | CAPITALIZABLE cost: DR INVENTORY · CR FINANCE_CLEARING. |
| **FIN-JRN-019** | PERIOD_EXPENSE only via Expense recognition (same TX as `setTreatment` → `createFromPurchaseOrderCostInTx`; never capitalize builder). |
| **FIN-JRN-020** | AP journal at GRN post: DR INVENTORY · CR SUPPLIER_PAYABLE. |
| **FIN-JRN-021** | PO create/approve creates no journal. |
| **FIN-JRN-022** | Foreign lines preserve originalAmount/currency + baseAmount + fxRate. |
| **FIN-JRN-023** | No auto FX gain/loss engine in 4.8. |
| **FIN-JRN-024** | Posted journals are immutable; corrections = reverse. |
| **FIN-JRN-025** | Double reverse is idempotent (one reversal row). |
| **FIN-JRN-026** | Cross-company journal lines forbidden. |
| **FIN-JRN-027** | Trial balance posted debit = credit per company. |
| **FIN-JRN-028** | FinancialAccount maps to child under CASH_AND_BANK. |
| **FIN-JRN-029** | ExpenseCategory maps to expense CoA under OPERATING_EXPENSE. |
| **FIN-JRN-030** | System CoA keys are company-unique when set. |
| **FIN-JRN-031** | Journal numbers JRN-###### via JournalEntrySequence. |
| **FIN-JRN-032** | RBAC: finance.journals.read / finance.journals.post. |
| **FIN-JRN-033** | IDOR → 404 across companies. |
| **FIN-JRN-034** | No Profit Engine / COGS / AP settlement from Payment (4.9). |
| **FIN-JRN-035** | Never guess classification from generic Payment/Receipt. |

## APIs

- `GET/POST /finance/ledger-accounts`, `GET :id`, `POST :id/archive`
- `GET/POST /finance/journals`, `GET :id`, `POST manual`, `POST :id/post`, `POST :id/reverse`
- `GET /finance/ledger`, `GET /finance/general-ledger` (running balance; Phase 4.10), `GET /finance/trial-balance`

## Permissions

`finance.journals.read`, `finance.journals.post` (ledger manage reuses post).
