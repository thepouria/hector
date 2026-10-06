import { describe, expect, it } from 'vitest';
import {
  availableToAdd,
  DEFAULT_SCANNER_MODE,
  formatScanHistoryLabel,
  normalizeScannerInput,
} from './scanner-receiving';

describe('scanner-receiving helpers', () => {
  it('defaults to scan + quantity mode', () => {
    expect(DEFAULT_SCANNER_MODE).toBe('QUANTITY');
  });

  it('preserves leading zeros and strips control characters', () => {
    expect(normalizeScannerInput('0012345678905')).toBe('0012345678905');
    expect(normalizeScannerInput('4059729196967\r')).toBe('4059729196967');
    expect(normalizeScannerInput('\u00004059729196967\n')).toBe('4059729196967');
  });

  it('computes draft available-to-add from remaining − draft', () => {
    expect(availableToAdd(60, 20)).toBe(40);
    expect(availableToAdd(5, 5)).toBe(0);
    expect(availableToAdd(0, 0)).toBe(0);
  });

  it('formats session scan history labels', () => {
    expect(
      formatScanHistoryLabel({
        kind: 'success',
        skuCode: 'ESS-MASCARA-01',
        barcode: '4059729196967',
        quantity: 10,
      }),
    ).toBe('✓ ESS-MASCARA-01 +10');
    expect(
      formatScanHistoryLabel({ kind: 'unknown', barcode: '9999999999999' }),
    ).toBe('✕ 9999999999999 UNKNOWN');
    expect(
      formatScanHistoryLabel({
        kind: 'wrong_sku',
        skuCode: 'LIPSTICK-02',
        barcode: 'x',
      }),
    ).toBe('⚠ LIPSTICK-02 NOT IN PO');
  });
});
