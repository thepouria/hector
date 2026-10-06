import {
  generateLocationBarcode,
  LOCATION_BARCODE_PREFIX,
  normalizeLocationBarcodeInput,
} from './location-barcode.util';

describe('location-barcode.util', () => {
  it('generates LOC- namespace barcodes', () => {
    const barcode = generateLocationBarcode();
    expect(barcode.startsWith(LOCATION_BARCODE_PREFIX)).toBe(true);
    expect(barcode).toMatch(/^LOC-[0-9A-F]+$/);
  });

  it('generates unique values across calls', () => {
    const set = new Set(Array.from({ length: 50 }, () => generateLocationBarcode()));
    expect(set.size).toBe(50);
  });

  it('trims barcode input without stripping hyphens or zeros', () => {
    expect(normalizeLocationBarcodeInput('  LOC-0ABC  ')).toBe('LOC-0ABC');
    expect(normalizeLocationBarcodeInput('LOC-MAIN-S03')).toBe('LOC-MAIN-S03');
  });
});
