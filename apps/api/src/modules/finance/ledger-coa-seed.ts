import {
  CurrencyCode,
  LedgerAccountKind,
  LedgerAccountStatus,
  LedgerAccountType,
  Prisma,
} from '@hector/database';
import { LEDGER_SYSTEM_KEYS } from './finance-journals.constants';

type Db = {
  ledgerAccount: Prisma.TransactionClient['ledgerAccount'];
  financialAccount: Prisma.TransactionClient['financialAccount'];
  expenseCategory: Prisma.TransactionClient['expenseCategory'];
  company: Prisma.TransactionClient['company'];
};

const SYSTEM_COA: Array<{
  systemKey: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  parentSystemKey?: string;
  description: string;
}> = [
  {
    systemKey: LEDGER_SYSTEM_KEYS.CASH_AND_BANK,
    code: '1000',
    name: 'Cash and Bank',
    type: LedgerAccountType.ASSET,
    description: 'Parent for financial cash/bank/wallet accounts',
  },
  {
    systemKey: LEDGER_SYSTEM_KEYS.INVENTORY,
    code: '1200',
    name: 'Inventory Asset',
    type: LedgerAccountType.ASSET,
    description: 'Inventory asset (AP recognition DR at GRN post)',
  },
  {
    systemKey: LEDGER_SYSTEM_KEYS.SUPPLIER_PAYABLE,
    code: '2100',
    name: 'Supplier Payable',
    type: LedgerAccountType.LIABILITY,
    description: 'Accounts payable to suppliers',
  },
  {
    systemKey: LEDGER_SYSTEM_KEYS.CUSTOMER_RECEIVABLE,
    code: '1100',
    name: 'Customer Receivable',
    type: LedgerAccountType.ASSET,
    description: 'Accounts receivable from customers (sales recognition)',
  },
  {
    systemKey: LEDGER_SYSTEM_KEYS.CHANNEL_RECEIVABLE,
    code: '1110',
    name: 'Channel Receivable',
    type: LedgerAccountType.ASSET,
    description: 'Marketplace/channel clearing receivable (not bank cash)',
  },
  {
    systemKey: LEDGER_SYSTEM_KEYS.LOAN_PAYABLE,
    code: '2200',
    name: 'Loan Payable',
    type: LedgerAccountType.LIABILITY,
    description: 'Loan principal liability (never Equity)',
  },
  {
    systemKey: LEDGER_SYSTEM_KEYS.EXPENSE_PAYABLE,
    code: '2300',
    name: 'Expense Payable',
    type: LedgerAccountType.LIABILITY,
    description: 'Accrued unpaid expenses',
  },
  {
    systemKey: LEDGER_SYSTEM_KEYS.FINANCE_CLEARING,
    code: '2400',
    name: 'Finance Clearing',
    type: LedgerAccountType.LIABILITY,
    description: 'Clearing for unclassified / capitalizable cost cash side',
  },
  {
    systemKey: LEDGER_SYSTEM_KEYS.UNCLASSIFIED_PAYMENTS,
    code: '2410',
    name: 'Unclassified Payments',
    type: LedgerAccountType.LIABILITY,
    parentSystemKey: LEDGER_SYSTEM_KEYS.FINANCE_CLEARING,
    description: 'Generic payment clearing — never Expense',
  },
  {
    systemKey: LEDGER_SYSTEM_KEYS.UNCLASSIFIED_RECEIPTS,
    code: '2420',
    name: 'Unclassified Receipts',
    type: LedgerAccountType.LIABILITY,
    parentSystemKey: LEDGER_SYSTEM_KEYS.FINANCE_CLEARING,
    description: 'Generic receipt clearing — never Revenue',
  },
  {
    systemKey: LEDGER_SYSTEM_KEYS.CAPITAL_EQUITY,
    code: '3000',
    name: 'Capital Equity',
    type: LedgerAccountType.EQUITY,
    description: 'Owner/partner capital contributions',
  },
  {
    systemKey: LEDGER_SYSTEM_KEYS.OPERATING_EXPENSE,
    code: '5000',
    name: 'Operating Expense',
    type: LedgerAccountType.EXPENSE,
    description: 'Default operating expense P&L',
  },
  {
    systemKey: LEDGER_SYSTEM_KEYS.FX_GAIN,
    code: '7100',
    name: 'FX Gain',
    type: LedgerAccountType.REVENUE,
    description: 'Reserved FX gain (no auto engine in 4.8)',
  },
  {
    systemKey: LEDGER_SYSTEM_KEYS.FX_LOSS,
    code: '7200',
    name: 'FX Loss',
    type: LedgerAccountType.EXPENSE,
    description: 'Reserved FX loss (no auto engine in 4.8)',
  },
  {
    systemKey: LEDGER_SYSTEM_KEYS.REVENUE_FOUNDATION,
    code: '4000',
    name: 'Revenue Foundation',
    type: LedgerAccountType.REVENUE,
    description: 'Placeholder revenue CoA (no sales engine yet)',
  },
];

