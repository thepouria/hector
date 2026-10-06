import {
  formatPurchaseReturnNumber,
  PURCHASE_RETURN_NUMBER_PATTERN,
} from './purchase-return-numbering';

describe('purchase-return-numbering', () => {
  it('formats PR-YYYY-######', () => {
    expect(formatPurchaseReturnNumber(new Date('2026-10-03T12:00:00.000Z'), 1)).toBe(
      'PR-2026-000001',
    );
    expect(formatPurchaseReturnNumber(new Date('2026-01-01T00:00:00.000Z'), 42)).toBe(
      'PR-2026-000042',
    );
    expect(PURCHASE_RETURN_NUMBER_PATTERN.test('PR-2026-000001')).toBe(true);
  });

  it('rejects non-positive sequences', () => {
    expect(() => formatPurchaseReturnNumber(new Date(), 0)).toThrow(RangeError);
  });
});
