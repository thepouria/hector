/**
 * Read-only Sales integrity checks (Phase 5.4 QA).
 *
 * Usage from repo root:
 *   pnpm db:check:sales
 *   pnpm sales:integrity
 *   pnpm --filter @hector/database exec tsx scripts/sales-integrity-check.ts
 *
 * Exit 0 = clean; 1 = violations. Never mutates data.
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client';

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
    const sqlChecks: Array<{ name: string; sql: Promise<unknown[]> }> = [
      {
        name: 'qty_ordered_not_positive',
        sql: prisma.$queryRaw`
          SELECT id FROM sales_order_items
          WHERE quantity <= 0
          LIMIT 20`,
      },
      {
        name: 'qty_trackers_negative',
        sql: prisma.$queryRaw`
          SELECT id FROM sales_order_items
          WHERE cancelled_quantity < 0
             OR fulfilled_quantity < 0
             OR returned_quantity < 0
          LIMIT 20`,
      },
      {
        name: 'qty_cancelled_plus_fulfilled_exceeds_ordered',
        sql: prisma.$queryRaw`
          SELECT id FROM sales_order_items
          WHERE cancelled_quantity + fulfilled_quantity > quantity
          LIMIT 20`,
      },
      {
        name: 'qty_returned_exceeds_fulfilled',
        sql: prisma.$queryRaw`
          SELECT id FROM sales_order_items
          WHERE returned_quantity > fulfilled_quantity
          LIMIT 20`,
      },
      {
        name: 'order_channel_cross_company',
        sql: prisma.$queryRaw`
          SELECT so.id FROM sales_orders so
          JOIN sales_channels sc ON sc.id = so.channel_id
          WHERE sc.company_id <> so.company_id
          LIMIT 20`,
      },
      {
        name: 'order_customer_cross_company',
        sql: prisma.$queryRaw`
          SELECT so.id FROM sales_orders so
          JOIN customers c ON c.id = so.customer_id
          WHERE so.customer_id IS NOT NULL
            AND c.company_id <> so.company_id
          LIMIT 20`,
      },
      {
        name: 'order_item_sku_cross_company',
        sql: prisma.$queryRaw`
          SELECT i.id FROM sales_order_items i
          JOIN skus s ON s.id = i.sku_id
          WHERE s.company_id <> i.company_id
          LIMIT 20`,
      },
      {
        name: 'order_item_without_valid_order',
        sql: prisma.$queryRaw`
          SELECT i.id FROM sales_order_items i
          LEFT JOIN sales_orders so
            ON so.id = i.sales_order_id AND so.company_id = i.company_id
          WHERE so.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'fulfillment_order_cross_company',
        sql: prisma.$queryRaw`
          SELECT f.id FROM sales_fulfillments f
          JOIN sales_orders so ON so.id = f.sales_order_id
          WHERE so.company_id <> f.company_id
          LIMIT 20`,
      },
      {
        name: 'return_order_cross_company',
        sql: prisma.$queryRaw`
          SELECT r.id FROM sales_returns r
          JOIN sales_orders so ON so.id = r.sales_order_id
          WHERE so.company_id <> r.company_id
          LIMIT 20`,
      },
      {
        name: 'completed_fulfillment_missing_issue_movement',
        sql: prisma.$queryRaw`
          SELECT f.id FROM sales_fulfillments f
          WHERE f.status = 'COMPLETED'
            AND NOT EXISTS (
              SELECT 1 FROM inventory_movements m
              WHERE m.company_id = f.company_id
                AND m.source_type = 'SALES_FULFILLMENT'
                AND m.source_id = f.id
                AND m.movement_type = 'ISSUE'
            )
          LIMIT 20`,
      },
      {
        name: 'received_return_missing_return_in',
        sql: prisma.$queryRaw`
          SELECT r.id FROM sales_returns r
          WHERE r.status = 'RECEIVED'
            AND NOT EXISTS (
              SELECT 1 FROM inventory_movements m
              WHERE m.company_id = r.company_id
                AND m.source_type = 'CUSTOMER_RETURN'
                AND m.source_id = r.id
                AND m.movement_type = 'RETURN_IN'
            )
          LIMIT 20`,
      },
      {
        name: 'orphan_active_reservation_cancelled_order',
        sql: prisma.$queryRaw`
          SELECT ir.id FROM inventory_reservations ir
          JOIN sales_orders so ON so.id = ir.source_id AND so.company_id = ir.company_id
          WHERE ir.source_type = 'SALES_ORDER'
            AND ir.status = 'ACTIVE'
            AND so.status = 'CANCELLED'
          LIMIT 20`,
      },
      {
        name: 'orphan_active_reservation_fully_covered',
        sql: prisma.$queryRaw`
          SELECT ir.id FROM inventory_reservations ir
          JOIN sales_order_items soi
            ON soi.id = ir.source_line_id AND soi.company_id = ir.company_id
          WHERE ir.source_type = 'SALES_ORDER'
            AND ir.status = 'ACTIVE'
            AND soi.cancelled_quantity + soi.fulfilled_quantity >= soi.quantity
          LIMIT 20`,
      },
      {
        name: 'reservation_remaining_exceeds_open_remaining',
        sql: prisma.$queryRaw`
          SELECT ir.id FROM inventory_reservations ir
          JOIN sales_order_items soi
            ON soi.id = ir.source_line_id AND soi.company_id = ir.company_id
          WHERE ir.source_type = 'SALES_ORDER'
            AND ir.status = 'ACTIVE'
            AND ir.remaining_quantity >
              GREATEST(0, soi.quantity - soi.cancelled_quantity - soi.fulfilled_quantity)
          LIMIT 20`,
      },
      {
        name: 'completed_fulfillment_missing_receivable',
        sql: prisma.$queryRaw`
          SELECT f.id FROM sales_fulfillments f
          JOIN sales_orders so ON so.id = f.sales_order_id AND so.company_id = f.company_id
          WHERE f.status = 'COMPLETED'
            AND so.grand_total > 0
            AND NOT EXISTS (
              SELECT 1 FROM customer_receivables cr
              WHERE cr.company_id = f.company_id
                AND cr.sales_fulfillment_id = f.id
            )
          LIMIT 20`,
      },
      {
        name: 'marketplace_sale_auto_cash_movement',
        sql: prisma.$queryRaw`
          SELECT fam.id FROM financial_account_movements fam
          JOIN sales_fulfillments f
            ON f.id = fam.source_id AND f.company_id = fam.company_id
          JOIN sales_orders so
            ON so.id = f.sales_order_id AND so.company_id = f.company_id
          JOIN sales_channels sc
            ON sc.id = so.channel_id AND sc.company_id = so.company_id
          WHERE sc.type = 'MARKETPLACE'
            AND (
              fam.source_type ILIKE 'SALES%'
              OR fam.source_type IN (
                'SALES_FULFILLMENT',
                'SALES_ORDER',
                'SALES_RETURN',
                'CUSTOMER_RECEIVABLE',
                'SALES_AR_RECOGNITION'
              )
            )
          LIMIT 20`,
      },
    ];

    for (const check of sqlChecks) {
      const rows = await check.sql;
      if (rows.length > 0) {
        violations.push({ check: check.name, count: rows.length, sample: rows });
      }
    }

    // Money: recalculate line/order totals vs persisted (Decimal-safe JS).
    const moneyBad: Array<{ id: string; kind: string }> = [];
    const orders = await prisma.salesOrder.findMany({
      select: {
        id: true,
        subtotal: true,
        itemDiscountTotal: true,
        orderDiscountTotal: true,
        netItemsTotal: true,
        shippingAmount: true,
        otherCharges: true,
        grandTotal: true,
        items: {
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            discountAmount: true,
            lineSubtotal: true,
            lineNetTotal: true,
          },
        },
      },
      take: 5000,
    });

    for (const order of orders) {
      let subtotal = new Prisma.Decimal(0);
      let itemDiscountTotal = new Prisma.Decimal(0);
      let netItemsTotal = new Prisma.Decimal(0);

      for (const item of order.items) {
        const expectedSubtotal = new Prisma.Decimal(item.unitPrice).mul(item.quantity);
        const expectedNet = expectedSubtotal.sub(item.discountAmount);
        if (!expectedSubtotal.equals(item.lineSubtotal)) {
          moneyBad.push({ id: item.id, kind: 'line_subtotal' });
        }
        if (!expectedNet.equals(item.lineNetTotal)) {
          moneyBad.push({ id: item.id, kind: 'line_net_total' });
        }
        if (new Prisma.Decimal(item.discountAmount).lt(0)) {
          moneyBad.push({ id: item.id, kind: 'line_discount_negative' });
        }
        if (new Prisma.Decimal(item.discountAmount).gt(expectedSubtotal)) {
          moneyBad.push({ id: item.id, kind: 'line_discount_exceeds_subtotal' });
        }
        subtotal = subtotal.add(expectedSubtotal);
        itemDiscountTotal = itemDiscountTotal.add(item.discountAmount);
        netItemsTotal = netItemsTotal.add(expectedNet);
      }

      const expectedGrand = netItemsTotal
        .sub(order.orderDiscountTotal)
        .add(order.shippingAmount)
        .add(order.otherCharges);

      if (!subtotal.equals(order.subtotal)) {
        moneyBad.push({ id: order.id, kind: 'order_subtotal' });
      }
      if (!itemDiscountTotal.equals(order.itemDiscountTotal)) {
        moneyBad.push({ id: order.id, kind: 'order_item_discount_total' });
      }
      if (!netItemsTotal.equals(order.netItemsTotal)) {
        moneyBad.push({ id: order.id, kind: 'order_net_items_total' });
      }
      if (!expectedGrand.equals(order.grandTotal)) {
        moneyBad.push({ id: order.id, kind: 'order_grand_total' });
      }
      if (moneyBad.length >= 20) break;
    }

    if (moneyBad.length > 0) {
      violations.push({
        check: 'money_totals_mismatch',
        count: moneyBad.length,
        sample: moneyBad.slice(0, 20),
      });
    }

    console.log('Sales integrity checks:');
    for (const check of sqlChecks) {
      const hit = violations.find((v) => v.check === check.name);
      console.log(`  ${check.name}: ${hit ? hit.count : 0}`);
    }
    const moneyHit = violations.find((v) => v.check === 'money_totals_mismatch');
    console.log(`  money_totals_mismatch: ${moneyHit ? moneyHit.count : 0}`);

    if (violations.length === 0) {
      console.log('Sales integrity check: OK (0 known violations)');
      console.log('Violations: 0');
      process.exitCode = 0;
    } else {
      console.error('Sales integrity check: FAILED');
      for (const v of violations) {
        console.error(`  ${v.check}: ${v.count}`, v.sample ?? '');
      }
      console.error(`Violations: ${violations.length}`);
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
