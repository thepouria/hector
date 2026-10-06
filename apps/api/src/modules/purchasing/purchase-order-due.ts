import {
  PURCHASE_ORDER_DUE_SOON_DAYS,
  type PurchaseDueStatus,
} from './purchasing.constants';

/**
 * Normalize a Date to the UTC business calendar day at noon.
 * Avoids timezone day-shift when serializing date-only due dates through Timestamptz.
 */
export function toUtcBusinessDate(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0, 0),
  );
}

/** Parse an ISO date or datetime string into a UTC business calendar date (noon). */
export function parseUtcBusinessDate(value: string): Date {
  const trimmed = value.trim();
  const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dayOnly) {
    const year = Number(dayOnly[1]);
    const month = Number(dayOnly[2]);
    const day = Number(dayOnly[3]);
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid date');
  }
  return toUtcBusinessDate(parsed);
}

/** UTC calendar YYYY-MM-DD of a stored business date. */
export function utcBusinessDateKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole UTC calendar days from `from` to `to` (can be negative). */
export function utcCalendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

/**
 * Derived contractual due status. NOT payment state.
 * OVERDUE = contractual due calendar day is before today — not "still unpaid".
 */
export function deriveDueStatus(
  dueDate: Date | null | undefined,
  now: Date = new Date(),
  dueSoonDays: number = PURCHASE_ORDER_DUE_SOON_DAYS,
): PurchaseDueStatus {
  if (!dueDate) return 'NO_DUE_DATE';
  const daysUntil = utcCalendarDaysBetween(toUtcBusinessDate(now), toUtcBusinessDate(dueDate));
  if (daysUntil < 0) return 'OVERDUE';
  if (daysUntil === 0) return 'DUE_TODAY';
  if (daysUntil <= dueSoonDays) return 'DUE_SOON';
  return 'UPCOMING';
}

/** Inclusive UTC day window for list filters (start noon … end noon of that calendar day). */
export function utcDayRange(date: Date): { gte: Date; lte: Date } {
  const day = toUtcBusinessDate(date);
  return {
    gte: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0, 0)),
    lte: new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59, 59, 999),
    ),
  };
}

/**
 * Translate a derived dueStatus into a Prisma dueDate filter relative to `now`.
 * Returns null for NO_DUE_DATE (caller should use `{ dueDate: null }`).
 */
export function dueStatusToDateFilter(
  status: Exclude<PurchaseDueStatus, 'NO_DUE_DATE'>,
  now: Date = new Date(),
  dueSoonDays: number = PURCHASE_ORDER_DUE_SOON_DAYS,
): { lt?: Date; gte?: Date; lte?: Date } {
  const today = toUtcBusinessDate(now);
  const todayStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0),
  );
  const todayEnd = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59, 999),
  );
  const soonEnd = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() + dueSoonDays,
      23,
      59,
      59,
      999,
    ),
  );
  const upcomingStart = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() + dueSoonDays + 1,
      0,
      0,
      0,
      0,
    ),
  );

  if (status === 'OVERDUE') return { lt: todayStart };
  if (status === 'DUE_TODAY') return { gte: todayStart, lte: todayEnd };
  if (status === 'DUE_SOON') {
    const tomorrowStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1, 0, 0, 0, 0),
    );
    return { gte: tomorrowStart, lte: soonEnd };
  }
  // UPCOMING
  return { gte: upcomingStart };
}
