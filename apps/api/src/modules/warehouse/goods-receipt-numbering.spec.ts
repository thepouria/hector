import {
  formatGoodsReceiptNumber,
  GOODS_RECEIPT_NUMBER_PATTERN,
} from './goods-receipt-numbering';

describe('goods-receipt-numbering', () => {
  it('formats GRN-YYYY-NNNNNN with a 6 digit zero-padded sequence', () => {
    expect(formatGoodsReceiptNumber(new Date('2026-10-04T10:00:00.000Z'), 1)).toBe(
      'GRN-2026-000001',
    );
    expect(formatGoodsReceiptNumber(new Date('2026-10-04T10:00:00.000Z'), 42)).toBe(
      'GRN-2026-000042',
    );
  });

  it('uses UTC year of the reference date', () => {
    expect(formatGoodsReceiptNumber(new Date('2026-01-01T00:00:00.000Z'), 7)).toBe(
      'GRN-2026-000007',
    );
    expect(formatGoodsReceiptNumber(new Date('2025-12-31T23:59:59.999Z'), 7)).toBe(
      'GRN-2025-000007',
    );
  });

  it('matches the operational number pattern', () => {
    expect(GOODS_RECEIPT_NUMBER_PATTERN.test('GRN-2026-000001')).toBe(true);
    expect(GOODS_RECEIPT_NUMBER_PATTERN.test('GRN-26-1')).toBe(false);
  });
});
