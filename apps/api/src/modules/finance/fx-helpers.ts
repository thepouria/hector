import { CurrencyCode, FxRateType, Prisma } from '@hector/database';
import { convertMoney, fxQuote, type FxRateQuote } from './money/fx-rate';
import { moneyOf, type Money } from './money/money';

type Tx = Prisma.TransactionClient;

export type StoredFxRateRow = {
  id: string;
  baseCurrency: CurrencyCode;
  quoteCurrency: CurrencyCode;
  rate: Prisma.Decimal;
  rateType: FxRateType;
  effectiveAt: Date;
};

/**
 * Latest applicable non-archived rate for (base, quote, rateType) with effectiveAt <= asOf.
 * Does not invent a rate or invert silently when the pair is flipped.
 */
export async function getLatestApplicableRate(
  tx: Tx,
  input: {
    companyId: string;
    baseCurrency: CurrencyCode;
    quoteCurrency: CurrencyCode;
    rateType: FxRateType;
    asOf: Date;
  },
): Promise<StoredFxRateRow | null> {
  if (input.baseCurrency === input.quoteCurrency) {
    return null;
  }
  const row = await tx.fxRate.findFirst({
    where: {
      companyId: input.companyId,
      baseCurrency: input.baseCurrency,
      quoteCurrency: input.quoteCurrency,
      rateType: input.rateType,
      archivedAt: null,
      effectiveAt: { lte: input.asOf },
    },
    orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
  });
  if (!row) return null;
  return {
    id: row.id,
    baseCurrency: row.baseCurrency,
    quoteCurrency: row.quoteCurrency,
    rate: row.rate,
    rateType: row.rateType,
    effectiveAt: row.effectiveAt,
  };
}

export function toFxRateQuote(row: StoredFxRateRow): FxRateQuote {
  return fxQuote({
    baseCurrency: row.baseCurrency,
    quoteCurrency: row.quoteCurrency,
    rate: row.rate,
    effectiveAt: row.effectiveAt,
  });
}

/**
 * Value `amount` in `currency` into company base using an explicit quote.
 * Returns null when quote cannot convert (caller must treat as unavailable, never zero).
 */
export function calculateBaseValue(input: {
  amount: Prisma.Decimal | string;
  currency: CurrencyCode;
  baseCurrency: CurrencyCode;
  quote: FxRateQuote;
}): Money | null {
  try {
    const money = moneyOf(input.amount, input.currency);
    if (money.currency === input.baseCurrency) {
      return money;
    }
    return convertMoney({
      money,
      toCurrency: input.baseCurrency,
      quote: input.quote,
    });
  } catch {
    return null;
  }
}

/** Difference between current and historical base values (current − historical). */
export function calculateFxDifference(input: {
  historicalBase: Money;
  currentBase: Money;
}): Money {
  if (input.historicalBase.currency !== input.currentBase.currency) {
    throw new Error('FX difference requires same base currency');
  }
  return {
    amount: input.currentBase.amount.minus(input.historicalBase.amount),
    currency: input.currentBase.currency,
  };
}

/**
 * Preview / reconcile: convert from→to using explicit applied rate snapshot.
 * Rate pair must be able to convert the currencies (no silent invert invent).
 */
export function previewConvertAmount(input: {
  fromAmount: Prisma.Decimal | string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  rateBaseCurrency: CurrencyCode;
  rateQuoteCurrency: CurrencyCode;
  appliedRate: Prisma.Decimal | string;
}): Money {
  const quote = fxQuote({
    baseCurrency: input.rateBaseCurrency,
    quoteCurrency: input.rateQuoteCurrency,
    rate: input.appliedRate,
  });
  return convertMoney({
    money: moneyOf(input.fromAmount, input.fromCurrency),
    toCurrency: input.toCurrency,
    quote,
  });
}

/** Amounts match when equal after currency storage rounding (already applied by convertMoney). */
export function amountsMatchWithinRounding(a: Prisma.Decimal, b: Prisma.Decimal): boolean {
  return a.eq(b);
}
