import {
  InventoryCostLayerSourceType,
  InventoryReservationSourceType,
  InventoryReservationStatus,
  InventoryValuationStatus,
  StockClassification,
  reconcileInventory,
  reconcilePosition,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp } from './helpers/e2e-app';

/**
 * Phase 3.18 — controlled corruption must FAIL read-only reconciliation.
 * Never auto-repairs; each case restores the fixture before exit.
 */
describe('Inventory reconciliation corruption detection (Phase 3.18)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let pishtehId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    await syncPermissions(database.client);
    await syncOwnerRolePermissions(database.client);
    pishtehId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'pishteh' } })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('detects StockBalance drift vs Movement ledger (WH-INT-002 / WH-INT-030)', async () => {
    const candidates = await database.client.inventoryBalance.findMany({
      where: { companyId: pishtehId, onHandQuantity: { gt: 0 } },
      orderBy: { onHandQuantity: 'desc' },
      take: 30,
    });
    expect(candidates.length).toBeGreaterThan(0);

    let balance = candidates[0]!;
    let baseline = await reconcilePosition(database.client, {
      companyId: pishtehId,
      warehouseId: balance.warehouseId,
      locationId: balance.locationId,
      skuId: balance.skuId,
      batchId: balance.batchId,
      classification: balance.classification,
    });
    for (const candidate of candidates) {
      const result = await reconcilePosition(database.client, {
        companyId: pishtehId,
        warehouseId: candidate.warehouseId,
        locationId: candidate.locationId,
        skuId: candidate.skuId,
        batchId: candidate.batchId,
        classification: candidate.classification,
      });
      if (result.status === 'MATCH') {
        balance = candidate;
        baseline = result;
        break;
      }
    }
    expect(baseline.status).toBe('MATCH');

    const position = {
      companyId: pishtehId,
      warehouseId: balance.warehouseId,
      locationId: balance.locationId,
      skuId: balance.skuId,
      batchId: balance.batchId,
      classification: balance.classification,
    };
    const before = balance.onHandQuantity;

    await database.client.inventoryBalance.update({
      where: { id: balance.id },
      data: { onHandQuantity: before - 1 },
    });

    try {
      const drifted = await reconcilePosition(database.client, position);
      expect(drifted.status).toBe('MISMATCH');
      expect(drifted.ledgerQuantity).toBe(before);
      expect(drifted.balanceQuantity).toBe(before - 1);
      expect(drifted.difference).toBe(-1);

      const summary = await reconcileInventory(database.client, {
        companyId: pishtehId,
        sampleLimit: 50,
      });
      expect(summary.mismatched).toBeGreaterThan(0);
    } finally {
      await database.client.inventoryBalance.update({
        where: { id: balance.id },
        data: { onHandQuantity: before },
      });
    }

    const restored = await reconcilePosition(database.client, position);
    expect(restored.status).toBe('MATCH');
  });

  it('detects FIFO remaining ≠ original − consumptions (WH-INT-011)', async () => {
    const layer = await database.client.inventoryCostLayer.findFirst({
      where: {
        companyId: pishtehId,
        remainingQuantity: { gt: 1 },
        originalQuantity: { gt: 1 },
      },
      orderBy: { remainingQuantity: 'desc' },
    });
    expect(layer).toBeTruthy();
    if (!layer) return;

    const beforeRemaining = layer.remainingQuantity;
    const beforeOriginal = layer.originalQuantity;
    // Corrupt within DB bounds: drop remaining without a consumption row
    // (remaining + consumed ≠ original). Spec alternate: remaining too high
    // is blocked by CHECK remaining_lte_original — document that path as
    // "Prevented by database constraint" when remaining would exceed original.
    await database.client.inventoryCostLayer.update({
      where: { id: layer.id },
      data: { remainingQuantity: beforeRemaining - 1 },
    });

    try {
      const rows = await database.client.$queryRaw<
        Array<{ id: string; original: number; remaining: number; consumed: number }>
      >`
        SELECT l.id::text AS id, l.original_quantity AS original, l.remaining_quantity AS remaining,
               COALESCE((SELECT SUM(c.quantity)::int FROM inventory_layer_consumptions c WHERE c.cost_layer_id = l.id), 0) AS consumed
        FROM inventory_cost_layers l
        WHERE l.id = ${layer.id}::uuid
          AND l.remaining_quantity + COALESCE((
            SELECT SUM(c.quantity) FROM inventory_layer_consumptions c WHERE c.cost_layer_id = l.id
          ), 0) <> l.original_quantity`;
      expect(rows.length).toBe(1);
      expect(rows[0]!.remaining).toBe(beforeRemaining - 1);
      expect(rows[0]!.original - rows[0]!.consumed).toBe(beforeOriginal);
    } finally {
      await database.client.inventoryCostLayer.update({
        where: { id: layer.id },
        data: { remainingQuantity: beforeRemaining },
      });
    }
  });

  it('detects over-reservation vs SELLABLE on hand (WH-INT-008)', async () => {
    const sellable = await database.client.inventoryBalance.groupBy({
      by: ['warehouseId', 'skuId'],
      where: {
        companyId: pishtehId,
        classification: StockClassification.SELLABLE,
        onHandQuantity: { gt: 0 },
      },
      _sum: { onHandQuantity: true },
      orderBy: { _sum: { onHandQuantity: 'desc' } },
      take: 1,
    });
    expect(sellable.length).toBe(1);
    const pos = sellable[0]!;
    const onHand = pos._sum.onHandQuantity ?? 0;
    const owner = await database.client.user.findUniqueOrThrow({
      where: { email: 'pouria@hector.local' },
    });
    const requestId = randomUUID();
    const sourceId = randomUUID();

    const created = await database.client.inventoryReservation.create({
      data: {
        companyId: pishtehId,
        warehouseId: pos.warehouseId,
        skuId: pos.skuId,
        sourceType: InventoryReservationSourceType.MANUAL_OPERATION,
        sourceId,
        sourceLineId: sourceId,
        requestId,
        quantity: onHand + 50,
        remainingQuantity: onHand + 50,
        status: InventoryReservationStatus.ACTIVE,
        createdById: owner.id,
      },
    });

    try {
      const over = await database.client.$queryRaw<
        Array<{ warehouse_id: string; sku_id: string; on_hand: bigint; reserved: bigint }>
      >`
        SELECT b.warehouse_id, b.sku_id,
               COALESCE(SUM(b.on_hand_quantity), 0)::bigint AS on_hand,
               COALESCE((
                 SELECT SUM(r.remaining_quantity) FROM inventory_reservations r
                 WHERE r.company_id = b.company_id AND r.warehouse_id = b.warehouse_id
                   AND r.sku_id = b.sku_id AND r.status = 'ACTIVE'
               ), 0)::bigint AS reserved
        FROM inventory_balances b
        WHERE b.classification = 'SELLABLE'
          AND b.company_id = ${pishtehId}::uuid
          AND b.warehouse_id = ${pos.warehouseId}::uuid
          AND b.sku_id = ${pos.skuId}::uuid
        GROUP BY b.company_id, b.warehouse_id, b.sku_id
        HAVING COALESCE((
                 SELECT SUM(r.remaining_quantity) FROM inventory_reservations r
                 WHERE r.company_id = b.company_id AND r.warehouse_id = b.warehouse_id
                   AND r.sku_id = b.sku_id AND r.status = 'ACTIVE'
               ), 0) > COALESCE(SUM(b.on_hand_quantity), 0)`;
      expect(over.length).toBe(1);
      expect(Number(over[0]!.reserved)).toBeGreaterThan(Number(over[0]!.on_hand));
    } finally {
      await database.client.inventoryReservation.delete({ where: { id: created.id } });
    }
  });

  it('does not invent valued zero-cost layers when healing is absent (WH-INT-014 marker)', async () => {
    const fakeZero = await database.client.inventoryCostLayer.count({
      where: {
        companyId: pishtehId,
        valuationStatus: { not: InventoryValuationStatus.UNVALUED },
        baseCurrencyUnitCost: 0,
        remainingQuantity: { gt: 0 },
      },
    });
    expect(fakeZero).toBe(0);

    // Ensure seed/bootstrap source types exist without costing as VALUED zero.
    const bootstrapValuedZero = await database.client.inventoryCostLayer.count({
      where: {
        companyId: pishtehId,
        sourceType: InventoryCostLayerSourceType.SYSTEM_BOOTSTRAP,
        valuationStatus: InventoryValuationStatus.VALUED,
        baseCurrencyUnitCost: 0,
      },
    });
    expect(bootstrapValuedZero).toBe(0);
  });
});
