/**
 * Local performance sanity for Phase 3.8 Putaway (bounded synthetic dataset).
 * Not a CI gate — reports timings only.
 *
 * Usage:
 *   pnpm --filter @hector/database exec tsx scripts/putaway-perf-sanity.ts
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../src/generated/prisma/client';

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

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  console.log(`${label}: ${ms.toFixed(1)}ms`);
  return result;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const company = await prisma.company.findUnique({ where: { slug: 'pishteh' } });
    if (!company) {
      console.error('pishteh company missing — seed first');
      process.exit(1);
    }

    await timed('pending putaway query (page 1)', async () => {
      await prisma.$queryRaw`
        SELECT a.id
        FROM goods_receipt_item_batches a
        JOIN goods_receipt_items i ON i.id = a.goods_receipt_item_id
        JOIN goods_receipts g ON g.id = i.goods_receipt_id
        LEFT JOIN (
          SELECT pi.goods_receipt_item_batch_id AS allocation_id, SUM(pi.quantity)::int AS qty
          FROM putaway_items pi
          JOIN putaways p ON p.id = pi.putaway_id
          WHERE p.status = 'COMPLETED'
          GROUP BY pi.goods_receipt_item_batch_id
        ) c ON c.allocation_id = a.id
        WHERE a.company_id = ${company.id}::uuid
          AND g.status = 'POSTED'
          AND (a.quantity - COALESCE(c.qty, 0)) > 0
        ORDER BY g.posted_at DESC NULLS LAST
        LIMIT 50`;
    });

    await timed('location barcode exact resolve', async () => {
      await prisma.warehouseLocation.findFirst({
        where: { companyId: company.id, barcode: 'LOC-A-03' },
      });
    });

    await timed('putaway detail with items', async () => {
      await prisma.putaway.findFirst({
        where: { companyId: company.id, number: 'PUT-000001' },
        include: {
          items: true,
          warehouse: true,
          goodsReceipt: true,
        },
      });
    });

    const counts = await timed('row counts', async () => ({
      allocations: await prisma.goodsReceiptItemBatch.count({
        where: { companyId: company.id },
      }),
      locations: await prisma.warehouseLocation.count({ where: { companyId: company.id } }),
      putawayItems: await prisma.putawayItem.count({ where: { companyId: company.id } }),
    }));
    console.log('counts', counts);
    console.log('Putaway perf sanity: OK (local timings only; not a CI gate)');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
