import { BarcodeType } from '@hector/database';
import { AppError } from '../../common/exceptions/app.error';
import { withGtinCheckDigit } from './barcode-checksum.util';
import { generateInternalBarcodeValue, INTERNAL_BARCODE_PREFIX } from './barcode-internal.util';
import {
  detectBarcodeType,
  normalizeAndValidateBarcode,
  normalizeScannedValue,
} from './barcode-normalize.util';

describe('barcode-normalize.util', () => {
  it('normalizes EAN-13 (trim, strip spaces, checksum)', () => {
    const ean = withGtinCheckDigit('400638133393');
    const spaced = `  ${ean.slice(0, 6)} ${ean.slice(6)} \n`;
    const result = normalizeAndValidateBarcode(spaced, BarcodeType.EAN13);
    expect(result.value).toBe(ean);
    expect(result.normalizedValue).toBe(ean);
  });

  it('rejects invalid EAN checksum', () => {
    expect(() => normalizeAndValidateBarcode('4006381333932', BarcodeType.EAN13)).toThrow(
      AppError,
    );
  });

  it('uppercases INTERNAL / CODE128 and strips scanner control chars', () => {
    const result = normalizeAndValidateBarcode('  hct-abc123\t\r\n', BarcodeType.INTERNAL);
    expect(result.value).toBe('HCT-ABC123');
    expect(result.normalizedValue).toBe('HCT-ABC123');
  });

  it('OTHER preserves leading zeros as string identity', () => {
    const result = normalizeAndValidateBarcode(' 0012345 ', BarcodeType.OTHER);
    expect(result.value).toBe('0012345');
    expect(result.normalizedValue).toBe('0012345');
    expect(result.normalizedValue).not.toBe('12345');
  });

  it('normalizeScannedValue does not collapse leading zeros for digit barcodes', () => {
    expect(normalizeScannedValue('0012345')).toBe('0012345');
  });

  it('normalizeScannedValue strips controls and digit spaces', () => {
    expect(normalizeScannedValue(' 626 100 \n')).toBe('626100');
    expect(normalizeScannedValue('hct-abc\t')).toBe('HCT-ABC');
  });

  it('detectBarcodeType suggests EAN13 when checksum valid', () => {
    const ean = withGtinCheckDigit('400638133393');
    expect(detectBarcodeType(ean).suggested).toBe(BarcodeType.EAN13);
  });
});

describe('barcode-internal.util', () => {
  it('generates scanner-safe HCT values of stable length', () => {
    const value = generateInternalBarcodeValue();
    expect(value.startsWith(INTERNAL_BARCODE_PREFIX)).toBe(true);
    expect(value).toMatch(/^HCT-[0-9A-F]{16}$/);
    expect(normalizeAndValidateBarcode(value, BarcodeType.INTERNAL).normalizedValue).toBe(value);
  });
});
