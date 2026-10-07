import { SalesOrderStatus, SalesReturnStatus } from '@hector/database';
import { toUtcBusinessDate } from '../purchasing/purchase-order-due';

/** Open commercial pipeline (not draft, not terminal). */
export const OPEN_SALES_ORDER_STATUSES: readonly SalesOrderStatus[] = [
  SalesOrderStatus.CONFIRMED,
  SalesOrderStatus.PROCESSING,
  SalesOrderStatus.PARTIALLY_FULFILLED,
] as const;

/** Committed sales analytics (excludes DRAFT / CANCELLED). */
export const COMMITTED_SALES_ORDER_STATUSES: readonly SalesOrderStatus[] = [
  SalesOrderStatus.CONFIRMED,
  SalesOrderStatus.PROCESSING,
  SalesOrderStatus.PARTIALLY_FULFILLED,
  SalesOrderStatus.FULFILLED,
] as const;

export const PENDING_FULFILLMENT_STATUSES: readonly SalesOrderStatus[] = [
  SalesOrderStatus.CONFIRMED,
  SalesOrderStatus.PROCESSING,
  SalesOrderStatus.PARTIALLY_FULFILLED,
] as const;

export const OPEN_RETURN_STATUSES: readonly SalesReturnStatus[] = [
  SalesReturnStatus.DRAFT,
  SalesReturnStatus.APPROVED,
] as const;

export const DASHBOARD_MAX_RANGE_DAYS = 366;
export const DASHBOARD_DEFAULT_RANGE_DAYS = 30;
export const DASHBOARD_RECENT_ORDERS_LIMIT = 12;
export const DASHBOARD_RECEIVABLES_LIMIT = 8;

export type SalesDashboardRangePreset = 'today' | '7d' | '30d' | 'custom';

export type ResolvedSalesDashboardRange = {
  preset: SalesDashboardRangePreset;
  from: Date;
  to: Date;
  /** Inclusive UTC calendar day count. */
  dayCount: number;
};

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

/**
 * Resolve sales dashboard analytics window (UTC business calendar).
 * Default: last 30 days inclusive of today.
 */
export function resolveSalesDashboardRange(input: {
  range?: string;
  from?: string;
  to?: string;
  now?: Date;
}): ResolvedSalesDashboardRange {
  const now = input.now ?? new Date();
  const today = toUtcBusinessDate(now);
  const raw = input.range ?? '30d';

  let from: Date;
  let to: Date;
  let resolvedPreset: SalesDashboardRangePreset;

  if (raw === 'custom' || (!input.range && input.from && input.to)) {
    if (!input.from || !input.to) {
      throw new Error('CUSTOM_RANGE_REQUIRES_FROM_TO');
    }
    from = startOfUtcDay(toUtcBusinessDate(new Date(input.from)));
    to = endOfUtcDay(toUtcBusinessDate(new Date(input.to)));
    resolvedPreset = 'custom';
  } else if (raw === 'today') {
    from = startOfUtcDay(today);
    to = endOfUtcDay(today);
    resolvedPreset = 'today';
  } else if (raw === '7d') {
    from = startOfUtcDay(addUtcDays(today, -6));
    to = endOfUtcDay(today);
    resolvedPreset = '7d';
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
  };
}
