import { Prisma } from '@hector/database';
import {
  toUtcBusinessDate,
  utcBusinessDateKey,
} from '../purchasing/purchase-order-due';

/** Due-soon window for finance liabilities (single policy constant). */
export const FINANCE_LIABILITY_DUE_SOON_DAYS = 7;

export const DASHBOARD_MAX_RANGE_DAYS = 366;
export const DASHBOARD_DEFAULT_RANGE_DAYS = 30;
export const DASHBOARD_ACTIVITY_LIMIT = 20;
export const DASHBOARD_DUE_LIST_LIMIT = 25;
export const DASHBOARD_TOP_SUPPLIER_LIMIT = 10;

export type FinanceDashboardRangePreset =
  | 'today'
  | '1d'
  | '7d'
  | '30d'
  | 'this_month'
  | 'custom';

export type FinanceDashboardTrendGranularity = 'day' | 'week';

export type ResolvedFinanceDashboardRange = {
  preset: FinanceDashboardRangePreset;
  from: Date;
  to: Date;
  /** Inclusive UTC calendar day count. */
  dayCount: number;
  granularity: FinanceDashboardTrendGranularity;
};

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function endOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999),
  );
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function addUtcDays(d: Date, days: number): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days, 12, 0, 0, 0),
  );
}

function dayCountInclusive(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86_400_000) + 1;
}

export function chooseFinanceTrendGranularity(dayCount: number): FinanceDashboardTrendGranularity {
  if (dayCount <= 45) return 'day';
  return 'week';
}

/**
 * Resolve finance dashboard analytics window (UTC business calendar).
 * Default: last 30 days inclusive of today.
 * Snapshot metrics ignore this window; period metrics use [from, to].
 */
export function resolveFinanceDashboardRange(input: {
  range?: string;
  from?: string;
  to?: string;
  now?: Date;
}): ResolvedFinanceDashboardRange {
  const now = input.now ?? new Date();
  const today = toUtcBusinessDate(now);
  const raw = input.range ?? '30d';

  let from: Date;
  let to: Date;
  let resolvedPreset: FinanceDashboardRangePreset;

  if (raw === 'custom' || (!input.range && input.from && input.to)) {
    if (!input.from || !input.to) {
      throw new Error('CUSTOM_RANGE_REQUIRES_FROM_TO');
    }
    from = startOfUtcDay(toUtcBusinessDate(new Date(input.from)));
    to = endOfUtcDay(toUtcBusinessDate(new Date(input.to)));
    resolvedPreset = 'custom';
  } else if (raw === 'today' || raw === '1d') {
    from = startOfUtcDay(today);
    to = endOfUtcDay(today);
    resolvedPreset = raw === '1d' ? '1d' : 'today';
  } else if (raw === '7d') {
    from = startOfUtcDay(addUtcDays(today, -6));
    to = endOfUtcDay(today);
    resolvedPreset = '7d';
  } else if (raw === 'this_month') {
    from = startOfUtcMonth(today);
    to = endOfUtcDay(today);
    resolvedPreset = 'this_month';
  } else {
    resolvedPreset = '30d';
    from = startOfUtcDay(addUtcDays(today, -(DASHBOARD_DEFAULT_RANGE_DAYS - 1)));
    to = endOfUtcDay(today);
  }

  if (from.getTime() > to.getTime()) {
    throw new Error('INVALID_DATE_RANGE');
  }

  const days = dayCountInclusive(from, to);
  if (days > DASHBOARD_MAX_RANGE_DAYS) {
    throw new Error('DATE_RANGE_TOO_LARGE');
  }

  return {
    preset: resolvedPreset,
    from,
    to,
    dayCount: days,
    granularity: chooseFinanceTrendGranularity(days),
  };
}

export function financeTrendBucketKey(
  date: Date,
  granularity: FinanceDashboardTrendGranularity,
): string {
  if (granularity === 'day') return utcBusinessDateKey(date);
  const day = toUtcBusinessDate(date);
  const dow = day.getUTCDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = addUtcDays(day, mondayOffset);
  return `W${utcBusinessDateKey(monday)}`;
}

/** Decimal-safe currency → amount map helpers (never use JS Number for aggregation). */
export function addCurrencyDecimal(
  map: Map<string, Prisma.Decimal>,
  currency: string,
  amount: Prisma.Decimal | string | number,
): void {
  const prev = map.get(currency) ?? new Prisma.Decimal(0);
  map.set(currency, prev.add(new Prisma.Decimal(amount)));
}

export function currencyDecimalMapToRows(
  map: Map<string, Prisma.Decimal>,
): Array<{ currency: string; amount: string }> {
  return [...map.entries()]
    .filter(([, amount]) => !amount.eq(0))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({ currency, amount: amount.toFixed() }));
}

/**
 * Pure helper: never sum distinct currencies into one total.
 * Returns false if rows are not safely separated by currency.
 */
export function moneyByCurrencyRowsAreSeparated(
  rows: Array<{ currency: string; amount: string }>,
): boolean {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.currency)) return false;
    seen.add(row.currency);
    if (typeof row.amount !== 'string') return false;
  }
  return true;
}

/** Demonstrates that mixed-currency Number aggregation is forbidden / impure. */
export function wouldMixedCurrencyNumberSumBeImpure(
  rows: Array<{ currency: string; amount: string }>,
): boolean {
  const currencies = new Set(rows.map((r) => r.currency));
  return currencies.size > 1;
}
