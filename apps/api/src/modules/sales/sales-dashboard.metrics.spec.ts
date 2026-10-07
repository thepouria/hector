import {
  COMMITTED_SALES_ORDER_STATUSES,
  OPEN_RETURN_STATUSES,
  OPEN_SALES_ORDER_STATUSES,
  PENDING_FULFILLMENT_STATUSES,
  resolveSalesDashboardRange,
} from './sales-dashboard.metrics';
import { SalesOrderStatus, SalesReturnStatus } from '@hector/database';

describe('sales-dashboard.metrics', () => {
  const now = new Date('2026-10-06T15:00:00.000Z');

  it('defines open / committed / pending status sets', () => {
    expect(OPEN_SALES_ORDER_STATUSES).toEqual([
      SalesOrderStatus.CONFIRMED,
      SalesOrderStatus.PROCESSING,
      SalesOrderStatus.PARTIALLY_FULFILLED,
    ]);
    expect(COMMITTED_SALES_ORDER_STATUSES).toContain(SalesOrderStatus.FULFILLED);
    expect(COMMITTED_SALES_ORDER_STATUSES).not.toContain(SalesOrderStatus.DRAFT);
    expect(COMMITTED_SALES_ORDER_STATUSES).not.toContain(SalesOrderStatus.CANCELLED);
    expect(PENDING_FULFILLMENT_STATUSES).toEqual([...OPEN_SALES_ORDER_STATUSES]);
    expect(OPEN_RETURN_STATUSES).toEqual([
      SalesReturnStatus.DRAFT,
      SalesReturnStatus.APPROVED,
    ]);
  });

  it('defaults to 30-day inclusive range', () => {
    const range = resolveSalesDashboardRange({ now });
    expect(range.preset).toBe('30d');
    expect(range.dayCount).toBe(30);
    expect(range.from.toISOString().startsWith('2026-09-07')).toBe(true);
    expect(range.to.toISOString().startsWith('2026-10-06')).toBe(true);
  });

  it('resolves today and 7d', () => {
    expect(resolveSalesDashboardRange({ range: 'today', now }).dayCount).toBe(1);
    expect(resolveSalesDashboardRange({ range: '7d', now }).dayCount).toBe(7);
  });

  it('rejects oversized custom ranges', () => {
    expect(() =>
      resolveSalesDashboardRange({
        range: 'custom',
        from: '2024-01-01',
        to: '2026-10-06',
        now,
      }),
    ).toThrow('DATE_RANGE_TOO_LARGE');
  });

  it('requires from/to for custom', () => {
    expect(() => resolveSalesDashboardRange({ range: 'custom', now })).toThrow(
      'CUSTOM_RANGE_REQUIRES_FROM_TO',
    );
  });
});
