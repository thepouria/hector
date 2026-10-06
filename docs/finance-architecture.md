# Finance Architecture (Phase 4.1)

Finance Core architecture for Hector. **No operational Finance workflows in 4.1.**

Related:

- `docs/finance-invariants.md`
- `docs/finance-domain-boundaries.md`
- `docs/finance-currency-and-money.md`
- `docs/finance-purchasing-contract.md`
- `docs/finance-warehouse-contract.md`
- `docs/phase-4.1-finance-architecture-report.md`

---

## Mission

Represent Company financial position safely:

```text
Cash / Bank / Wallet
IRR / USD (+ future currencies)
Owner/Partner Capital (Equity)
Loans / Borrowings
Supplier Payables
Money In / Out / Transfers
Expenses
Purchase-related financial posting
FX monetary obligations
Financial Journals
Audit / Events
```

without confusing:

```text
Cash ≠ Revenue
Capital ≠ Revenue
Loan ≠ Revenue
Supplier credit ≠ Revenue
Cash receipt ≠ Profit
Expense ≠ Cash payment
Inventory purchase ≠ immediate Expense
Inventory value ≠ Cash balance
```

---

## Layered model

```text
Business Document
      ↓
Financial Transaction / Obligation
      ↓
Accounting Posting (Journal)
      ↓
Financial Ledger
      ↓
Financial Read Models
```

Examples:

```text
Loan Received → Loan Liability + Cash increase → Journal
Credit Purchase (POSTED GRN) → Supplier Payable → Journal
Capital Injection → Equity + Cash → Journal
```

Operational objects (Loan, Payable, Payment) remain queryable. Journal does **not** replace them.

---

## Double-entry direction (4.8)

Future posted journals:

```text
Journal Entry
  Journal Lines (Debit / Credit)
  currency + amount + baseCurrencyAmount
  sourceType / sourceId
```

Invariants: atomic post, Debit = Credit (base rules), immutable posted, corrections via reversal.

Accounting equation target:

```text
Assets = Liabilities + Equity
```

Finance is **not** a cash tracker only.

---

## Source-of-truth principle

No freely editable authoritative balances:

```text
cashBalance = user typed
loanOutstanding = user typed
supplierDebt = overwritten
```

Balances = opening (traceable) + posted canonical movements/settlements (reconcilable).

---

## Base currency

Already on `Company.baseCurrency` (`CurrencyCode`: IRR | USD). Default seed uses IRR. Not globally hard-coded in Finance code.

---

## Original currency principle (CRITICAL)

If Hector owes `1,000 USD`, the liability remains `1,000 USD` until settlement.

Reference IRR valuation is measurement only. Market FX changes do **not** rewrite principal.

Same for USD loans and FX_CREDIT purchases (Purchasing already stores foreign obligation — Finance preserves it).

---

## Equity vs Debt

```text
OWNER_EQUITY / PARTNER_EQUITY
≠
LOAN_RECEIVED / OTHER_DEBT
```

Same counterparty (e.g. Ahmad) may inject capital **or** lend. Funding type is explicit — never inferred from person alone.

---

## Supplier payable recognition (locked)

```text
DRAFT PO / DRAFT GRN  → no payable
POSTED Goods Receipt  → recognize liability for accepted received qty (incremental)
```

Partial receipts: recognize 40 then 50 of PO 100 without duplicating ordered 100.

Warehouse physical receipt ≠ Finance liability table (related, not collapsed).

---

## Cash / accounts direction (4.2)

Prefer **one account = one currency**.

Balance = opening + posted movements. Same-currency transfer preserves Company total cash. Cross-currency requires explicit FX (4.5/4.6).

`MONEY_IN` is not Revenue. `MONEY_OUT` is not Expense.

---

## Expense vs acquisition cost

```text
Payment ≠ Expense
Purchase cost ≠ automatically Expense
FIFO consumption ≠ automatically COGS
```

Some purchase costs may capitalize into inventory acquisition (policy later). Warehouse owns FIFO layers; Finance must not overwrite them.

---

## Immutability / reversal

```text
DRAFT  → editable
POSTED → immutable
```

Corrections: reversal / corrective transaction. No normal hard-delete of posted money/journals.

---

## Idempotency / concurrency / tenant

Reuse Hector idempotency + company context. Nested tenant validation on Account, Supplier, PO, Loan, Journal. Client never supplies `companyId` ownership or spoofs actors.

Anticipate races: dual payments vs same payable, dual repayments vs same loan, dual transfers vs same cash.

---

## RBAC

Finance permissions registered (`finance.*`). Sensitive — Warehouse/Purchasing users do not automatically see cash/capital/loans/payables.

---

## Audit vs Ledger

Audit = who/what/when/why.  
Ledger/Journal = financial truth. Audit never substitutes for balances.

---

## Domain events (planned names)

See `FINANCE_DOMAIN_EVENT_TYPES` in `apps/api/src/modules/finance/finance.constants.ts`. Not emitted in 4.1.

---

## Opening balances

Future controlled opening (cash, supplier debt, loans, capital) with provenance `OPENING_BALANCE`. Do **not** invent fake Finance from existing PO/stock/FIFO in 4.1.

---

## Future modules

| Phase | Owns |
|-------|------|
| 5 Sales | Orders, channel commercial lifecycle |
| 6 Settlement | Marketplace expected vs received |
| 7 Profit | Revenue attribution, COGS, GP/NP, margins |

Finance provides inputs only — no Profit-from-cash in Phase 4.

---

## Module layout (growing)

```text
apps/api/src/modules/finance/
  money/           # Decimal Money + FX helpers (4.1)
  contracts/       # Purchasing/Warehouse ports (4.1)
  architecture/    # Architecture gate tests (4.1)
  finance.constants.ts
  accounts/        # 4.2+
  funding/         # 4.3+
  loans/           # 4.3+
  payables/        # 4.4+
  payments/        # 4.6+
  expenses/        # 4.7+
  fx/              # 4.5+
  ledger/ journals/ # 4.8+
```

---

## STOP after 4.1

Do not implement Financial Accounts, Loans, Payables, Payments, Expenses, Journals, Dashboard, or Profit until their dedicated steps.
