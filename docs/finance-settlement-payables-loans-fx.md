# Finance Settlement — Payables, Loans & FX (Phase 6.2)

Companion to `docs/settlement-architecture.md`. Focuses on Finance/Purchasing economic meaning.

---

## Supplier Payable settlement

```text
Finance Payment
      ↓
SettlementAllocation (obligation currency amount)
      ↓
SupplierLiabilityMovement (DECREASE / PAYMENT_ALLOCATION)
      ↓
SupplierPayable status derived from outstanding
```

- Partial and multi-payment supported.
- One payment → many payables; one payable → many payments.
- Purchase returns/corrections adjust settleable amount via liability movements — do not fake via Payment.
- Counterparty: payment party must not contradict payable supplier party.

## Loan repayment

```text
Finance Payment
      ↓
SettlementAllocation
      ↓
Loan outstanding = disbursements − cash repayments − ACTIVE core allocations
      ↓
Loan status ACTIVE / PARTIALLY_REPAID / SETTLED
```

- **Loan ≠ Capital.** Same Party may be PARTNER + LENDER; capital contributions stay equity.
- Principal focus; no full interest engine in 6.2.
- Do not casually rewrite original principal.

## Obligation vs reference valuation

| Concept | Example | Role |
| --- | --- | --- |
| Obligation currency amount | 1,000 USD | Primary liability |
| Purchase / loan reference rate | 250,000 IRR/USD | Historical valuation evidence |
| Reference IRR value | 250M IRR | Reporting context only |
| Settlement FX rate | 280,000 (per allocation) | Cash conversion evidence |
| Cash paid | 280M IRR | Finance Payment amount |

Outstanding is **always** primarily in obligation currency (STL-037).

## Same-currency settlement

USD Payment → USD liability (or IRR → IRR): no FX detail; amounts equal.

## Cross-currency settlement

IRR Payment → USD liability requires:

- obligation amount (USD)
- payment amount (IRR)
- explicit rate + rate pair + rate date + rate source (typically MANUAL)
- mathematical consistency: `payment ≈ obligation × rate` with explicit rounding difference

Each allocation keeps its own historical rate. Reversal restores USD outstanding using original dimensions — never today's rate.

## Mixed-currency multi-payment

One USD loan may be settled by USD payments and IRR payments at different rates in any order.
Totals remain in USD.

## What 6.2 does **not** do

- Live FX market API fetch
- Automatic FX gain/loss journal / fake expense
- Channel / marketplace settlement (6.3)
- Full reconciliation engine (6.4)
- Professional wholesale credit/aging UI (later)
