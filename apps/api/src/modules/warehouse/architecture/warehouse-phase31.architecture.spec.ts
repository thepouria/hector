import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PurchaseOrderStatus } from '@hector/database';
import {
  assertPurchaseReceivingAllowed,
  derivePurchaseReceivingStatus,
  isPurchaseReceivingEligible,
  PURCHASE_RECEIVING_ELIGIBLE_STATUSES,
} from '../../purchasing/contracts/purchase-receiving.policy';
import type { PurchaseReceivingContext } from '../../purchasing/contracts/purchase-receiving.types';
import { ERROR_CODES } from '../../../common/constants';
import { AppError } from '../../../common/exceptions/app.error';

/**
 * Phase 3.1 — architecture / contract gates only.
 * Does not implement operational Warehouse.
 */
describe('Warehouse Phase 3.1 architecture', () => {
  // jest rootDir = apps/api
  const schemaPath = join(process.cwd(), '../../packages/database/prisma/schema.prisma');

  it('keeps Purchasing receiving context identifiers stable for Warehouse', () => {
    const context: PurchaseReceivingContext = {
      purchaseOrderId: 'po-1',
      companyId: 'co-1',
      status: PurchaseOrderStatus.ORDERED,
      supplierId: 'sup-1',
      items: [
        {
          purchaseOrderItemId: 'poi-1',
          skuId: 'sku-1',
          orderedQuantity: 100,
          closedUnfulfilledQuantity: 0,
        },
      ],
    };

    expect(Object.keys(context).sort()).toEqual(
      ['companyId', 'items', 'purchaseOrderId', 'status', 'supplierId'].sort(),
    );
    expect(Object.keys(context.items[0]!).sort()).toEqual(
      [
        'closedUnfulfilledQuantity',
        'orderedQuantity',
        'purchaseOrderItemId',
        'skuId',
      ].sort(),
    );
  });

  it('allows receiving only for ORDERED / PARTIALLY_RECEIVED', () => {
    expect([...PURCHASE_RECEIVING_ELIGIBLE_STATUSES]).toEqual([
      PurchaseOrderStatus.ORDERED,
      PurchaseOrderStatus.PARTIALLY_RECEIVED,
    ]);
    expect(isPurchaseReceivingEligible(PurchaseOrderStatus.APPROVED)).toBe(false);
    expect(() => assertPurchaseReceivingAllowed(PurchaseOrderStatus.ORDERED)).not.toThrow();
  });

  it('forbids default over-receipt (Phase 3.1 policy)', () => {
    try {
      derivePurchaseReceivingStatus(
        [{ purchaseOrderItemId: 'a', orderedQuantity: 100 }],
        [{ purchaseOrderItemId: 'a', acceptedReceivedQuantity: 101 }],
      );
      throw new Error('expected over-receipt rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ERROR_CODES.PURCHASE_ORDER_OVER_RECEIPT_NOT_ALLOWED);
    }
  });

  it('supports multiple receipt aggregates toward one PO item without rewriting ordered qty', () => {
    const status = derivePurchaseReceivingStatus(
      [{ purchaseOrderItemId: 'a', orderedQuantity: 100 }],
      [
        { purchaseOrderItemId: 'a', acceptedReceivedQuantity: 40 },
        { purchaseOrderItemId: 'a', acceptedReceivedQuantity: 60 },
      ],
    );
    expect(status).toBe(PurchaseOrderStatus.RECEIVED);
  });

  it('allows Warehouse + Ledger + Transfer models but forbids competing stock / reservation tables', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    // Phase 3.2–3.11: Warehouse Master → Ledger → Balance → Stock Transfer.
    expect(schema).toContain('model Warehouse ');
    expect(schema).toContain('model WarehouseLocation ');
    expect(schema).toContain('model GoodsReceipt ');
    expect(schema).toContain('model GoodsReceiptItem ');
    expect(schema).toContain('model InventoryMovement ');
    expect(schema).toContain('model InventoryBalance ');
    expect(schema).toContain('model StockTransfer ');
    expect(schema).toContain('model StockTransferItem ');
    expect(schema).toContain('model InventoryAdjustment ');
    expect(schema).toContain('model InventoryAdjustmentItem ');
    expect(schema).toContain('model StockCount ');
    expect(schema).toContain('model StockCountItem ');
    expect(schema).toContain('model SupplierReturnExecution ');
    expect(schema).toContain('model SupplierReturnExecutionItem ');
    expect(schema).toContain('model InventoryReservation ');
    expect(schema).toContain('model InventoryCostLayer ');
    expect(schema).toContain('model InventoryLayerConsumption ');
    expect(schema).toContain('model InventoryAvailabilityLock ');
    expect(schema).not.toContain('model ReturnShipment ');
    expect(schema).not.toContain('model WarehouseZone ');
    expect(schema).not.toContain('model WarehouseAisle ');
    expect(schema).not.toContain('model WarehouseRack ');
    expect(schema).not.toContain('model WarehouseShelf ');
    expect(schema).not.toContain('model WarehouseBin ');
    const forbiddenModels = [
      'model InventoryBatch ',
      'model StockBalance ',
      'model FifoLayer ',
      'model WarehouseProduct ',
      'model WarehouseSku ',
    ];
    for (const model of forbiddenModels) {
      expect(schema).not.toContain(model);
    }
  });

  it('keeps Catalog barcode resolve surface available (no Warehouse barcode master)', () => {
    const controllerPath = join(
      process.cwd(),
      'src/modules/catalog/barcodes.controller.ts',
    );
    const source = readFileSync(controllerPath, 'utf8');
    expect(source).toMatch(/resolve/i);
    expect(source).toMatch(/Barcode/);
  });
});
