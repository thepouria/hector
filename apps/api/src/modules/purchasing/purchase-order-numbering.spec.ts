import {
  PURCHASE_ORDER_NUMBER_PATTERN,
  formatPurchaseOrderNumber,
} from './purchase-order-numbering';

describe('purchase-order-numbering', () => {
  it('formats PO-YYYY-NNNNNN with a 6 digit zero-padded sequence', () => {
    expect(formatPurchaseOrderNumber(new Date('2026-10-03T10:00:00.000Z'), 1)).toBe('PO-2026-000001');
    expect(formatPurchaseOrderNumber(new Date('2026-10-03T10:00:00.000Z'), 42)).toBe('PO-2026-000042');
    expect(formatPurchaseOrderNumber(new Date('2026-10-03T10:00:00.000Z'), 999999)).toBe('PO-2026-999999');
  });

  it('widens past 6 digits instead of truncating', () => {
    expect(formatPurchaseOrderNumber(new Date('2026-01-01T00:00:00.000Z'), 1234567)).toBe(
      'PO-2026-1234567',
    );
  });

  it('uses the UTC year of the order date', () => {
    expect(formatPurchaseOrderNumber(new Date('2025-12-31T23:59:59.999Z'), 7)).toBe('PO-2025-000007');
    expect(formatPurchaseOrderNumber(new Date('2026-01-01T00:00:00.000Z'), 7)).toBe('PO-2026-000007');
    // 2026-01-01T01:00+03:30 is still 2025 in UTC.
    expect(formatPurchaseOrderNumber(new Date('2026-01-01T01:00:00+03:30'), 7)).toBe('PO-2025-000007');
  });

  it('rejects invalid sequences', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => formatPurchaseOrderNumber(new Date(), bad)).toThrow(RangeError);
    }
  });

  it('produces numbers that match the public pattern', () => {
    expect(PURCHASE_ORDER_NUMBER_PATTERN.test(formatPurchaseOrderNumber(new Date(), 1))).toBe(true);
    expect(PURCHASE_ORDER_NUMBER_PATTERN.test('PO-26-1')).toBe(false);
  });
});
