import { CurrencyCode, Prisma } from '@hector/database';
import { FX_RATE_STORAGE_SCALE, moneyOf, roundMoneyAmount, type Money } from './money';

/**
 * Explicit FX quote: how many `quoteCurrency` units equal 1 `baseCurrency` unit.
 *
 * Example (mandatory semantics):
 *   baseCurrency = USD
 *   quoteCurrency = IRR
 *   rate = 250000
 * means: 1 USD = 250,000 IRR
 *
 * Never invert silently. Callers must pick base/quote deliberately.
 */
export type FxRateQuote = {
  baseCurrency: CurrencyCode;
  quoteCurrency: CurrencyCode;
  rate: Prisma.Decimal;
  effectiveAt?: Date;
  source?: string;
};

export function parseFxRate(value: string): Prisma.Decimal {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error('Invalid FX rate format');
  }
  const rate = new Prisma.Decimal(trimmed);
  if (rate.lte(0)) {
    throw new Error('FX rate must be positive');
  }
  if (rate.decimalPlaces() > FX_RATE_STORAGE_SCALE) {
    throw new Error(`FX rate precision exceeds ${FX_RATE_STORAGE_SCALE} decimal places`);
  }
  return rate;
}

export function fxQuote(input: {
  baseCurrency: CurrencyCode;
  quoteCurrency: CurrencyCode;
  rate: string | Prisma.Decimal;
  effectiveAt?: Date;
  source?: string;
}): FxRateQuote {
  if (input.baseCurrency === input.quoteCurrency) {
    throw new Error('FX quote requires distinct base and quote currencies');
  }
  const rate =
    typeof input.rate === 'string' ? parseFxRate(input.rate) : input.rate;
  if (rate.lte(0)) {
    throw new Error('FX rate must be positive');
  }
  return {
    baseCurrency: input.baseCurrency,
    quoteCurrency: input.quoteCurrency,
    rate,
    effectiveAt: input.effectiveAt,
    source: input.source,
  };
}

/**
 * Convert amount in `from` currency to `to` currency using an explicit quote.
 * Uses Decimal arithmetic only.
 */
export function convertMoney(input: {
  money: Money;
  toCurrency: CurrencyCode;
  quote: FxRateQuote;
}): Money {
  const { money, toCurrency, quote } = input;
  if (money.currency === toCurrency) {
    return money;
  }

  // money is in quote.base → multiply by rate → quote.quoteCurrency
  if (
    money.currency === quote.baseCurrency &&
    toCurrency === quote.quoteCurrency
  ) {
    const raw = money.amount.mul(quote.rate);
    return moneyOf(roundMoneyAmount(raw, toCurrency), toCurrency);
  }

  // money is in quote.quote → divide by rate → quote.baseCurrency
  if (
    money.currency === quote.quoteCurrency &&
    toCurrency === quote.baseCurrency
  ) {
    const raw = money.amount.div(quote.rate);
    return moneyOf(roundMoneyAmount(raw, toCurrency), toCurrency);
  }

  throw new Error(
    `FX quote ${quote.baseCurrency}/${quote.quoteCurrency} @ ${quote.rate.toString()} cannot convert ${money.currency} → ${toCurrency}`,
  );
}

/** Human-readable rate direction for docs / audit metadata. */
export function describeFxQuote(quote: FxRateQuote): string {
  return `1 ${quote.baseCurrency} = ${quote.rate.toString()} ${quote.quoteCurrency}`;
}
