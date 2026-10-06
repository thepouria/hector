/**
 * Putaway scanner workflow (Phase 3.8) — presentation only; mutations via API.
 */

import { normalizeScannerInput } from '@/lib/utils/scanner-input';

export type PutawayScannerExpectation =
  | 'EXPECT_PRODUCT'
  | 'EXPECT_QUANTITY'
  | 'EXPECT_LOCATION';

export { normalizeScannerInput };

export function derivePutawayScannerExpectation(input: {
  selectedAllocationId: string | null;
  quantity: number | null;
  allowProductScan: boolean;
}): PutawayScannerExpectation | null {
  if (!input.selectedAllocationId) {
    return input.allowProductScan ? 'EXPECT_PRODUCT' : null;
  }
  if (input.quantity == null || input.quantity <= 0) {
    return 'EXPECT_QUANTITY';
  }
  return 'EXPECT_LOCATION';
}

export function putawayScannerExpectationLabel(
  expectation: PutawayScannerExpectation | null,
): string {
  switch (expectation) {
    case 'EXPECT_PRODUCT':
      return 'در انتظار اسکن کالا (اختیاری)';
    case 'EXPECT_QUANTITY':
      return 'تعداد را وارد کنید';
    case 'EXPECT_LOCATION':
      return 'بارکد مکان را اسکن کنید';
    default:
      return 'یک ردیف منبع را انتخاب کنید';
  }
}

export function parseScannerQuantity(raw: string): number | null {
  const normalized = normalizeScannerInput(raw);
  if (!/^\d+$/.test(normalized)) return null;
  const n = Number(normalized);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}
