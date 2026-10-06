import { describe, expect, it } from 'vitest';
import {
  catalogLookupHref,
  catalogLookupTypeLabel,
  isLtrLookupLabel,
  isLtrLookupSublabel,
} from '@/features/catalog/catalog-lookup-utils';
import type { CatalogLookupHit } from '@/types/catalog';

function hit(overrides: Partial<CatalogLookupHit>): CatalogLookupHit {
  return {
    type: 'PRODUCT',
    id: 'hit-1',
    label: 'پنکه سقفی',
    sublabel: null,
    productId: 'product-1',
    skuId: null,
    status: 'ACTIVE',
    ...overrides,
  };
}

describe('catalog lookup hits', () => {
  it('routes product hits to product detail', () => {
    expect(catalogLookupHref(hit({ type: 'PRODUCT' }))).toBe('/app/catalog/products/product-1');
  });

  it('routes sku hits to sku detail', () => {
    expect(catalogLookupHref(hit({ type: 'SKU', skuId: 'sku-1' }))).toBe('/app/catalog/skus/sku-1');
  });

  it('routes barcode hits to the owning sku', () => {
    expect(catalogLookupHref(hit({ type: 'BARCODE', skuId: 'sku-9' }))).toBe(
      '/app/catalog/skus/sku-9',
    );
  });

  it('falls back to the product when a hit carries no sku', () => {
    expect(catalogLookupHref(hit({ type: 'BARCODE', skuId: null }))).toBe(
      '/app/catalog/products/product-1',
    );
    expect(catalogLookupHref(hit({ type: 'SKU', skuId: null, productId: null }))).toBeNull();
  });

  it('labels hit types in Persian and keeps machine codes LTR', () => {
    expect(catalogLookupTypeLabel('PRODUCT')).toBe('محصول');
    expect(catalogLookupTypeLabel('BARCODE')).toBe('بارکد');
    expect(isLtrLookupLabel('PRODUCT')).toBe(false);
    expect(isLtrLookupLabel('SKU')).toBe(true);
    expect(isLtrLookupLabel('BARCODE')).toBe(true);
  });

  it('keeps code-shaped sublabels LTR and product names RTL', () => {
    expect(isLtrLookupSublabel('PRODUCT')).toBe(true);
    expect(isLtrLookupSublabel('BARCODE')).toBe(true);
    expect(isLtrLookupSublabel('SKU')).toBe(false);
  });
});
