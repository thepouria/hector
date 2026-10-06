import {
  gtinCheckDigit,
  hasValidGtinChecksum,
  validateEan13,
  validateEan8,
  validateUpcA,
  withGtinCheckDigit,
} from './barcode-checksum.util';

describe('barcode-checksum.util', () => {
  it('computes known EAN-13 check digits', () => {
    // 400638133393 + check → 4006381333931
    expect(gtinCheckDigit('400638133393')).toBe(1);
    expect(validateEan13('4006381333931')).toBe(true);
    expect(withGtinCheckDigit('400638133393')).toBe('4006381333931');
  });

  it('rejects invalid EAN-13 checksum / length / non-numeric', () => {
    expect(validateEan13('4006381333932')).toBe(false);
    expect(validateEan13('400638133393')).toBe(false);
    expect(validateEan13('40063813339311')).toBe(false);
    expect(validateEan13('40063813339a1')).toBe(false);
  });

  it('validates EAN-8', () => {
    const body = '9638507';
    const full = withGtinCheckDigit(body);
    expect(full).toHaveLength(8);
    expect(validateEan8(full)).toBe(true);
    expect(validateEan8(full.slice(0, -1) + ((Number(full.slice(-1)) + 1) % 10))).toBe(false);
    expect(validateEan8('1234567')).toBe(false);
  });

  it('validates UPC-A', () => {
    const body = '01234567890';
    const full = withGtinCheckDigit(body);
    expect(full).toHaveLength(12);
    expect(validateUpcA(full)).toBe(true);
    expect(validateUpcA('012345678901')).toBe(hasValidGtinChecksum('012345678901'));
  });
});
