/**
 * Reservations + FIFO + Valuation integrity (Phase 3.15).
 *
 * Usage: pnpm db:check:valuation
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  InventoryReservationStatus,
  InventoryValuationStatus,
  StockClassification,
} from '../src/generated/prisma/enums';

function loadRootEnv(): void {
  for (const path of [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(__dirname, '../../../.env'),
  ]) {
    if (existsSync(path)) {
      config({ path, quiet: true });
      return;
    }
  }
}

loadRootEnv();

type Finding = { code: string; message: string };

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const findings: Finding[] = [];

  try {
    const badResQty = await prisma.inventoryReservation.count({
      where: {
        OR: [{ quantity: { lte: 0 } }, { remainingQuantity: { lt: 0 } }],
      },
    });
    if (badResQty > 0) {
      findings.push({
        code: 'RES_QTY',
        message: `${badResQty} reservation(s) with non-positive quantity / negative remaining`,
      });
    }

    const terminalCounted = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*)::bigint AS c
      FROM inventory_reservations
      WHERE status <> 'ACTIVE' AND remaining_quantity > 0
    `;
    if (Number(terminalCounted[0]?.c ?? 0) > 0) {
      findings.push({
        code: 'RES_TERMINAL',
        message: 'Terminal reservations still have remaining_quantity > 0',
      });
    }

    const availRows = await prisma.$queryRaw<
      Array<{
        company_id: string;
        warehouse_id: string;
        sku_id: string;
        on_hand: bigint;
        reserved: bigint;
      }>
    >`
      SELECT
        b.company_id,
        b.warehouse_id,
        b.sku_id,
        COALESCE(SUM(b.on_hand_quantity), 0)::bigint AS on_hand,
        COALESCE((
          SELECT SUM(r.remaining_quantity)
          FROM inventory_reservations r
          WHERE r.company_id = b.company_id
            AND r.warehouse_id = b.warehouse_id
            AND r.sku_id = b.sku_id
            AND r.status = 'ACTIVE'
        ), 0)::bigint AS reserved
      FROM inventory_balances b
      WHERE b.classification = 'SELLABLE'
      GROUP BY b.company_id, b.warehouse_id, b.sku_id
    `;
    for (const row of availRows) {
      const onHand = Number(row.on_hand);
      const reserved = Number(row.reserved);
      if (reserved > onHand) {
        findings.push({
          code: 'RES_OVER',
          message: `Reserved ${reserved} > SELLABLE onHand ${onHand} wh=${row.warehouse_id} sku=${row.sku_id}`,
        });
      }
      if (onHand - reserved < 0) {
        findings.push({
          code: 'AVAIL_NEG',
          message: `Negative available wh=${row.warehouse_id} sku=${row.sku_id}`,
        });
      }
    }

    const badLayers = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*)::bigint AS c FROM inventory_cost_layers
      WHERE original_quantity <= 0
         OR remaining_quantity < 0
         OR remaining_quantity > original_quantity
         OR (valuation_status = 'UNVALUED' AND base_currency_unit_cost IS NOT NULL)
         OR (valuation_status <> 'UNVALUED' AND base_currency_unit_cost IS NULL)
         OR (valuation_status <> 'UNVALUED' AND base_currency_unit_cost = 0
             AND original_unit_amount IS NULL)
    `;
    if (Number(badLayers[0]?.c ?? 0) > 0) {
      findings.push({
        code: 'LAYER_BOUNDS',
        message: `${badLayers[0]?.c} cost layer(s) violate quantity/valuation invariants`,
      });
    }

    // Fake zero: VALUED with unit cost 0 and no original amount is suspicious — already partly covered.
    const fakeZero = await prisma.inventoryCostLayer.count({
      where: {
        valuationStatus: { not: InventoryValuationStatus.UNVALUED },
        baseCurrencyUnitCost: 0,
        remainingQuantity: { gt: 0 },
      },
    });
    if (fakeZero > 0) {
      findings.push({
        code: 'FAKE_ZERO',
        message: `${fakeZero} valued layer(s) with base cost 0 (possible fake zero)`,
      });
    }

    const qtyMismatch = await prisma.$queryRaw<
      Array<{
        company_id: string;
        warehouse_id: string;
        sku_id: string;
        batch_id: string;
        classification: string;
        on_hand: bigint;
        layer_remaining: bigint;
      }>
    >`
      SELECT
        b.company_id,
        b.warehouse_id,
        b.sku_id,
        b.batch_id,
        b.classification::text,
        SUM(b.on_hand_quantity)::bigint AS on_hand,
        COALESCE((
          SELECT SUM(l.remaining_quantity)
          FROM inventory_cost_layers l
          WHERE l.company_id = b.company_id
            AND l.warehouse_id = b.warehouse_id
            AND l.sku_id = b.sku_id
            AND l.batch_id = b.batch_id
            AND l.classification = b.classification
        ), 0)::bigint AS layer_remaining
      FROM inventory_balances b
      GROUP BY b.company_id, b.warehouse_id, b.sku_id, b.batch_id, b.classification
      HAVING SUM(b.on_hand_quantity) <> COALESCE((
          SELECT SUM(l.remaining_quantity)
          FROM inventory_cost_layers l
          WHERE l.company_id = b.company_id
            AND l.warehouse_id = b.warehouse_id
            AND l.sku_id = b.sku_id
            AND l.batch_id = b.batch_id
            AND l.classification = b.classification
        ), 0)
      LIMIT 50
    `;
    for (const row of qtyMismatch) {
      findings.push({
        code: 'QTY_RECON',
        message: `Physical ${row.on_hand} ≠ layer remaining ${row.layer_remaining} wh=${row.warehouse_id} sku=${row.sku_id} batch=${row.batch_id} class=${row.classification}`,
      });
    }

    const badCons = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*)::bigint AS c FROM inventory_layer_consumptions
      WHERE quantity <= 0
         OR (valuation_status = 'UNVALUED' AND (unit_cost IS NOT NULL OR total_cost IS NOT NULL))
         OR (valuation_status <> 'UNVALUED' AND (unit_cost IS NULL OR total_cost IS NULL))
    `;
    if (Number(badCons[0]?.c ?? 0) > 0) {
      findings.push({
        code: 'CONS',
        message: `${badCons[0]?.c} layer consumption row(s) invalid`,
      });
    }

    // WH-INT-011: remaining + SUM(consumptions) = original (transfer/reclassify write consumptions).
    const layerEq = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*)::bigint AS c
      FROM inventory_cost_layers l
      WHERE l.remaining_quantity + COALESCE((
        SELECT SUM(c.quantity) FROM inventory_layer_consumptions c WHERE c.cost_layer_id = l.id
      ), 0) <> l.original_quantity
    `;
    if (Number(layerEq[0]?.c ?? 0) > 0) {
      findings.push({
        code: 'LAYER_EQ',
        message: `${layerEq[0]?.c} layer(s) where remaining+consumed ≠ original`,
      });
    }

    console.log(
      JSON.stringify(
        {
          findings: findings.length,
          reservationStatusActive: InventoryReservationStatus.ACTIVE,
          sellable: StockClassification.SELLABLE,
        },
        null,
        2,
      ),
    );

    if (findings.length > 0) {
      console.error('Valuation / reservation / FIFO integrity failures:');
      for (const f of findings.slice(0, 40)) {
        console.error(`- [${f.code}] ${f.message}`);
      }
      process.exit(1);
    }

    console.log('Valuation integrity check PASSED.');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
