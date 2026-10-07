import { formatPartyCode, PARTY_CODE_PATTERN } from './party-numbering';

describe('party numbering', () => {
  it('formats PTY-000001 style codes', () => {
    expect(formatPartyCode(1)).toBe('PTY-000001');
    expect(formatPartyCode(42)).toBe('PTY-000042');
    expect(formatPartyCode(1_000_000)).toBe('PTY-1000000');
    expect(PARTY_CODE_PATTERN.test(formatPartyCode(7))).toBe(true);
  });

  it('rejects non-positive sequences', () => {
    expect(() => formatPartyCode(0)).toThrow(RangeError);
    expect(() => formatPartyCode(-1)).toThrow(RangeError);
    expect(() => formatPartyCode(1.5)).toThrow(RangeError);
  });
});
