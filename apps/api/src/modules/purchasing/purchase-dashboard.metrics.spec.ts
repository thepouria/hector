import {
  COMMITTED_PURCHASE_STATUSES,
  OPEN_PURCHASE_STATUSES,
  UNFULFILLED_PURCHASE_STATUSES,
  chooseTrendGranularity,
  daysRemainingLabel,
  dueBucket,
  resolveDashboardRange,
  trendBucketKey,
} from './purchase-dashboard.metrics';
import { PurchaseOrderStatus } from '@hector/database';

describe('purchase-dashboard.metrics', () => {
  const now = new Date('2026-10-03T15:00:00.000Z');

  it('defines open vs committed vs unfulfilled status sets', () => {
    expect(OPEN_PURCHASE_STATUSES).toEqual([
      PurchaseOrderStatus.APPROVED,
      PurchaseOrderStatus.ORDERED,
      PurchaseOrderStatus.PARTIALLY_RECEIVED,
    ]);
    expect(COMMITTED_PURCHASE_STATUSES).toContain(PurchaseOrderStatus.RECEIVED);
    expect(COMMITTED_PURCHASE_STATUSES).not.toContain(PurchaseOrderStatus.DRAFT);
    expect(COMMITTED_PURCHASE_STATUSES).not.toContain(PurchaseOrderStatus.CANCELLED);
    expect(UNFULFILLED_PURCHASE_STATUSES).toEqual([
      PurchaseOrderStatus.ORDERED,
      PurchaseOrderStatus.PARTIALLY_RECEIVED,
    ]);
  });

  it('defaults to 30-day inclusive range', () => {
    const range = resolveDashboardRange({ now });
    expect(range.preset).toBe('30d');
    expect(range.dayCount).toBe(30);
    expect(range.from.toISOString().startsWith('2026-09-04')).toBe(true);
    expect(range.to.toISOString().startsWith('2026-10-03')).toBe(true);
    expect(range.granularity).toBe('day');
  });

  it('resolves 7d / 90d / this_month / last_month', () => {
    expect(resolveDashboardRange({ range: '7d', now }).dayCount).toBe(7);
    expect(resolveDashboardRange({ range: '90d', now }).dayCount).toBe(90);
    const thisMonth = resolveDashboardRange({ range: 'this_month', now });
    expect(thisMonth.from.toISOString().startsWith('2026-10-01')).toBe(true);
    const lastMonth = resolveDashboardRange({ range: 'last_month', now });
    expect(lastMonth.from.toISOString().startsWith('2026-09-01')).toBe(true);
    expect(lastMonth.to.toISOString().startsWith('2026-09-30')).toBe(true);
  });

  it('rejects oversized custom ranges', () => {
    expect(() =>
      resolveDashboardRange({
        range: 'custom',
        from: '2024-01-01',
        to: '2026-10-03',
        now,
      }),
    ).toThrow('DATE_RANGE_TOO_LARGE');
  });

  it('chooses trend granularity by span', () => {
    expect(chooseTrendGranularity(7)).toBe('day');
    expect(chooseTrendGranularity(30)).toBe('day');
    expect(chooseTrendGranularity(90)).toBe('week');
    expect(chooseTrendGranularity(200)).toBe('month');
  });

  it('builds due buckets and labels without payment wording', () => {
    const today = new Date(Date.UTC(2026, 9, 3, 12));
    expect(dueBucket(new Date(Date.UTC(2026, 9, 3, 12)), today)).toBe('TODAY');
    expect(dueBucket(new Date(Date.UTC(2026, 9, 6, 12)), today)).toBe('D1_7');
    expect(dueBucket(new Date(Date.UTC(2026, 9, 20, 12)), today)).toBe('D8_30');
    expect(dueBucket(new Date(Date.UTC(2026, 9, 1, 12)), today)).toBe('PAST');
    expect(daysRemainingLabel(0)).toBe('امروز');
    expect(daysRemainingLabel(3)).toBe('3 روز دیگر');
    expect(daysRemainingLabel(-2)).toBe('2 روز گذشته');
  });

  it('builds trend bucket keys', () => {
    const d = new Date(Date.UTC(2026, 9, 3, 12));
    expect(trendBucketKey(d, 'day')).toBe('2026-10-03');
    expect(trendBucketKey(d, 'month')).toBe('2026-10');
    expect(trendBucketKey(d, 'week')).toMatch(/^W\d{4}-\d{2}-\d{2}$/);
  });
});