/**
 * Idempotent minimal Chart of Accounts + FinancialAccount / ExpenseCategory mapping.
 */
export async function ensureCompanyChartOfAccounts(
  db: Db,
  companyId: string,
  actorUserId?: string | null,
): Promise<void> {
  const byKey = new Map<string, string>();

  // Parents first (no parentSystemKey), then children.
  const ordered = [
    ...SYSTEM_COA.filter((a) => !a.parentSystemKey),
    ...SYSTEM_COA.filter((a) => a.parentSystemKey),
  ];

  for (const def of ordered) {
    const existing = await db.ledgerAccount.findFirst({
      where: { companyId, systemKey: def.systemKey },
    });
    if (existing) {
      byKey.set(def.systemKey, existing.id);
      continue;
    }
    const parentId = def.parentSystemKey
      ? byKey.get(def.parentSystemKey) ?? null
      : null;
    const created = await db.ledgerAccount.create({
      data: {
        companyId,
        code: def.code,
        name: def.name,
        type: def.type,
        systemKey: def.systemKey,
        kind: LedgerAccountKind.SYSTEM,
        status: LedgerAccountStatus.ACTIVE,
        parentId,
        description: def.description,
        createdById: actorUserId ?? null,
      },
    });
    byKey.set(def.systemKey, created.id);
  }

  // Map FinancialAccounts under CASH_AND_BANK.
  const cashParentId = byKey.get(LEDGER_SYSTEM_KEYS.CASH_AND_BANK);
  if (cashParentId) {
    const accounts = await db.financialAccount.findMany({
      where: { companyId, ledgerAccountId: null },
    });
    for (const account of accounts) {
      const code = `CASH-${account.code}`.slice(0, 64);
      let child = await db.ledgerAccount.findFirst({
        where: { companyId, code },
      });
      if (!child) {
        child = await db.ledgerAccount.create({
          data: {
            companyId,
            code,
            name: account.name,
            type: LedgerAccountType.ASSET,
            kind: LedgerAccountKind.USER_DEFINED,
            status: LedgerAccountStatus.ACTIVE,
            parentId: cashParentId,
            description: `Mapped from FinancialAccount ${account.code}`,
            createdById: actorUserId ?? null,
          },
        });
      }
      await db.financialAccount.update({
        where: { id: account.id },
        data: { ledgerAccountId: child.id },
      });
    }
  }

  // Map expense categories → OPERATING_EXPENSE (or per-category child).
  const expenseParentId = byKey.get(LEDGER_SYSTEM_KEYS.OPERATING_EXPENSE);
  if (expenseParentId) {
    const categories = await db.expenseCategory.findMany({
      where: { companyId, ledgerAccountId: null },
    });
    for (const cat of categories) {
      const code = `EXP-${cat.code}`.slice(0, 64);
      let child = await db.ledgerAccount.findFirst({
        where: { companyId, code },
      });
      if (!child) {
        child = await db.ledgerAccount.create({
          data: {
            companyId,
            code,
            name: cat.name,
            type: LedgerAccountType.EXPENSE,
            kind: LedgerAccountKind.USER_DEFINED,
            status: LedgerAccountStatus.ACTIVE,
            parentId: expenseParentId,
            description: `Mapped from ExpenseCategory ${cat.code}`,
            createdById: actorUserId ?? null,
          },
        });
      }
      await db.expenseCategory.update({
        where: { id: cat.id },
        data: { ledgerAccountId: child.id },
      });
    }
  }

  // Touch company base currency presence (no-op validation).
  await db.company.findFirstOrThrow({
    where: { id: companyId },
    select: { baseCurrency: true },
  });
}

/** Seed helper: ensure CoA for all companies (or one). */
export async function seedChartOfAccountsForCompanies(
  db: Db,
  companyIds?: string[],
): Promise<void> {
  const companies =
    companyIds && companyIds.length > 0
      ? companyIds.map((id) => ({ id }))
      : await db.company.findMany({ select: { id: true } });
  for (const company of companies) {
    await ensureCompanyChartOfAccounts(db, company.id);
  }
}

export type { CurrencyCode };
