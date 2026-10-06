/**
 * Read-only Finance integrity checks (Phase 4.12).
 *
 * Never mutates data. Callable from CLI (`pnpm finance:integrity` / `pnpm db:check:finance`)
 * and from e2e corruption detection.
 */
import type { PrismaClient } from './generated/prisma/client';

export type FinanceIntegrityViolation = {
  code: string;
  check: string;
  count: number;
  sample?: unknown;
};

export type FinanceIntegritySummary = {
  companies: number;
  accounts: number;
  movements: number;
  liabilities: number;
  settlements: number;
  journals: number;
  journalLines: number;
  loans: number;
  expenses: number;
  violations: FinanceIntegrityViolation[];
  status: 'OK' | 'FAILED';
};

function violationCode(check: string): string {
  return `FIN-INT-${check}`;
}

async function countTable(prisma: PrismaClient, table: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*)::bigint AS n FROM ${table}`,
  );
  return Number(rows[0]?.n ?? 0);
}

export async function runFinanceIntegrityChecks(
  prisma: PrismaClient,
): Promise<FinanceIntegritySummary> {
  const [
    companies,
    accounts,
    movements,
    liabilities,
    settlements,
    journals,
    journalLines,
    loans,
    expenses,
  ] = await Promise.all([
    countTable(prisma, 'companies'),
    countTable(prisma, 'financial_accounts'),
    countTable(prisma, 'financial_account_movements'),
    countTable(prisma, 'supplier_payables'),
    countTable(prisma, 'supplier_payment_allocations'),
    countTable(prisma, 'journal_entries'),
    countTable(prisma, 'journal_lines'),
    countTable(prisma, 'loans'),
    countTable(prisma, 'expenses'),
  ]);

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
      // --- Phase 4.6 Payments + Receipts ---
      {
        name: 'payment_missing_out_movement',
        sql: prisma.$queryRaw`
          SELECT p.id FROM payments p
          WHERE p.status = 'POSTED'
            AND p.reversal_of_id IS NULL
            AND (
              SELECT COUNT(*) FROM financial_account_movements m
              WHERE m.company_id = p.company_id
                AND m.source_type = 'PAYMENT'
                AND m.source_id = p.id
                AND m.direction = 'OUT'
                AND m.type = 'MONEY_OUT'
                AND m.amount = p.amount
                AND m.currency = p.currency
            ) <> 1
          LIMIT 20`,
      },
      {
        name: 'payment_currency_mismatch',
        sql: prisma.$queryRaw`
          SELECT p.id FROM payments p
          JOIN financial_accounts a ON a.id = p.account_id AND a.company_id = p.company_id
          WHERE p.currency <> a.currency
          LIMIT 20`,
      },
      {
        name: 'orphan_payment_movement_source',
        sql: prisma.$queryRaw`
          SELECT m.id FROM financial_account_movements m
          WHERE m.source_type = 'PAYMENT'
            AND (
              m.source_id IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM payments p
                WHERE p.id = m.source_id AND p.company_id = m.company_id
              )
            )
          LIMIT 20`,
      },
      {
        name: 'receipt_missing_in_movement',
        sql: prisma.$queryRaw`
          SELECT r.id FROM receipts r
          WHERE r.status = 'POSTED'
            AND r.reversal_of_id IS NULL
            AND (
              SELECT COUNT(*) FROM financial_account_movements m
              WHERE m.company_id = r.company_id
                AND m.source_type = 'RECEIPT'
                AND m.source_id = r.id
                AND m.direction = 'IN'
                AND m.type = 'MONEY_IN'
                AND m.amount = r.amount
                AND m.currency = r.currency
            ) <> 1
          LIMIT 20`,
      },
      {
        name: 'receipt_currency_mismatch',
        sql: prisma.$queryRaw`
          SELECT r.id FROM receipts r
          JOIN financial_accounts a ON a.id = r.account_id AND a.company_id = r.company_id
          WHERE r.currency <> a.currency
          LIMIT 20`,
      },
      {
        name: 'orphan_receipt_movement_source',
        sql: prisma.$queryRaw`
          SELECT m.id FROM financial_account_movements m
          WHERE m.source_type = 'RECEIPT'
            AND (
              m.source_id IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM receipts r
                WHERE r.id = m.source_id AND r.company_id = m.company_id
              )
            )
          LIMIT 20`,
      },
      {
        name: 'supplier_settlement_over_allocate_payment',
        sql: prisma.$queryRaw`
          SELECT p.id FROM payments p
          WHERE p.status = 'POSTED'
            AND (
              COALESCE((
                SELECT SUM(spa.payment_amount_applied)
                FROM supplier_payment_allocations spa
                WHERE spa.company_id = p.company_id
                  AND spa.payment_id = p.id
                  AND spa.status = 'POSTED'
              ), 0)
              +
              COALESCE((
                SELECT SUM(epa.amount)
                FROM expense_payment_allocations epa
                WHERE epa.company_id = p.company_id
                  AND epa.payment_id = p.id
                  AND epa.status = 'ACTIVE'
              ), 0)
            ) > p.amount
          LIMIT 20`,
      },
      {
        name: 'supplier_settlement_over_liability',
        sql: prisma.$queryRaw`
          SELECT p.id FROM supplier_payables p
          WHERE COALESCE((
              SELECT SUM(spa.liability_amount_settled)
              FROM supplier_payment_allocations spa
              WHERE spa.payable_id = p.id AND spa.company_id = p.company_id
                AND spa.status = 'POSTED'
            ), 0) > COALESCE((
              SELECT SUM(m.amount)
              FROM supplier_liability_movements m
              WHERE m.payable_id = p.id AND m.company_id = p.company_id
                AND m.direction = 'INCREASE'
                AND m.type <> 'REVERSAL'
            ), 0)
          LIMIT 20`,
      },
      {
        name: 'supplier_settlement_missing_journal',
        sql: prisma.$queryRaw`
          SELECT spa.id FROM supplier_payment_allocations spa
          WHERE spa.status = 'POSTED'
            AND spa.payment_id IS NOT NULL
            AND spa.settlement_group_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM journal_entries j
              WHERE j.company_id = spa.company_id
                AND j.source_type = 'SUPPLIER_PAYMENT_ALLOCATION'
                AND j.source_id = spa.id
                AND j.effect_type = 'SUPPLIER_AP_SETTLEMENT'
                AND j.status = 'POSTED'
            )
          LIMIT 20`,
      },
      {
        name: 'supplier_settlement_second_bank_credit',
        sql: prisma.$queryRaw`
          SELECT j.id FROM journal_entries j
          WHERE j.effect_type = 'SUPPLIER_AP_SETTLEMENT' AND j.status = 'POSTED'
            AND EXISTS (
              SELECT 1 FROM journal_lines l
              JOIN ledger_accounts a ON a.id = l.ledger_account_id AND a.company_id = l.company_id
              WHERE l.journal_entry_id = j.id AND l.company_id = j.company_id
                AND l.direction = 'CREDIT'
                AND a.system_key = 'CASH_AND_BANK'
            )
          LIMIT 20`,
      },
      {
        name: 'supplier_settlement_reversed_without_reversal_movement',
        sql: prisma.$queryRaw`
          SELECT spa.id FROM supplier_payment_allocations spa
          WHERE spa.status = 'REVERSED'
            AND NOT EXISTS (
              SELECT 1 FROM supplier_liability_movements m
              WHERE m.company_id = spa.company_id
                AND m.source_type = 'SUPPLIER_PAYMENT_ALLOCATION'
                AND m.source_id = spa.id
                AND m.type = 'REVERSAL'
                AND m.direction = 'INCREASE'
            )
          LIMIT 20`,
      },
      {
        name: 'duplicate_payment_source_movements',
        sql: prisma.$queryRaw`
          SELECT source_id, company_id, direction, COUNT(*)::bigint AS n
          FROM financial_account_movements
          WHERE source_type = 'PAYMENT' AND source_id IS NOT NULL
          GROUP BY source_id, company_id, direction, type
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'duplicate_receipt_source_movements',
        sql: prisma.$queryRaw`
          SELECT source_id, company_id, direction, COUNT(*)::bigint AS n
          FROM financial_account_movements
          WHERE source_type = 'RECEIPT' AND source_id IS NOT NULL
          GROUP BY source_id, company_id, direction, type
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'duplicate_account_transfer_source_movements',
        sql: prisma.$queryRaw`
          SELECT source_id, company_id, type, COUNT(*)::bigint AS n
          FROM financial_account_movements
          WHERE source_type = 'ACCOUNT_TRANSFER' AND source_id IS NOT NULL
          GROUP BY source_id, company_id, type, account_id
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'transfer_same_account',
        sql: prisma.$queryRaw`
          SELECT id FROM financial_account_transfers
          WHERE source_account_id = destination_account_id
          LIMIT 20`,
      },
      {
        name: 'payment_non_positive_amount',
        sql: prisma.$queryRaw`
          SELECT id FROM payments WHERE amount <= 0 LIMIT 20`,
      },
      {
        name: 'receipt_non_positive_amount',
        sql: prisma.$queryRaw`
          SELECT id FROM receipts WHERE amount <= 0 LIMIT 20`,
      },
      {
        name: 'payment_cross_company_account',
        sql: prisma.$queryRaw`
          SELECT p.id FROM payments p
          JOIN financial_accounts a ON a.id = p.account_id
          WHERE a.company_id <> p.company_id
          LIMIT 20`,
      },
      {
        name: 'receipt_cross_company_account',
        sql: prisma.$queryRaw`
          SELECT r.id FROM receipts r
          JOIN financial_accounts a ON a.id = r.account_id
          WHERE a.company_id <> r.company_id
          LIMIT 20`,
      },
      {
        name: 'payment_reversed_missing_provenance',
        sql: prisma.$queryRaw`
          SELECT p.id FROM payments p
          WHERE p.status = 'REVERSED'
            AND p.reversal_of_id IS NULL
            AND (
              p.reversed_at IS NULL
              OR p.reversed_by_id IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM payments rev
                WHERE rev.company_id = p.company_id
                  AND rev.reversal_of_id = p.id
              )
              OR (
                SELECT COUNT(*) FROM financial_account_movements m
                WHERE m.company_id = p.company_id
                  AND m.source_type = 'PAYMENT'
                  AND m.source_id = (
                    SELECT rev.id FROM payments rev
                    WHERE rev.company_id = p.company_id AND rev.reversal_of_id = p.id
                    LIMIT 1
                  )
                  AND m.type = 'REVERSAL'
                  AND m.direction = 'IN'
              ) <> 1
            )
          LIMIT 20`,
      },
      {
        name: 'receipt_reversed_missing_provenance',
        sql: prisma.$queryRaw`
          SELECT r.id FROM receipts r
          WHERE r.status = 'REVERSED'
            AND r.reversal_of_id IS NULL
            AND (
              r.reversed_at IS NULL
              OR r.reversed_by_id IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM receipts rev
                WHERE rev.company_id = r.company_id
                  AND rev.reversal_of_id = r.id
              )
              OR (
                SELECT COUNT(*) FROM financial_account_movements m
                WHERE m.company_id = r.company_id
                  AND m.source_type = 'RECEIPT'
                  AND m.source_id = (
                    SELECT rev.id FROM receipts rev
                    WHERE rev.company_id = r.company_id AND rev.reversal_of_id = r.id
                    LIMIT 1
                  )
                  AND m.type = 'REVERSAL'
                  AND m.direction = 'OUT'
              ) <> 1
            )
          LIMIT 20`,
      },
      {
        name: 'transfer_reversed_missing_provenance',
        sql: prisma.$queryRaw`
          SELECT t.id FROM financial_account_transfers t
          WHERE t.status = 'REVERSED'
            AND t.reversal_of_transfer_id IS NULL
            AND (
              t.reversed_at IS NULL
              OR t.reversed_by_id IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM financial_account_transfers rev
                WHERE rev.company_id = t.company_id
                  AND rev.reversal_of_transfer_id = t.id
              )
            )
          LIMIT 20`,
      },
      // Phase 4.7 — Expenses + purchase cost financialization
      {
        name: 'expense_over_allocated',
        sql: prisma.$queryRaw`
          SELECT e.id FROM expenses e
          WHERE (
            SELECT COALESCE(SUM(a.amount), 0) FROM expense_payment_allocations a
            WHERE a.company_id = e.company_id
              AND a.expense_id = e.id
              AND a.status = 'ACTIVE'
          ) > e.amount
          LIMIT 20`,
      },
      {
        name: 'expense_payment_status_mismatch',
        sql: prisma.$queryRaw`
          SELECT e.id FROM expenses e
          WHERE e.status <> 'CANCELLED'
            AND (
              (
                e.payment_status = 'UNPAID'
                AND EXISTS (
                  SELECT 1 FROM expense_payment_allocations a
                  WHERE a.company_id = e.company_id AND a.expense_id = e.id AND a.status = 'ACTIVE'
                )
              )
              OR (
                e.payment_status = 'PAID'
                AND (
                  SELECT COALESCE(SUM(a.amount), 0) FROM expense_payment_allocations a
                  WHERE a.company_id = e.company_id AND a.expense_id = e.id AND a.status = 'ACTIVE'
                ) < e.amount
              )
              OR (
                e.payment_status = 'PARTIALLY_PAID'
                AND (
                  SELECT COALESCE(SUM(a.amount), 0) FROM expense_payment_allocations a
                  WHERE a.company_id = e.company_id AND a.expense_id = e.id AND a.status = 'ACTIVE'
                ) NOT BETWEEN 0.000001 AND e.amount - 0.000001
              )
            )
          LIMIT 20`,
      },
      {
        name: 'expense_allocation_cross_currency',
        sql: prisma.$queryRaw`
          SELECT a.id FROM expense_payment_allocations a
          JOIN expenses e ON e.id = a.expense_id AND e.company_id = a.company_id
          JOIN payments p ON p.id = a.payment_id AND p.company_id = a.company_id
          WHERE a.status = 'ACTIVE'
            AND (a.currency <> e.currency OR a.currency <> p.currency)
          LIMIT 20`,
      },
      {
        name: 'expense_approved_has_cash_movement',
        sql: prisma.$queryRaw`
          SELECT e.id FROM expenses e
          WHERE EXISTS (
            SELECT 1 FROM financial_account_movements m
            WHERE m.company_id = e.company_id
              AND m.source_type = 'EXPENSE'
              AND m.source_id = e.id
          )
          LIMIT 20`,
      },
      {
        name: 'capitalizable_cost_has_expense',
        sql: prisma.$queryRaw`
          SELECT c.id FROM purchase_order_costs c
          WHERE c.treatment = 'CAPITALIZABLE' AND c.expense_id IS NOT NULL
          LIMIT 20`,
      },
      {
        name: 'period_expense_cost_missing_expense',
        sql: prisma.$queryRaw`
          SELECT c.id FROM purchase_order_costs c
          WHERE c.treatment = 'PERIOD_EXPENSE'
            AND c.status = 'ACTIVE'
            AND c.expense_id IS NULL
          LIMIT 20`,
      },
      {
        name: 'purchase_cost_allocation_sum_mismatch',
        sql: prisma.$queryRaw`
          SELECT c.id FROM purchase_order_costs c
          WHERE c.allocated_at IS NOT NULL
            AND (
              SELECT COALESCE(SUM(l.allocated_amount), 0)
              FROM purchase_cost_allocation_lines l
              WHERE l.company_id = c.company_id
                AND l.purchase_order_cost_id = c.id
            ) <> c.amount
          LIMIT 20`,
      },
      {
        name: 'expense_allocation_on_reversed_payment',
        sql: prisma.$queryRaw`
          SELECT a.id FROM expense_payment_allocations a
          JOIN payments p ON p.id = a.payment_id AND p.company_id = a.company_id
          WHERE a.status = 'ACTIVE' AND p.status = 'REVERSED'
          LIMIT 20`,
      },
      // Phase 4.8 — Journal / ledger integrity
      {
        name: 'journal_posted_unbalanced',
        sql: prisma.$queryRaw`
          SELECT j.id FROM journal_entries j
          WHERE j.status = 'POSTED'
            AND j.total_debit_base <> j.total_credit_base
          LIMIT 20`,
      },
      {
        name: 'journal_posted_zero_total',
        sql: prisma.$queryRaw`
          SELECT j.id FROM journal_entries j
          WHERE j.status IN ('POSTED', 'REVERSED')
            AND (j.total_debit_base = 0 OR j.total_credit_base = 0)
          LIMIT 20`,
      },
      {
        name: 'journal_posted_too_few_lines',
        sql: prisma.$queryRaw`
          SELECT j.id FROM journal_entries j
          WHERE j.status IN ('POSTED', 'REVERSED')
            AND (SELECT COUNT(*) FROM journal_lines l
                 WHERE l.journal_entry_id = j.id AND l.company_id = j.company_id) < 2
          LIMIT 20`,
      },
      {
        name: 'journal_duplicate_source_effect',
        sql: prisma.$queryRaw`
          SELECT company_id, source_type, source_id, effect_type, COUNT(*)::bigint AS n
          FROM journal_entries
          WHERE source_id IS NOT NULL
            AND status IN ('DRAFT', 'POSTED', 'REVERSED')
          GROUP BY company_id, source_type, source_id, effect_type
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'journal_duplicate_reversal',
        sql: prisma.$queryRaw`
          SELECT company_id, reversal_of_id, COUNT(*)::bigint AS n
          FROM journal_entries
          WHERE reversal_of_id IS NOT NULL
          GROUP BY company_id, reversal_of_id
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'journal_line_cross_company',
        sql: prisma.$queryRaw`
          SELECT l.id FROM journal_lines l
          JOIN journal_entries j ON j.id = l.journal_entry_id
          WHERE j.company_id <> l.company_id
          LIMIT 20`,
      },
      {
        name: 'journal_line_ledger_cross_company',
        sql: prisma.$queryRaw`
          SELECT l.id FROM journal_lines l
          JOIN ledger_accounts a ON a.id = l.ledger_account_id
          WHERE a.company_id <> l.company_id
          LIMIT 20`,
      },
      {
        name: 'trial_balance_debit_ne_credit',
        sql: prisma.$queryRaw`
          SELECT j.company_id,
            SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE 0 END) AS debits,
            SUM(CASE WHEN l.direction = 'CREDIT' THEN l.base_amount ELSE 0 END) AS credits
          FROM journal_lines l
          JOIN journal_entries j ON j.id = l.journal_entry_id AND j.company_id = l.company_id
          WHERE j.status = 'POSTED'
          GROUP BY j.company_id
          HAVING SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE 0 END)
               <> SUM(CASE WHEN l.direction = 'CREDIT' THEN l.base_amount ELSE 0 END)
          LIMIT 20`,
      },
      {
        name: 'capital_journal_not_equity',
        sql: prisma.$queryRaw`
          SELECT j.id FROM journal_entries j
          WHERE j.effect_type = 'CAPITAL_POST' AND j.status = 'POSTED'
            AND NOT EXISTS (
              SELECT 1 FROM journal_lines l
              JOIN ledger_accounts a ON a.id = l.ledger_account_id AND a.company_id = l.company_id
              WHERE l.journal_entry_id = j.id AND l.company_id = j.company_id
                AND l.direction = 'CREDIT' AND a.system_key = 'CAPITAL_EQUITY'
            )
          LIMIT 20`,
      },
      {
        name: 'loan_disburse_journal_not_liability',
        sql: prisma.$queryRaw`
          SELECT j.id FROM journal_entries j
          WHERE j.effect_type = 'LOAN_DISBURSE' AND j.status = 'POSTED'
            AND NOT EXISTS (
              SELECT 1 FROM journal_lines l
              JOIN ledger_accounts a ON a.id = l.ledger_account_id AND a.company_id = l.company_id
              WHERE l.journal_entry_id = j.id AND l.company_id = j.company_id
                AND l.direction = 'CREDIT' AND a.system_key = 'LOAN_PAYABLE'
            )
          LIMIT 20`,
      },
      {
        name: 'expense_recognition_settlement_double_expense',
        sql: prisma.$queryRaw`
          SELECT j.id FROM journal_entries j
          WHERE j.effect_type = 'EXPENSE_SETTLEMENT' AND j.status = 'POSTED'
            AND EXISTS (
              SELECT 1 FROM journal_lines l
              JOIN ledger_accounts a ON a.id = l.ledger_account_id AND a.company_id = l.company_id
              WHERE l.journal_entry_id = j.id AND l.company_id = j.company_id
                AND l.direction = 'DEBIT' AND a.type = 'EXPENSE'
            )
          LIMIT 20`,
      },
      // --- Phase 4.12 additions ---
      {
        name: 'movement_non_positive_amount',
        sql: prisma.$queryRaw`
          SELECT m.id FROM financial_account_movements m
          WHERE m.amount <= 0
          LIMIT 20`,
      },
      {
        name: 'journal_posted_missing_debit_or_credit_side',
        sql: prisma.$queryRaw`
          SELECT j.id FROM journal_entries j
          WHERE j.status = 'POSTED'
            AND (
              (SELECT COUNT(*) FROM journal_lines l
               WHERE l.journal_entry_id = j.id AND l.company_id = j.company_id
                 AND l.direction = 'DEBIT') < 1
              OR
              (SELECT COUNT(*) FROM journal_lines l
               WHERE l.journal_entry_id = j.id AND l.company_id = j.company_id
                 AND l.direction = 'CREDIT') < 1
            )
          LIMIT 20`,
      },
      {
        name: 'journal_header_totals_vs_lines',
        sql: prisma.$queryRaw`
          SELECT j.id FROM journal_entries j
          WHERE j.status = 'POSTED'
            AND (
              j.total_debit_base <> COALESCE((
                SELECT SUM(l.base_amount) FROM journal_lines l
                WHERE l.journal_entry_id = j.id AND l.company_id = j.company_id
                  AND l.direction = 'DEBIT'
              ), 0)
              OR
              j.total_credit_base <> COALESCE((
                SELECT SUM(l.base_amount) FROM journal_lines l
                WHERE l.journal_entry_id = j.id AND l.company_id = j.company_id
                  AND l.direction = 'CREDIT'
              ), 0)
            )
          LIMIT 20`,
      },
      {
        name: 'journal_totals_mismatch_lines',
        sql: prisma.$queryRaw`
          SELECT j.id FROM journal_entries j
          WHERE j.status = 'POSTED'
            AND (
              j.total_debit_base <> COALESCE((
                SELECT SUM(l.base_amount) FROM journal_lines l
                WHERE l.journal_entry_id = j.id AND l.company_id = j.company_id
                  AND l.direction = 'DEBIT'
              ), 0)
              OR
              j.total_credit_base <> COALESCE((
                SELECT SUM(l.base_amount) FROM journal_lines l
                WHERE l.journal_entry_id = j.id AND l.company_id = j.company_id
                  AND l.direction = 'CREDIT'
              ), 0)
            )
          LIMIT 20`,
      },
      {
        name: 'posted_payment_missing_journal',
        sql: prisma.$queryRaw`
          SELECT p.id FROM payments p
          WHERE p.status = 'POSTED'
            AND p.reversal_of_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM journal_entries j
              WHERE j.company_id = p.company_id
                AND j.source_type = 'PAYMENT'
                AND j.source_id = p.id
                AND j.effect_type = 'PAYMENT_CLEARING'
                AND j.status IN ('POSTED', 'REVERSED')
            )
          LIMIT 20`,
      },
      {
        name: 'posted_receipt_missing_journal',
        sql: prisma.$queryRaw`
          SELECT r.id FROM receipts r
          WHERE r.status = 'POSTED'
            AND r.reversal_of_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM journal_entries j
              WHERE j.company_id = r.company_id
                AND j.source_type = 'RECEIPT'
                AND j.source_id = r.id
                AND j.effect_type = 'RECEIPT_CLEARING'
                AND j.status IN ('POSTED', 'REVERSED')
            )
          LIMIT 20`,
      },
      {
        name: 'cross_currency_settlement_missing_fx_snapshot',
        sql: prisma.$queryRaw`
          SELECT spa.id FROM supplier_payment_allocations spa
          JOIN supplier_payables p
            ON p.id = spa.payable_id AND p.company_id = spa.company_id
          WHERE spa.status = 'POSTED'
            AND spa.payment_currency <> p.currency
            AND (
              spa.settlement_rate IS NULL
              OR spa.settlement_rate_base_currency IS NULL
              OR spa.settlement_rate_quote_currency IS NULL
            )
          LIMIT 20`,
      },
  ];

  const violations: FinanceIntegrityViolation[] = [];
  for (const check of checks) {
    const rows = await check.sql;
    if (rows.length > 0) {
      violations.push({
        code: violationCode(check.name),
        check: check.name,
        count: rows.length,
        sample: rows,
      });
    }
  }

  return {
    companies,
    accounts,
    movements,
    liabilities,
    settlements,
    journals,
    journalLines,
    loans,
    expenses,
    violations,
    status: violations.length === 0 ? 'OK' : 'FAILED',
  };
}

/** CLI-oriented report lines (no side effects). */
export function formatFinanceIntegrityReport(summary: FinanceIntegritySummary): string {
  const lines = [
    'Finance Integrity Check',
    `Companies checked: ${summary.companies}`,
    `Accounts checked: ${summary.accounts}`,
    `Movements checked: ${summary.movements}`,
    `Liabilities checked: ${summary.liabilities}`,
    `Settlements checked: ${summary.settlements}`,
    `Journals checked: ${summary.journals}`,
    `Journal lines checked: ${summary.journalLines}`,
    `Loans checked: ${summary.loans}`,
    `Expenses checked: ${summary.expenses}`,
    `Violations: ${summary.violations.length}`,
    `STATUS: ${summary.status}`,
  ];
  if (summary.violations.length > 0) {
    lines.push('');
    for (const v of summary.violations) {
      lines.push(`${v.code} count=${v.count}`);
      lines.push(JSON.stringify(v.sample, null, 2));
    }
  }
  return lines.join('\n');
}
