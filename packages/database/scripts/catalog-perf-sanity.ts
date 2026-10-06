/**
 * Temporary Catalog performance sanity fixture (Phase 1.12).
 * Creates bounded rows under Pishteh, times list/search/resolve, then deletes the batch.
 *
 * Usage:
 *   pnpm --filter @hector/database exec tsx scripts/catalog-perf-sanity.ts
 *
 * Not a production benchmark. Does not enlarge the normal seed.
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { CatalogLifecycleStatus } from '../src/generated/prisma/enums';

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

const PRODUCT_COUNT = Number(process.env.CATALOG_PERF_PRODUCTS ?? 500);
const BATCH = 50;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const runId = `perf${Date.now().toString(36)}`;

  try {
    const company = await prisma.company.findUniqueOrThrow({ where: { slug: 'pishteh' } });
    const brand = await prisma.brand.findFirstOrThrow({
      where: { companyId: company.id, code: 'FAN' },
    });

    console.log(`Creating ${PRODUCT_COUNT} products (+SKU+barcode) run=${runId}…`);
    const tCreate0 = performance.now();
    const productIds: string[] = [];
    const skuIds: string[] = [];
    let barcodeValue = '';

    for (let i = 0; i < PRODUCT_COUNT; i += BATCH) {
      const slice = Array.from({ length: Math.min(BATCH, PRODUCT_COUNT - i) }, (_, j) => {
        const n = i + j;
        const code = `${runId}-P${String(n).padStart(4, '0')}`;
        return { n, code };
      });

      await prisma.$transaction(async (tx) => {
        for (const row of slice) {
          const product = await tx.product.create({
            data: {
              companyId: company.id,
              name: `Perf Product ${row.n}`,
              normalizedName: `perf product ${row.n}`,
              code: row.code,
              normalizedCode: row.code.toLowerCase(),
              brandId: brand.id,
              status: CatalogLifecycleStatus.ACTIVE,
            },
          });
          productIds.push(product.id);
          const skuCode = `${runId}-S${String(row.n).padStart(4, '0')}`;
          const sku = await tx.sku.create({
            data: {
              companyId: company.id,
              productId: product.id,
              code: skuCode,
              normalizedCode: skuCode,
              variantSignature: 'SIMPLE',
              status: CatalogLifecycleStatus.ACTIVE,
            },
          });
          skuIds.push(sku.id);
          const bc = `${runId}-BC-${String(row.n).padStart(4, '0')}`;
          if (row.n === 0) barcodeValue = bc;
          await tx.barcode.create({
            data: {
              companyId: company.id,
              skuId: sku.id,
              value: bc,
              normalizedValue: bc,
              type: 'OTHER',
              isPrimary: true,
            },
          });
        }
      });
    }
    const tCreate1 = performance.now();
    console.log(`create_ms=${(tCreate1 - tCreate0).toFixed(1)}`);

    const tList0 = performance.now();
    await prisma.product.findMany({
      where: { companyId: company.id, code: { startsWith: runId } },
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: { brand: { select: { id: true, name: true } } },
    });
    const tList1 = performance.now();
    console.log(`product_list_50_ms=${(tList1 - tList0).toFixed(1)}`);

    const tSearch0 = performance.now();
    await prisma.product.findMany({
      where: {
        companyId: company.id,
        OR: [
          { name: { contains: 'Perf Product 1', mode: 'insensitive' } },
          { normalizedName: { contains: 'perf product 1' } },
        ],
      },
      take: 50,
    });
    const tSearch1 = performance.now();
    console.log(`product_search_ms=${(tSearch1 - tSearch0).toFixed(1)}`);

    const tBc0 = performance.now();
    const hit = await prisma.barcode.findFirst({
      where: { companyId: company.id, normalizedValue: barcodeValue, archivedAt: null },
      include: { sku: { include: { product: true } } },
    });
    const tBc1 = performance.now();
    console.log(`barcode_exact_ms=${(tBc1 - tBc0).toFixed(1)} hit=${Boolean(hit)}`);

    const explain = await prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
      `EXPLAIN ANALYZE SELECT id FROM barcodes WHERE company_id = $1::uuid AND normalized_value = $2 AND archived_at IS NULL LIMIT 1`,
      company.id,
      barcodeValue,
    );
    console.log('barcode_explain:');
    for (const row of explain) {
      console.log(`  ${row['QUERY PLAN']}`);
    }

    console.log('Cleaning temporary perf rows…');
    await prisma.barcode.deleteMany({ where: { companyId: company.id, value: { startsWith: `${runId}-` } } });
    await prisma.sku.deleteMany({ where: { companyId: company.id, code: { startsWith: `${runId}-` } } });
    await prisma.product.deleteMany({ where: { companyId: company.id, code: { startsWith: `${runId}-` } } });
    console.log('done');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

void main();
