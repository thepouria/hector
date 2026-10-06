# Finance FX + Currency Ledger (Phase 4.5)

**Status:** Phase 4.5 COMPLETE — READY FOR 4.6

Currency ledger is **projected** from `FxConversion` + `FinancialAccountMovement` — there is **no** `CurrencyLedgerEntry` table.

## Critical locks

| Rule | Detail |
|------|--------|
| Original currency never lost | USD obligation stays USD |
| Rate kinds are distinct | `REFERENCE ≠ CONVERSION ≠ SETTLEMENT ≠ VALUATION` |
| No silent aggregation | Never sum IRR + USD without explicit FX |
| Valuation is read-only | Never mutates cash / payable / loan |
| No auto FX P&L journal | Gain/loss posting is out of scope |
| No external FX provider | Manual / system seed rates only |
| Same-currency ≠ FX | Use account transfer |
| Reverse uses originals | Administrative reverse posts original amounts, not market rate |

## Money / convert reuse

- `apps/api/src/modules/finance/money/fx-rate.ts` — `convertMoney`, `FxRateQuote`, `describeFxQuote`
- `apps/api/src/modules/finance/money/money.ts` — Decimal, ROUND_HALF_UP, precision
- Quote semantics: **1 base = rate quote** (e.g. `1 USD = 250000 IRR`)

## Schema

### Enums

- `FxRateType`: REFERENCE \| CONVERSION \| SETTLEMENT \| VALUATION
- `FxRateSourceType`: MANUAL \| PURCHASE \| FX_TRANSACTION \| SETTLEMENT \| SYSTEM \| EXTERNAL
- `FxConversionStatus`: DRAFT \| POSTED \| CANCELLED \| REVERSED

### FxRate

Immutable snapshots. Create-new only; soft-archive when needed. CHECK `rate > 0`, `base ≠ quote`. Index `(companyId, base, quote, rateType, effectiveAt DESC)`. Multiple types same day allowed.

### FxConversion

Number `FXC-######`. On POST: lock accounts, verify `convertMoney(from→to)` matches `toAmount`, `postMovementsInTx` MONEY_OUT + MONEY_IN with `sourceType=FX_CONVERSION`. Optional fee foundation (`feeAmount` / `feeCurrency` / `feeAccountId`) posts distinct MONEY_OUT when fee &gt; 0.

## Services

| Service | Responsibility |
|---------|----------------|
| `fx-rates.service` | create / list / get / latest(asOf) / archive |
| `fx-conversions.service` | draft / postImmediately / post / cancel / reverse / preview |
| `fx-positions.service` | positions + valuation (read-only) |
| `fx-helpers` | `getLatestApplicableRate`, `calculateBaseValue`, `calculateFxDifference` |

### Position net (per currency)

```text
net = cashBalance − payableOutstanding − loanOutstanding
```

No cross-currency sum.

### Valuation

Prefer `VALUATION` rate; fall back to `REFERENCE`. Missing rate → `UNAVAILABLE` (never fabricate `0`).

## API

```text
POST/GET  /finance/fx/rates
GET       /finance/fx/rates/latest?base=&quote=&rateType=&asOf=
GET       /finance/fx/rates/:id
POST      /finance/fx/rates/:id/archive

POST/GET  /finance/fx/conversions
GET       /finance/fx/conversions/:id
POST      /finance/fx/conversions/:id/post|cancel|reverse
POST      /finance/fx/convert/preview

GET       /finance/fx/positions
GET       /finance/fx/valuation?asOf=&rateType=
```

Permissions: `finance.fx.read` / `finance.fx.manage` (manage covers convert / post / reverse).

## Settlement contract (deferred to 4.9)

Cross-currency settlement of USD payables/loans with IRR cash requires an **explicit SETTLEMENT** rate on the settlement document. Phase 4.5 does **not** settle payables or loans. Valuation may *display* base-currency equivalents without changing outstanding original currency.

## Invariants — FIN-FX-001…025

| ID | Invariant |
|----|-----------|
| **FIN-FX-001** | Original transaction currency is never silently replaced. |
| **FIN-FX-002** | Different currencies are never silently aggregated. |
| **FIN-FX-003** | Every FX rate has explicit direction (`1 base = rate quote`). |
| **FIN-FX-004** | Every FX rate must be positive. |
| **FIN-FX-005** | Historical FX rates are preserved. |
| **FIN-FX-006** | Posted financial operations preserve their exact applied rate. |
| **FIN-FX-007** | Reference Rate is not Actual Conversion Rate. |
| **FIN-FX-008** | Conversion Rate is not Settlement Rate. |
| **FIN-FX-009** | Settlement Rate is not Valuation Rate. |
| **FIN-FX-010** | Valuation never mutates original monetary amount. |
| **FIN-FX-011** | FX Conversion must create balanced two-sided currency/account effects. |
| **FIN-FX-012** | FX Conversion is atomic. |
| **FIN-FX-013** | FX Conversion is idempotent. |
| **FIN-FX-014** | Posted FX Conversion is immutable. |
| **FIN-FX-015** | Administrative reversal uses original financial amounts, not current market rate. |
| **FIN-FX-016** | Foreign Supplier Payable retains contractual currency. |
| **FIN-FX-017** | Foreign Loan retains contractual currency. |
| **FIN-FX-018** | Currency Position is derived/reconcilable. |
| **FIN-FX-019** | Liabilities reduce net currency position. |
| **FIN-FX-020** | Missing valuation rate must not be treated as zero. |
| **FIN-FX-021** | FX principal conversion is neither Revenue nor Expense. |
| **FIN-FX-022** | FX fee is distinct from FX principal. |
| **FIN-FX-023** | Future-dated rate cannot silently price an earlier transaction. |
| **FIN-FX-024** | Cross-company FX/account references are forbidden. |
| **FIN-FX-025** | Financial FX calculations use Decimal-safe arithmetic. |

Operational locks: same-currency FX conversion rejected; no `CurrencyLedgerEntry` table; no external FX provider; settlement execution deferred to 4.9.

## Seed

PISHTEH: USD→IRR REFERENCE `250000` and VALUATION `270000` (SYSTEM / illustrative — not live market).

## Integrity

`pnpm db:check:finance` includes FX checks (rate positivity, posted OUT/IN pair, currency match, rate snapshot, payable/loan currency preservation samples).

## UI

Finance → ارز / FX: rates list/create, conversions list/new/detail, positions. Persian RTL. Always show `1 USD = N IRR`.
