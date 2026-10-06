import { describe, expect, it } from 'vitest';
import {
  brandKeys,
  categoryKeys,
  companyKeys,
  memberKeys,
  offerKeys,
  purchaseOrderKeys,
  purchaseReturnKeys,
  purchasingKeys,
  roleKeys,
  skuKeys,
  supplierKeys,
  variantKeys,
  barcodeKeys,
  warehouseKeys,
} from '@/lib/query/keys';

describe('company-scoped query cache isolation', () => {
  it('keeps Company A and Company B member lists distinct', () => {
    const a = memberKeys.list('company-a', { page: 1 });
    const b = memberKeys.list('company-b', { page: 1 });
    expect(a).not.toEqual(b);
    expect(a[1]).toBe('company-a');
    expect(b[1]).toBe('company-b');
  });

  it('keeps role detail keys company-scoped', () => {
    const sharedRoleId = 'role-1';
    expect(roleKeys.detail('company-a', sharedRoleId)).not.toEqual(
      roleKeys.detail('company-b', sharedRoleId),
    );
  });

  it('keeps company detail keys distinct', () => {
    expect(companyKeys.detail('a')).not.toEqual(companyKeys.detail('b'));
  });

  it('keeps brand and category query keys company-scoped', () => {
    expect(brandKeys.list('a', { page: 1 })).not.toEqual(brandKeys.list('b', { page: 1 }));
    expect(categoryKeys.tree('a')).not.toEqual(categoryKeys.tree('b'));
  });

  it('keeps SKU and variant query keys company- and product-scoped', () => {
    expect(skuKeys.list('a', 'p1', { page: 1 })).not.toEqual(skuKeys.list('b', 'p1', { page: 1 }));
    expect(skuKeys.list('a', 'p1')).not.toEqual(skuKeys.list('a', 'p2'));
    expect(variantKeys.options('a', 'p1')).not.toEqual(variantKeys.options('b', 'p1'));
    expect(variantKeys.options('a', 'p1')).not.toEqual(variantKeys.options('a', 'p2'));
    expect(skuKeys.byProduct('a', 'p1')).toEqual(skuKeys.list('a', 'p1').slice(0, 4));
  });

  it('keeps barcode query keys company- and sku-scoped', () => {
    expect(barcodeKeys.bySku('a', 's1')).not.toEqual(barcodeKeys.bySku('b', 's1'));
    expect(barcodeKeys.bySku('a', 's1')).not.toEqual(barcodeKeys.bySku('a', 's2'));
  });

  it('keeps Purchasing query keys company-scoped', () => {
    expect(purchasingKeys.summary('a')).not.toEqual(purchasingKeys.summary('b'));
    expect(purchasingKeys.dashboard('a', { range: '30d' })).not.toEqual(
      purchasingKeys.dashboard('b', { range: '30d' }),
    );
    expect(supplierKeys.list('a', { q: 'x' })).not.toEqual(supplierKeys.list('b', { q: 'x' }));
    expect(offerKeys.list('a', { page: 1 })).not.toEqual(offerKeys.list('b', { page: 1 }));
    expect(purchaseOrderKeys.detail('a', 'po-1')).not.toEqual(
      purchaseOrderKeys.detail('b', 'po-1'),
    );
    expect(purchaseOrderKeys.corrections('a', 'po-1')).not.toEqual(
      purchaseOrderKeys.corrections('b', 'po-1'),
    );
    expect(purchaseReturnKeys.list('a', { status: 'DRAFT' })).not.toEqual(
      purchaseReturnKeys.list('b', { status: 'DRAFT' }),
    );
  });

  it('keeps Warehouse query keys company-scoped', () => {
    expect(warehouseKeys.list('a', { page: 1 })).not.toEqual(warehouseKeys.list('b', { page: 1 }));
    expect(warehouseKeys.detail('a', 'wh-1')).not.toEqual(warehouseKeys.detail('b', 'wh-1'));
    expect(warehouseKeys.all('a')[1]).toBe('a');
  });

  it('keeps Warehouse Location query keys company- and warehouse-scoped', () => {
    expect(warehouseKeys.locations('a', 'wh-1', { page: 1 })).not.toEqual(
      warehouseKeys.locations('b', 'wh-1', { page: 1 }),
    );
    expect(warehouseKeys.locations('a', 'wh-1')).not.toEqual(
      warehouseKeys.locations('a', 'wh-2'),
    );
    expect(warehouseKeys.locationDetail('a', 'wh-1', 'loc-1')).not.toEqual(
      warehouseKeys.locationDetail('b', 'wh-1', 'loc-1'),
    );
    expect(warehouseKeys.locationDetail('a', 'wh-1', 'loc-1')).not.toEqual(
      warehouseKeys.locationDetail('a', 'wh-2', 'loc-1'),
    );
  });

  it('keeps Goods Receipt query keys company-scoped', () => {
    const gr = warehouseKeys.goodsReceipts;
    expect(gr.list('a', { page: 1 })).not.toEqual(gr.list('b', { page: 1 }));
    expect(gr.detail('a', 'gr-1')).not.toEqual(gr.detail('b', 'gr-1'));
    expect(gr.eligiblePurchaseOrders('a')).not.toEqual(gr.eligiblePurchaseOrders('b'));
    expect(gr.purchaseOrderProgress('a', 'po-1')).not.toEqual(
      gr.purchaseOrderProgress('b', 'po-1'),
    );
    expect(gr.purchaseOrderProgress('a', 'po-1')).not.toEqual(
      gr.purchaseOrderProgress('a', 'po-2'),
    );
    expect(gr.all('a')[1]).toBe('a');
  });
});
