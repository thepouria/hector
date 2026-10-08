/**
 * Read-only Warehouse Master + Locations + Goods Receipt + Batch/Lot + Putaway
 * + Inventory Ledger / Balance integrity checks (Phase 3.2–3.12).
 *
 * Usage from repo root:
 *   pnpm db:check:warehouse
 *   pnpm db:check:inventory   (dedicated Balance↔Ledger reconciliation)
 *
 * Exit 0 = clean; 1 = violations. Never mutates data.
 * InventoryMovement Ledger is canonical On Hand truth; InventoryBalance is projection.
 * Batch has no inventory quantity field — do not assert Batch.quantity.
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
        name: 'warehouse_orphan_company',
        sql: prisma.$queryRaw`
          SELECT w.id FROM warehouses w
          LEFT JOIN companies c ON c.id = w.company_id
          WHERE c.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'warehouse_duplicate_default',
        sql: prisma.$queryRaw`
          SELECT company_id, COUNT(*)::int AS cnt
          FROM warehouses
          WHERE is_default = true
          GROUP BY company_id
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'warehouse_default_not_active',
        sql: prisma.$queryRaw`
          SELECT id, company_id, status FROM warehouses
          WHERE is_default = true AND status <> 'ACTIVE'
          LIMIT 20`,
      },
      {
        name: 'warehouse_active_without_default',
        sql: prisma.$queryRaw`
          SELECT c.id AS company_id
          FROM companies c
          WHERE EXISTS (
            SELECT 1 FROM warehouses w
            WHERE w.company_id = c.id AND w.status = 'ACTIVE'
          )
          AND NOT EXISTS (
            SELECT 1 FROM warehouses w
            WHERE w.company_id = c.id AND w.is_default = true AND w.status = 'ACTIVE'
          )
          LIMIT 20`,
      },
      {
        name: 'location_orphan_warehouse',
        sql: prisma.$queryRaw`
          SELECT l.id FROM warehouse_locations l
          LEFT JOIN warehouses w ON w.id = l.warehouse_id AND w.company_id = l.company_id
          WHERE w.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'location_company_mismatch',
        sql: prisma.$queryRaw`
          SELECT l.id FROM warehouse_locations l
          JOIN warehouses w ON w.id = l.warehouse_id
          WHERE l.company_id <> w.company_id
          LIMIT 20`,
      },
      {
        name: 'location_parent_cross_warehouse',
        sql: prisma.$queryRaw`
          SELECT l.id FROM warehouse_locations l
          JOIN warehouse_locations p ON p.id = l.parent_id
          WHERE l.warehouse_id <> p.warehouse_id OR l.company_id <> p.company_id
          LIMIT 20`,
      },
      {
        name: 'location_self_parent',
        sql: prisma.$queryRaw`
          SELECT id FROM warehouse_locations
          WHERE parent_id IS NOT NULL AND parent_id = id
          LIMIT 20`,
      },
      {
        name: 'location_duplicate_code',
        sql: prisma.$queryRaw`
          SELECT company_id, warehouse_id, code, COUNT(*)::int AS cnt
          FROM warehouse_locations
          GROUP BY company_id, warehouse_id, code
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'location_duplicate_barcode',
        sql: prisma.$queryRaw`
          SELECT barcode, COUNT(*)::int AS cnt
          FROM warehouse_locations
          GROUP BY barcode
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'location_cycle',
        sql: prisma.$queryRaw`
          WITH RECURSIVE walk AS (
            SELECT id, parent_id, id AS root_id, 1 AS depth, ARRAY[id] AS path
            FROM warehouse_locations
            WHERE parent_id IS NOT NULL
            UNION ALL
            SELECT l.id, l.parent_id, w.root_id, w.depth + 1, w.path || l.id
            FROM warehouse_locations l
            JOIN walk w ON l.id = w.parent_id
            WHERE w.depth < 64 AND NOT (l.id = ANY(w.path))
          )
          SELECT root_id, id FROM walk
          WHERE id = root_id AND depth > 1
          LIMIT 20`,
      },
      {
        name: 'grn_orphan_warehouse',
        sql: prisma.$queryRaw`
          SELECT g.id FROM goods_receipts g
          LEFT JOIN warehouses w ON w.id = g.warehouse_id AND w.company_id = g.company_id
          WHERE w.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'grn_orphan_purchase_order',
        sql: prisma.$queryRaw`
          SELECT g.id FROM goods_receipts g
          LEFT JOIN purchase_orders po ON po.id = g.purchase_order_id AND po.company_id = g.company_id
          WHERE po.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'grn_supplier_mismatch_po',
        sql: prisma.$queryRaw`
          SELECT g.id FROM goods_receipts g
          JOIN purchase_orders po ON po.id = g.purchase_order_id AND po.company_id = g.company_id
          WHERE g.supplier_id <> po.supplier_id
          LIMIT 20`,
      },
      {
        name: 'grn_item_wrong_po',
        sql: prisma.$queryRaw`
          SELECT i.id FROM goods_receipt_items i
          JOIN goods_receipts g ON g.id = i.goods_receipt_id AND g.company_id = i.company_id
          JOIN purchase_order_items poi ON poi.id = i.purchase_order_item_id
          WHERE poi.purchase_order_id <> g.purchase_order_id
             OR poi.company_id <> i.company_id
          LIMIT 20`,
      },
      {
        name: 'grn_item_sku_mismatch',
        sql: prisma.$queryRaw`
          SELECT i.id FROM goods_receipt_items i
          JOIN purchase_order_items poi
            ON poi.id = i.purchase_order_item_id AND poi.company_id = i.company_id
          WHERE i.sku_id <> poi.sku_id
          LIMIT 20`,
      },
      {
        name: 'grn_posted_empty',
        sql: prisma.$queryRaw`
          SELECT g.id FROM goods_receipts g
          WHERE g.status = 'POSTED'
            AND NOT EXISTS (
              SELECT 1 FROM goods_receipt_items i WHERE i.goods_receipt_id = g.id
            )
          LIMIT 20`,
      },
      {
        name: 'grn_non_positive_quantity',
        sql: prisma.$queryRaw`
          SELECT id FROM goods_receipt_items WHERE quantity <= 0 LIMIT 20`,
      },
      {
        name: 'grn_duplicate_po_item_in_receipt',
        sql: prisma.$queryRaw`
          SELECT goods_receipt_id, purchase_order_item_id, COUNT(*)::int AS cnt
          FROM goods_receipt_items
          GROUP BY goods_receipt_id, purchase_order_item_id
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'grn_aggregate_over_receipt',
        sql: prisma.$queryRaw`
          SELECT poi.id AS purchase_order_item_id,
                 poi.quantity AS ordered,
                 COALESCE(SUM(i.quantity), 0)::int AS posted_received
          FROM purchase_order_items poi
          JOIN goods_receipt_items i ON i.purchase_order_item_id = poi.id
          JOIN goods_receipts g ON g.id = i.goods_receipt_id
          WHERE g.status = 'POSTED'
          GROUP BY poi.id, poi.quantity
          HAVING COALESCE(SUM(i.quantity), 0) > poi.quantity
          LIMIT 20`,
      },
      {
        name: 'receiving_posted_plus_short_exceeds_ordered',
        sql: prisma.$queryRaw`
          SELECT poi.id AS purchase_order_item_id,
                 poi.quantity AS ordered,
                 poi.closed_unfulfilled_quantity AS short_qty,
                 COALESCE(posted.qty, 0)::int AS posted_received
          FROM purchase_order_items poi
          LEFT JOIN (
            SELECT i.purchase_order_item_id, SUM(i.quantity)::int AS qty
            FROM goods_receipt_items i
            JOIN goods_receipts g ON g.id = i.goods_receipt_id
            WHERE g.status = 'POSTED'
            GROUP BY i.purchase_order_item_id
          ) posted ON posted.purchase_order_item_id = poi.id
          WHERE COALESCE(posted.qty, 0) + poi.closed_unfulfilled_quantity > poi.quantity
          LIMIT 20`,
      },
      {
        name: 'receiving_negative_remaining_derived',
        sql: prisma.$queryRaw`
          SELECT poi.id AS purchase_order_item_id
          FROM purchase_order_items poi
          LEFT JOIN (
            SELECT i.purchase_order_item_id, SUM(i.quantity)::int AS qty
            FROM goods_receipt_items i
            JOIN goods_receipts g ON g.id = i.goods_receipt_id
            WHERE g.status = 'POSTED'
            GROUP BY i.purchase_order_item_id
          ) posted ON posted.purchase_order_item_id = poi.id
          WHERE poi.quantity - COALESCE(posted.qty, 0) - poi.closed_unfulfilled_quantity < 0
          LIMIT 20`,
      },
      {
        name: 'shortage_wrong_po',
        sql: prisma.$queryRaw`
          SELECT d.id FROM purchase_discrepancies d
          JOIN purchase_order_items poi
            ON poi.id = d.purchase_order_item_id AND poi.company_id = d.company_id
          WHERE d.status = 'SHORT_CLOSED'
            AND poi.purchase_order_id <> d.purchase_order_id
          LIMIT 20`,
      },
      {
        name: 'shortage_cross_company',
        sql: prisma.$queryRaw`
          SELECT d.id FROM purchase_discrepancies d
          JOIN purchase_orders po ON po.id = d.purchase_order_id
          WHERE d.company_id <> po.company_id
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
        name: 'grn_company_mismatch_warehouse',
        sql: prisma.$queryRaw`
          SELECT g.id FROM goods_receipts g
          JOIN warehouses w ON w.id = g.warehouse_id
          WHERE g.company_id <> w.company_id
          LIMIT 20`,
      },
      {
        name: 'scan_request_company_mismatch',
        sql: prisma.$queryRaw`
          SELECT s.id FROM goods_receipt_scan_requests s
          JOIN goods_receipts g ON g.id = s.goods_receipt_id
          WHERE s.company_id <> g.company_id
          LIMIT 20`,
      },
      {
        name: 'batch_orphan_or_cross_company_sku',
        sql: prisma.$queryRaw`
          SELECT b.id FROM batches b
          LEFT JOIN skus s ON s.id = b.sku_id AND s.company_id = b.company_id
          WHERE s.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'batch_allocation_sku_mismatch',
        sql: prisma.$queryRaw`
          SELECT a.id FROM goods_receipt_item_batches a
          JOIN goods_receipt_items i
            ON i.id = a.goods_receipt_item_id AND i.company_id = a.company_id
          JOIN batches b ON b.id = a.batch_id AND b.company_id = a.company_id
          WHERE a.sku_id <> i.sku_id
             OR a.sku_id <> b.sku_id
             OR b.sku_id <> i.sku_id
          LIMIT 20`,
      },
      {
        name: 'batch_allocation_cross_company',
        sql: prisma.$queryRaw`
          SELECT a.id FROM goods_receipt_item_batches a
          JOIN goods_receipt_items i ON i.id = a.goods_receipt_item_id
          JOIN batches b ON b.id = a.batch_id
          WHERE a.company_id <> i.company_id
             OR a.company_id <> b.company_id
             OR i.company_id <> b.company_id
          LIMIT 20`,
      },
      {
        name: 'batch_allocation_duplicate_item_batch',
        sql: prisma.$queryRaw`
          SELECT goods_receipt_item_id, batch_id, COUNT(*)::int AS cnt
          FROM goods_receipt_item_batches
          GROUP BY goods_receipt_item_id, batch_id
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'batch_posted_grn_allocation_sum_mismatch',
        sql: prisma.$queryRaw`
          SELECT i.id AS goods_receipt_item_id,
                 i.quantity,
                 COALESCE(SUM(a.quantity), 0)::int AS allocated
          FROM goods_receipt_items i
          JOIN goods_receipts g
            ON g.id = i.goods_receipt_id AND g.company_id = i.company_id
          LEFT JOIN goods_receipt_item_batches a
            ON a.goods_receipt_item_id = i.id AND a.company_id = i.company_id
          WHERE g.status = 'POSTED'
          GROUP BY i.id, i.quantity
          HAVING COALESCE(SUM(a.quantity), 0) <> i.quantity
          LIMIT 20`,
      },
      {
        name: 'batch_allocation_non_positive_quantity',
        sql: prisma.$queryRaw`
          SELECT id FROM goods_receipt_item_batches
          WHERE quantity <= 0
          LIMIT 20`,
      },
      {
        name: 'batch_invalid_manufacture_expiry_chronology',
        sql: prisma.$queryRaw`
          SELECT id FROM batches
          WHERE manufactured_at IS NOT NULL
            AND expires_at IS NOT NULL
            AND expires_at < manufactured_at
          LIMIT 20`,
      },
      {
        name: 'batch_allocation_orphan_or_cancelled_grn',
        sql: prisma.$queryRaw`
          SELECT a.id FROM goods_receipt_item_batches a
          LEFT JOIN goods_receipt_items i
            ON i.id = a.goods_receipt_item_id AND i.company_id = a.company_id
          LEFT JOIN goods_receipts g
            ON g.id = i.goods_receipt_id AND g.company_id = i.company_id
          WHERE i.id IS NULL
             OR g.id IS NULL
             OR g.status = 'CANCELLED'
          LIMIT 20`,
      },
      {
        name: 'putaway_non_posted_receipt',
        sql: prisma.$queryRaw`
          SELECT p.id FROM putaways p
          JOIN goods_receipts g ON g.id = p.goods_receipt_id
          WHERE g.status <> 'POSTED'
             OR p.company_id <> g.company_id
          LIMIT 20`,
      },
      {
        name: 'putaway_warehouse_mismatch_receipt',
        sql: prisma.$queryRaw`
          SELECT p.id FROM putaways p
          JOIN goods_receipts g
            ON g.id = p.goods_receipt_id AND g.company_id = p.company_id
          WHERE p.warehouse_id <> g.warehouse_id
          LIMIT 20`,
      },
      {
        name: 'putaway_item_allocation_mismatch',
        sql: prisma.$queryRaw`
          SELECT i.id FROM putaway_items i
          JOIN putaways p ON p.id = i.putaway_id AND p.company_id = i.company_id
          JOIN goods_receipt_item_batches a
            ON a.id = i.goods_receipt_item_batch_id AND a.company_id = i.company_id
          JOIN goods_receipt_items gri
            ON gri.id = a.goods_receipt_item_id AND gri.company_id = a.company_id
          WHERE gri.goods_receipt_id <> p.goods_receipt_id
          LIMIT 20`,
      },
      {
        name: 'putaway_item_location_warehouse_mismatch',
        sql: prisma.$queryRaw`
          SELECT i.id FROM putaway_items i
          JOIN putaways p ON p.id = i.putaway_id AND p.company_id = i.company_id
          JOIN warehouse_locations l ON l.id = i.warehouse_location_id
          WHERE l.warehouse_id <> p.warehouse_id
             OR l.company_id <> i.company_id
             OR p.company_id <> i.company_id
          LIMIT 20`,
      },
      {
        name: 'putaway_item_non_positive_quantity',
        sql: prisma.$queryRaw`
          SELECT id FROM putaway_items
          WHERE quantity <= 0
          LIMIT 20`,
      },
      {
        name: 'putaway_item_duplicate_allocation_location',
        sql: prisma.$queryRaw`
          SELECT putaway_id, goods_receipt_item_batch_id, warehouse_location_id, COUNT(*)::int AS cnt
          FROM putaway_items
          GROUP BY putaway_id, goods_receipt_item_batch_id, warehouse_location_id
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'putaway_completed_exceeds_received',
        sql: prisma.$queryRaw`
          SELECT a.id AS allocation_id,
                 a.quantity AS received,
                 COALESCE(SUM(i.quantity), 0)::int AS completed_putaway
          FROM goods_receipt_item_batches a
          JOIN putaway_items i
            ON i.goods_receipt_item_batch_id = a.id AND i.company_id = a.company_id
          JOIN putaways p
            ON p.id = i.putaway_id AND p.company_id = i.company_id
          WHERE p.status = 'COMPLETED'
          GROUP BY a.id, a.quantity
          HAVING COALESCE(SUM(i.quantity), 0) > a.quantity
          LIMIT 20`,
      },
      {
        name: 'putaway_cross_company',
        sql: prisma.$queryRaw`
          SELECT p.id FROM putaways p
          JOIN warehouses w ON w.id = p.warehouse_id
          JOIN goods_receipts g ON g.id = p.goods_receipt_id
          WHERE p.company_id <> w.company_id
             OR p.company_id <> g.company_id
          LIMIT 20`,
      },
      {
        name: 'inventory_movement_zero_delta',
        sql: prisma.$queryRaw`
          SELECT id FROM inventory_movements
          WHERE quantity_delta = 0
          LIMIT 20`,
      },
      {
        name: 'inventory_movement_sign_mismatch',
        sql: prisma.$queryRaw`
          SELECT id, movement_type, quantity_delta FROM inventory_movements
          WHERE (
            movement_type IN (
              'RECEIVE','TRANSFER_IN','RECLASSIFY_IN','ADJUSTMENT_IN','RETURN_IN',
              'STOCK_COUNT_ADJUSTMENT_IN','OPENING_BALANCE'
            ) AND quantity_delta <= 0
          ) OR (
            movement_type IN (
              'ISSUE','TRANSFER_OUT','RECLASSIFY_OUT','ADJUSTMENT_OUT','RETURN_OUT',
              'STOCK_COUNT_ADJUSTMENT_OUT'
            ) AND quantity_delta >= 0
          )
          LIMIT 20`,
      },
      {
        name: 'inventory_movement_batch_sku_mismatch',
        sql: prisma.$queryRaw`
          SELECT m.id FROM inventory_movements m
          JOIN batches b ON b.id = m.batch_id AND b.company_id = m.company_id
          WHERE m.sku_id <> b.sku_id
          LIMIT 20`,
      },
      {
        name: 'inventory_movement_location_warehouse_mismatch',
        sql: prisma.$queryRaw`
          SELECT m.id FROM inventory_movements m
          JOIN warehouse_locations l ON l.id = m.location_id
          WHERE m.warehouse_id <> l.warehouse_id
             OR m.company_id <> l.company_id
          LIMIT 20`,
      },
      {
        name: 'inventory_completed_putaway_missing_receive',
        sql: prisma.$queryRaw`
          SELECT i.id AS putaway_item_id
          FROM putaway_items i
          JOIN putaways p ON p.id = i.putaway_id AND p.company_id = i.company_id
          LEFT JOIN inventory_movements m
            ON m.company_id = i.company_id
           AND m.source_type = 'PUTAWAY'
           AND m.source_line_id = i.id
           AND m.movement_type = 'RECEIVE'
          WHERE p.status = 'COMPLETED'
            AND m.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'inventory_putaway_receive_quantity_mismatch',
        sql: prisma.$queryRaw`
          SELECT i.id AS putaway_item_id, i.quantity, m.quantity_delta
          FROM putaway_items i
          JOIN putaways p ON p.id = i.putaway_id AND p.company_id = i.company_id
          JOIN inventory_movements m
            ON m.company_id = i.company_id
           AND m.source_type = 'PUTAWAY'
           AND m.source_line_id = i.id
           AND m.movement_type = 'RECEIVE'
          WHERE p.status = 'COMPLETED'
            AND (
              m.quantity_delta <> i.quantity
              OR m.location_id <> i.warehouse_location_id
              OR m.warehouse_id <> p.warehouse_id
            )
          LIMIT 20`,
      },
      {
        name: 'inventory_balance_negative',
        sql: prisma.$queryRaw`
          SELECT id, on_hand_quantity FROM inventory_balances
          WHERE on_hand_quantity < 0
          LIMIT 20`,
      },
      {
        name: 'inventory_balance_ledger_mismatch',
        sql: prisma.$queryRaw`
          SELECT b.id,
                 b.on_hand_quantity,
                 COALESCE(SUM(m.quantity_delta), 0)::int AS ledger_sum
          FROM inventory_balances b
          LEFT JOIN inventory_movements m
            ON m.company_id = b.company_id
           AND m.warehouse_id = b.warehouse_id
           AND m.location_id = b.location_id
           AND m.sku_id = b.sku_id
           AND m.batch_id = b.batch_id
           AND m.classification = b.classification
          GROUP BY b.id, b.on_hand_quantity
          HAVING b.on_hand_quantity <> COALESCE(SUM(m.quantity_delta), 0)
          LIMIT 20`,
      },
      {
        name: 'inventory_missing_balance',
        sql: prisma.$queryRaw`
          SELECT m.company_id, m.warehouse_id, m.location_id, m.sku_id, m.batch_id, m.classification,
                 COALESCE(SUM(m.quantity_delta), 0)::int AS ledger_sum
          FROM inventory_movements m
          LEFT JOIN inventory_balances b
            ON b.company_id = m.company_id
           AND b.warehouse_id = m.warehouse_id
           AND b.location_id = m.location_id
           AND b.sku_id = m.sku_id
           AND b.batch_id = m.batch_id
           AND b.classification = m.classification
          WHERE b.id IS NULL
          GROUP BY m.company_id, m.warehouse_id, m.location_id, m.sku_id, m.batch_id, m.classification
          LIMIT 20`,
      },
      {
        name: 'inventory_orphan_balance',
        sql: prisma.$queryRaw`
          SELECT b.id, b.on_hand_quantity, b.classification
          FROM inventory_balances b
          LEFT JOIN inventory_movements m
            ON m.company_id = b.company_id
           AND m.warehouse_id = b.warehouse_id
           AND m.location_id = b.location_id
           AND m.sku_id = b.sku_id
           AND m.batch_id = b.batch_id
           AND m.classification = b.classification
          WHERE m.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'inventory_balance_batch_sku_mismatch',
        sql: prisma.$queryRaw`
          SELECT b.id FROM inventory_balances b
          JOIN batches bt ON bt.id = b.batch_id AND bt.company_id = b.company_id
          WHERE b.sku_id <> bt.sku_id
          LIMIT 20`,
      },
      {
        name: 'inventory_balance_location_warehouse_mismatch',
        sql: prisma.$queryRaw`
          SELECT b.id FROM inventory_balances b
          JOIN warehouse_locations l ON l.id = b.location_id
          WHERE b.warehouse_id <> l.warehouse_id
             OR b.company_id <> l.company_id
          LIMIT 20`,
      },
      {
        name: 'inventory_cross_company',
        sql: prisma.$queryRaw`
          SELECT m.id FROM inventory_movements m
          JOIN warehouses w ON w.id = m.warehouse_id
          JOIN skus s ON s.id = m.sku_id
          JOIN batches b ON b.id = m.batch_id
          WHERE m.company_id <> w.company_id
             OR m.company_id <> s.company_id
             OR m.company_id <> b.company_id
          LIMIT 20`,
      },
      // Phase 3.11 stock transfer integrity
      {
        name: 'transfer_item_location_warehouse_mismatch',
        sql: prisma.$queryRaw`
          SELECT i.id FROM stock_transfer_items i
          JOIN stock_transfers t ON t.id = i.transfer_id
          JOIN warehouse_locations sl ON sl.id = i.source_location_id
          JOIN warehouse_locations dl ON dl.id = i.destination_location_id
          WHERE sl.warehouse_id <> t.source_warehouse_id
             OR dl.warehouse_id <> t.destination_warehouse_id
             OR i.company_id <> t.company_id
          LIMIT 20`,
      },
      {
        name: 'transfer_item_batch_sku_mismatch',
        sql: prisma.$queryRaw`
          SELECT i.id FROM stock_transfer_items i
          JOIN batches b ON b.id = i.batch_id
          WHERE i.sku_id <> b.sku_id
          LIMIT 20`,
      },
      {
        name: 'transfer_item_same_location',
        sql: prisma.$queryRaw`
          SELECT id FROM stock_transfer_items
          WHERE source_location_id = destination_location_id
          LIMIT 20`,
      },
      {
        name: 'transfer_item_non_positive_quantity',
        sql: prisma.$queryRaw`
          SELECT id FROM stock_transfer_items WHERE quantity <= 0 LIMIT 20`,
      },
      {
        name: 'transfer_draft_with_movements',
        sql: prisma.$queryRaw`
          SELECT t.id FROM stock_transfers t
          WHERE t.status = 'DRAFT'
            AND EXISTS (
              SELECT 1 FROM inventory_movements m
              WHERE m.source_type = 'TRANSFER' AND m.source_id = t.id
            )
          LIMIT 20`,
      },
      {
        name: 'transfer_in_transit_missing_dispatch',
        sql: prisma.$queryRaw`
          SELECT t.id FROM stock_transfers t
          JOIN stock_transfer_items i ON i.transfer_id = t.id
          WHERE t.status = 'IN_TRANSIT'
            AND NOT EXISTS (
              SELECT 1 FROM inventory_movements m
              WHERE m.source_type = 'TRANSFER'
                AND m.source_id = t.id
                AND m.source_line_id = i.id
                AND m.movement_type = 'TRANSFER_OUT'
            )
          LIMIT 20`,
      },
      {
        name: 'transfer_completed_missing_completion',
        sql: prisma.$queryRaw`
          SELECT t.id FROM stock_transfers t
          JOIN stock_transfer_items i ON i.transfer_id = t.id
          WHERE t.status = 'COMPLETED'
            AND NOT EXISTS (
              SELECT 1 FROM inventory_movements m
              WHERE m.source_type = 'TRANSFER'
                AND m.source_id = t.id
                AND m.source_line_id = i.complete_source_line_id
                AND m.movement_type = 'TRANSFER_IN'
            )
          LIMIT 20`,
      },
      {
        name: 'transfer_cancelled_in_transit_missing_return',
        sql: prisma.$queryRaw`
          SELECT t.id FROM stock_transfers t
          JOIN stock_transfer_items i ON i.transfer_id = t.id
          WHERE t.status = 'CANCELLED'
            AND t.dispatched_at IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM inventory_movements m
              WHERE m.source_type = 'TRANSFER'
                AND m.source_id = t.id
                AND m.source_line_id = i.cancel_source_line_id
                AND m.movement_type = 'TRANSFER_IN'
            )
          LIMIT 20`,
      },
      {
        name: 'transfer_company_conservation_in_transit',
        sql: prisma.$queryRaw`
          SELECT t.id,
                 COALESCE(SUM(CASE WHEN m.movement_type = 'TRANSFER_OUT' THEN m.quantity_delta ELSE 0 END), 0)::int AS out_sum,
                 COALESCE(SUM(CASE WHEN m.movement_type = 'TRANSFER_IN' THEN m.quantity_delta ELSE 0 END), 0)::int AS in_sum
          FROM stock_transfers t
          JOIN inventory_movements m
            ON m.source_type = 'TRANSFER' AND m.source_id = t.id
          WHERE t.status IN ('IN_TRANSIT', 'COMPLETED', 'CANCELLED')
          GROUP BY t.id
          HAVING COALESCE(SUM(m.quantity_delta), 0) <> 0
          LIMIT 20`,
      },
      // Phase 3.12 stock classification + stock issue integrity
      {
        name: 'classification_change_non_positive_quantity',
        sql: prisma.$queryRaw`
          SELECT id FROM stock_classification_changes WHERE quantity <= 0 LIMIT 20`,
      },
      {
        name: 'classification_change_from_equals_to',
        sql: prisma.$queryRaw`
          SELECT id FROM stock_classification_changes
          WHERE from_classification = to_classification
          LIMIT 20`,
      },
      {
        name: 'classification_change_missing_ledger_pair',
        sql: prisma.$queryRaw`
          SELECT c.id FROM stock_classification_changes c
          WHERE NOT EXISTS (
            SELECT 1 FROM inventory_movements m
            WHERE m.company_id = c.company_id
              AND m.source_type = 'CLASSIFICATION_CHANGE'
              AND m.source_id = c.id
              AND m.movement_type = 'RECLASSIFY_OUT'
          )
          OR NOT EXISTS (
            SELECT 1 FROM inventory_movements m
            WHERE m.company_id = c.company_id
              AND m.source_type = 'CLASSIFICATION_CHANGE'
              AND m.source_id = c.id
              AND m.movement_type = 'RECLASSIFY_IN'
          )
          LIMIT 20`,
      },
      {
        name: 'classification_change_unpaired_operation',
        sql: prisma.$queryRaw`
          SELECT c.id, c.operation_id,
                 COUNT(m.id)::int AS movement_count,
                 COALESCE(SUM(m.quantity_delta), 0)::int AS net_delta
          FROM stock_classification_changes c
          JOIN inventory_movements m
            ON m.company_id = c.company_id AND m.operation_id = c.operation_id
          GROUP BY c.id, c.operation_id
          HAVING COUNT(m.id) <> 2
             OR COALESCE(SUM(m.quantity_delta), 0) <> 0
          LIMIT 20`,
      },
      {
        name: 'classification_change_quantity_mismatch',
        sql: prisma.$queryRaw`
          SELECT c.id, c.quantity,
                 ABS(m.quantity_delta)::int AS movement_qty
          FROM stock_classification_changes c
          JOIN inventory_movements m
            ON m.company_id = c.company_id
           AND m.source_type = 'CLASSIFICATION_CHANGE'
           AND m.source_id = c.id
           AND m.movement_type IN ('RECLASSIFY_OUT', 'RECLASSIFY_IN')
          WHERE ABS(m.quantity_delta) <> c.quantity
          LIMIT 20`,
      },
      {
        name: 'classification_change_movement_classification_mismatch',
        sql: prisma.$queryRaw`
          SELECT c.id, m.id AS movement_id, m.movement_type, m.classification
          FROM stock_classification_changes c
          JOIN inventory_movements m
            ON m.company_id = c.company_id
           AND m.source_type = 'CLASSIFICATION_CHANGE'
           AND m.source_id = c.id
          WHERE (
            m.movement_type = 'RECLASSIFY_OUT'
            AND m.classification <> c.from_classification
          ) OR (
            m.movement_type = 'RECLASSIFY_IN'
            AND m.classification <> c.to_classification
          )
          LIMIT 20`,
      },
      {
        name: 'classification_change_dimension_mismatch',
        sql: prisma.$queryRaw`
          SELECT c.id, m.id AS movement_id
          FROM stock_classification_changes c
          JOIN inventory_movements m
            ON m.company_id = c.company_id
           AND m.source_type = 'CLASSIFICATION_CHANGE'
           AND m.source_id = c.id
          WHERE m.warehouse_id <> c.warehouse_id
             OR m.location_id <> c.location_id
             OR m.sku_id <> c.sku_id
             OR m.batch_id <> c.batch_id
          LIMIT 20`,
      },
      {
        name: 'classification_change_company_sku_conservation',
        sql: prisma.$queryRaw`
          SELECT c.id AS change_id, c.operation_id,
                 COALESCE(SUM(m.quantity_delta), 0)::int AS sku_net_delta
          FROM stock_classification_changes c
          JOIN inventory_movements m
            ON m.company_id = c.company_id AND m.operation_id = c.operation_id
          GROUP BY c.id, c.operation_id
          HAVING COALESCE(SUM(m.quantity_delta), 0) <> 0
          LIMIT 20`,
      },
      {
        name: 'reclassification_orphan_movement',
        sql: prisma.$queryRaw`
          SELECT m.id FROM inventory_movements m
          LEFT JOIN stock_classification_changes c
            ON c.id = m.source_id AND c.company_id = m.company_id
          WHERE m.source_type = 'CLASSIFICATION_CHANGE'
            AND c.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'issue_draft_with_movements',
        sql: prisma.$queryRaw`
          SELECT i.id FROM stock_issues i
          WHERE i.status = 'DRAFT'
            AND EXISTS (
              SELECT 1 FROM inventory_movements m
              WHERE m.source_type = 'STOCK_ISSUE' AND m.source_id = i.id
            )
          LIMIT 20`,
      },
      {
        name: 'issue_posted_missing_movement',
        sql: prisma.$queryRaw`
          SELECT i.id FROM stock_issues i
          JOIN stock_issue_items it ON it.stock_issue_id = i.id
          WHERE i.status = 'POSTED'
            AND NOT EXISTS (
              SELECT 1 FROM inventory_movements m
              WHERE m.company_id = it.company_id
                AND m.source_type = 'STOCK_ISSUE'
                AND m.source_id = i.id
                AND m.source_line_id = it.id
                AND m.movement_type = 'ISSUE'
            )
          LIMIT 20`,
      },
      {
        name: 'issue_posted_movement_count_mismatch',
        sql: prisma.$queryRaw`
          SELECT i.id,
                 (SELECT COUNT(*)::int FROM stock_issue_items it WHERE it.stock_issue_id = i.id) AS item_count,
                 (SELECT COUNT(*)::int FROM inventory_movements m
                  WHERE m.source_type = 'STOCK_ISSUE' AND m.source_id = i.id
                    AND m.movement_type = 'ISSUE') AS movement_count
          FROM stock_issues i
          WHERE i.status = 'POSTED'
            AND (
              SELECT COUNT(*) FROM stock_issue_items it WHERE it.stock_issue_id = i.id
            ) <> (
              SELECT COUNT(*) FROM inventory_movements m
              WHERE m.source_type = 'STOCK_ISSUE' AND m.source_id = i.id
                AND m.movement_type = 'ISSUE'
            )
          LIMIT 20`,
      },
      {
        name: 'issue_item_non_positive_quantity',
        sql: prisma.$queryRaw`
          SELECT id FROM stock_issue_items WHERE quantity <= 0 LIMIT 20`,
      },
      {
        name: 'issue_item_location_warehouse_mismatch',
        sql: prisma.$queryRaw`
          SELECT it.id FROM stock_issue_items it
          JOIN stock_issues i ON i.id = it.stock_issue_id AND i.company_id = it.company_id
          JOIN warehouse_locations l ON l.id = it.location_id
          WHERE l.warehouse_id <> i.warehouse_id
             OR l.company_id <> it.company_id
          LIMIT 20`,
      },
      {
        name: 'issue_item_batch_sku_mismatch',
        sql: prisma.$queryRaw`
          SELECT it.id FROM stock_issue_items it
          JOIN batches b ON b.id = it.batch_id AND b.company_id = it.company_id
          WHERE b.sku_id <> it.sku_id
          LIMIT 20`,
      },
      {
        name: 'issue_posted_movement_quantity_mismatch',
        sql: prisma.$queryRaw`
          SELECT it.id, it.quantity, m.quantity_delta
          FROM stock_issue_items it
          JOIN stock_issues i ON i.id = it.stock_issue_id AND i.company_id = it.company_id
          JOIN inventory_movements m
            ON m.company_id = it.company_id
           AND m.source_type = 'STOCK_ISSUE'
           AND m.source_id = i.id
           AND m.source_line_id = it.id
           AND m.movement_type = 'ISSUE'
          WHERE i.status = 'POSTED'
            AND m.quantity_delta <> -it.quantity
          LIMIT 20`,
      },
      {
        name: 'issue_posted_movement_classification_mismatch',
        sql: prisma.$queryRaw`
          SELECT it.id, it.classification, m.classification AS movement_classification
          FROM stock_issue_items it
          JOIN stock_issues i ON i.id = it.stock_issue_id AND i.company_id = it.company_id
          JOIN inventory_movements m
            ON m.company_id = it.company_id
           AND m.source_type = 'STOCK_ISSUE'
           AND m.source_id = i.id
           AND m.source_line_id = it.id
           AND m.movement_type = 'ISSUE'
          WHERE i.status = 'POSTED'
            AND m.classification <> it.classification
          LIMIT 20`,
      },
      {
        name: 'transfer_movement_classification_mismatch',
        sql: prisma.$queryRaw`
          SELECT i.id AS transfer_item_id, m.id AS movement_id,
                 i.classification AS item_classification, m.classification AS movement_classification
          FROM stock_transfer_items i
          JOIN stock_transfers t ON t.id = i.transfer_id
          JOIN inventory_movements m
            ON m.source_type = 'TRANSFER'
           AND m.source_id = t.id
           AND m.company_id = i.company_id
          WHERE m.classification <> i.classification
          LIMIT 20`,
      },
      {
        name: 'adjustment_item_non_positive_quantity',
        sql: prisma.$queryRaw`
          SELECT id FROM inventory_adjustment_items WHERE quantity <= 0 LIMIT 20`,
      },
      {
        name: 'adjustment_cross_company',
        sql: prisma.$queryRaw`
          SELECT it.id FROM inventory_adjustment_items it
          JOIN inventory_adjustments a
            ON a.id = it.inventory_adjustment_id AND a.company_id = it.company_id
          JOIN warehouses w ON w.id = a.warehouse_id
          LEFT JOIN skus s ON s.id = it.sku_id AND s.company_id = it.company_id
          LEFT JOIN batches b ON b.id = it.batch_id AND b.company_id = it.company_id
          LEFT JOIN warehouse_locations l ON l.id = it.location_id AND l.company_id = it.company_id
          WHERE a.company_id <> w.company_id
             OR s.id IS NULL
             OR b.id IS NULL
             OR l.id IS NULL
             OR b.sku_id <> it.sku_id
          LIMIT 20`,
      },
      {
        name: 'adjustment_item_location_warehouse_mismatch',
        sql: prisma.$queryRaw`
          SELECT it.id FROM inventory_adjustment_items it
          JOIN inventory_adjustments a ON a.id = it.inventory_adjustment_id AND a.company_id = it.company_id
          JOIN warehouse_locations l ON l.id = it.location_id
          WHERE l.warehouse_id <> a.warehouse_id
             OR l.company_id <> it.company_id
          LIMIT 20`,
      },
      {
        name: 'adjustment_item_batch_sku_mismatch',
        sql: prisma.$queryRaw`
          SELECT it.id FROM inventory_adjustment_items it
          JOIN batches b ON b.id = it.batch_id AND b.company_id = it.company_id
          WHERE b.sku_id <> it.sku_id
          LIMIT 20`,
      },
      {
        name: 'adjustment_draft_with_movements',
        sql: prisma.$queryRaw`
          SELECT a.id FROM inventory_adjustments a
          WHERE a.status = 'DRAFT'
            AND EXISTS (
              SELECT 1 FROM inventory_movements m
              WHERE m.source_type = 'MANUAL_ADJUSTMENT' AND m.source_id = a.id
            )
          LIMIT 20`,
      },
      {
        name: 'adjustment_posted_missing_movement',
        sql: prisma.$queryRaw`
          SELECT a.id FROM inventory_adjustments a
          JOIN inventory_adjustment_items it ON it.inventory_adjustment_id = a.id
          WHERE a.status = 'POSTED'
            AND NOT EXISTS (
              SELECT 1 FROM inventory_movements m
              WHERE m.company_id = it.company_id
                AND m.source_type = 'MANUAL_ADJUSTMENT'
                AND m.source_id = a.id
                AND m.source_line_id = it.id
                AND m.movement_type IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT')
            )
          LIMIT 20`,
      },
      {
        name: 'adjustment_posted_movement_count_mismatch',
        sql: prisma.$queryRaw`
          SELECT a.id,
                 (SELECT COUNT(*)::int FROM inventory_adjustment_items it WHERE it.inventory_adjustment_id = a.id) AS item_count,
                 (SELECT COUNT(*)::int FROM inventory_movements m
                  WHERE m.source_type = 'MANUAL_ADJUSTMENT' AND m.source_id = a.id
                    AND m.movement_type IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT')) AS movement_count
          FROM inventory_adjustments a
          WHERE a.status = 'POSTED'
            AND (
              SELECT COUNT(*) FROM inventory_adjustment_items it WHERE it.inventory_adjustment_id = a.id
            ) <> (
              SELECT COUNT(*) FROM inventory_movements m
              WHERE m.source_type = 'MANUAL_ADJUSTMENT' AND m.source_id = a.id
                AND m.movement_type IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT')
            )
          LIMIT 20`,
      },
      {
        name: 'adjustment_posted_duplicate_movement',
        sql: prisma.$queryRaw`
          SELECT it.id, COUNT(m.id)::int AS movement_count
          FROM inventory_adjustment_items it
          JOIN inventory_adjustments a ON a.id = it.inventory_adjustment_id AND a.company_id = it.company_id
          JOIN inventory_movements m
            ON m.company_id = it.company_id
           AND m.source_type = 'MANUAL_ADJUSTMENT'
           AND m.source_id = a.id
           AND m.source_line_id = it.id
           AND m.movement_type IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT')
          WHERE a.status = 'POSTED'
          GROUP BY it.id
          HAVING COUNT(m.id) > 1
          LIMIT 20`,
      },
      {
        name: 'adjustment_posted_movement_quantity_mismatch',
        sql: prisma.$queryRaw`
          SELECT it.id, it.direction, it.quantity, m.quantity_delta
          FROM inventory_adjustment_items it
          JOIN inventory_adjustments a ON a.id = it.inventory_adjustment_id AND a.company_id = it.company_id
          JOIN inventory_movements m
            ON m.company_id = it.company_id
           AND m.source_type = 'MANUAL_ADJUSTMENT'
           AND m.source_id = a.id
           AND m.source_line_id = it.id
           AND m.movement_type IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT')
          WHERE a.status = 'POSTED'
            AND (
              (it.direction = 'IN' AND m.quantity_delta <> it.quantity)
              OR (it.direction = 'OUT' AND m.quantity_delta <> -it.quantity)
            )
          LIMIT 20`,
      },
      {
        name: 'stock_count_cross_company',
        sql: prisma.$queryRaw`
          SELECT it.id FROM stock_count_items it
          JOIN stock_counts c ON c.id = it.stock_count_id AND c.company_id = it.company_id
          JOIN warehouses w ON w.id = c.warehouse_id
          LEFT JOIN skus s ON s.id = it.sku_id AND s.company_id = it.company_id
          LEFT JOIN batches b ON b.id = it.batch_id AND b.company_id = it.company_id
          LEFT JOIN warehouse_locations l ON l.id = it.location_id AND l.company_id = it.company_id
          WHERE c.company_id <> w.company_id
             OR it.warehouse_id <> c.warehouse_id
             OR s.id IS NULL
             OR b.id IS NULL
             OR l.id IS NULL
             OR b.sku_id <> it.sku_id
          LIMIT 20`,
      },
      {
        name: 'stock_count_item_counted_negative',
        sql: prisma.$queryRaw`
          SELECT id FROM stock_count_items WHERE counted_quantity < 0 LIMIT 20`,
      },
      {
        name: 'stock_count_posted_missing_correction',
        sql: prisma.$queryRaw`
          SELECT it.id FROM stock_count_items it
          JOIN stock_counts c ON c.id = it.stock_count_id AND c.company_id = it.company_id
          WHERE c.status = 'POSTED'
            AND it.difference IS NOT NULL
            AND it.difference <> 0
            AND NOT EXISTS (
              SELECT 1 FROM inventory_movements m
              WHERE m.company_id = it.company_id
                AND m.source_type = 'STOCK_COUNT'
                AND m.source_id = c.id
                AND m.source_line_id = it.id
                AND m.movement_type IN ('STOCK_COUNT_ADJUSTMENT_IN', 'STOCK_COUNT_ADJUSTMENT_OUT')
            )
          LIMIT 20`,
      },
      {
        name: 'stock_count_posted_duplicate_correction',
        sql: prisma.$queryRaw`
          SELECT it.id, COUNT(m.id)::int AS movement_count
          FROM stock_count_items it
          JOIN stock_counts c ON c.id = it.stock_count_id AND c.company_id = it.company_id
          JOIN inventory_movements m
            ON m.company_id = it.company_id
           AND m.source_type = 'STOCK_COUNT'
           AND m.source_id = c.id
           AND m.source_line_id = it.id
           AND m.movement_type IN ('STOCK_COUNT_ADJUSTMENT_IN', 'STOCK_COUNT_ADJUSTMENT_OUT')
          WHERE c.status = 'POSTED'
            AND it.difference IS NOT NULL
            AND it.difference <> 0
          GROUP BY it.id
          HAVING COUNT(m.id) > 1
          LIMIT 20`,
      },
      {
        name: 'stock_count_posted_movement_quantity_mismatch',
        sql: prisma.$queryRaw`
          SELECT it.id, it.difference, m.quantity_delta, m.movement_type
          FROM stock_count_items it
          JOIN stock_counts c ON c.id = it.stock_count_id AND c.company_id = it.company_id
          JOIN inventory_movements m
            ON m.company_id = it.company_id
           AND m.source_type = 'STOCK_COUNT'
           AND m.source_id = c.id
           AND m.source_line_id = it.id
           AND m.movement_type IN ('STOCK_COUNT_ADJUSTMENT_IN', 'STOCK_COUNT_ADJUSTMENT_OUT')
          WHERE c.status = 'POSTED'
            AND it.difference IS NOT NULL
            AND it.difference <> 0
            AND m.quantity_delta <> it.difference
          LIMIT 20`,
      },
      {
        name: 'stock_count_posted_expected_reconciliation',
        sql: prisma.$queryRaw`
          SELECT it.id, it.snapshot_quantity, it.movements_during_count, it.expected_quantity
          FROM stock_count_items it
          JOIN stock_counts c ON c.id = it.stock_count_id AND c.company_id = it.company_id
          WHERE c.status = 'POSTED'
            AND it.expected_quantity IS NOT NULL
            AND it.snapshot_quantity IS NOT NULL
            AND it.movements_during_count IS NOT NULL
            AND it.expected_quantity <> it.snapshot_quantity + it.movements_during_count
          LIMIT 20`,
      },
      {
        name: 'supplier_return_execution_item_non_positive_quantity',
        sql: prisma.$queryRaw`
          SELECT id FROM supplier_return_execution_items WHERE quantity <= 0 LIMIT 20`,
      },
      {
        name: 'supplier_return_execution_cross_company',
        sql: prisma.$queryRaw`
          SELECT it.id FROM supplier_return_execution_items it
          JOIN supplier_return_executions e
            ON e.id = it.supplier_return_execution_id AND e.company_id = it.company_id
          JOIN warehouses w ON w.id = e.warehouse_id
          LEFT JOIN skus s ON s.id = it.sku_id AND s.company_id = it.company_id
          LEFT JOIN batches b ON b.id = it.batch_id AND b.company_id = it.company_id
          LEFT JOIN warehouse_locations l ON l.id = it.location_id AND l.company_id = it.company_id
          WHERE e.company_id <> w.company_id
             OR s.id IS NULL
             OR b.id IS NULL
             OR l.id IS NULL
             OR b.sku_id <> it.sku_id
          LIMIT 20`,
      },
      {
        name: 'supplier_return_execution_item_location_warehouse_mismatch',
        sql: prisma.$queryRaw`
          SELECT it.id FROM supplier_return_execution_items it
          JOIN supplier_return_executions e
            ON e.id = it.supplier_return_execution_id AND e.company_id = it.company_id
          JOIN warehouse_locations l ON l.id = it.location_id
          WHERE l.warehouse_id <> e.warehouse_id
             OR l.company_id <> it.company_id
          LIMIT 20`,
      },
      {
        name: 'supplier_return_execution_item_batch_sku_mismatch',
        sql: prisma.$queryRaw`
          SELECT it.id FROM supplier_return_execution_items it
          JOIN batches b ON b.id = it.batch_id AND b.company_id = it.company_id
          WHERE b.sku_id <> it.sku_id
          LIMIT 20`,
      },
      {
        name: 'supplier_return_execution_item_sku_return_line_mismatch',
        sql: prisma.$queryRaw`
          SELECT it.id FROM supplier_return_execution_items it
          JOIN purchase_return_items pri
            ON pri.id = it.purchase_return_item_id AND pri.company_id = it.company_id
          WHERE pri.sku_id <> it.sku_id
          LIMIT 20`,
      },
      {
        name: 'supplier_return_execution_draft_with_movements',
        sql: prisma.$queryRaw`
          SELECT e.id FROM supplier_return_executions e
          WHERE e.status = 'DRAFT'
            AND EXISTS (
              SELECT 1 FROM inventory_movements m
              WHERE m.source_type = 'SUPPLIER_RETURN' AND m.source_id = e.id
            )
          LIMIT 20`,
      },
      {
        name: 'supplier_return_execution_dispatched_missing_return_out',
        sql: prisma.$queryRaw`
          SELECT e.id FROM supplier_return_executions e
          JOIN supplier_return_execution_items it
            ON it.supplier_return_execution_id = e.id AND it.company_id = e.company_id
          WHERE e.status = 'DISPATCHED'
            AND NOT EXISTS (
              SELECT 1 FROM inventory_movements m
              WHERE m.company_id = it.company_id
                AND m.source_type = 'SUPPLIER_RETURN'
                AND m.source_id = e.id
                AND m.source_line_id = it.id
                AND m.movement_type = 'RETURN_OUT'
            )
          LIMIT 20`,
      },
      {
        name: 'supplier_return_execution_dispatched_movement_count_mismatch',
        sql: prisma.$queryRaw`
          SELECT e.id,
                 (SELECT COUNT(*)::int FROM supplier_return_execution_items it
                  WHERE it.supplier_return_execution_id = e.id) AS item_count,
                 (SELECT COUNT(*)::int FROM inventory_movements m
                  WHERE m.source_type = 'SUPPLIER_RETURN' AND m.source_id = e.id
                    AND m.movement_type = 'RETURN_OUT') AS movement_count
          FROM supplier_return_executions e
          WHERE e.status = 'DISPATCHED'
            AND (
              SELECT COUNT(*) FROM supplier_return_execution_items it
              WHERE it.supplier_return_execution_id = e.id
            ) <> (
              SELECT COUNT(*) FROM inventory_movements m
              WHERE m.source_type = 'SUPPLIER_RETURN' AND m.source_id = e.id
                AND m.movement_type = 'RETURN_OUT'
            )
          LIMIT 20`,
      },
      {
        name: 'supplier_return_execution_dispatched_movement_quantity_mismatch',
        sql: prisma.$queryRaw`
          SELECT it.id, it.quantity, m.quantity_delta
          FROM supplier_return_execution_items it
          JOIN supplier_return_executions e
            ON e.id = it.supplier_return_execution_id AND e.company_id = it.company_id
          JOIN inventory_movements m
            ON m.company_id = it.company_id
           AND m.source_type = 'SUPPLIER_RETURN'
           AND m.source_id = e.id
           AND m.source_line_id = it.id
           AND m.movement_type = 'RETURN_OUT'
          WHERE e.status = 'DISPATCHED'
            AND m.quantity_delta <> -it.quantity
          LIMIT 20`,
      },
      {
        name: 'supplier_return_execution_dispatched_movement_classification_mismatch',
        sql: prisma.$queryRaw`
          SELECT it.id, it.classification, m.classification AS movement_classification
          FROM supplier_return_execution_items it
          JOIN supplier_return_executions e
            ON e.id = it.supplier_return_execution_id AND e.company_id = it.company_id
          JOIN inventory_movements m
            ON m.company_id = it.company_id
           AND m.source_type = 'SUPPLIER_RETURN'
           AND m.source_id = e.id
           AND m.source_line_id = it.id
           AND m.movement_type = 'RETURN_OUT'
          WHERE e.status = 'DISPATCHED'
            AND m.classification <> it.classification
          LIMIT 20`,
      },
      {
        name: 'supplier_return_execution_duplicate_return_out',
        sql: prisma.$queryRaw`
          SELECT m.company_id, m.source_line_id, m.movement_type, COUNT(*)::int AS cnt
          FROM inventory_movements m
          WHERE m.source_type = 'SUPPLIER_RETURN'
            AND m.movement_type = 'RETURN_OUT'
          GROUP BY m.company_id, m.source_line_id, m.movement_type
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'supplier_return_over_authorized_dispatch_sum',
        sql: prisma.$queryRaw`
          SELECT pri.id AS purchase_return_item_id, pri.quantity AS authorized,
                 COALESCE(SUM(it.quantity) FILTER (WHERE e.status = 'DISPATCHED'), 0)::int AS dispatched
          FROM purchase_return_items pri
          JOIN purchase_returns pr ON pr.id = pri.purchase_return_id AND pr.company_id = pri.company_id
          LEFT JOIN supplier_return_execution_items it
            ON it.purchase_return_item_id = pri.id AND it.company_id = pri.company_id
          LEFT JOIN supplier_return_executions e
            ON e.id = it.supplier_return_execution_id AND e.company_id = it.company_id
          WHERE pr.status = 'APPROVED'
          GROUP BY pri.id, pri.quantity
          HAVING COALESCE(SUM(it.quantity) FILTER (WHERE e.status = 'DISPATCHED'), 0) > pri.quantity
          LIMIT 20`,
      },
    ];

    // Purchasing lifecycle (PO status vs open qty) belongs to purchasing integrity.
    // Keep the query as a non-blocking warning so warehouse/FIFO gates stay focused.
    const purchasingLifecycleWarnings = new Set(['received_po_with_remaining']);
    const warnings: Violation[] = [];

    for (const check of checks) {
      const rows = await check.sql;
      if (rows.length === 0) continue;
      const entry = { check: check.name, count: rows.length, sample: rows.slice(0, 5) };
      if (purchasingLifecycleWarnings.has(check.name)) {
        warnings.push(entry);
      } else {
        violations.push(entry);
      }
    }

    for (const w of warnings) {
      console.warn(`Warehouse integrity warning (purchasing lifecycle): ${w.check}: ${w.count}`, w.sample ?? '');
    }

    if (violations.length === 0) {
      console.log(
        warnings.length === 0
          ? 'Warehouse integrity check: OK (0 known violations)'
          : `Warehouse integrity check: OK (${warnings.length} purchasing-lifecycle warning(s); 0 warehouse hard violations)`,
      );
      process.exit(0);
    }

    console.error('Warehouse integrity check: FAILED');
    for (const v of violations) {
      console.error(`- ${v.check}: ${v.count}`, v.sample ?? '');
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
