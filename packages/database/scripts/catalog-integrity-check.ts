/**
 * Read-only Catalog integrity checks (Phase 1.12 QA).
 *
 * Usage from repo root:
 *   pnpm --filter @hector/database exec tsx scripts/catalog-integrity-check.ts
 *
 * Exit 0 = clean; 1 = violations. Never mutates data.
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
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

type Violation = { check: string; count: number; sample?: unknown };

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const violations: Violation[] = [];

  try {
    const checks: Array<{ name: string; sql: Promise<unknown[]> }> = [
      {
        name: 'sku_without_valid_product',
        sql: prisma.$queryRaw`
          SELECT s.id FROM skus s
          LEFT JOIN products p ON p.id = s.product_id AND p.company_id = s.company_id
          WHERE p.id IS NULL LIMIT 20`,
      },
      {
        name: 'barcode_without_valid_sku',
        sql: prisma.$queryRaw`
          SELECT b.id FROM barcodes b
          LEFT JOIN skus s ON s.id = b.sku_id AND s.company_id = b.company_id
          WHERE s.id IS NULL LIMIT 20`,
      },
      {
        name: 'multiple_active_primary_barcodes',
        sql: prisma.$queryRaw`
          SELECT sku_id, COUNT(*)::bigint AS n FROM barcodes
          WHERE is_primary = true AND archived_at IS NULL
          GROUP BY sku_id HAVING COUNT(*) > 1 LIMIT 20`,
      },
      {
        name: 'product_brand_cross_company',
        sql: prisma.$queryRaw`
          SELECT p.id FROM products p
          JOIN brands b ON b.id = p.brand_id
          WHERE p.brand_id IS NOT NULL AND b.company_id <> p.company_id LIMIT 20`,
      },
      {
        name: 'product_category_cross_company',
        sql: prisma.$queryRaw`
          SELECT p.id FROM products p
          JOIN categories c ON c.id = p.category_id
          WHERE p.category_id IS NOT NULL AND c.company_id <> p.company_id LIMIT 20`,
      },
      {
        name: 'category_self_parent',
        sql: prisma.$queryRaw`SELECT id FROM categories WHERE parent_id = id LIMIT 20`,
      },
      {
        name: 'product_attribute_option_mismatch',
        sql: prisma.$queryRaw`
          SELECT pas.id FROM product_attribute_selections pas
          JOIN product_attribute_values pav ON pav.id = pas.product_attribute_value_id
          JOIN attribute_options ao ON ao.id = pas.attribute_option_id
          WHERE ao.attribute_definition_id <> pav.attribute_definition_id
             OR ao.company_id <> pas.company_id
          LIMIT 20`,
      },
    ];

    for (const check of checks) {
      const rows = await check.sql;
      if (rows.length > 0) {
        violations.push({ check: check.name, count: rows.length, sample: rows });
      }
    }

    if (violations.length === 0) {
      console.log('Catalog integrity check: OK (no violations)');
      process.exitCode = 0;
    } else {
      console.error('Catalog integrity check: VIOLATIONS');
      console.error(
        JSON.stringify(violations, (_, v) => (typeof v === 'bigint' ? Number(v) : v), 2),
      );
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

void main();
