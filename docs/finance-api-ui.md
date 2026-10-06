# Finance API + UI Coherence (Phase 4.10)

Consolidation of existing Finance domains into coherent navigation, hubs, and reports.
**Not** a new finance domain. Operational dashboard + finance audit are Phase **4.11** (`docs/finance-dashboard-audit-events.md`). **Not** Profit Engine.

## Truth boundaries (unchanged)

| Layer | Owns |
|---|---|
| Operational docs | Capital, Loan, Payment, Expense, Payable, Settlement |
| AccountMovement | Cash/bank balances only |
| Journal / GL | Accrual CoA in **Company.baseCurrency** |

Capital (equity) ≠ Loan (liability). Payment post ≠ AP settle.

## Navigation map (Persian)

| Nav item | Route | Notes |
|---|---|---|
| مالی | `/app/finance` | Overview hub |
| حساب‌ها | `/app/finance/accounts` | Cash/bank accounts |
| حرکت پول | `/app/finance/money-movements` | Hub → Payments / Receipts / Transfers |
| بدهی‌ها | `/app/finance/liabilities` | Hub → Payables / Loans / Unpaid expenses / Settlements |
| هزینه‌ها | `/app/finance/expenses` | `?paymentStatus=UNPAID` for unpaid view |
| سرمایه و تأمین مالی | `/app/finance/capital` | Equity only — loans under بدهی‌ها |
| ارز / FX | `/app/finance/fx` | Rates / Conversions / Positions |
| حسابداری | `/app/finance/accounting` | Hub → Journals / GL / Trial Balance / CoA |

## Hub routes

| Hub | Children |
|---|---|
| `/app/finance/money-movements` | payments, receipts, account-transfers |
| `/app/finance/liabilities` | payables, loans, expenses?paymentStatus=UNPAID, settlements |
| `/app/finance/accounting` | journals, general-ledger, trial-balance, ledger-accounts |
| `/app/finance/settlements` | Guidance hub (settle via payment/payable detail) |

## API map (stable paths)

| Area | Endpoints |
|---|---|
| Accounts | `GET/POST /finance/accounts`, movements, archive |
| Capital | `GET/POST /finance/capital-contributions` |
| Loans | `GET/POST /finance/loans`, repayments |
| Payables | `GET /finance/payables`, allocate, statement |
| Settlements | `POST /finance/settlements/preview`, `GET|POST /finance/payments/:id/settlements`, `POST /finance/payables/:id/settle`, `GET /finance/settlements/:id`, `POST …/reverse` |
| Payments / Receipts / Transfers | Existing Phase 4.6 paths (`account-transfers` unchanged) |
| Expenses | `GET/POST /finance/expenses`, categories, pay |
| FX | rates, conversions, positions |
| Journals / CoA | `GET/POST /finance/journals`, ledger-accounts |
| Ledger reports | `GET /finance/ledger`, **`GET /finance/general-ledger`**, `GET /finance/trial-balance` |

### General ledger (`GET /finance/general-ledger`)

Query: `ledgerAccountId` (required), `dateFrom`, `dateTo`, `page`, `pageSize`.

Response includes `openingBalanceBase`, `closingBalanceBase`, lines with `runningBalanceBase` (DEBIT +, CREDIT − in company base currency). POSTED journals only.

## Core UI/API invariants FIN-UI-001…024

| ID | Invariant |
|---|---|
| **FIN-UI-001** | Frontend never owns authoritative financial calculations. |
| **FIN-UI-002** | Financial mutations use canonical backend domain services. |
| **FIN-UI-003** | Account balance is server-derived. |
| **FIN-UI-004** | Liability outstanding is server-derived. |
| **FIN-UI-005** | Settlement result is server-derived. |
| **FIN-UI-006** | Journal totals are server-derived. |
| **FIN-UI-007** | Money serialization is Decimal-safe. |
| **FIN-UI-008** | Currency is always explicit. |
| **FIN-UI-009** | IRR and toman are never silently interchanged. |
| **FIN-UI-010** | Borrowed money is displayed as Liability, never Equity. |
| **FIN-UI-011** | Generic Receipt is not displayed as Revenue without classification. |
| **FIN-UI-012** | Generic Payment is not displayed as Expense without classification. |
| **FIN-UI-013** | Cross-currency settlement explicitly displays FX context. |
| **FIN-UI-014** | Critical financial mutations are idempotent. |
| **FIN-UI-015** | UI double-click cannot create duplicate economic effects. |
| **FIN-UI-016** | All Finance query keys are Company-scoped. |
| **FIN-UI-017** | Company switch cannot expose stale previous-company Finance data. |
| **FIN-UI-018** | Frontend permission checks never replace backend RBAC. |
| **FIN-UI-019** | Posted Journal cannot be edited from UI. |
| **FIN-UI-020** | Financial reversal is explicit, never destructive delete. |
| **FIN-UI-021** | UI cannot bypass operational/subledger truth. |
| **FIN-UI-022** | Original and base currency are distinguishable. |
| **FIN-UI-023** | Historical FX snapshots are visible and immutable. |
| **FIN-UI-024** | Finance UI does not fabricate Profit/Revenue/COGS data from incomplete domains. |

## Implementation notes (4.10 coherence)

- Finance nav uses hub groups (Overview, Accounts, Money Movements, Liabilities, Expenses, Capital, FX, Accounting).
- Settlements nav never points at Payments list as if it were settlements.
- General Ledger requires a ledger account filter; running balance is server-derived in base currency.
- Payable detail Settle uses preview API before confirm; FX rate fields when currencies differ.
- Overview is the Finance Dashboard (Phase 4.11) with operational hubs below.
- Browser QA must be reported honestly (`NOT TESTED` if no browser run).

## Related docs

- `docs/finance-ledger-journal.md` — FIN-JRN
- `docs/finance-liability-settlement.md` — FIN-SET
- `docs/finance-money-movements.md` — FIN-MOV
- `docs/phase-4.10-finance-api-ui-report.md` — Phase report
