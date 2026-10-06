import { CurrencyCode, Prisma } from '@hector/database';

/**
 * Canonical Money value for Finance (Phase 4.1).
 * Amount is always Prisma.Decimal — never JS Number for authoritative math.
 */
export type Money = {
  amount: Prisma.Decimal;
  currency: CurrencyCode;
};

/** Central currency storage / arithmetic precision (minor-unit policy). */
export const CURRENCY_PRECISION: Readonly<Record<CurrencyCode, number>> = {
  [CurrencyCode.IRR]: 0,
  [CurrencyCode.USD]: 6,
};

/** FX rate storage scale (matches Purchasing / Warehouse Decimal(24, 8) convention). */
export const FX_RATE_STORAGE_SCALE = 8;

/** Display scale hints (UI); storage may be finer for USD. */
export const CURRENCY_DISPLAY_PRECISION: Readonly<Record<CurrencyCode, number>> = {
  [CurrencyCode.IRR]: 0,
  [CurrencyCode.USD]: 2,
};

export function currencyPrecision(currency: CurrencyCode): number {
  return CURRENCY_PRECISION[currency];
}

export function assertCurrencyCode(value: string): CurrencyCode {
  if (value === CurrencyCode.IRR || value === CurrencyCode.USD) {
    return value;
  }
  throw new Error(`Unsupported currency code: ${value}`);
}

/**
 * Parse a non-negative money amount string for the given currency.
 * Rejects scientific notation and floating JS coercion paths.
 */
export function parseMoneyAmount(
  value: string,
  currency: CurrencyCode,
  options?: { allowZero?: boolean },
): Prisma.Decimal {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error('Invalid money amount format');
  }
  const amount = new Prisma.Decimal(trimmed);
  if (options?.allowZero) {
    if (amount.lt(0)) throw new Error('Money amount cannot be negative');
  } else if (amount.lte(0)) {
    throw new Error('Money amount must be positive');
  }
  const maxPlaces = currencyPrecision(currency);
  if (amount.decimalPlaces() > maxPlaces) {
    throw new Error(
      `Amount precision exceeds ${maxPlaces} decimal place(s) for ${currency}`,
    );
  }
  return amount;
}

export function moneyOf(
  amount: Prisma.Decimal | string,
  currency: CurrencyCode,
): Money {
  const decimal =
    typeof amount === 'string' ? parseMoneyAmount(amount, currency, { allowZero: true }) : amount;
  if (decimal.lt(0)) {
    throw new Error('Money amount cannot be negative');
  }
  if (decimal.decimalPlaces() > currencyPrecision(currency)) {
    throw new Error(`Amount precision exceeds policy for ${currency}`);
  }
  return { amount: decimal, currency };
}

export function sameCurrency(a: Money, b: Money): boolean {
  return a.currency === b.currency;
}

/** Add same-currency money. Throws on currency mismatch. */
export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot add ${a.currency} to ${b.currency}`);
  }
  return { amount: a.amount.add(b.amount), currency: a.currency };
}

/** Subtract same-currency money (result must stay >= 0 unless allowNegative). */
export function subtractMoney(
  a: Money,
  b: Money,
  options?: { allowNegative?: boolean },
): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot subtract ${b.currency} from ${a.currency}`);
  }
  const next = a.amount.sub(b.amount);
  if (!options?.allowNegative && next.lt(0)) {
    throw new Error('Money subtraction would go negative');
  }
  return { amount: next, currency: a.currency };
}

/**
 * Round using central Finance policy: half-up to currency storage precision.
 * Prefer validating inputs at parse time; rounding is for FX conversion results.
 */
export function roundMoneyAmount(
  amount: Prisma.Decimal,
  currency: CurrencyCode,
): Prisma.Decimal {
  return amount.toDecimalPlaces(currencyPrecision(currency), Prisma.Decimal.ROUND_HALF_UP);
}
