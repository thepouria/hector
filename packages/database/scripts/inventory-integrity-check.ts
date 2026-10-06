/**
 * Read-only Inventory Balance ↔ Ledger reconciliation (Phase 3.10).
 *
 * Usage from repo root:
 *   pnpm db:check:inventory
 *
 * Exit 0 = all MATCH (and no negatives); 1 = discrepancies.
 * Never mutates data. Ledger is canonical; Balance is projection.
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { reconcileInventory } from '../src/inventory-reconciliation';

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

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const companyArg = process.argv.find((a) => a.startsWith('--company='));
  const companyId = companyArg ? companyArg.slice('--company='.length) : undefined;

  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const summary = await reconcileInventory(prisma, { companyId, sampleLimit: 30 });

    console.log('Inventory reconciliation summary:');
    console.log(
      JSON.stringify(
        {
          companyId: summary.companyId,
          positionsChecked: summary.positionsChecked,
          matched: summary.matched,
          mismatched: summary.mismatched,
          missingBalances: summary.missingBalances,
          orphanBalances: summary.orphanBalances,
          negativePositions: summary.negativePositions,
        },
        null,
        2,
      ),
    );

    if (summary.samples.length > 0) {
      console.error('Sample discrepancies:');
      for (const s of summary.samples) {
        console.error(
          `- ${s.status} warehouse=${s.warehouseId} location=${s.locationId} sku=${s.skuId} batch=${s.batchId} ledger=${s.ledgerQuantity} balance=${s.balanceQuantity} diff=${s.difference}`,
        );
      }
    }

    const failed =
      summary.mismatched > 0 ||
      summary.missingBalances > 0 ||
      summary.orphanBalances > 0 ||
      summary.negativePositions > 0;

    if (failed) {
      console.error('Inventory integrity check: FAILED');
      process.exit(1);
    }

    console.log('Inventory integrity check: OK');
    process.exit(0);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
