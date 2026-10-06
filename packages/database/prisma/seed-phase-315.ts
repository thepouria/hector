import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client';
import {
  InventoryCostLayerSourceType,
  InventoryReservationSourceType,
  InventoryReservationStatus,
  InventoryValuationStatus,
  StockClassification,
} from '../src/generated/prisma/enums';

function deterministicUuid(seed: string): string {
  const hash = createHash('sha256').update(seed).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Phase 3.15 seed (idempotent).
 *
 * Strategy for existing Phase 3 inventory:
 * - Align cost-layer remaining qty to physical On Hand via SYSTEM_BOOTSTRAP UNVALUED gaps
 *   (never invent fake 0 IRR costs).
 * - Carve a FIFO demo (500k/550k) from SELLABLE ESS-MASCARA MAIN by converting bootstrap qty.
 * - ACTIVE reservation of 30 when available.
 *
 * Live putaway RECEIVE posting creates GOODS_RECEIPT valued layers via API.
 */
export async function seedReservationsFifoValuationForPishteh(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: 'pouria@hector.local' },
  });

  // Repair prior seed generations that reduced remaining without consumptions.
  await healSyntheticLayerQuantities(prisma, companyId);

  // 1) Gap backfill UNVALUED so sum(remaining) >= physical (then trim surplus bootstraps).
  const balances = await prisma.inventoryBalance.groupBy({
    by: ['warehouseId', 'skuId', 'batchId', 'classification'],
    where: { companyId, onHandQuantity: { gt: 0 } },
    _sum: { onHandQuantity: true },
  });

  for (const pos of balances) {
    const onHand = pos._sum.onHandQuantity ?? 0;
    if (onHand <= 0) continue;

    const layerSum = await prisma.inventoryCostLayer.aggregate({
      where: {
        companyId,
        warehouseId: pos.warehouseId,
        skuId: pos.skuId,
        batchId: pos.batchId,
        classification: pos.classification,
      },
      _sum: { remainingQuantity: true },
    });
    const remaining = layerSum._sum.remainingQuantity ?? 0;
    const gap = onHand - remaining;
    if (gap <= 0) continue;

    const sourceLineId = deterministicUuid(
      `bootstrap:${companyId}:${pos.warehouseId}:${pos.skuId}:${pos.batchId}:${pos.classification}`,
    );
    const existing = await prisma.inventoryCostLayer.findUnique({
      where: {
        companyId_sourceType_sourceLineId: {
          companyId,
          sourceType: InventoryCostLayerSourceType.SYSTEM_BOOTSTRAP,
          sourceLineId,
        },
      },
    });
    if (existing) {
      // Bootstrap layers are synthetic gap-fill with no consumptions: keep
      // originalQuantity === remainingQuantity (WH-FIFO / WH-INT-011).
      await prisma.inventoryCostLayer.update({
        where: { id: existing.id },
        data: {
          originalQuantity: gap,
          remainingQuantity: gap,
          valuationStatus: InventoryValuationStatus.UNVALUED,
          baseCurrencyUnitCost: null,
          originalUnitAmount: null,
        },
      });
      continue;
    }

    await prisma.inventoryCostLayer.create({
      data: {
        id: sourceLineId,
        companyId,
        warehouseId: pos.warehouseId,
        skuId: pos.skuId,
        batchId: pos.batchId,
        classification: pos.classification,
        sourceType: InventoryCostLayerSourceType.SYSTEM_BOOTSTRAP,
        sourceId: sourceLineId,
        sourceLineId,
        receivedAt: new Date('1970-01-01T00:00:00.000Z'),
        originalQuantity: gap,
        remainingQuantity: gap,
        valuationStatus: InventoryValuationStatus.UNVALUED,
      },
    });
  }

  // Trim bootstrap surplus if any position overshoots physical.
  await trimBootstrapSurplus(prisma, companyId);

  // 2) FIFO demo: convert up to 180 SELLABLE units on MAIN / ESS-MASCARA to valued layers.
  const sku = await prisma.sku.findFirst({
    where: { companyId, code: 'ESS-MASCARA-01' },
  });
  const warehouse = await prisma.warehouse.findFirst({
    where: { companyId, code: 'MAIN', isSystem: false },
  });
  if (sku && warehouse) {
    const demoL1Id = deterministicUuid(`seed-fifo-l1:${companyId}:${sku.id}`);
    const demoL2Id = deterministicUuid(`seed-fifo-l2:${companyId}:${sku.id}`);
    const existingDemo = await prisma.inventoryCostLayer.findUnique({
      where: {
        companyId_sourceType_sourceLineId: {
          companyId,
          sourceType: InventoryCostLayerSourceType.SEED,
          sourceLineId: demoL2Id,
        },
      },
    });

    if (!existingDemo) {
      // Pick a SELLABLE position with enough bootstrap to host the FIFO story.
      const bootstraps = await prisma.inventoryCostLayer.findMany({
        where: {
          companyId,
          warehouseId: warehouse.id,
          skuId: sku.id,
          classification: StockClassification.SELLABLE,
          sourceType: InventoryCostLayerSourceType.SYSTEM_BOOTSTRAP,
          remainingQuantity: { gte: 180 },
        },
        orderBy: { remainingQuantity: 'desc' },
        take: 1,
      });
      const host = bootstraps[0];
      if (host?.batchId) {
        const carved = await carveBootstrapQuantity(prisma, {
          companyId,
          warehouseId: warehouse.id,
          skuId: sku.id,
          batchId: host.batchId,
          classification: StockClassification.SELLABLE,
          quantity: 180,
        });
        if (carved >= 180) {
          // Two remaining valued layers (100 @ 500k + 80 @ 550k). No fake
          // depleted layer without InventoryLayerConsumption rows.
          await prisma.inventoryCostLayer.create({
            data: {
              id: demoL1Id,
              companyId,
              warehouseId: warehouse.id,
              skuId: sku.id,
              batchId: host.batchId,
              classification: StockClassification.SELLABLE,
              sourceType: InventoryCostLayerSourceType.SEED,
              sourceId: demoL1Id,
              sourceLineId: demoL1Id,
              receivedAt: new Date('2026-01-01T00:00:00.000Z'),
              originalQuantity: 100,
              remainingQuantity: 100,
              valuationStatus: InventoryValuationStatus.VALUED,
              originalCurrency: 'IRR',
              originalUnitAmount: new Prisma.Decimal(500_000),
              baseCurrencyUnitCost: new Prisma.Decimal(500_000),
            },
          });
          await prisma.inventoryCostLayer.create({
            data: {
              id: demoL2Id,
              companyId,
              warehouseId: warehouse.id,
              skuId: sku.id,
              batchId: host.batchId,
              classification: StockClassification.SELLABLE,
              sourceType: InventoryCostLayerSourceType.SEED,
              sourceId: demoL2Id,
              sourceLineId: demoL2Id,
              receivedAt: new Date('2026-01-02T00:00:00.000Z'),
              originalQuantity: 80,
              remainingQuantity: 80,
              valuationStatus: InventoryValuationStatus.VALUED,
              originalCurrency: 'IRR',
              originalUnitAmount: new Prisma.Decimal(550_000),
              baseCurrencyUnitCost: new Prisma.Decimal(550_000),
            },
          });
        } else if (carved > 0) {
          await restoreBootstrap(prisma, {
            companyId,
            warehouseId: warehouse.id,
            skuId: sku.id,
            batchId: host.batchId,
            classification: StockClassification.SELLABLE,
            quantity: carved,
          });
        }
      }
    } else {
      // Heal legacy demo layers after empty SEED rows were deleted by heal.
      const l1 = await prisma.inventoryCostLayer.findUnique({
        where: {
          companyId_sourceType_sourceLineId: {
            companyId,
            sourceType: InventoryCostLayerSourceType.SEED,
            sourceLineId: demoL1Id,
          },
        },
      });
      const l2 = await prisma.inventoryCostLayer.findUnique({
        where: {
          companyId_sourceType_sourceLineId: {
            companyId,
            sourceType: InventoryCostLayerSourceType.SEED,
            sourceLineId: demoL2Id,
          },
        },
      });
      if (l1 && l1.remainingQuantity > 0 && l1.originalQuantity !== l1.remainingQuantity) {
        await prisma.inventoryCostLayer.update({
          where: { id: l1.id },
          data: {
            originalQuantity: l1.remainingQuantity,
          },
        });
      }
      if (l2 && l2.remainingQuantity > 0 && l2.originalQuantity !== l2.remainingQuantity) {
        await prisma.inventoryCostLayer.update({
          where: { id: l2.id },
          data: {
            originalQuantity: l2.remainingQuantity,
          },
        });
      }
      // If heal deleted depleted L1 but L2 remains, recreate L1 only when physical
      // still has room after gap-fill (handled by bootstrap gap pass above).
      if (!l1 && l2 && l2.remainingQuantity === 180) {
        await prisma.inventoryCostLayer.update({
          where: { id: l2.id },
          data: { originalQuantity: 80, remainingQuantity: 80 },
        });
        await prisma.inventoryCostLayer.create({
          data: {
            id: demoL1Id,
            companyId,
            warehouseId: warehouse.id,
            skuId: sku.id,
            batchId: l2.batchId,
            classification: StockClassification.SELLABLE,
            sourceType: InventoryCostLayerSourceType.SEED,
            sourceId: demoL1Id,
            sourceLineId: demoL1Id,
            receivedAt: new Date('2026-01-01T00:00:00.000Z'),
            originalQuantity: 100,
            remainingQuantity: 100,
            valuationStatus: InventoryValuationStatus.VALUED,
            originalCurrency: 'IRR',
            originalUnitAmount: new Prisma.Decimal(500_000),
            baseCurrencyUnitCost: new Prisma.Decimal(500_000),
          },
        });
      }
    }

    // 3) Unvalued ADJUSTMENT_IN marker layer is already covered by bootstrap;
    // ensure at least one UNVALUED remaining exists company-wide for the seed story.
    const unvaluedCount = await prisma.inventoryCostLayer.count({
      where: {
        companyId,
        valuationStatus: InventoryValuationStatus.UNVALUED,
        remainingQuantity: { gt: 0 },
      },
    });
    if (unvaluedCount === 0) {
      // Create a tiny explicit unvalued seed layer only if physical allows via bootstrap carve 1.
      const carved1 = await carveBootstrapQuantity(prisma, {
        companyId,
        warehouseId: warehouse.id,
        skuId: sku.id,
        classification: StockClassification.SELLABLE,
        quantity: 1,
      });
      if (carved1 >= 1) {
        const unvaluedId = deterministicUuid(`seed-unvalued:${companyId}:${sku.id}`);
        await prisma.inventoryCostLayer.create({
          data: {
            id: unvaluedId,
            companyId,
            warehouseId: warehouse.id,
            skuId: sku.id,
            classification: StockClassification.SELLABLE,
            sourceType: InventoryCostLayerSourceType.ADJUSTMENT_IN,
            sourceId: unvaluedId,
            sourceLineId: unvaluedId,
            receivedAt: new Date('2026-03-01T00:00:00.000Z'),
            originalQuantity: 1,
            remainingQuantity: 1,
            valuationStatus: InventoryValuationStatus.UNVALUED,
          },
        });
      }
    }

    // 4) Reservation 30 ACTIVE.
    const requestId = 'bbbbbbbb-3150-4000-8000-000000000001';
    const sourceId = 'bbbbbbbb-3150-4000-8000-000000000002';
    const existingRes = await prisma.inventoryReservation.findUnique({
      where: { companyId_requestId: { companyId, requestId } },
    });
    if (!existingRes) {
      const onHandAgg = await prisma.inventoryBalance.aggregate({
        where: {
          companyId,
          warehouseId: warehouse.id,
          skuId: sku.id,
          classification: StockClassification.SELLABLE,
        },
        _sum: { onHandQuantity: true },
      });
      const onHand = onHandAgg._sum.onHandQuantity ?? 0;
      const reservedAgg = await prisma.inventoryReservation.aggregate({
        where: {
          companyId,
          warehouseId: warehouse.id,
          skuId: sku.id,
          status: InventoryReservationStatus.ACTIVE,
        },
        _sum: { remainingQuantity: true },
      });
      const reserved = reservedAgg._sum.remainingQuantity ?? 0;
      if (onHand - reserved >= 30) {
        await prisma.inventoryReservation.create({
          data: {
            companyId,
            warehouseId: warehouse.id,
            skuId: sku.id,
            sourceType: InventoryReservationSourceType.MANUAL_OPERATION,
            sourceId,
            sourceLineId: sourceId,
            requestId,
            quantity: 30,
            remainingQuantity: 30,
            status: InventoryReservationStatus.ACTIVE,
            createdById: owner.id,
          },
        });
      }
    }
  }

  await trimBootstrapSurplus(prisma, companyId);
}

