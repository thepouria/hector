import { describe, expect, it } from 'vitest';
import {
  derivePutawayScannerExpectation,
  parseScannerQuantity,
} from './scanner-putaway';

describe('derivePutawayScannerExpectation', () => {
  it('returns null when no row and product scan disabled', () => {
    expect(
      derivePutawayScannerExpectation({
        selectedAllocationId: null,
        quantity: null,
        allowProductScan: false,
      }),
    ).toBeNull();
  });

  it('expects quantity after row selected', () => {
    expect(
      derivePutawayScannerExpectation({
        selectedAllocationId: 'alloc-1',
        quantity: null,
        allowProductScan: false,
      }),
    ).toBe('EXPECT_QUANTITY');
  });

  it('expects location when quantity set', () => {
    expect(
      derivePutawayScannerExpectation({
        selectedAllocationId: 'alloc-1',
        quantity: 3,
        allowProductScan: false,
      }),
    ).toBe('EXPECT_LOCATION');
  });
});

describe('parseScannerQuantity', () => {
  it('parses positive integers', () => {
    expect(parseScannerQuantity('12')).toBe(12);
  });

  it('rejects non-numeric', () => {
    expect(parseScannerQuantity('abc')).toBeNull();
  });
});
