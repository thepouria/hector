import {
  DASHBOARD_ACTIVITY_LIMIT,
  FINANCE_LIABILITY_DUE_SOON_DAYS,
  chooseFinanceTrendGranularity,
  financeTrendBucketKey,
  moneyByCurrencyRowsAreSeparated,
  resolveFinanceDashboardRange,
  wouldMixedCurrencyNumberSumBeImpure,
} from './finance-dashboard.metrics';

describe('finance-dashboard.metrics', () => {
  const now = new Date('2026-10-06T15:00:00.000Z');

  it('exposes single due-soon constant', () => {
    expect(FINANCE_LIABILITY_DUE_SOON_DAYS).toBe(7);
    expect(DASHBOARD_ACTIVITY_LIMIT).toBe(20);
  });

  it('defaults to 30-day inclusive range', () => {
    const range = resolveFinanceDashboardRange({ now });
    expect(range.preset).toBe('30d');
    expect(range.dayCount).toBe(30);
    expect(range.granularity).toBe('day');
  });

  it('resolves today / 1d / 7d / this_month', () => {
    expect(resolveFinanceDashboardRange({ range: 'today', now }).dayCount).toBe(1);
    expect(resolveFinanceDashboardRange({ range: '1d', now }).dayCount).toBe(1);
    expect(resolveFinanceDashboardRange({ range: '7d', now }).dayCount).toBe(7);
    const thisMonth = resolveFinanceDashboardRange({ range: 'this_month', now });
    expect(thisMonth.from.toISOString().startsWith('2026-10-01')).toBe(true);
  });

  it('rejects oversized custom ranges', () => {
    expect(() =>
      resolveFinanceDashboardRange({
        range: 'custom',
        from: '2024-01-01',
        to: '2026-10-06',
        now,
      }),
    ).toThrow('DATE_RANGE_TOO_LARGE');
  });

  it('requires from/to for custom', () => {
    expect(() => resolveFinanceDashboardRange({ range: 'custom', now })).toThrow(
      'CUSTOM_RANGE_REQUIRES_FROM_TO',
    );
  });

  it('chooses trend granularity', () => {
    expect(chooseFinanceTrendGranularity(7)).toBe('day');
    expect(chooseFinanceTrendGranularity(30)).toBe('day');
    expect(chooseFinanceTrendGranularity(90)).toBe('week');
  });

  it('builds trend bucket keys', () => {
    const d = new Date(Date.UTC(2026, 9, 6, 12));
    expect(financeTrendBucketKey(d, 'day')).toBe('2026-10-06');
    expect(financeTrendBucketKey(d, 'week')).toMatch(/^W\d{4}-\d{2}-\d{2}$/);
  });

  it('keeps currencies separated — never sums IRR+USD', () => {
    const rows = [
      { currency: 'IRR', amount: '1000000000' },
      { currency: 'USD', amount: '1000' },
    ];
    expect(moneyByCurrencyRowsAreSeparated(rows)).toBe(true);
    expect(wouldMixedCurrencyNumberSumBeImpure(rows)).toBe(true);
    // Authoritative totals stay per-currency strings.
    expect(rows.every((r) => typeof r.amount === 'string')).toBe(true);
  });
});
