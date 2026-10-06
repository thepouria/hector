# Finance Liability Settlement (Phase 4.9)

Explicit **Payment ↔ Liability** settlement. Payment post clears cash only; settlement reallocates clearing to AP (or Expense via its own SoT).

## Architecture

| Concern | SoT |
|---|---|
| Supplier AP settle | `SupplierPaymentAllocation` (evolved) + `SettlementService` facade |
| Expense settle | `ExpensePaymentAllocation` (unchanged; FIN-SET-006) |
| Loan principal repay | `LoanRepayment` direct path (not through SettlementService) |
| Cash truth | `AccountMovement` on Payment post only |

**No** `LiabilitySettlement` batch document — allocation-centric with optional `settlementGroupId` for multi-line batches.

## FIN-SET invariants

| ID | Invariant |
|---|---|
| **FIN-SET-001** | Payment alone does not reduce liability |
| **FIN-SET-002** | Settlement is explicit Payment↔Liability link |
| **FIN-SET-003** | No over-settle liability / over-allocate payment |
| **FIN-SET-004** | Settlement never creates second AccountMovement |
| **FIN-SET-005** | Settlement journal uses clearing reclass (no double Bank CR) |
| **FIN-SET-006** | Expense settlement remains ExpensePaymentAllocation SoT |
| **FIN-SET-007** | Cross-currency requires explicit SETTLEMENT rate |
| **FIN-SET-008** | Historical purchase reference rate immutable |
| **FIN-SET-009** | Realized FX difference preserved when enabled |
| **FIN-SET-010** | Payment reverse reconciles settlements |
| **FIN-SET-011** | Concurrent settle cannot over-allocate |
| **FIN-SET-012** | Idempotent settlement (`requestId`) |
| **FIN-SET-013** | Tenant isolation |
| **FIN-SET-014** | Loan principal repay remains LoanRepayment (not Expense) |

## Supplier settle flow

```text
POSTED Payment (cash already OUT + DR UNCLASSIFIED_PAYMENTS · CR Bank)
  → SettlementService.settle (lines[])
  → lock Payment + payables (id order)
  → SupplierPaymentAllocation POSTED (paymentId hard FK)
  → SupplierLiabilityMovement DECREASE PAYMENT_ALLOCATION
  → Journal SUPPLIER_AP_SETTLEMENT:
       same ccy: DR SUPPLIER_PAYABLE · CR UNCLASSIFIED_PAYMENTS
       FX: DR SUPPLIER_PAYABLE (carrying) · DR FX_LOSS|CR FX_GAIN · CR UNCLASSIFIED_PAYMENTS (payment base)
  → no AccountMovement
```

## Cross-currency

- Require `settlementFxRateId` (type SETTLEMENT) or validated rate + base/quote.
- Never use “latest” silently.
- Carrying base from payable `referenceFxRate` (immutable).
- Partial settlements: proportional carrying; remainder on last slice.
- `fxDifferenceBase = paymentBase − carryingBase` (positive → FX loss).

## Reverse

Payment reverse (same TX): supplier settlements → expense/purchase-cost links → payment clearing journal.

Per allocation: status REVERSED · liability INCREASE REVERSAL · reverse settlement journal.

## APIs

- `POST /finance/settlements/preview`
- `GET|POST /finance/payments/:paymentId/settlements`
- `POST /finance/payables/:payableId/settle`
- `GET /finance/settlements/:id`
- `POST /finance/settlements/:id/reverse`

Permissions: `finance.settlements.read` / `finance.settlements.manage`.

## Integrity

`pnpm db:check:finance` includes over-allocate payment, over-settle liability, missing settlement journal (4.9 path), second Bank CR forbid, reversed without REVERSAL movement.
