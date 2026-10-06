import { randomBytes } from 'node:crypto';

/** Prefix for Hector-generated INTERNAL barcodes. Opaque — does not encode SKU/product data. */
export const INTERNAL_BARCODE_PREFIX = 'HCT-';

/** Hex payload length (bytes → 2 hex chars each). 8 bytes → 16 hex → HCT- + 16 = 20 chars. */
const INTERNAL_RANDOM_BYTES = 8;

/**
 * Generate a collision-resistant, scanner-safe INTERNAL barcode value.
 * Format: HCT-{UPPER_HEX} — not sequential, not derived from SKU code/name.
 */
export function generateInternalBarcodeValue(): string {
  const hex = randomBytes(INTERNAL_RANDOM_BYTES).toString('hex').toUpperCase();
  return `${INTERNAL_BARCODE_PREFIX}${hex}`;
}
