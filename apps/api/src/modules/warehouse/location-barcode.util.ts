import { randomBytes } from 'node:crypto';

/** Reserved Warehouse Location barcode namespace (not Catalog product barcodes). */
export const LOCATION_BARCODE_PREFIX = 'LOC-';

const LOCATION_BARCODE_RANDOM_BYTES = 6;

/**
 * Generate a stable, opaque location barcode.
 * Format: LOC-{UPPER_HEX} — independent of warehouse/location codes.
 */
export function generateLocationBarcode(): string {
  const hex = randomBytes(LOCATION_BARCODE_RANDOM_BYTES).toString('hex').toUpperCase();
  return `${LOCATION_BARCODE_PREFIX}${hex}`;
}

/** Minimal safe scanner normalization: trim only (preserve hyphens / zeros). */
export function normalizeLocationBarcodeInput(value: string): string {
  return value.trim();
}
