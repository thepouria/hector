import { formatBatchNumber, BATCH_NUMBER_PATTERN } from './batch-numbering';

describe('batch-numbering', () => {
  it('formats BAT-###### with at least 6 digits', () => {
    expect(formatBatchNumber(1)).toBe('BAT-000001');
    expect(formatBatchNumber(381)).toBe('BAT-000381');
    expect(formatBatchNumber(1_000_000)).toBe('BAT-1000000');
    expect(BATCH_NUMBER_PATTERN.test('BAT-000001')).toBe(true);
  });

  it('rejects non-positive sequences', () => {
    expect(() => formatBatchNumber(0)).toThrow(RangeError);
    expect(() => formatBatchNumber(-1)).toThrow(RangeError);
  });
});
