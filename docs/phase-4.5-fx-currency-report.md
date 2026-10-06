# HECTOR — Phase 4.5 FX + Currency Ledger Report

**Date:** 2026-10-05  
**Scope:** FxRate + FxConversion, currency positions/valuation (read), integrity, seed, minimal UI, e2e/security.

---

## 1. Baseline

Phase 4.4 CLOSED — Supplier Payables operational; accounts ledger ready; money/FX primitives from 4.1.

## 2. Repository Reviewed

`money/fx-rate.ts`, `AccountMovementsWriter`, finance accounts/transfers/loans/payables patterns, permissions `finance.fx.*`.

## 3. Schema Changes

Migration `20261005130000_finance_fx_currency`: enums FxRateType / FxRateSourceType / FxConversionStatus; tables `fx_rates`, `fx_conversions`, `fx_conversion_sequences`. Composite tenant FKs; CHECKs on rate &gt; 0 and currency pairs.

## 4. No CurrencyLedgerEntry

Currency ledger is projected from FxConversion + AccountMovement.

## 5. Rate Kinds

REFERENCE ≠ CONVERSION ≠ SETTLEMENT ≠ VALUATION — stored distinctly; same pair may coexist same day.

## 6. Rate Immutability

Create-new only; soft-archive; no hard-delete API for referenced rates.

## 7. Quote Semantics

Reuse `FxRateQuote`: 1 base = rate quote (e.g. 1 USD = 250000 IRR). UI shows this explicitly.

## 8. convertMoney Reuse

Central Decimal + ROUND_HALF_UP; conversion post reconciles `toAmount` against `convertMoney`.

## 9. FX Conversion Posting

MONEY_OUT (from) + MONEY_IN (to), `sourceType=FX_CONVERSION`, account locks + balance check.

## 10. Same-Currency Reject

Same from/to currency → 400; use account transfer.

## 11. Account Currency Match

Source must match fromCurrency; destination must match toCurrency.

## 12. Fee Foundation

Optional feeAmount/feeCurrency/feeAccountId; if fee &gt; 0 posts separate MONEY_OUT (4.7 expense refinement later).

## 13. Numbering

FXC-###### via `fx_conversion_sequences`.

## 14. Idempotency

Unique `(companyId, requestId)` on conversions.

## 15. Reverse Originals

Administrative reverse swaps accounts and posts ORIGINAL amounts (REVERSAL movements), not market revaluation.

## 16. Positions

Per-currency cash + payable outstanding + loan outstanding; net = cash − payables − loans.

## 17. Valuation Read-Only

VALUATION preferred, REFERENCE fallback; UNAVAILABLE when missing — never zero fabrication; no mutation of cash/AP/loan.

## 18. No Auto FX P&L

No journal FX gain/loss posting in 4.5.

## 19. No External Provider

Manual/SYSTEM seed only.

## 20. Company.baseCurrency

Used as valuation target currency.

## 21. Permissions

`finance.fx.read` / `finance.fx.manage` (manage = convert/post/reverse).

## 22. Module Wiring

`FxController` + FxRates / FxConversions / FxPositions services in `FinanceModule`.

## 23. Domain Events

`finance.fx.rate_created|rate_archived|conversion_created|posted|cancelled|reversed`.

## 24. Audit Actions

`FX_RATE_CREATED`, `FX_RATE_ARCHIVED`, `FX_CONVERSION_*`.

## 25. Error Codes

`FX_RATE_*`, `FX_CONVERSION_*`, `FX_VALUATION_UNAVAILABLE`.

## 26. Integrity Checks

Rate positivity; posted OUT/IN pair; account currency match; applied rate snapshot; orphan movement source; USD payable/loan currency preservation samples.

## 27. Seed

PISHTEH USD→IRR REFERENCE 250000 + VALUATION 270000 (illustrative).

## 28. Unit Tests

`fx-helpers.spec.ts`: asOf selection contract, position net, valuation unavailable ≠ zero, convert preview.

## 29. E2E

`finance-fx.e2e-spec.ts`: rate history asOf, IRR→USD conversion, insufficient balance, wrong currency, same-currency reject, idempotency, concurrent race, reverse originals, positions, valuation unavailable, tenant IDOR, mass assignment, zero rate, payable/loan preservation under valuation.

## 30. Security +1

`security.e2e-spec.ts` FX deny warehouse + cross-tenant IDOR.

## 31. UI

Persian RTL Finance → ارز / FX hub, rates, conversions, positions; explicit `1 USD = N IRR`.

## 32. Docs

`docs/finance-fx-currency.md` (FIN-FX-001…025), this report, README + invariants updates.

## 33. FIN-FX Invariants

Documented FIN-FX-001…025 in `docs/finance-fx-currency.md`.

## 34. Settlement Contract (4.9)

Documented: settling foreign obligations with local cash requires explicit SETTLEMENT rate — not implemented here.

## 35. Payable/Loan Preservation

Valuation endpoints read outstanding without rewriting currency; integrity samples enforce currency consistency.

## 36. Source Types

`FINANCE_ACCOUNT_SOURCE_TYPES.FX_CONVERSION` added; conceptual `FINANCE_SOURCE_TYPES` includes FX_CONVERSION.

## 37. Archive Path

`POST /finance/fx/rates/:id/archive` soft-archives.

## 38. Preview Endpoint

`POST /finance/fx/convert/preview` — no posting.

## 39. Concurrent Safety

Account FOR UPDATE + balance check; e2e race expects 201+409.

## 40. Tenant Safety

Company header scoping; IDOR returns 404; mass-assign companyId ignored.

## 41. Regression Gate

`pnpm db:migrate:deploy && pnpm db:generate && pnpm typecheck && pnpm lint && pnpm test && pnpm test:security && pnpm test:e2e && pnpm build && pnpm db:check:finance && pnpm db:check:catalog && pnpm db:check:purchasing`

## 42. Out of Scope (STOP)

Supplier cash payments (4.6), expenses (4.7), journals (4.8), settlement (4.9) — not started.

## 43. Known Illustrative Seed Rates

250000 / 270000 are fixtures, not market truth.

## 44. Currency Ledger Projection

Operators read conversion documents + account movements; no separate ledger table.

## 45. Completion Gate

All acceptance scenarios covered in e2e; integrity clean; docs + UI present.

## 46. STATUS

**PHASE 4.5 STATUS: READY FOR 4.6**

STOP — do not start Phase 4.6 automatically.
