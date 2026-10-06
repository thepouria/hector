# HECTOR — Phase 4.2 Accounts + Cash / Bank / Wallet Report

**Date:** 2026-10-05  
**Scope:** Financial Accounts, opening balance, same-currency transfers, integrity, seed, minimal UI.

---

## 1. Baseline

| Item | State entering 4.2 |
|------|-------------------|
| Phase 4.1 | CLOSED — architecture + money helpers + RBAC namespace |
| Schema | Not yet present for accounts |
| Operational Finance | None |

---

## 2. Schema

Models: `FinancialAccount`, `FinancialAccountMovement`, `FinancialAccountTransfer`, `FinancialAccountTransferSequence`.  
Migration: `20261005100000_finance_accounts`.  
Partial unique: one default per company+currency; one opening per account; company-scoped `requestId` uniqueness.

---

## 3. Permissions

Added `finance.transfers.read` / `finance.transfers.create`. Existing accounts/transactions keys wired to controllers.

---

## 4. Error codes

`FINANCIAL_ACCOUNT_*` and `ACCOUNT_TRANSFER_*` codes for not-found, currency immutable, insufficient balance, cross-currency, idempotency, archive, etc.

---

## 5. Audit

Actions: account created/updated/archived/activated/deactivated/default-changed; opening recorded; transfer created/posted/cancelled/reversed.  
Entity types: `FINANCIAL_ACCOUNT`, `FINANCIAL_ACCOUNT_MOVEMENT`, `FINANCIAL_ACCOUNT_TRANSFER`.

---

## 6. Domain events

Emitted after commit: `finance.account.*`, `finance.opening_balance.recorded`, `finance.account_transfer.*`.

---

## 7. Balance truth

`computeAccountBalance` = Decimal SUM(IN)−SUM(OUT). No balance column on account.

---

## 8. Opening balance

IN + OPENING_BALANCE; amount &gt; 0; not Revenue; one per account; `requestId` idempotent.

---

## 9. Transfers

DRAFT → POSTED / CANCELLED; POSTED → REVERSED. Numbering `FAT-######`. Atomic OUT+IN. Same currency only.

---

## 10. Concurrency

`SELECT … FOR UPDATE` on accounts ordered by id before OUT posts. Concurrent overspend rejected.

---

## 11. Default account

One ACTIVE default per company+currency via partial unique index + transactional clear.

---

## 12. Archive

Requires ledger balance === 0.

---

## 13. Currency / type immutability

Currency never changeable. Type blocked after any movement.

---

## 14. Mass assignment

PATCH rejects `balance` and `currency`.

---

## 15. Tenant isolation

All queries filter `companyId` from company context. Cross-tenant GET → 404.

---

## 16. Module wiring

`FinanceModule` imports Audit + forwardRef Rbac; registered in `AppModule`.

---

## 17. Seed

Pishteh: BANK-MELLAT-IRR (2B default), CASH-IRR (200M), CASH-USD (10k default), KHANOUMI-WALLET (500M).

---

## 18. Integrity script

`pnpm db:check:finance` — tenant, currency match, opening uniqueness, transfer pairs, negatives, defaults, orphan sources.

---

## 19. Unit tests

`accounts.balance.spec.ts` + existing `money.spec.ts`.

---

## 20. E2E tests

`finance-accounts.e2e-spec.ts` — create, opening, conservation, idempotency, insufficient, concurrent, cross-currency, IDOR, archive, currency/balance patch, permission denial.

---

## 21. Security suite

Additional case: warehouse operator 403 + cross-tenant account IDOR.

---

## 22. UI

Routes: accounts list/new/detail, transfer new. Nav: حساب‌ها. Persian RTL; opening labeled موجودی افتتاحیه.

---

## 23. API client

`hector.ts` finance account/transfer helpers.

---

## 24. Docs

`docs/finance-accounts.md` (FIN-ACC-001…020), this report, README + invariants updates.

---

## 25. Money helpers

Reuse Phase 4.1 `parseMoneyAmount` / Decimal; IRR precision 0, USD 6.

---

## 26. Numbering

`FAT-######` via `financial_account_transfer_sequences` upsert.

---

## 27. Provenance

Opening: `sourceType=OPENING_BALANCE`. Transfers: `sourceType=ACCOUNT_TRANSFER`, `sourceId=transferId`.

---

## 28. Reversal

Creates linked POSTED reversal document + REVERSAL movements; original → REVERSED.

---

## 29. Summary API

`GET /finance/accounts/summary` — totals per currency, no FX merge.

---

## 30. Out of scope (deferred)

Capital, Loans, Payables, FX, Payments, Expenses, Journal, Profit — Phase 4.3+.

---

## 31. Known limitations

- No balance projection cache (compute from ledger)
- No overdraft accounts
- Cross-currency transfers deferred to 4.5/4.6
- Minimal UI only (full Finance UI in 4.10)

---

## 32. Commands used

```bash
pnpm db:migrate:deploy && pnpm db:generate
pnpm typecheck && pnpm lint
pnpm test && pnpm test:security && pnpm test:e2e
pnpm build && pnpm db:check:finance
```

---

## 33. Regression Results

| Command | Result |
|---------|--------|
| `pnpm db:migrate:deploy` | PASS |
| `pnpm db:generate` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test` | API **246** (+3) + Web suites PASS |
| `pnpm test:security` | **29 passed** (+1 finance IDOR/perm) |
| `pnpm test:e2e` | **416 passed** (44 suites; includes `finance-accounts.e2e-spec`) |
| `pnpm build` | PASS |
| `pnpm db:check:finance` | **0 violations** |

---

## 34. Verdict

### Completion gate

| Question | Answer |
|----------|--------|
| Can Company create IRR Cash account? | YES |
| Can Company create USD Cash account? | YES |
| Can Company create Bank account? | YES |
| Can Company create Wallet account? | YES |
| Is every account single-currency? | YES |
| Is balance derived from movement truth? | YES |
| Can balance be manually overwritten? | NO |
| Is Opening Balance traceable? | YES |
| Does Opening Balance avoid Revenue classification? | YES |
| Can same-currency account transfer work atomically? | YES |
| Does internal transfer preserve Company currency total? | YES |
| Is cross-currency transfer rejected in 4.2? | YES |
| Can concurrent transfers overspend? | NO |
| Can posted movements be edited? | NO |
| Can posted movements be deleted normally? | NO |
| Can Company A access Company B account? | NO |
| Can different currencies be silently summed? | NO |
| Does reconciliation prove account balances? | YES |

**PHASE 4.2 STATUS: READY FOR 4.3**

Financial Accounts + same-currency transfers are implemented with ledger balance truth, opening-balance idempotency, concurrent overspend protection, integrity gate, seed fixtures, minimal UI, and regression green.

STOP — do not start Phase 4.3 automatically.
