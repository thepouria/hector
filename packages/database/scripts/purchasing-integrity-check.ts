/**
 * Read-only Purchasing integrity checks (Phase 2.16 QA).
 *
 * Usage from repo root:
 *   pnpm db:check:purchasing
 *   pnpm --filter @hector/database exec tsx scripts/purchasing-integrity-check.ts
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
        name: 'po_supplier_cross_company',
        sql: prisma.$queryRaw`
          SELECT po.id FROM purchase_orders po
          JOIN suppliers s ON s.id = po.supplier_id
          WHERE s.company_id <> po.company_id
          LIMIT 20`,
      },
      {
        name: 'po_item_without_valid_po',
        sql: prisma.$queryRaw`
          SELECT i.id FROM purchase_order_items i
          LEFT JOIN purchase_orders po
            ON po.id = i.purchase_order_id AND po.company_id = i.company_id
          WHERE po.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'po_item_sku_cross_company',
        sql: prisma.$queryRaw`
          SELECT i.id FROM purchase_order_items i
          JOIN skus s ON s.id = i.sku_id
          WHERE s.company_id <> i.company_id
          LIMIT 20`,
      },
      {
        name: 'po_cost_without_valid_po',
        sql: prisma.$queryRaw`
          SELECT c.id FROM purchase_order_costs c
          LEFT JOIN purchase_orders po
            ON po.id = c.purchase_order_id AND po.company_id = c.company_id
          WHERE po.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'po_correction_without_valid_po',
        sql: prisma.$queryRaw`
          SELECT c.id FROM purchase_order_corrections c
          LEFT JOIN purchase_orders po
            ON po.id = c.purchase_order_id AND po.company_id = c.company_id
          WHERE po.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'po_correction_item_mismatch',
        sql: prisma.$queryRaw`
          SELECT c.id FROM purchase_order_corrections c
          JOIN purchase_order_items i ON i.id = c.purchase_order_item_id
          WHERE c.purchase_order_item_id IS NOT NULL
            AND (i.company_id <> c.company_id
              OR i.purchase_order_id <> c.purchase_order_id)
          LIMIT 20`,
      },
      {
        name: 'discrepancy_item_mismatch',
        sql: prisma.$queryRaw`
          SELECT d.id FROM purchase_discrepancies d
          JOIN purchase_order_items i ON i.id = d.purchase_order_item_id
          WHERE i.company_id <> d.company_id
             OR i.purchase_order_id <> d.purchase_order_id
          LIMIT 20`,
      },
      {
        name: 'return_po_cross_company',
        sql: prisma.$queryRaw`
          SELECT r.id FROM purchase_returns r
          JOIN purchase_orders po ON po.id = r.purchase_order_id
          WHERE r.purchase_order_id IS NOT NULL
            AND po.company_id <> r.company_id
          LIMIT 20`,
      },
      {
        name: 'return_supplier_cross_company',
        sql: prisma.$queryRaw`
          SELECT r.id FROM purchase_returns r
          JOIN suppliers s ON s.id = r.supplier_id
          WHERE s.company_id <> r.company_id
          LIMIT 20`,
      },
      {
        name: 'return_item_without_valid_return',
        sql: prisma.$queryRaw`
          SELECT ri.id FROM purchase_return_items ri
          LEFT JOIN purchase_returns r
            ON r.id = ri.purchase_return_id AND r.company_id = ri.company_id
          WHERE r.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'return_item_sku_cross_company',
        sql: prisma.$queryRaw`
          SELECT ri.id FROM purchase_return_items ri
          JOIN skus s ON s.id = ri.sku_id
          WHERE s.company_id <> ri.company_id
          LIMIT 20`,
      },
      {
        name: 'cash_with_fx_obligation',
        sql: prisma.$queryRaw`
          SELECT id FROM purchase_orders
          WHERE purchase_type = 'CASH'
            AND (obligation_amount IS NOT NULL
              OR obligation_currency IS NOT NULL
              OR reference_fx_rate IS NOT NULL)
          LIMIT 20`,
      },
      {
        name: 'fx_credit_missing_obligation',
        sql: prisma.$queryRaw`
          SELECT id FROM purchase_orders
          WHERE purchase_type = 'FX_CREDIT'
            AND status IN ('APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED')
            AND (obligation_amount IS NULL
              OR obligation_currency IS NULL
              OR reference_fx_rate IS NULL)
          LIMIT 20`,
      },
      {
        name: 'term_credit_missing_due_semantics',
        sql: prisma.$queryRaw`
          SELECT id FROM purchase_orders
          WHERE purchase_type = 'TERM_CREDIT'
            AND status IN ('APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED')
            AND (
              payment_term_type IS NULL
              OR due_date IS NULL
              OR (
                payment_term_type = 'NET_DAYS'
                AND (net_days IS NULL OR term_basis IS NULL)
              )
            )
          LIMIT 20`,
      },
      {
        name: 'short_close_exceeds_quantity',
        sql: prisma.$queryRaw`
          SELECT id FROM purchase_order_items
          WHERE closed_unfulfilled_quantity < 0
             OR closed_unfulfilled_quantity > quantity
          LIMIT 20`,
      },
      {
        name: 'committed_po_without_items',
        sql: prisma.$queryRaw`
          SELECT po.id FROM purchase_orders po
          LEFT JOIN purchase_order_items i
            ON i.purchase_order_id = po.id AND i.company_id = po.company_id
          WHERE po.status IN ('APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED')
          GROUP BY po.id
          HAVING COUNT(i.id) = 0
          LIMIT 20`,
      },
      {
        name: 'received_po_with_remaining',
        sql: prisma.$queryRaw`
          SELECT po.id, po.number
          FROM purchase_orders po
          WHERE po.status = 'RECEIVED'
            AND EXISTS (
              SELECT 1 FROM purchase_order_items poi
              LEFT JOIN (
                SELECT i.purchase_order_item_id, SUM(i.quantity)::int AS qty
                FROM goods_receipt_items i
                JOIN goods_receipts g ON g.id = i.goods_receipt_id
                WHERE g.status = 'POSTED' AND g.purchase_order_id = po.id
                GROUP BY i.purchase_order_item_id
              ) posted ON posted.purchase_order_item_id = poi.id
              WHERE poi.purchase_order_id = po.id
                AND poi.quantity - COALESCE(posted.qty, 0) - poi.closed_unfulfilled_quantity > 0
            )
          LIMIT 20`,
      },
      {
        name: 'offer_supplier_or_sku_cross_company',
        sql: prisma.$queryRaw`
          SELECT o.id FROM supplier_offers o
          JOIN suppliers s ON s.id = o.supplier_id
          JOIN skus k ON k.id = o.sku_id
          WHERE s.company_id <> o.company_id
             OR k.company_id <> o.company_id
          LIMIT 20`,
      },
      {
        name: 'supplier_contact_cross_company',
        sql: prisma.$queryRaw`
          SELECT c.id FROM supplier_contacts c
          JOIN suppliers s ON s.id = c.supplier_id
          WHERE s.company_id <> c.company_id
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
      console.log('Purchasing integrity check: OK (0 known violations)');
      process.exitCode = 0;
    } else {
      console.error('Purchasing integrity check: VIOLATIONS');
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
