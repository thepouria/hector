import { rebuildInventoryBalances, type Prisma } from '@hector/database';
import type { DatabaseService } from '../../src/infrastructure/database/database.service';

type Tx = Prisma.TransactionClient;

/**
 * E2E-only: remove inventory movements while reversing FIFO side-effects.
 *
 * Production never deletes posted movements. Prior cleanup deleted consumptions
 * without restoring `remainingQuantity` and left destination TRANSFER_IN /
 * RECLASSIFY_IN / SEED layers behind — that polluted shared-DB integrity
 * (LAYER_EQ, QTY_RECON) after otherwise-green suites.
 *
 * Reverse order:
 * 1. Provenance destination layers (createdAt DESC on consumptions)
 * 2. Restore source-layer remaining for each consumption
 * 3. Delete consumptions
 * 4. Delete inbound layers keyed by movement sourceLineId / bootstrap sourceId
 * 5. Delete movements
 */
export async function deleteInventoryMovements(
  database: DatabaseService,
  where: Prisma.InventoryMovementWhereInput,
): Promise<void> {
  const movements = await database.client.inventoryMovement.findMany({
    where,
    select: {
      id: true,
      companyId: true,
      sourceId: true,
      sourceLineId: true,
      movementType: true,
      quantityDelta: true,
      warehouseId: true,
      locationId: true,
      skuId: true,
      batchId: true,
      classification: true,
    },
  });
  if (movements.length === 0) return;

  const ids = movements.map((m) => m.id);

  // Sort outbound before inbound so intermediate ledger sums stay non-negative
  // when callers delete in multiple passes (issue → reclass → seed receive).
  const outboundTypes = new Set([
    'ISSUE',
    'TRANSFER_OUT',
    'RECLASSIFY_OUT',
    'ADJUSTMENT_OUT',
    'STOCK_COUNT_ADJUSTMENT_OUT',
    'RETURN_OUT',
  ]);
  const ordered = [...movements].sort((a, b) => {
    const aOut = outboundTypes.has(a.movementType) ? 0 : 1;
    const bOut = outboundTypes.has(b.movementType) ? 0 : 1;
    return aOut - bOut;
  });
  const orderedIds = ordered.map((m) => m.id);

  await database.client.$transaction(async (tx) => {
    await reverseFifoForMovements(tx, orderedIds);

    // Inbound layers created for RECEIVE/SEED/ADJUSTMENT_IN etc. (sourceLineId match).
    const sourceLineIds = [...new Set(movements.map((m) => m.sourceLineId))];
    const inboundLayers = await tx.inventoryCostLayer.findMany({
      where: {
        OR: [
          { sourceLineId: { in: sourceLineIds } },
          { sourceType: 'SYSTEM_BOOTSTRAP', sourceId: { in: ids } },
          { sourceType: 'SEED', sourceId: { in: movements.map((m) => m.sourceId) } },
        ],
      },
      select: { id: true },
    });
    for (const layer of inboundLayers) {
      await deleteLayerIfUnused(tx, layer.id);
    }

    await tx.inventoryMovement.deleteMany({ where: { id: { in: ids } } });
  });

  // Do NOT sync balances here: callers often delete outbound docs first, then seed
  // receives. Mid-pass sync can see temporary negative ledgers and fail CHECK.
  // Call `rebuildInventoryBalances` / `syncBalanceFromLedger` after all deletes.
}

async function reverseFifoForMovements(tx: Tx, movementIds: string[]): Promise<void> {
  const consumptions = await tx.inventoryLayerConsumption.findMany({
    where: { inventoryMovementId: { in: movementIds } },
    orderBy: { createdAt: 'desc' },
  });

  for (const c of consumptions) {
    if (c.destinationLayerId) {
      await deleteLayerTree(tx, c.destinationLayerId);
    }

    const layer = await tx.inventoryCostLayer.findUnique({
      where: { id: c.costLayerId },
      select: { id: true, remainingQuantity: true, originalQuantity: true },
    });
    if (layer) {
      const nextRemaining = layer.remainingQuantity + c.quantity;
      await tx.inventoryCostLayer.update({
        where: { id: layer.id },
        data: {
          remainingQuantity: Math.min(nextRemaining, layer.originalQuantity),
        },
      });
    }

    await tx.inventoryLayerConsumption.delete({ where: { id: c.id } });
  }
}

/**
 * Delete a destination/provenance layer. If later outbound moved stock onward,
 * recurse into those destination layers first (depth-first via consumptions).
 */
async function deleteLayerTree(tx: Tx, layerId: string): Promise<void> {
  const outbound = await tx.inventoryLayerConsumption.findMany({
    where: { costLayerId: layerId },
    orderBy: { createdAt: 'desc' },
  });
  for (const c of outbound) {
    if (c.destinationLayerId) {
      await deleteLayerTree(tx, c.destinationLayerId);
    }
    // Outbound from a layer we are deleting belongs to movements we are also
    // deleting (e2e cleanup); drop consumption without restoring this layer
    // (layer will be deleted). Parent restore happens on the parent consumption.
    await tx.inventoryLayerConsumption.delete({ where: { id: c.id } });
  }

  await deleteLayerIfUnused(tx, layerId);
}

async function deleteLayerIfUnused(tx: Tx, layerId: string): Promise<void> {
  const remainingConsumptions = await tx.inventoryLayerConsumption.count({
    where: { costLayerId: layerId },
  });
  if (remainingConsumptions > 0) return;

  const children = await tx.inventoryCostLayer.count({
    where: { parentLayerId: layerId },
  });
  if (children > 0) return;

  await tx.inventoryCostComponent.deleteMany({ where: { layerId } });
  await tx.inventoryCostLayer.deleteMany({ where: { id: layerId } });
}

/**
 * After e2e suites delete movements (test-only), rebuild On Hand projections for the
 * company so SYS-TRANSIT / forgotten positions cannot leave balance≠ledger drift.
 * Never used as a production silent-repair path.
 */
export async function finalizeInventoryE2eCleanup(
  database: DatabaseService,
  companyId: string,
): Promise<void> {
  await rebuildInventoryBalances(database.client, { companyId });
}

/**
 * Project balance from remaining ledger for a position.
 * Zero-balance policy: keep qty=0 rows when movement history exists; delete only true orphans.
 */
export async function syncBalanceFromLedger(
  database: DatabaseService,
  position: {
    companyId: string;
    warehouseId: string;
    locationId: string;
    skuId: string;
    batchId: string;
    classification: string;
  },
): Promise<void> {
  const [sum, movementCount] = await Promise.all([
    database.client.inventoryMovement.aggregate({
      where: position,
      _sum: { quantityDelta: true },
    }),
    database.client.inventoryMovement.count({ where: position }),
  ]);
  const qty = sum._sum.quantityDelta ?? 0;
  const whereKey = position;

  if (movementCount === 0) {
    await database.client.inventoryBalance.deleteMany({ where: whereKey });
    return;
  }

  await database.client.inventoryBalance.upsert({
    where: {
      companyId_warehouseId_locationId_skuId_batchId_classification: {
        companyId: whereKey.companyId,
        warehouseId: whereKey.warehouseId,
        locationId: whereKey.locationId,
        skuId: whereKey.skuId,
        batchId: whereKey.batchId,
        classification: whereKey.classification as never,
      },
    },
    update: { onHandQuantity: qty },
    create: {
      companyId: whereKey.companyId,
      warehouseId: whereKey.warehouseId,
      locationId: whereKey.locationId,
      skuId: whereKey.skuId,
      batchId: whereKey.batchId,
      classification: whereKey.classification as never,
      onHandQuantity: qty,
    },
  });
}
