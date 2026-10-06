import { formatPaymentNumber, formatReceiptNumber } from './payment-numbering';

describe('payment-numbering', () => {
  it('formats PAY-###### and REC-######', () => {
    expect(formatPaymentNumber(1)).toBe('PAY-000001');
    expect(formatPaymentNumber(42)).toBe('PAY-000042');
    expect(formatReceiptNumber(1)).toBe('REC-000001');
    expect(formatReceiptNumber(999999)).toBe('REC-999999');
  });

  it('rejects non-positive sequences', () => {
    expect(() => formatPaymentNumber(0)).toThrow(RangeError);
    expect(() => formatReceiptNumber(-1)).toThrow(RangeError);
    expect(() => formatPaymentNumber(1.5)).toThrow(RangeError);
  });
});