async function healSyntheticLayerQuantities(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  // Empty synthetic layers (remaining=0, no consumptions) cannot set original=0
  // (CHECK original_positive). Delete them — they carry no truth.
  await prisma.$executeRaw`
    DELETE FROM inventory_cost_layers l
    WHERE l.company_id = ${companyId}::uuid
      AND l.source_type IN ('SYSTEM_BOOTSTRAP', 'SEED')
      AND l.remaining_quantity = 0
      AND NOT EXISTS (
        SELECT 1 FROM inventory_layer_consumptions c WHERE c.cost_layer_id = l.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM inventory_cost_layers child WHERE child.parent_layer_id = l.id
      )`;

  // Remaining synthetic layers without consumptions: keep original === remaining.
  await prisma.$executeRaw`
    UPDATE inventory_cost_layers l
    SET original_quantity = remaining_quantity
    WHERE l.company_id = ${companyId}::uuid
      AND l.source_type IN ('SYSTEM_BOOTSTRAP', 'SEED')
      AND l.remaining_quantity > 0
      AND l.original_quantity <> l.remaining_quantity
      AND NOT EXISTS (
        SELECT 1 FROM inventory_layer_consumptions c WHERE c.cost_layer_id = l.id
      )`;
}

async function carveBootstrapQuantity(
  prisma: PrismaClient,
  input: {
    companyId: string;
    warehouseId: string;
    skuId: string;
    batchId?: string | null;
    classification: StockClassification;
    quantity: number;
  },
): Promise<number> {
  let need = input.quantity;
  let carved = 0;
  const bootstraps = await prisma.inventoryCostLayer.findMany({
    where: {
      companyId: input.companyId,
      warehouseId: input.warehouseId,
      skuId: input.skuId,
      ...(input.batchId !== undefined ? { batchId: input.batchId } : {}),
      classification: input.classification,
      sourceType: InventoryCostLayerSourceType.SYSTEM_BOOTSTRAP,
      remainingQuantity: { gt: 0 },
    },
    orderBy: { id: 'asc' },
  });
  for (const b of bootstraps) {
    if (need <= 0) break;
    const take = Math.min(b.remainingQuantity, need);
    const next = b.remainingQuantity - take;
    if (next === 0) {
      await prisma.inventoryCostLayer.delete({ where: { id: b.id } });
    } else {
      // Keep original === remaining on synthetic bootstrap (no consumption rows).
      await prisma.inventoryCostLayer.update({
        where: { id: b.id },
        data: { remainingQuantity: next, originalQuantity: next },
      });
    }
    carved += take;
    need -= take;
  }
  return carved;
}

