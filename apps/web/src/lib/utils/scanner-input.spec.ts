import { describe, expect, it } from 'vitest';
import { normalizeScannerInput } from './scanner-input';

describe('normalizeScannerInput (WH-SCANUX-001/002)', () => {
  it('preserves leading zeros', () => {
    expect(normalizeScannerInput('001234567')).toBe('001234567');
  });

  it('strips surrounding whitespace and control characters without numeric coercion', () => {
    expect(normalizeScannerInput(' 001234567\r\n')).toBe('001234567');
    expect(normalizeScannerInput('\u00000012345\u007F')).toBe('0012345');
  });

  it('does not treat barcode as a number', () => {
    const value = normalizeScannerInput('000123');
    expect(value).toBe('000123');
    expect(Number(value)).toBe(123); // numeric coercion would lose zeros — UI must keep string
    expect(value.startsWith('0')).toBe(true);
  });
});
