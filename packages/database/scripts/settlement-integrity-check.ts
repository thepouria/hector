/**
 * Read-only Settlement integrity checks (Phase 6.1 + 6.2 + 6.3).
 *
 * Usage:
 *   pnpm db:check:settlement
 *   pnpm settlement:integrity
 *
 * Exit 0 = clean (soft warnings allowed); 1 = hard violations. Never mutates data.
 * Never auto-repairs.
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
    const counts = await prisma.$queryRaw<
      Array<{
        settlements: number;
        items: number;
        allocations: number;
        obligations: number;
      }>
    >`
      SELECT
        (SELECT COUNT(*)::int FROM settlements) AS settlements,
        (SELECT COUNT(*)::int FROM settlement_items) AS items,
        (SELECT COUNT(*)::int FROM settlement_allocations) AS allocations,
        (SELECT COUNT(*)::int FROM settlement_manual_obligations) AS obligations
    `;

    const sqlChecks: Array<{ name: string; sql: Promise<unknown[]>; soft?: boolean }> = [
      {
        name: 'settlement_item_orphan_settlement',
        sql: prisma.$queryRaw`
          SELECT i.id FROM settlement_items i
          LEFT JOIN settlements s ON s.id = i.settlement_id AND s.company_id = i.company_id
          WHERE s.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'allocation_orphan_settlement',
        sql: prisma.$queryRaw`
          SELECT a.id FROM settlement_allocations a
          LEFT JOIN settlements s ON s.id = a.settlement_id AND s.company_id = a.company_id
          WHERE s.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'allocation_orphan_item',
        sql: prisma.$queryRaw`
          SELECT a.id FROM settlement_allocations a
          LEFT JOIN settlement_items i
            ON i.id = a.settlement_item_id AND i.company_id = a.company_id
          WHERE i.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'settlement_party_cross_company',
        sql: prisma.$queryRaw`
          SELECT s.id FROM settlements s
          JOIN parties p ON p.id = s.party_id
          WHERE s.party_id IS NOT NULL AND s.company_id <> p.company_id
          LIMIT 20`,
      },
      {
        name: 'allocation_payment_cross_company',
        sql: prisma.$queryRaw`
          SELECT a.id FROM settlement_allocations a
          JOIN payments p ON p.id = a.payment_id
          WHERE a.payment_id IS NOT NULL AND a.company_id <> p.company_id
          LIMIT 20`,
      },
      {
        name: 'item_settlement_cross_company',
        sql: prisma.$queryRaw`
          SELECT i.id FROM settlement_items i
          JOIN settlements s ON s.id = i.settlement_id
          WHERE i.company_id <> s.company_id
          LIMIT 20`,
      },
      {
        name: 'allocation_negative_or_zero',
        sql: prisma.$queryRaw`
          SELECT id FROM settlement_allocations
          WHERE amount <= 0
          LIMIT 20`,
      },
      {
        name: 'item_original_non_positive',
        sql: prisma.$queryRaw`
          SELECT id FROM settlement_items
          WHERE original_amount <= 0
          LIMIT 20`,
      },
      {
        name: 'obligation_original_non_positive',
        sql: prisma.$queryRaw`
          SELECT id FROM settlement_manual_obligations
          WHERE original_amount <= 0
          LIMIT 20`,
      },
      {
        name: 'allocation_currency_mismatch_item',
        sql: prisma.$queryRaw`
          SELECT a.id FROM settlement_allocations a
          JOIN settlement_items i ON i.id = a.settlement_item_id AND i.company_id = a.company_id
          WHERE a.currency <> i.currency
          LIMIT 20`,
      },
      {
        name: 'allocation_currency_mismatch_settlement',
        sql: prisma.$queryRaw`
          SELECT a.id FROM settlement_allocations a
          JOIN settlements s ON s.id = a.settlement_id AND s.company_id = a.company_id
          WHERE a.currency <> s.currency
          LIMIT 20`,
      },
      {
        name: 'allocation_payment_currency_mismatch',
        sql: prisma.$queryRaw`
          SELECT a.id FROM settlement_allocations a
          JOIN payments p ON p.id = a.payment_id AND p.company_id = a.company_id
          WHERE a.payment_id IS NOT NULL AND a.payment_currency <> p.currency
          LIMIT 20`,
      },
      {
        name: 'settled_with_remaining',
        sql: prisma.$queryRaw`
          SELECT s.id
          FROM settlements s
          WHERE s.status = 'SETTLED'
            AND EXISTS (
              SELECT 1 FROM settlement_items i
              WHERE i.settlement_id = s.id AND i.company_id = s.company_id
            )
            AND (
              SELECT COALESCE(SUM(i.original_amount), 0)
              FROM settlement_items i
              WHERE i.settlement_id = s.id AND i.company_id = s.company_id
            ) > (
              SELECT COALESCE(SUM(a.amount), 0)
              FROM settlement_allocations a
              WHERE a.settlement_id = s.id
                AND a.company_id = s.company_id
                AND a.status = 'ACTIVE'
            )
          LIMIT 20`,
      },
      {
        name: 'partially_settled_with_zero_allocated',
        sql: prisma.$queryRaw`
          SELECT s.id FROM settlements s
          WHERE s.status = 'PARTIALLY_SETTLED'
            AND NOT EXISTS (
              SELECT 1 FROM settlement_allocations a
              WHERE a.settlement_id = s.id
                AND a.company_id = s.company_id
                AND a.status = 'ACTIVE'
            )
          LIMIT 20`,
      },
      {
        name: 'open_with_active_allocations',
        sql: prisma.$queryRaw`
          SELECT s.id FROM settlements s
          WHERE s.status = 'OPEN'
            AND EXISTS (
              SELECT 1 FROM settlement_allocations a
              WHERE a.settlement_id = s.id
                AND a.company_id = s.company_id
                AND a.status = 'ACTIVE'
            )
          LIMIT 20`,
      },
      {
        name: 'cancelled_with_active_allocations',
        sql: prisma.$queryRaw`
          SELECT s.id FROM settlements s
          WHERE s.status = 'CANCELLED'
            AND EXISTS (
              SELECT 1 FROM settlement_allocations a
              WHERE a.settlement_id = s.id
                AND a.company_id = s.company_id
                AND a.status = 'ACTIVE'
            )
          LIMIT 20`,
      },
      {
        name: 'active_allocation_on_draft',
        sql: prisma.$queryRaw`
          SELECT a.id FROM settlement_allocations a
          JOIN settlements s ON s.id = a.settlement_id AND s.company_id = a.company_id
          WHERE a.status = 'ACTIVE' AND s.status = 'DRAFT'
          LIMIT 20`,
      },
      {
        name: 'reversal_missing_metadata',
        sql: prisma.$queryRaw`
          SELECT id FROM settlement_allocations
          WHERE status = 'REVERSED'
            AND (reversed_at IS NULL OR reversed_by_id IS NULL)
          LIMIT 20`,
      },
      {
        name: 'unsupported_source_allocated',
        sql: prisma.$queryRaw`
          SELECT i.id FROM settlement_items i
          JOIN settlement_allocations a
            ON a.settlement_item_id = i.id AND a.company_id = i.company_id
          WHERE a.status = 'ACTIVE'
            AND i.source_type NOT IN ('MANUAL_OBLIGATION', 'SUPPLIER_PAYABLE', 'LOAN', 'CHANNEL')
          LIMIT 20`,
      },
      {
        name: 'channel_settlement_source_missing',
        sql: prisma.$queryRaw`
          SELECT i.id FROM settlement_items i
          LEFT JOIN channel_settlements c
            ON c.id = i.source_id AND c.company_id = i.company_id
          WHERE i.source_type = 'CHANNEL' AND c.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'channel_expected_net_mismatch',
        sql: prisma.$queryRaw`
          SELECT s.id
          FROM channel_settlements s
          WHERE s.expected_net <> COALESCE((
            SELECT SUM(
              CASE WHEN c.effect = 'INCREASE' THEN c.amount ELSE -c.amount END
            )
            FROM channel_settlement_components c
            WHERE c.channel_settlement_id = s.id AND c.company_id = s.company_id
          ), 0)
          LIMIT 20`,
      },
      {
        name: 'channel_received_status_mismatch',
        sql: prisma.$queryRaw`
          SELECT s.id
          FROM channel_settlements s
          WHERE s.status = 'RECEIVED'
            AND s.expected_net > COALESCE((
              SELECT SUM(a.amount)
              FROM settlement_items i
              JOIN settlement_allocations a
                ON a.settlement_item_id = i.id AND a.company_id = i.company_id
              WHERE i.company_id = s.company_id
                AND i.source_type = 'CHANNEL'
                AND i.source_id = s.id
                AND a.status = 'ACTIVE'
            ), 0)
          LIMIT 20`,
      },
      {
        name: 'channel_cancelled_with_active_allocations',
        sql: prisma.$queryRaw`
          SELECT s.id
          FROM channel_settlements s
          WHERE s.status = 'CANCELLED'
            AND EXISTS (
              SELECT 1
              FROM settlement_items i
              JOIN settlement_allocations a
                ON a.settlement_item_id = i.id AND a.company_id = i.company_id
              WHERE i.company_id = s.company_id
                AND i.source_type = 'CHANNEL'
                AND i.source_id = s.id
                AND a.status = 'ACTIVE'
            )
          LIMIT 20`,
      },
      {
        name: 'receipt_over_allocated',
        sql: prisma.$queryRaw`
          SELECT a.receipt_id
          FROM (
            SELECT company_id, receipt_id, SUM(payment_amount) AS amt
            FROM settlement_allocations
            WHERE status = 'ACTIVE' AND receipt_id IS NOT NULL
            GROUP BY company_id, receipt_id
          ) a
          JOIN receipts r ON r.id = a.receipt_id AND r.company_id = a.company_id
          WHERE a.amt > r.amount
          LIMIT 20`,
      },
      {
        name: 'allocation_receipt_currency_mismatch',
        sql: prisma.$queryRaw`
          SELECT a.id FROM settlement_allocations a
          JOIN receipts r ON r.id = a.receipt_id AND r.company_id = a.company_id
          WHERE a.receipt_id IS NOT NULL AND a.payment_currency <> r.currency
          LIMIT 20`,
      },
      {
        name: 'channel_component_currency_mismatch',
        sql: prisma.$queryRaw`
          SELECT c.id FROM channel_settlement_components c
          JOIN channel_settlements s
            ON s.id = c.channel_settlement_id AND s.company_id = c.company_id
          WHERE c.currency <> s.currency
          LIMIT 20`,
      },
      {
        name: 'channel_cross_company_channel',
        sql: prisma.$queryRaw`
          SELECT s.id FROM channel_settlements s
          JOIN sales_channels ch ON ch.id = s.channel_id
          WHERE s.company_id <> ch.company_id
          LIMIT 20`,
      },
      {
        name: 'channel_invalid_period',
        sql: prisma.$queryRaw`
          SELECT id FROM channel_settlements
          WHERE period_start > period_end
          LIMIT 20`,
      },
      {
        name: 'channel_component_non_positive',
        sql: prisma.$queryRaw`
          SELECT id FROM channel_settlement_components
          WHERE amount <= 0
          LIMIT 20`,
      },
      {
        name: 'channel_over_received',
        sql: prisma.$queryRaw`
          SELECT s.id
          FROM channel_settlements s
          WHERE COALESCE((
            SELECT SUM(a.amount)
            FROM settlement_items i
            JOIN settlement_allocations a
              ON a.settlement_item_id = i.id AND a.company_id = i.company_id
            WHERE i.company_id = s.company_id
              AND i.source_type = 'CHANNEL'
              AND i.source_id = s.id
              AND a.status = 'ACTIVE'
          ), 0) > s.expected_net
          LIMIT 20`,
      },
      {
        name: 'channel_allocation_missing_receipt',
        sql: prisma.$queryRaw`
          SELECT a.id
          FROM settlement_allocations a
          JOIN settlement_items i
            ON i.id = a.settlement_item_id AND i.company_id = a.company_id
          WHERE i.source_type = 'CHANNEL'
            AND a.status = 'ACTIVE'
            AND (a.receipt_id IS NULL OR a.finance_txn_type <> 'RECEIPT')
          LIMIT 20`,
      },
      {
        name: 'channel_suspicious_duplicate_period',
        soft: true,
        sql: prisma.$queryRaw`
          SELECT (array_agg(s.id::text ORDER BY s.created_at))[1] AS id
          FROM channel_settlements s
          WHERE s.status <> 'CANCELLED'
            AND s.external_reference IS NULL
          GROUP BY s.company_id, s.channel_id, s.period_start, s.period_end, s.expected_net
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'cross_currency_missing_fx_detail',
        sql: prisma.$queryRaw`
          SELECT a.id FROM settlement_allocations a
          LEFT JOIN settlement_allocation_fx_details f
            ON f.allocation_id = a.id AND f.company_id = a.company_id
          WHERE a.payment_currency <> a.currency
            AND f.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'same_currency_has_fx_detail',
        sql: prisma.$queryRaw`
          SELECT a.id FROM settlement_allocations a
          JOIN settlement_allocation_fx_details f
            ON f.allocation_id = a.id AND f.company_id = a.company_id
          WHERE a.payment_currency = a.currency
          LIMIT 20`,
      },
      {
        name: 'fx_detail_currency_mismatch',
        sql: prisma.$queryRaw`
          SELECT a.id FROM settlement_allocations a
          JOIN settlement_allocation_fx_details f
            ON f.allocation_id = a.id AND f.company_id = a.company_id
          WHERE a.currency <> f.obligation_currency
             OR a.amount <> f.obligation_amount
             OR a.payment_currency <> f.payment_currency
             OR a.payment_amount <> f.payment_amount
          LIMIT 20`,
      },
      {
        name: 'fx_rate_non_positive',
        sql: prisma.$queryRaw`
          SELECT id FROM settlement_allocation_fx_details
          WHERE rate <= 0 OR payment_amount <= 0 OR obligation_amount <= 0
          LIMIT 20`,
      },
      {
        name: 'payment_amount_vs_capacity_field',
        sql: prisma.$queryRaw`
          SELECT id FROM settlement_allocations
          WHERE payment_amount IS NULL OR payment_amount <= 0
          LIMIT 20`,
      },
      {
        name: 'supplier_payable_source_missing',
        sql: prisma.$queryRaw`
          SELECT i.id FROM settlement_items i
          LEFT JOIN supplier_payables p
            ON p.id = i.source_id AND p.company_id = i.company_id
          WHERE i.source_type = 'SUPPLIER_PAYABLE' AND p.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'loan_source_missing',
        sql: prisma.$queryRaw`
          SELECT i.id FROM settlement_items i
          LEFT JOIN loans l
            ON l.id = i.source_id AND l.company_id = i.company_id
          WHERE i.source_type = 'LOAN' AND l.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'manual_obligation_missing',
        sql: prisma.$queryRaw`
          SELECT i.id FROM settlement_items i
          LEFT JOIN settlement_manual_obligations o
            ON o.id = i.source_id AND o.company_id = i.company_id
          WHERE i.source_type = 'MANUAL_OBLIGATION' AND o.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'payment_over_allocated_core_plus_legacy',
        sql: prisma.$queryRaw`
          WITH alloc AS (
            SELECT company_id, payment_id, SUM(amount) AS amt
            FROM (
              SELECT company_id, payment_id, payment_amount AS amount
              FROM settlement_allocations
              WHERE status = 'ACTIVE' AND payment_id IS NOT NULL
              UNION ALL
              SELECT company_id, payment_id, payment_amount_applied AS amount
              FROM supplier_payment_allocations
              WHERE status = 'POSTED'
              UNION ALL
              SELECT company_id, payment_id, amount
              FROM expense_payment_allocations
              WHERE status = 'ACTIVE'
              UNION ALL
              SELECT company_id, payment_id, amount
              FROM purchase_cost_payment_allocations
              WHERE status = 'ACTIVE'
            ) u
            GROUP BY company_id, payment_id
          )
          SELECT a.payment_id
          FROM alloc a
          JOIN payments p ON p.id = a.payment_id AND p.company_id = a.company_id
          WHERE a.amt > p.amount
          LIMIT 20`,
      },
      {
        name: 'supplier_payable_paid_with_outstanding',
        sql: prisma.$queryRaw`
          SELECT p.id
          FROM supplier_payables p
          WHERE p.status = 'PAID'
            AND (
              SELECT COALESCE(SUM(
                CASE WHEN m.direction = 'INCREASE' THEN m.amount ELSE -m.amount END
              ), 0)
              FROM supplier_liability_movements m
              WHERE m.payable_id = p.id AND m.company_id = p.company_id
            ) > 0
          LIMIT 20`,
      },
      {
        name: 'loan_settled_with_outstanding_principal',
        sql: prisma.$queryRaw`
          SELECT l.id
          FROM loans l
          WHERE l.status = 'SETTLED'
            AND (
              COALESCE((
                SELECT SUM(d.amount)
                FROM loan_disbursements d
                WHERE d.loan_id = l.id
                  AND d.company_id = l.company_id
                  AND d.status = 'POSTED'
                  AND d.reversal_of_id IS NULL
              ), 0)
              -
              COALESCE((
                SELECT SUM(r.principal_amount)
                FROM loan_repayments r
                WHERE r.loan_id = l.id
                  AND r.company_id = l.company_id
                  AND r.status = 'POSTED'
                  AND r.reversal_of_id IS NULL
              ), 0)
              -
              COALESCE((
                SELECT SUM(a.amount)
                FROM settlement_items i
                JOIN settlement_allocations a
                  ON a.settlement_item_id = i.id AND a.company_id = i.company_id
                WHERE i.company_id = l.company_id
                  AND i.source_type = 'LOAN'
                  AND i.source_id = l.id
                  AND a.status = 'ACTIVE'
              ), 0)
            ) > 0
          LIMIT 20`,
      },
      {
        name: 'fx_detail_rate_pair_invalid',
        sql: prisma.$queryRaw`
          SELECT f.id
          FROM settlement_allocation_fx_details f
          WHERE f.rate_base_currency = f.rate_quote_currency
             OR (
               f.rate_base_currency <> f.obligation_currency
               AND f.rate_quote_currency <> f.obligation_currency
             )
             OR (
               f.rate_base_currency <> f.payment_currency
               AND f.rate_quote_currency <> f.payment_currency
             )
          LIMIT 20`,
      },
      {
        name: 'obligation_over_settled',
        sql: prisma.$queryRaw`
          SELECT i.id
          FROM settlement_items i
          WHERE (
            SELECT COALESCE(SUM(a.amount), 0)
            FROM settlement_allocations a
            WHERE a.settlement_item_id = i.id
              AND a.company_id = i.company_id
              AND a.status = 'ACTIVE'
          ) > i.original_amount
          LIMIT 20`,
      },
      {
        name: 'invalid_party_on_settlement',
        sql: prisma.$queryRaw`
          SELECT s.id FROM settlements s
          LEFT JOIN parties p ON p.id = s.party_id AND p.company_id = s.company_id
          WHERE s.party_id IS NOT NULL AND p.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'payment_fk_missing_when_type_payment',
        sql: prisma.$queryRaw`
          SELECT id FROM settlement_allocations
          WHERE finance_txn_type = 'PAYMENT'
            AND (payment_id IS NULL OR payment_id <> finance_txn_id)
          LIMIT 20`,
      },
    ];

    const warnings: Violation[] = [];

    for (const check of sqlChecks) {
      const rows = await check.sql;
      if (rows.length > 0) {
        const entry = {
          check: check.name,
          count: rows.length,
          sample: rows.slice(0, 5),
        };
        if (check.soft) {
          warnings.push(entry);
        } else {
          violations.push(entry);
        }
      }
    }

    console.log('Settlement integrity summary:');
    console.log(JSON.stringify(counts[0] ?? {}, null, 2));

    if (warnings.length > 0) {
      console.warn('Settlement integrity soft warnings (non-fatal):');
      for (const w of warnings) {
        console.warn(`- ${w.check}: ${w.count}`, w.sample ?? '');
      }
    }

    if (violations.length === 0) {
      console.log('Settlement integrity: 0 hard violations');
      process.exit(0);
    }

    console.error('Settlement integrity violations:');
    for (const v of violations) {
      console.error(`- ${v.check}: ${v.count}`, v.sample ?? '');
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
