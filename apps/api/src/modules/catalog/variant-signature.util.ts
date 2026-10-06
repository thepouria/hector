/**
 * Deterministic SKU variant combination signature.
 * - Zero options → `SIMPLE`
 * - With options → sorted `optionId:valueId` joined by `|`
 * Display labels are never used (IDs only). Request order must not matter.
 */
export const SIMPLE_VARIANT_SIGNATURE = 'SIMPLE';

export type VariantPair = {
  optionId: string;
  optionValueId: string;
};

export function buildVariantSignature(pairs: VariantPair[]): string {
  if (pairs.length === 0) {
    return SIMPLE_VARIANT_SIGNATURE;
  }

  const sorted = [...pairs].sort((a, b) => {
    if (a.optionId < b.optionId) return -1;
    if (a.optionId > b.optionId) return 1;
    if (a.optionValueId < b.optionValueId) return -1;
    if (a.optionValueId > b.optionValueId) return 1;
    return 0;
  });

  return sorted.map((p) => `${p.optionId}:${p.optionValueId}`).join('|');
}
