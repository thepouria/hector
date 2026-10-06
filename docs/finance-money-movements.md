# Finance Money Movements — Payments, Receipts, Transfers (Phase 4.6)

Standalone cash documents that post through `AccountMovement`. They do **not** replace Capital, Loan, FX Conversion, or Supplier Payable settlement.

## Source-of-truth matrix

| Domain action | Business truth | Money movement | Account effect owner |
|---|---|---|---|
| Capital contribution | `CapitalContribution` | `IN` `sourceType=CAPITAL_INJECTION` | Capital module via AccountMovementsWriter |
| Loan disbursement | `LoanDisbursement` | `IN` `sourceType=LOAN_DISBURSEMENT` | Loan module (direct) |
| Loan repayment | `LoanRepayment` | `OUT` `sourceType=LOAN_REPAYMENT` | Loan module (direct) |
| FX conversion | `FxConversion` | `OUT`+`IN` `sourceType=FX_CONVERSION` | FX module |
| Supplier payable creation | `SupplierPayable` + liability movement | **none** (cash not moved) | Payables module |
| Payment (standalone) | `Payment` | `OUT` `MONEY_OUT` `sourceType=PAYMENT` | PaymentsService |
| Receipt (standalone) | `Receipt` | `IN` `MONEY_IN` `sourceType=RECEIPT` | ReceiptsService |
| Transfer (internal) | `FinancialAccountTransfer` | `TRANSFER_OUT`+`TRANSFER_IN` `sourceType=ACCOUNT_TRANSFER` | AccountTransfersService |

**No double-count rule:** Capital / Loan continue posting AccountMovement directly. Do **not** wrap them as Receipt/Payment. Receipt `sourceType=CAPITAL|LOAN` is a **label only**.

**Supplier boundary:** Payment `purposeType=SUPPLIER` posts cash OUT only. It does **not** allocate / settle `SupplierPayable` until Phase **4.9**.

**Transfer API:** reuse `/finance/account-transfers` (no second Transfer model; no `/finance/transfers` alias required).

## Core invariants (FIN-MOV-001…028)

| ID | Invariant |
|---|---|
| **FIN-MOV-001** | AccountMovement remains canonical account balance truth. |
| **FIN-MOV-002** | Account balances are never manually overwritten by Payment/Receipt/Transfer. |
| **FIN-MOV-003** | Posted Payment creates exactly one canonical OUT effect. |
| **FIN-MOV-004** | Posted Receipt creates exactly one canonical IN effect. |
| **FIN-MOV-005** | Posted Transfer creates exactly one OUT and one IN effect. |
| **FIN-MOV-006** | Transfer posting is atomic. |
| **FIN-MOV-007** | Normal Transfer requires same currency. |
| **FIN-MOV-008** | Cross-currency movement uses FX Conversion, not Transfer. |
| **FIN-MOV-009** | Transfer source and destination must differ. |
| **FIN-MOV-010** | All financial amounts must be positive. |
| **FIN-MOV-011** | Payment/Receipt currency must match Account currency. |
| **FIN-MOV-012** | Negative balance rules are enforced at posting time. |
| **FIN-MOV-013** | Posted financial transactions are immutable. |
| **FIN-MOV-014** | Posted corrections use reversal. |
| **FIN-MOV-015** | Reversal preserves original transaction history. |
| **FIN-MOV-016** | Reversal uses original amount/currency/account semantics. |
| **FIN-MOV-017** | Posting is idempotent. |
| **FIN-MOV-018** | Reversal is idempotent. |
| **FIN-MOV-019** | Concurrent operations cannot bypass balance guards. |
| **FIN-MOV-020** | Payment does not automatically mean Expense. |
| **FIN-MOV-021** | Receipt does not automatically mean Revenue. |
| **FIN-MOV-022** | Transfer creates neither Expense nor Revenue. |
| **FIN-MOV-023** | Supplier Payment does not automatically settle SupplierPayable in Phase 4.6. |
| **FIN-MOV-024** | One real-world money movement must never create duplicate account effects. |
| **FIN-MOV-025** | All references are Company-isolated. |
| **FIN-MOV-026** | Client cannot spoof financial actor/status/system fields. |
| **FIN-MOV-027** | Financial calculations use Decimal-safe arithmetic. |
| **FIN-MOV-028** | Every posted money movement is reconcilable to AccountMovement. |

## APIs

- `GET/POST /finance/payments` · `GET/PATCH /finance/payments/:id` · `POST …/post|cancel|reverse`
- `GET/POST /finance/receipts` · `GET/PATCH /finance/receipts/:id` · `POST …/post|cancel|reverse`
- Transfers: `GET/POST /finance/account-transfers` (existing Phase 4.2)

## Permissions

- `finance.payments.read` / `finance.payments.create`
- `finance.receipts.read` / `finance.receipts.create`
- Transfers: `finance.transfers.read` / `finance.transfers.create`

## Integrity

`pnpm db:check:finance` includes posted Payment/Receipt movement presence, transfer OUT/IN pair, duplicate source movements, currency mismatch, same-account transfer, non-positive amounts, reverse provenance, cross-company account refs, and SUPPLIER purpose without payable allocation.
