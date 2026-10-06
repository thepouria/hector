/**
 * Read-only Finance integrity checks
 * (Phase 4.2 Accounts + Phase 4.3 Capital/Loans + Phase 4.4 Supplier Payables
 *  + Phase 4.5 FX + Currency).
 *
 * Usage from repo root:
 *   pnpm db:check:finance
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
        name: 'account_company_orphan',
        sql: prisma.$queryRaw`
          SELECT a.id FROM financial_accounts a
          LEFT JOIN companies c ON c.id = a.company_id
          WHERE c.id IS NULL LIMIT 20`,
      },
      {
        name: 'movement_company_orphan',
        sql: prisma.$queryRaw`
          SELECT m.id FROM financial_account_movements m
          LEFT JOIN companies c ON c.id = m.company_id
          WHERE c.id IS NULL LIMIT 20`,
      },
      {
        name: 'movement_account_cross_company',
        sql: prisma.$queryRaw`
          SELECT m.id FROM financial_account_movements m
          JOIN financial_accounts a ON a.id = m.account_id
          WHERE a.company_id <> m.company_id LIMIT 20`,
      },
      {
        name: 'movement_currency_mismatch',
        sql: prisma.$queryRaw`
          SELECT m.id FROM financial_account_movements m
          JOIN financial_accounts a ON a.id = m.account_id AND a.company_id = m.company_id
          WHERE m.currency <> a.currency LIMIT 20`,
      },
      {
        name: 'multiple_opening_balances',
        sql: prisma.$queryRaw`
          SELECT account_id, COUNT(*)::bigint AS n
          FROM financial_account_movements
          WHERE type = 'OPENING_BALANCE'
          GROUP BY account_id
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'transfer_missing_out_in_pair',
        sql: prisma.$queryRaw`
          SELECT t.id FROM financial_account_transfers t
          WHERE t.status = 'POSTED'
            AND (
              (SELECT COUNT(*) FROM financial_account_movements m
               WHERE m.company_id = t.company_id
                 AND m.source_type = 'ACCOUNT_TRANSFER'
                 AND m.source_id = t.id
                 AND m.type = 'TRANSFER_OUT'
                 AND m.account_id = t.source_account_id
                 AND m.amount = t.amount
                 AND m.currency = t.currency) <> 1
              OR
              (SELECT COUNT(*) FROM financial_account_movements m
               WHERE m.company_id = t.company_id
                 AND m.source_type = 'ACCOUNT_TRANSFER'
                 AND m.source_id = t.id
                 AND m.type = 'TRANSFER_IN'
                 AND m.account_id = t.destination_account_id
                 AND m.amount = t.amount
                 AND m.currency = t.currency) <> 1
            )
          LIMIT 20`,
      },
      {
        name: 'negative_account_balance',
        sql: prisma.$queryRaw`
          SELECT a.id, a.code, a.company_id,
            COALESCE(SUM(CASE WHEN m.direction = 'IN' THEN m.amount
                              WHEN m.direction = 'OUT' THEN -m.amount
                              ELSE 0 END), 0) AS balance
          FROM financial_accounts a
          LEFT JOIN financial_account_movements m
            ON m.account_id = a.id AND m.company_id = a.company_id
          GROUP BY a.id, a.code, a.company_id
          HAVING COALESCE(SUM(CASE WHEN m.direction = 'IN' THEN m.amount
                                   WHEN m.direction = 'OUT' THEN -m.amount
                                   ELSE 0 END), 0) < 0
          LIMIT 20`,
      },
      {
        name: 'multiple_defaults_per_currency',
        sql: prisma.$queryRaw`
          SELECT company_id, currency, COUNT(*)::bigint AS n
          FROM financial_accounts
          WHERE is_default = true
          GROUP BY company_id, currency
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'orphan_transfer_movement_source',
        sql: prisma.$queryRaw`
          SELECT m.id FROM financial_account_movements m
          WHERE m.type IN ('TRANSFER_IN', 'TRANSFER_OUT', 'REVERSAL')
            AND m.source_type = 'ACCOUNT_TRANSFER'
            AND (
              m.source_id IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM financial_account_transfers t
                WHERE t.id = m.source_id AND t.company_id = m.company_id
              )
            )
          LIMIT 20`,
      },
      {
        name: 'transfer_cross_company_accounts',
        sql: prisma.$queryRaw`
          SELECT t.id FROM financial_account_transfers t
          JOIN financial_accounts s ON s.id = t.source_account_id
          JOIN financial_accounts d ON d.id = t.destination_account_id
          WHERE s.company_id <> t.company_id
             OR d.company_id <> t.company_id
          LIMIT 20`,
      },
      {
        name: 'capital_missing_in_movement',
        sql: prisma.$queryRaw`
          SELECT c.id FROM capital_contributions c
          WHERE c.status = 'POSTED'
            AND c.reversal_of_id IS NULL
            AND (
              SELECT COUNT(*) FROM financial_account_movements m
              WHERE m.company_id = c.company_id
                AND m.source_type = 'CAPITAL_INJECTION'
                AND m.source_id = c.id
                AND m.direction = 'IN'
                AND m.amount = c.amount
                AND m.currency = c.currency
            ) <> 1
          LIMIT 20`,
      },
      {
        name: 'capital_currency_mismatch',
        sql: prisma.$queryRaw`
          SELECT c.id FROM capital_contributions c
          JOIN financial_accounts a ON a.id = c.account_id AND a.company_id = c.company_id
          WHERE c.currency <> a.currency
          LIMIT 20`,
      },
      {
        name: 'disbursement_missing_in_movement',
        sql: prisma.$queryRaw`
          SELECT d.id FROM loan_disbursements d
          WHERE d.status = 'POSTED'
            AND d.reversal_of_id IS NULL
            AND (
              SELECT COUNT(*) FROM financial_account_movements m
              WHERE m.company_id = d.company_id
                AND m.source_type = 'LOAN_DISBURSEMENT'
                AND m.source_id = d.id
                AND m.direction = 'IN'
                AND m.amount = d.amount
                AND m.currency = d.currency
            ) <> 1
          LIMIT 20`,
      },
      {
        name: 'repayment_missing_out_movement',
        sql: prisma.$queryRaw`
          SELECT r.id FROM loan_repayments r
          WHERE r.status = 'POSTED'
            AND r.reversal_of_id IS NULL
            AND (
              SELECT COUNT(*) FROM financial_account_movements m
              WHERE m.company_id = r.company_id
                AND m.source_type = 'LOAN_REPAYMENT'
                AND m.source_id = r.id
                AND m.direction = 'OUT'
                AND m.amount = (r.principal_amount + r.interest_amount + r.fee_amount)
                AND m.currency = r.currency
            ) <> 1
          LIMIT 20`,
      },
      {
        name: 'loan_over_repay',
        sql: prisma.$queryRaw`
          SELECT l.id FROM loans l
          WHERE (
            COALESCE((
              SELECT SUM(d.amount) FROM loan_disbursements d
              WHERE d.loan_id = l.id AND d.company_id = l.company_id
                AND d.status = 'POSTED' AND d.reversal_of_id IS NULL
            ), 0)
            -
            COALESCE((
              SELECT SUM(r.principal_amount) FROM loan_repayments r
              WHERE r.loan_id = l.id AND r.company_id = l.company_id
                AND r.status = 'POSTED' AND r.reversal_of_id IS NULL
            ), 0)
          ) < 0
          LIMIT 20`,
      },
      {
        name: 'loan_currency_inconsistency',
        sql: prisma.$queryRaw`
          SELECT d.id FROM loan_disbursements d
          JOIN loans l ON l.id = d.loan_id AND l.company_id = d.company_id
          WHERE d.currency <> l.currency
          UNION ALL
          SELECT r.id FROM loan_repayments r
          JOIN loans l ON l.id = r.loan_id AND l.company_id = r.company_id
          WHERE r.currency <> l.currency
          LIMIT 20`,
      },
      {
        name: 'loan_cross_company_account',
        sql: prisma.$queryRaw`
          SELECT d.id FROM loan_disbursements d
          JOIN financial_accounts a ON a.id = d.account_id
          WHERE a.company_id <> d.company_id
          LIMIT 20`,
      },
      // --- Phase 4.4 Supplier Payables ---
      {
        name: 'posted_grn_item_missing_payable_line',
        sql: prisma.$queryRaw`
          SELECT gri.id
          FROM goods_receipt_items gri
          JOIN goods_receipts gr
            ON gr.id = gri.goods_receipt_id AND gr.company_id = gri.company_id
          JOIN purchase_orders po
            ON po.id = gr.purchase_order_id AND po.company_id = gr.company_id
          WHERE gr.status = 'POSTED'
            AND po.purchase_type IS NOT NULL
            AND gri.quantity > 0
            AND NOT EXISTS (
              SELECT 1 FROM supplier_payable_lines spl
              WHERE spl.goods_receipt_item_id = gri.id
                AND spl.company_id = gri.company_id
            )
          LIMIT 20`,
      },
      {
        name: 'orphan_payable_line_no_posted_grn_item',
        sql: prisma.$queryRaw`
          SELECT spl.id
          FROM supplier_payable_lines spl
          LEFT JOIN goods_receipt_items gri
            ON gri.id = spl.goods_receipt_item_id AND gri.company_id = spl.company_id
          LEFT JOIN goods_receipts gr
            ON gr.id = spl.goods_receipt_id AND gr.company_id = spl.company_id
          WHERE gri.id IS NULL
             OR gr.id IS NULL
             OR gr.status <> 'POSTED'
          LIMIT 20`,
      },
      {
        name: 'payable_movement_currency_mismatch',
        sql: prisma.$queryRaw`
          SELECT m.id
          FROM supplier_liability_movements m
          JOIN supplier_payables p
            ON p.id = m.payable_id AND p.company_id = m.company_id
          WHERE m.currency <> p.currency
          LIMIT 20`,
      },
      {
        name: 'payable_negative_outstanding',
        sql: prisma.$queryRaw`
          SELECT p.id,
            COALESCE(SUM(CASE WHEN m.direction = 'INCREASE' THEN m.amount ELSE 0 END), 0)
              - COALESCE(SUM(CASE WHEN m.direction = 'DECREASE' THEN m.amount ELSE 0 END), 0)
              AS outstanding
          FROM supplier_payables p
          LEFT JOIN supplier_liability_movements m
            ON m.payable_id = p.id AND m.company_id = p.company_id
          WHERE p.status <> 'CANCELLED'
          GROUP BY p.id
          HAVING COALESCE(SUM(CASE WHEN m.direction = 'INCREASE' THEN m.amount ELSE 0 END), 0)
               - COALESCE(SUM(CASE WHEN m.direction = 'DECREASE' THEN m.amount ELSE 0 END), 0) < 0
          LIMIT 20`,
      },
      {
        name: 'payable_outstanding_formula_inconsistent',
        sql: prisma.$queryRaw`
          SELECT p.id
          FROM supplier_payables p
          WHERE p.status <> 'CANCELLED'
            AND (
              COALESCE((
                SELECT SUM(m.amount) FROM supplier_liability_movements m
                WHERE m.payable_id = p.id AND m.company_id = p.company_id
                  AND m.direction = 'INCREASE'
              ), 0)
              -
              COALESCE((
                SELECT SUM(m.amount) FROM supplier_liability_movements m
                WHERE m.payable_id = p.id AND m.company_id = p.company_id
                  AND m.direction = 'DECREASE'
              ), 0)
            ) < 0
          LIMIT 20`,
      },
      {
        name: 'payable_cross_company',
        sql: prisma.$queryRaw`
          SELECT p.id FROM supplier_payables p
          JOIN suppliers s ON s.id = p.supplier_id
          WHERE s.company_id <> p.company_id
          UNION ALL
          SELECT spl.id FROM supplier_payable_lines spl
          JOIN supplier_payables p ON p.id = spl.payable_id
          WHERE p.company_id <> spl.company_id
          UNION ALL
          SELECT m.id FROM supplier_liability_movements m
          JOIN supplier_payables p ON p.id = m.payable_id
          WHERE m.payable_id IS NOT NULL AND p.company_id <> m.company_id
          UNION ALL
          SELECT a.id FROM supplier_payment_allocations a
          JOIN supplier_payables p ON p.id = a.payable_id
          WHERE p.company_id <> a.company_id
          LIMIT 20`,
      },
      {
        name: 'duplicate_payable_line_goods_receipt_item',
        sql: prisma.$queryRaw`
          SELECT goods_receipt_item_id, company_id, COUNT(*)::bigint AS n
          FROM supplier_payable_lines
          GROUP BY goods_receipt_item_id, company_id
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'payable_allocation_exceeds_recognized',
        sql: prisma.$queryRaw`
          SELECT p.id,
            COALESCE((
              SELECT SUM(m.amount) FROM supplier_liability_movements m
              WHERE m.payable_id = p.id AND m.company_id = p.company_id
                AND m.direction = 'INCREASE'
            ), 0) AS recognized,
            COALESCE((
              SELECT SUM(m.amount) FROM supplier_liability_movements m
              WHERE m.payable_id = p.id AND m.company_id = p.company_id
                AND m.direction = 'DECREASE'
                AND m.type = 'PAYMENT_ALLOCATION'
            ), 0) AS allocated
          FROM supplier_payables p
          WHERE COALESCE((
              SELECT SUM(m.amount) FROM supplier_liability_movements m
              WHERE m.payable_id = p.id AND m.company_id = p.company_id
                AND m.direction = 'DECREASE'
                AND m.type = 'PAYMENT_ALLOCATION'
            ), 0)
            >
            COALESCE((
              SELECT SUM(m.amount) FROM supplier_liability_movements m
              WHERE m.payable_id = p.id AND m.company_id = p.company_id
                AND m.direction = 'INCREASE'
            ), 0)
          LIMIT 20`,
      },
      {
        name: 'supplier_return_movement_missing_source_notes',
        sql: prisma.$queryRaw`
          SELECT m.id
          FROM supplier_liability_movements m
          WHERE m.type = 'SUPPLIER_RETURN'
            AND m.direction = 'DECREASE'
            AND (
              m.source_type IS NULL
              OR m.source_id IS NULL
              OR m.notes IS NULL
              OR btrim(m.notes) = ''
            )
          LIMIT 20`,
      },
      // --- Phase 4.5 FX + Currency ---
      {
        name: 'fx_rate_non_positive_or_same_currency',
        sql: prisma.$queryRaw`
          SELECT id FROM fx_rates
          WHERE rate <= 0 OR base_currency = quote_currency
          LIMIT 20`,
      },
      {
        name: 'fx_conversion_posted_missing_out_in_pair',
        sql: prisma.$queryRaw`
          SELECT c.id FROM fx_conversions c
          WHERE c.status = 'POSTED'
            AND c.reversal_of_id IS NULL
            AND (
              (SELECT COUNT(*) FROM financial_account_movements m
               WHERE m.company_id = c.company_id
                 AND m.source_type = 'FX_CONVERSION'
                 AND m.source_id = c.id
                 AND m.direction = 'OUT'
                 AND m.type = 'MONEY_OUT'
                 AND m.account_id = c.source_account_id
                 AND m.amount = c.from_amount
                 AND m.currency = c.from_currency) <> 1
              OR
              (SELECT COUNT(*) FROM financial_account_movements m
               WHERE m.company_id = c.company_id
                 AND m.source_type = 'FX_CONVERSION'
                 AND m.source_id = c.id
                 AND m.direction = 'IN'
                 AND m.type = 'MONEY_IN'
                 AND m.account_id = c.destination_account_id
                 AND m.amount = c.to_amount
                 AND m.currency = c.to_currency) <> 1
            )
          LIMIT 20`,
      },
      {
        name: 'fx_conversion_account_currency_mismatch',
        sql: prisma.$queryRaw`
          SELECT c.id FROM fx_conversions c
          JOIN financial_accounts s ON s.id = c.source_account_id AND s.company_id = c.company_id
          JOIN financial_accounts d ON d.id = c.destination_account_id AND d.company_id = c.company_id
          WHERE c.from_currency <> s.currency
             OR c.to_currency <> d.currency
             OR c.from_currency = c.to_currency
          LIMIT 20`,
      },
      {
        name: 'fx_conversion_missing_applied_rate_snapshot',
        sql: prisma.$queryRaw`
          SELECT id FROM fx_conversions
          WHERE applied_rate IS NULL
             OR applied_rate <= 0
             OR rate_base_currency IS NULL
             OR rate_quote_currency IS NULL
             OR rate_type <> 'CONVERSION'
             OR rate_base_currency = rate_quote_currency
          LIMIT 20`,
      },
      {
        name: 'fx_payable_loan_currency_preservation_sample',
        sql: prisma.$queryRaw`
          SELECT 'payable' AS kind, p.id::text AS id, p.currency::text AS currency
          FROM supplier_payables p
          WHERE p.currency = 'USD'
            AND EXISTS (
              SELECT 1 FROM supplier_liability_movements m
              WHERE m.payable_id = p.id AND m.company_id = p.company_id
                AND m.currency <> p.currency
            )
          UNION ALL
          SELECT 'loan' AS kind, l.id::text, l.currency::text
          FROM loans l
          WHERE l.currency = 'USD'
            AND (
              EXISTS (
                SELECT 1 FROM loan_disbursements d
                WHERE d.loan_id = l.id AND d.company_id = l.company_id
                  AND d.currency <> l.currency
              )
              OR EXISTS (
                SELECT 1 FROM loan_repayments r
                WHERE r.loan_id = l.id AND r.company_id = l.company_id
                  AND r.currency <> l.currency
              )
            )
          LIMIT 20`,
      },
      {
        name: 'fx_orphan_conversion_movement_source',
        sql: prisma.$queryRaw`
          SELECT m.id FROM financial_account_movements m
          WHERE m.source_type = 'FX_CONVERSION'
            AND (
              m.source_id IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM fx_conversions c
                WHERE c.id = m.source_id AND c.company_id = m.company_id
              )
            )
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
      console.log('Finance integrity: OK (0 violations)');
      process.exit(0);
    }

    console.error('Finance integrity: FAILED');
    for (const v of violations) {
      console.error(`- ${v.check}: ${v.count}`, JSON.stringify(v.sample, null, 2));
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
