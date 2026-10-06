/**
 * Administrative InventoryBalance rebuild from InventoryMovement ledger (Phase 3.10).
 *
 * Usage from repo root:
 *   pnpm db:rebuild:inventory-balances
 *   pnpm db:rebuild:inventory-balances -- --dry-run
 *   pnpm db:rebuild:inventory-balances -- --company=<uuid>
 *
 * Never modifies InventoryMovement. Ledger wins; Balance adapts.
 * Not a business API — CLI / ops only.
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  rebuildInventoryBalances,
  reconcileInventory,
} from '../src/inventory-reconciliation';

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

  const dryRun = process.argv.includes('--dry-run');
  const companyArg = process.argv.find((a) => a.startsWith('--company='));
  const companyId = companyArg ? companyArg.slice('--company='.length) : undefined;

  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    console.log(
      `Inventory balance rebuild ${dryRun ? '(dry-run)' : '(mutate)'} company=${companyId ?? 'ALL'}`,
    );

    const before = await reconcileInventory(prisma, { companyId, sampleLimit: 10 });
    console.log('Before:', {
      positionsChecked: before.positionsChecked,
      matched: before.matched,
      mismatched: before.mismatched,
      missingBalances: before.missingBalances,
      orphanBalances: before.orphanBalances,
    });

    const report = await rebuildInventoryBalances(prisma, {
      companyId,
      dryRun,
      planLimit: 100,
    });

    console.log('Rebuild plan summary:', {
      dryRun: report.dryRun,
      positionsFromLedger: report.positionsFromLedger,
      creates: report.creates,
      updates: report.updates,
      deletes: report.deletes,
      unchanged: report.unchanged,
    });

    if (report.plan.length > 0) {
      console.log('Plan sample (up to 100):');
      for (const row of report.plan.slice(0, 20)) {
        console.log(
          `- ${row.action} expected=${row.expectedOnHand} current=${row.currentOnHand} sku=${row.skuId} loc=${row.locationId}`,
        );
      }
    }

    if (!dryRun) {
      const after = await reconcileInventory(prisma, { companyId, sampleLimit: 10 });
      console.log('After:', {
        positionsChecked: after.positionsChecked,
        matched: after.matched,
        mismatched: after.mismatched,
        missingBalances: after.missingBalances,
        orphanBalances: after.orphanBalances,
      });
      const failed =
        after.mismatched > 0 ||
        after.missingBalances > 0 ||
        after.orphanBalances > 0 ||
        after.negativePositions > 0;
      if (failed) {
        console.error('Rebuild finished but reconciliation still FAILED');
        process.exit(1);
      }
      console.log('Rebuild completed; reconciliation OK. Ledger was not modified.');
    } else {
      console.log('Dry-run complete — no mutations applied.');
    }

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
