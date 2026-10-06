import { CurrencyCode, Prisma } from '@hector/database';
import { convertMoney, fxQuote, parseFxRate, type FxRateQuote } from './money/fx-rate';
import { moneyOf, roundMoneyAmount } from './money/money';

/**
 * Convert an amount to company base using an explicit quote (never invents rates).
 */
export function toBaseAmount(input: {
  amount: Prisma.Decimal;
  currency: CurrencyCode;
  baseCurrency: CurrencyCode;
  quote: FxRateQuote | null;
}): Prisma.Decimal {
  if (input.currency === input.baseCurrency) {
    return input.amount;
  }
  if (!input.quote) {
    throw new Error('FX quote required for foreign → base conversion');
  }
  return convertMoney({
    money: moneyOf(input.amount, input.currency),
    toCurrency: input.baseCurrency,
    quote: input.quote,
  }).amount;
}

/**
 * Deterministic carrying-base slice for a settlement (FIN-SET-008 / remainder on last).
 * When this settle consumes the remaining liability outstanding, assign remaining carrying.
 * Otherwise allocate proportionally and round to base currency precision.
 */
export function allocateCarryingBase(input: {
  liabilitySettled: Prisma.Decimal;
  outstandingBefore: Prisma.Decimal;
  totalCarryingBase: Prisma.Decimal;
  priorCarryingSettled: Prisma.Decimal;
  baseCurrency: CurrencyCode;
}): Prisma.Decimal {
  const remainingCarrying = input.totalCarryingBase.minus(input.priorCarryingSettled);
  if (remainingCarrying.lt(0)) {
    throw new Error('Prior carrying settlements exceed total carrying base');
  }
  if (input.liabilitySettled.gte(input.outstandingBefore)) {
    return remainingCarrying;
  }
  if (input.outstandingBefore.lte(0)) {
    return new Prisma.Decimal(0);
  }
  const raw = remainingCarrying
    .mul(input.liabilitySettled)
    .div(input.outstandingBefore);
  return roundMoneyAmount(raw, input.baseCurrency);
}

export function buildExplicitSettlementQuote(input: {
  rate: string | Prisma.Decimal;
  baseCurrency: CurrencyCode;
  quoteCurrency: CurrencyCode;
}): FxRateQuote {
  const rate =
    typeof input.rate === 'string' ? parseFxRate(input.rate) : input.rate;
  return fxQuote({
    baseCurrency: input.baseCurrency,
    quoteCurrency: input.quoteCurrency,
    rate,
  });
}

/** fxDifferenceBase = paymentBase − carryingBase (positive → loss). */
export function computeFxDifferenceBase(
  paymentBase: Prisma.Decimal,
  carryingBase: Prisma.Decimal,
): Prisma.Decimal {
  return paymentBase.minus(carryingBase);
}
