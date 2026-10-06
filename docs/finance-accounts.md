# Finance Accounts (Phase 4.2)

Operational cash/bank/wallet accounts. Balance truth = `FinancialAccountMovement` ledger.

## Invariants — FIN-ACC-*

| ID | Invariant |
|---|---|
| **FIN-ACC-001** | Every FinancialAccount belongs to exactly one Company. |
| **FIN-ACC-002** | Every FinancialAccount has exactly one currency. |
| **FIN-ACC-003** | Account balance is derived from canonical posted movements. |
| **FIN-ACC-004** | Account balance cannot be manually overwritten. |
| **FIN-ACC-005** | Every account movement currency equals account currency. |
| **FIN-ACC-006** | Posted account movements are immutable. |
| **FIN-ACC-007** | Opening Balance is traceable financial history. |
| **FIN-ACC-008** | Opening Balance is not Revenue. |
| **FIN-ACC-009** | Internal same-currency transfer creates equal OUT and IN effects. |
| **FIN-ACC-010** | Internal same-currency transfer preserves Company currency total. |
| **FIN-ACC-011** | Transfer posting is atomic. |
| **FIN-ACC-012** | Cross-currency movement is not a simple internal transfer. |
| **FIN-ACC-013** | Normal operations cannot create invalid negative account balance. |
| **FIN-ACC-014** | Account currency cannot change after financial history exists (immutable after create). |
| **FIN-ACC-015** | Accounts with financial history are not hard deleted (archive only when balance = 0). |
| **FIN-ACC-016** | Cross-company account references are forbidden. |
| **FIN-ACC-017** | Money-changing operations are idempotent (`requestId`). |
| **FIN-ACC-018** | Concurrent operations cannot overspend an account (`FOR UPDATE`). |
| **FIN-ACC-019** | Different currencies are never summed without explicit FX conversion. |
| **FIN-ACC-020** | Audit/Event records do not replace account movement truth. |

Additional operational locks: type immutable after first movement; one opening per account; one default per company+currency; transfer source ≠ destination; both accounts ACTIVE.

## APIs

| Method | Path | Permission |
|---|---|---|
| GET | `/finance/accounts` | `finance.accounts.read` |
| GET | `/finance/accounts/summary` | `finance.accounts.read` |
| GET | `/finance/accounts/:id` | `finance.accounts.read` |
| GET | `/finance/accounts/:id/balance` | `finance.accounts.read` |
| GET | `/finance/accounts/:id/movements` | `finance.accounts.read` |
| POST | `/finance/accounts` | `finance.accounts.manage` |
| PATCH | `/finance/accounts/:id` | `finance.accounts.manage` |
| POST | `/finance/accounts/:id/activate\|deactivate\|archive\|set-default` | `finance.accounts.manage` |
| POST | `/finance/accounts/:id/opening-balance` | `finance.accounts.manage` |
| GET/POST | `/finance/account-transfers` | `finance.transfers.read` / `create` |
| POST | `/finance/account-transfers/:id/post\|cancel\|reverse` | `finance.transfers.create` |

## Integrity

```bash
pnpm db:check:finance
```

## Related

- `docs/finance-architecture.md`
- `docs/finance-invariants.md` (FIN-CASH-* + FIN-ACC-*)
- `docs/phase-4.2-accounts-report.md`