async function restoreBootstrap(
  prisma: PrismaClient,
  input: {
    companyId: string;
    warehouseId: string;
    skuId: string;
    batchId: string | null;
    classification: StockClassification;
    quantity: number;
  },
): Promise<void> {
  if (input.quantity <= 0) return;
  const sourceLineId = deterministicUuid(
    `bootstrap:${input.companyId}:${input.warehouseId}:${input.skuId}:${input.batchId}:${input.classification}`,
  );
  const existing = await prisma.inventoryCostLayer.findUnique({
    where: {
      companyId_sourceType_sourceLineId: {
        companyId: input.companyId,
        sourceType: InventoryCostLayerSourceType.SYSTEM_BOOTSTRAP,
        sourceLineId,
      },
    },
  });
  if (existing) {
    const next = existing.remainingQuantity + input.quantity;
    await prisma.inventoryCostLayer.update({
      where: { id: existing.id },
      data: {
        remainingQuantity: next,
        originalQuantity: next,
      },
    });
    return;
  }
  await prisma.inventoryCostLayer.create({
    data: {
      id: sourceLineId,
      companyId: input.companyId,
      warehouseId: input.warehouseId,
      skuId: input.skuId,
      batchId: input.batchId,
      classification: input.classification,
      sourceType: InventoryCostLayerSourceType.SYSTEM_BOOTSTRAP,
      sourceId: sourceLineId,
      sourceLineId,
      receivedAt: new Date('1970-01-01T00:00:00.000Z'),
      originalQuantity: input.quantity,
      remainingQuantity: input.quantity,
      valuationStatus: InventoryValuationStatus.UNVALUED,
    },
  });
}

