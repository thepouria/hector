# Finance Currency and Money (Phase 4.1)

## CurrencyCode

Canonical enum (Prisma):

```text
IRR
USD
```

Extensible without `amountIrr` / `amountUsd` columns. Prefer `amount` + `currency`.

Company `baseCurrency` already exists (`Company.baseCurrency`).

---

## Money primitive

```ts
Money { amount: Prisma.Decimal; currency: CurrencyCode }
```

Code: `apps/api/src/modules/finance/money/money.ts`

Forbidden for authoritative math:

```text
parseFloat / Number(decimal) / JS Number * fxRate
```

---

## Precision policy (central)

| Currency | Storage max scale | Display hint |
|----------|-------------------|--------------|
| IRR | 0 (whole rials) | 0 |
| USD | 6 | 2 |

FX rate storage scale: **8** (aligns with Purchasing `Decimal(24, 8)`).

Rounding for FX conversion results: **half-up** to currency storage precision (`Prisma.Decimal.ROUND_HALF_UP`). Prefer rejecting over-precise inputs at parse time.

Do not scatter ad-hoc `floor`/`ceil` in services.

---

## FX rate semantics

```ts
FxRateQuote {
  baseCurrency   // 1 unit of this
  quoteCurrency  // equals `rate` units of this
  rate
  effectiveAt?
  source?
}
```

Example:

```text
base = USD, quote = IRR, rate = 250000
→ 1 USD = 250,000 IRR
```

Code: `apps/api/src/modules/finance/money/fx-rate.ts`  
`describeFxQuote` / `convertMoney` refuse ambiguous reverse interpretation.

Phase 4.5 operational FX: stored `FxRate` + `FxConversion`, positions/valuation — see `docs/finance-fx-currency.md`.

No market-rate provider in 4.1 / 4.5.

---

## Original currency examples

### USD supplier liability

```text
Liability: 1,000 USD
Reference: 235,000 IRR/USD → reference value 235,000,000 IRR
Later market 260,000 → still owe 1,000 USD
```

### USD loan

```text
Cash USD +10,000
Loan principal 10,000 USD (canonical)
Optional base measurement at reference rate — not a rewrite of principal
```

### Partial repayment

```text
Principal 10,000 USD − repayment 3,000 USD → outstanding 7,000 USD
```

Outstanding reconciles from principal + repayments (implementation in 4.3/4.9).

### Cross-currency repayment (future 4.9)

May settle USD loan with IRR at **explicit settlement rate** without losing original USD obligation history.

---

## Account currency

Prefer one Financial Account = one currency (4.2):

```text
Mellat Bank — IRR
USD Cash — USD
Khanoumi Wallet — IRR
```
