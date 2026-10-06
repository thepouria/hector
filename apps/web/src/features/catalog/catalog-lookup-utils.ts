import { catalogProductPath, catalogSkuPath } from '@/lib/utils/routes';
import type { CatalogLookupHit, CatalogLookupType } from '@/types/catalog';

/** Below two characters the lookup is too noisy to be useful. */
export const CATALOG_LOOKUP_MIN_LENGTH = 2;

export function catalogLookupTypeLabel(type: CatalogLookupType): string {
  if (type === 'PRODUCT') return 'محصول';
  if (type === 'SKU') return 'SKU';
  return 'بارکد';
}

/** Barcode and SKU hits both land on the SKU detail page; products on product detail. */
export function catalogLookupHref(hit: CatalogLookupHit): string | null {
  if (hit.type === 'PRODUCT') {
    const productId = hit.productId ?? hit.id;
    return productId ? catalogProductPath(productId) : null;
  }
  if (hit.skuId) return catalogSkuPath(hit.skuId);
  return hit.productId ? catalogProductPath(hit.productId) : null;
}

/** Machine identifiers (SKU codes, barcode values) always render left-to-right. */
export function isLtrLookupLabel(type: CatalogLookupType): boolean {
  return type !== 'PRODUCT';
}

/** Sublabels are product code (PRODUCT), product name (SKU) and SKU code (BARCODE). */
export function isLtrLookupSublabel(type: CatalogLookupType): boolean {
  return type !== 'SKU';
}