async function trimBootstrapSurplus(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  const balances = await prisma.inventoryBalance.groupBy({
    by: ['warehouseId', 'skuId', 'batchId', 'classification'],
    where: { companyId },
    _sum: { onHandQuantity: true },
  });

  for (const pos of balances) {
    const onHand = pos._sum.onHandQuantity ?? 0;
    const layerSum = await prisma.inventoryCostLayer.aggregate({
      where: {
        companyId,
        warehouseId: pos.warehouseId,
        skuId: pos.skuId,
        batchId: pos.batchId,
        classification: pos.classification,
      },
      _sum: { remainingQuantity: true },
    });
    let surplus = (layerSum._sum.remainingQuantity ?? 0) - onHand;
    if (surplus <= 0) continue;

    const bootstraps = await prisma.inventoryCostLayer.findMany({
      where: {
        companyId,
        warehouseId: pos.warehouseId,
        skuId: pos.skuId,
        batchId: pos.batchId,
        classification: pos.classification,
        sourceType: InventoryCostLayerSourceType.SYSTEM_BOOTSTRAP,
        remainingQuantity: { gt: 0 },
      },
      orderBy: { id: 'asc' },
    });
    for (const b of bootstraps) {
      if (surplus <= 0) break;
      const reduce = Math.min(b.remainingQuantity, surplus);
      const next = b.remainingQuantity - reduce;
      if (next === 0) {
        await prisma.inventoryCostLayer.delete({ where: { id: b.id } });
      } else {
        await prisma.inventoryCostLayer.update({
          where: { id: b.id },
          data: { remainingQuantity: next, originalQuantity: next },
        });
      }
      surplus -= reduce;
    }
  }
}
