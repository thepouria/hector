import { PurchaseOrderStatus } from '@hector/database';
import { toUtcBusinessDate, utcBusinessDateKey } from './purchase-order-due';

/** Currently open commercial commitments (not draft, not closed). */
export const OPEN_PURCHASE_STATUSES: readonly PurchaseOrderStatus[] = [
  PurchaseOrderStatus.APPROVED,
  PurchaseOrderStatus.ORDERED,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
] as const;

/**
 * Committed purchasing analytics (value / trend / supplier mix).
 * Excludes DRAFT (not yet commitment) and CANCELLED (not commercial volume).
 */
export const COMMITTED_PURCHASE_STATUSES: readonly PurchaseOrderStatus[] = [
  PurchaseOrderStatus.APPROVED,
  PurchaseOrderStatus.ORDERED,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
  PurchaseOrderStatus.RECEIVED,
] as const;

/** Phase 2 temporary “not fully delivered” view — lifecycle only, no Warehouse qty. */
export const UNFULFILLED_PURCHASE_STATUSES: readonly PurchaseOrderStatus[] = [
  PurchaseOrderStatus.ORDERED,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
] as const;

export const DASHBOARD_MAX_RANGE_DAYS = 366;
export const DASHBOARD_DEFAULT_RANGE_DAYS = 30;
export const DASHBOARD_LIST_LIMIT = 12;
export const DASHBOARD_SUPPLIER_LIMIT = 10;
export const DASHBOARD_ATTENTION_LIMIT = 12;
export const DASHBOARD_ACTIVITY_LIMIT = 15;
export const DASHBOARD_AGING_ORDERED_DAYS = 14;

export type DashboardRangePreset =
  | '7d'
  | '30d'
  | '90d'
  | 'this_month'
  | 'last_month'
  | 'custom';

export type DashboardTrendGranularity = 'day' | 'week' | 'month';

export type ResolvedDashboardRange = {
  preset: DashboardRangePreset;
  from: Date;
  to: Date;
  /** Inclusive UTC calendar day count. */
  dayCount: number;
  granularity: DashboardTrendGranularity;
  previousFrom: Date;
  previousTo: Date;
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

export function chooseTrendGranularity(dayCount: number): DashboardTrendGranularity {
  if (dayCount <= 45) return 'day';
  if (dayCount <= 120) return 'week';
  return 'month';
}

/**
 * Resolve dashboard analytics window (UTC business calendar).
 * Default: last 30 days inclusive of today.
 */
export function resolveDashboardRange(input: {
  range?: string;
  from?: string;
  to?: string;
  now?: Date;
}): ResolvedDashboardRange {
  const now = input.now ?? new Date();
  const today = toUtcBusinessDate(now);
  const preset = (input.range ?? '30d') as DashboardRangePreset;

  let from: Date;
  let to: Date;
  let resolvedPreset: DashboardRangePreset = preset;

  if (preset === 'custom' || input.from || input.to) {
    if (!input.from || !input.to) {
      throw new Error('CUSTOM_RANGE_REQUIRES_FROM_TO');
    }
    from = startOfUtcDay(toUtcBusinessDate(new Date(input.from)));
    to = endOfUtcDay(toUtcBusinessDate(new Date(input.to)));
    resolvedPreset = 'custom';
  } else if (preset === '7d') {
    from = startOfUtcDay(addUtcDays(today, -6));
    to = endOfUtcDay(today);
  } else if (preset === '90d') {
    from = startOfUtcDay(addUtcDays(today, -89));
    to = endOfUtcDay(today);
  } else if (preset === 'this_month') {
    from = startOfUtcMonth(today);
    to = endOfUtcDay(today);
  } else if (preset === 'last_month') {
    const firstThis = startOfUtcMonth(today);
    const lastPrev = addUtcDays(firstThis, -1);
    from = startOfUtcMonth(lastPrev);
    to = endOfUtcDay(lastPrev);
  } else {
    // 30d default
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

  const previousTo = endOfUtcDay(addUtcDays(from, -1));
  const previousFrom = startOfUtcDay(addUtcDays(previousTo, -(days - 1)));

  return {
    preset: resolvedPreset,
    from,
    to,
    dayCount: days,
    granularity: chooseTrendGranularity(days),
    previousFrom,
    previousTo,
  };
}

export function trendBucketKey(date: Date, granularity: DashboardTrendGranularity): string {
  if (granularity === 'day') return utcBusinessDateKey(date);
  if (granularity === 'week') {
    // ISO-like week key by Monday UTC of that week
    const day = toUtcBusinessDate(date);
    const dow = day.getUTCDay(); // 0 Sun
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const monday = addUtcDays(day, mondayOffset);
    return `W${utcBusinessDateKey(monday)}`;
  }
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export type DueBucket = 'TODAY' | 'D1_7' | 'D8_30' | 'PAST';

export function dueBucket(dueDate: Date, today: Date): DueBucket {
  const days = Math.round(
    (Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate()) -
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) /
      86_400_000,
  );
  if (days < 0) return 'PAST';
  if (days === 0) return 'TODAY';
  if (days <= 7) return 'D1_7';
  return 'D8_30';
}

export function daysRemainingLabel(days: number): string {
  if (days === 0) return 'امروز';
  if (days > 0) return `${days} روز دیگر`;
  return `${Math.abs(days)} روز گذشته`;
}
