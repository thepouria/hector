import { formatSettlementNumber, SETTLEMENT_CODE_PATTERN } from './settlement-numbering';

describe('settlement numbering', () => {
  it('formats STL-000001 style numbers', () => {
    expect(formatSettlementNumber(1)).toBe('STL-000001');
    expect(formatSettlementNumber(42)).toBe('STL-000042');
    expect(formatSettlementNumber(1_000_000)).toBe('STL-1000000');
    expect(SETTLEMENT_CODE_PATTERN.test(formatSettlementNumber(7))).toBe(true);
  });

  it('rejects non-positive sequences', () => {
    expect(() => formatSettlementNumber(0)).toThrow(RangeError);
    expect(() => formatSettlementNumber(-1)).toThrow(RangeError);
    expect(() => formatSettlementNumber(1.5)).toThrow(RangeError);
  });
});
