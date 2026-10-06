# Finance Funding + Loans (Phase 4.3)

Operational capital contributions and company borrowings. Builds on Phase 4.2 account ledger.

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

## Loans — FIN-LOAN-*

| ID | Invariant |
|---|---|
| **FIN-LOAN-001** | Every Loan has one contractual currency. |
| **FIN-LOAN-002** | Original principal currency is never lost. |
| **FIN-LOAN-003** | Outstanding principal is derived/reconcilable. |
| **FIN-LOAN-004** | Outstanding principal cannot become negative. |
| **FIN-LOAN-005** | Principal repayment is not Expense. |
| **FIN-LOAN-006** | Loan receipt creates canonical Account IN. |
| **FIN-LOAN-007** | Loan repayment creates canonical Account OUT. |
| **FIN-LOAN-008** | Loan financial effects are atomic. |
| **FIN-LOAN-009** | Loan operations are idempotent. |
| **FIN-LOAN-010** | Concurrent repayments cannot over-repay. |
| **FIN-LOAN-011** | Cross-currency repayment requires explicit FX workflow. |
| **FIN-LOAN-012** | Posted loan history cannot be hard deleted. |
| **FIN-LOAN-013** | Loan status must reconcile with outstanding principal. |
| **FIN-LOAN-014** | Cross-company loan/account references are forbidden. |

## Models

- `CapitalContribution` — CAP-######; fundingType OWNER_EQUITY | PARTNER_EQUITY | OTHER_FUNDING
- `Loan` — LOAN-######; contractedPrincipal ceiling; currency immutable after first disbursement
- `LoanDisbursement` — LDS-######; MONEY_IN sourceType=LOAN_DISBURSEMENT
- `LoanRepayment` — LRP-######; cash OUT = principal+interest+fee; outstanding −= principal only

## Outstanding formula

```text
outstanding = Σ posted disbursements − Σ posted principal repayments
```

Never an editable column.

## Deferred

- Partner withdrawals / distributions
- Cross-currency FX settlement of loans (4.5 / 4.9)
- Interest amortization engines
- Payables / Expenses / Journal / Profit

## APIs

- `GET/POST /finance/capital-contributions`
- `POST …/:id/post|cancel|reverse`
- `GET/POST /finance/loans`
- `POST /finance/loans/:id/disbursements`
- `POST /finance/loans/:id/repayments`
