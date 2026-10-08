import type { DatabaseService } from '../../src/infrastructure/database/database.service';

/**
 * Delete supplier-payable recognition rows that block GRN item cleanup.
 * Call before goodsReceiptItem / goodsReceipt deletes in e2e afterAll.
 */
export async function cleanupPayablesForGoodsReceipts(
  database: DatabaseService,
  goodsReceiptIds: string[],
): Promise<void> {
  if (goodsReceiptIds.length === 0) return;

  const lines = await database.client.supplierPayableLine.findMany({
    where: { goodsReceiptId: { in: goodsReceiptIds } },
    select: { id: true, payableId: true, goodsReceiptItemId: true },
  });
  if (lines.length === 0) return;

  const payableIds = [...new Set(lines.map((l) => l.payableId))];

  await database.client.supplierPaymentAllocation.deleteMany({
    where: { payableId: { in: payableIds } },
  });
  // Only delete by payableId — never match sourceId alone (opening sourceId === payable.id).
  await database.client.supplierLiabilityMovement.deleteMany({
    where: { payableId: { in: payableIds } },
  });
  await database.client.supplierPayableLine.deleteMany({
    where: { goodsReceiptId: { in: goodsReceiptIds } },
  });

  // Drop payables that no longer have lines (test fixtures only).
  for (const payableId of payableIds) {
    const remaining = await database.client.supplierPayableLine.count({
      where: { payableId },
    });
    if (remaining === 0) {
      await database.client.supplierCredit.updateMany({
        where: { payableId },
        data: { payableId: null },
      });
      await database.client.supplierPaymentAllocation.deleteMany({
        where: { payableId },
      });
      await database.client.supplierLiabilityMovement.deleteMany({
        where: { payableId },
      });
      await database.client.supplierPayable.delete({ where: { id: payableId } }).catch(() => {
        /* keep if still referenced */
      });
    }
  }
}

/**
 * Delete supplier-payable recognition rows for GRNs under the given POs.
 * Call before goodsReceiptItem / goodsReceipt deletes scoped by purchaseOrderId.
 */
export async function cleanupPayablesForPurchaseOrders(
  database: DatabaseService,
  purchaseOrderIds: string[],
): Promise<void> {
  if (purchaseOrderIds.length === 0) return;

  const receipts = await database.client.goodsReceipt.findMany({
    where: { purchaseOrderId: { in: purchaseOrderIds } },
    select: { id: true },
  });
  await cleanupPayablesForGoodsReceipts(
    database,
    receipts.map((r) => r.id),
  );
}

/**
 * Test-only: remove POs created by an e2e suite, including GRNs/payables.
 * Prevents `received_po_with_remaining` pollution when GRNs are deleted but
 * PO status remains RECEIVED / PARTIALLY_RECEIVED.
 */
export async function cleanupE2ePurchaseOrders(
  database: DatabaseService,
  purchaseOrderIds: string[],
): Promise<void> {
  if (purchaseOrderIds.length === 0) return;

  await cleanupPayablesForPurchaseOrders(database, purchaseOrderIds);
  await database.client.purchaseDiscrepancy.deleteMany({
    where: { purchaseOrderId: { in: purchaseOrderIds } },
  });
  await database.client.purchaseOrderCorrection.deleteMany({
    where: { purchaseOrderId: { in: purchaseOrderIds } },
  });
  const returnIds = (
    await database.client.purchaseReturn.findMany({
      where: { purchaseOrderId: { in: purchaseOrderIds } },
      select: { id: true },
    })
  ).map((r) => r.id);
  if (returnIds.length > 0) {
    await database.client.purchaseReturnItem.deleteMany({
      where: { purchaseReturnId: { in: returnIds } },
    });
    await database.client.purchaseReturn.deleteMany({
      where: { id: { in: returnIds } },
    });
  }
  await database.client.goodsReceiptItemBatch.deleteMany({
    where: { goodsReceiptItem: { goodsReceipt: { purchaseOrderId: { in: purchaseOrderIds } } } },
  });
  await database.client.goodsReceiptScanRequest.deleteMany({
    where: { goodsReceipt: { purchaseOrderId: { in: purchaseOrderIds } } },
  });
  await database.client.goodsReceiptItem.deleteMany({
    where: { goodsReceipt: { purchaseOrderId: { in: purchaseOrderIds } } },
  });
  await database.client.goodsReceipt.deleteMany({
    where: { purchaseOrderId: { in: purchaseOrderIds } },
  });
  await database.client.purchaseOrderCost.deleteMany({
    where: { purchaseOrderId: { in: purchaseOrderIds } },
  });
  await database.client.purchaseOrderItem.deleteMany({
    where: { purchaseOrderId: { in: purchaseOrderIds } },
  });
  await database.client.purchaseOrder.deleteMany({
    where: { id: { in: purchaseOrderIds } },
  });
}
