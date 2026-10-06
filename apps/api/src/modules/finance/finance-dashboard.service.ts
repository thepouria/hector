import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  ExpensePaymentAllocationStatus,
  ExpenseStatus,
  FinancialAccountType,
  LoanDisbursementStatus,
  LoanRepaymentStatus,
  PaymentStatus,
  PERMISSIONS,
  Prisma,
  ReceiptStatus,
  SupplierLiabilityMovementDirection,
  SupplierPayableStatus,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { prismaUserDisplayName } from '../../common/utils/prisma-user-display';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { CompanyContext } from '../companies/types/company.types';
import { toUtcBusinessDate } from '../purchasing/purchase-order-due';
import type { FinanceDashboardQueryDto } from './dto/finance-dashboard.query.dto';
import { FINANCE_AUDIT_ENTITY_TYPES } from './finance-audit.constants';
import {
  DASHBOARD_ACTIVITY_LIMIT,
  DASHBOARD_DUE_LIST_LIMIT,
  DASHBOARD_MAX_RANGE_DAYS,
  DASHBOARD_TOP_SUPPLIER_LIMIT,
  FINANCE_LIABILITY_DUE_SOON_DAYS,
  addCurrencyDecimal,
  currencyDecimalMapToRows,
  financeTrendBucketKey,
  resolveFinanceDashboardRange,
  type ResolvedFinanceDashboardRange,
} from './finance-dashboard.metrics';

type PermissionSet = Set<string>;

type MoneyRow = { currency: string; amount: string };

type AccountTypeBalance = {
  currency: string;
  type: FinancialAccountType;
  balance: string;
  accountCount: number;
};

type DueItem = {
  type: 'SUPPLIER_PAYABLE' | 'LOAN' | 'EXPENSE';
  counterparty: string;
  reference: string | null;
  number: string;
  dueDate: string;
  outstanding: string;
  currency: string;
  id: string;
};

type TopSupplierRow = {
  currency: string;
  supplierId: string;
  supplierName: string;
  outstanding: string;
};

type ActivityItem = {
  occurredAt: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  reference?: string;
  amount?: string;
  currency?: string;
};

type TrendPoint = {
  bucket: string;
  moneyIn: string;
  moneyOut: string;
};

function toPermissionSet(permissions: Set<string> | string[]): PermissionSet {
  return permissions instanceof Set ? permissions : new Set(permissions);
}

function has(perms: PermissionSet, key: string): boolean {
  return perms.has(key);
}

@Injectable()
export class FinanceDashboardService {
  constructor(private readonly database: DatabaseService) {}

  async getDashboard(
    company: CompanyContext,
    query: FinanceDashboardQueryDto,
    permissions: Set<string> | string[],
  ) {
    const perms = toPermissionSet(permissions);
    const companyId = company.companyId;

    let range: ResolvedFinanceDashboardRange;
    try {
      range = resolveFinanceDashboardRange({
        range: query.range,
        from: query.from,
        to: query.to,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'INVALID_DATE_RANGE';
      if (message === 'DATE_RANGE_TOO_LARGE') {
        throw new AppError({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `Date range cannot exceed ${DASHBOARD_MAX_RANGE_DAYS} days.`,
          statusCode: 400,
        });
      }
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message:
          message === 'CUSTOM_RANGE_REQUIRES_FROM_TO'
            ? 'Custom range requires both from and to.'
            : 'Invalid dashboard date range.',
        statusCode: 400,
      });
    }

    const companyRow = await this.database.client.company.findFirstOrThrow({
      where: { id: companyId },
      select: { baseCurrency: true },
    });

    const now = new Date();
    const today = toUtcBusinessDate(now);
    const todayStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0),
    );
    const dueSoonEnd = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() + FINANCE_LIABILITY_DUE_SOON_DAYS,
        23,
        59,
        59,
        999,
      ),
    );

    const canAccounts = has(perms, PERMISSIONS.FINANCE_ACCOUNTS_READ);
    const canPayables = has(perms, PERMISSIONS.FINANCE_PAYABLES_READ);
    const canLoans = has(perms, PERMISSIONS.FINANCE_LOANS_READ);
    const canExpenses = has(perms, PERMISSIONS.FINANCE_EXPENSES_READ);
    const canPayments = has(perms, PERMISSIONS.FINANCE_PAYMENTS_READ);
    const canReceipts = has(perms, PERMISSIONS.FINANCE_RECEIPTS_READ);
    const canAudit =
      has(perms, PERMISSIONS.FINANCE_AUDIT_READ) || has(perms, PERMISSIONS.AUDIT_READ);

    const snapshot: Record<string, unknown> = {};
    const periodMetrics: Record<string, unknown> = {};

    if (canAccounts) {
      snapshot.accountsByCurrency = await this.accountsByCurrency(companyId);
    }
    if (canPayables) {
      const payables = await this.supplierPayablesSnapshot(companyId, todayStart, dueSoonEnd);
      snapshot.supplierPayablesByCurrency = payables.byCurrency;
      snapshot.topSuppliers = payables.topSuppliers;
    }
    if (canLoans) {
      snapshot.loansByCurrency = await this.loansByCurrency(companyId);
    }
    if (canExpenses) {
      snapshot.expenseOutstandingByCurrency = await this.expenseOutstandingByCurrency(companyId);
    }

    const dueLists = await this.buildDueLists({
      companyId,
      todayStart,
      dueSoonEnd,
      includePayables: canPayables,
      includeLoans: canLoans,
      includeExpenses: canExpenses,
    });
    if (canPayables || canLoans || canExpenses) {
      snapshot.dueSoon = dueLists.dueSoon;
      snapshot.overdue = dueLists.overdue;
    }

    if (canReceipts) {
      periodMetrics.moneyInByCurrency = await this.moneyInByCurrency(
        companyId,
        range.from,
        range.to,
      );
    }
    if (canPayments) {
      periodMetrics.moneyOutByCurrency = await this.moneyOutByCurrency(
        companyId,
        range.from,
        range.to,
      );
    }
    if (canExpenses) {
      periodMetrics.expensesRecordedByCurrency = await this.expensesRecordedByCurrency(
        companyId,
        range.from,
        range.to,
      );
      periodMetrics.expensesByCategory = await this.expensesByCategory(
        companyId,
        range.from,
        range.to,
      );
    }

    const chartCurrency = await this.resolveChartCurrency(
      companyId,
      query.chartCurrency,
      companyRow.baseCurrency,
      canReceipts,
      canPayments,
    );

    if (canReceipts || canPayments) {
      periodMetrics.cashMovementTrend = await this.cashMovementTrend(
        companyId,
        range,
        chartCurrency,
        canReceipts,
        canPayments,
      );
    }

    let recentActivity: ActivityItem[] | undefined;
    if (canAudit) {
      recentActivity = await this.recentActivity(companyId);
    }

    return {
      asOf: now.toISOString(),
      period: {
        preset: range.preset,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        dayCount: range.dayCount,
        granularity: range.granularity,
      },
      snapshot,
      periodMetrics,
      ...(recentActivity !== undefined ? { recentActivity } : {}),
      chartCurrency,
      semantics: {
        moneyInIsNotRevenue: true,
        moneyOutIsNotExpense: true,
        cashMovementIsNotProfit: true,
        internalTransfersExcludedFromMoneyInOut: true,
      },
    };
  }

  private async accountsByCurrency(companyId: string): Promise<AccountTypeBalance[]> {
    const rows = await this.database.client.$queryRaw<
      Array<{
        currency: CurrencyCode;
        type: FinancialAccountType;
        balance: string | Prisma.Decimal;
        account_count: bigint;
      }>
    >(Prisma.sql`
      SELECT a.currency, a.type,
        COALESCE(SUM(
          CASE
            WHEN m.direction = 'IN' THEN m.amount
            WHEN m.direction = 'OUT' THEN -m.amount
            ELSE 0
          END
        ), 0)::text AS balance,
        COUNT(DISTINCT a.id) AS account_count
      FROM financial_accounts a
      LEFT JOIN financial_account_movements m
        ON m.account_id = a.id AND m.company_id = a.company_id
      WHERE a.company_id = ${companyId}::uuid
        AND a.status = 'ACTIVE'
      GROUP BY a.currency, a.type
      ORDER BY a.currency, a.type
    `);

    return rows
      .filter((row) => !new Prisma.Decimal(row.balance).eq(0) || Number(row.account_count) > 0)
      .map((row) => ({
        currency: row.currency,
        type: row.type,
        balance: new Prisma.Decimal(row.balance).toFixed(),
        accountCount: Number(row.account_count),
      }));
  }

  private async supplierPayablesSnapshot(
    companyId: string,
    _todayStart: Date,
    _dueSoonEnd: Date,
  ): Promise<{ byCurrency: MoneyRow[]; topSuppliers: TopSupplierRow[] }> {
    const payables = await this.database.client.supplierPayable.findMany({
      where: {
        companyId,
        status: { not: SupplierPayableStatus.CANCELLED },
      },
      select: {
        id: true,
        currency: true,
        supplierId: true,
        supplier: { select: { id: true, name: true } },
        movements: {
          select: {
            direction: true,
            amount: true,
          },
        },
      },
    });

    const byCurrency = new Map<string, Prisma.Decimal>();
    const bySupplierCurrency = new Map<
      string,
      { supplierId: string; supplierName: string; currency: string; outstanding: Prisma.Decimal }
    >();

    for (const payable of payables) {
      let outstanding = new Prisma.Decimal(0);
      for (const m of payable.movements) {
        if (m.direction === SupplierLiabilityMovementDirection.INCREASE) {
          outstanding = outstanding.plus(m.amount);
        } else {
          outstanding = outstanding.minus(m.amount);
        }
      }
      if (outstanding.lte(0)) continue;
      addCurrencyDecimal(byCurrency, payable.currency, outstanding);
      const key = `${payable.currency}:${payable.supplierId}`;
      const prev = bySupplierCurrency.get(key);
      if (prev) {
        prev.outstanding = prev.outstanding.plus(outstanding);
      } else {
        bySupplierCurrency.set(key, {
          supplierId: payable.supplierId,
          supplierName: payable.supplier.name,
          currency: payable.currency,
          outstanding,
        });
      }
    }

    const topSuppliers: TopSupplierRow[] = [];
    const byCurrencyGroups = new Map<string, typeof bySupplierCurrency extends Map<string, infer V> ? V[] : never>();
    for (const row of bySupplierCurrency.values()) {
      const list = byCurrencyGroups.get(row.currency) ?? [];
      list.push(row);
      byCurrencyGroups.set(row.currency, list);
    }
    for (const [, list] of [...byCurrencyGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      list
        .sort((a, b) => b.outstanding.comparedTo(a.outstanding))
        .slice(0, DASHBOARD_TOP_SUPPLIER_LIMIT)
        .forEach((row) => {
          topSuppliers.push({
            currency: row.currency,
            supplierId: row.supplierId,
            supplierName: row.supplierName,
            outstanding: row.outstanding.toFixed(),
          });
        });
    }

    return {
      byCurrency: currencyDecimalMapToRows(byCurrency),
      topSuppliers,
    };
  }

  private async loansByCurrency(companyId: string): Promise<MoneyRow[]> {
    const loans = await this.database.client.loan.findMany({
      where: { companyId },
      select: {
        currency: true,
        disbursements: {
          where: { status: LoanDisbursementStatus.POSTED, reversalOfId: null },
          select: { amount: true },
        },
        repayments: {
          where: { status: LoanRepaymentStatus.POSTED, reversalOfId: null },
          select: { principalAmount: true },
        },
      },
    });

    const map = new Map<string, Prisma.Decimal>();
    for (const loan of loans) {
      const received = loan.disbursements.reduce(
        (sum, d) => sum.plus(d.amount),
        new Prisma.Decimal(0),
      );
      const repaid = loan.repayments.reduce(
        (sum, r) => sum.plus(r.principalAmount),
        new Prisma.Decimal(0),
      );
      const outstanding = received.minus(repaid);
      if (outstanding.lte(0)) continue;
      addCurrencyDecimal(map, loan.currency, outstanding);
    }
    return currencyDecimalMapToRows(map);
  }

  private async expenseOutstandingByCurrency(companyId: string): Promise<MoneyRow[]> {
    const expenses = await this.database.client.expense.findMany({
      where: {
        companyId,
        status: ExpenseStatus.APPROVED,
        paymentStatus: { not: 'PAID' },
      },
      select: {
        currency: true,
        amount: true,
        paymentAllocations: {
          where: { status: ExpensePaymentAllocationStatus.ACTIVE },
          select: { amount: true },
        },
      },
    });

    const map = new Map<string, Prisma.Decimal>();
    for (const expense of expenses) {
      const paid = expense.paymentAllocations.reduce(
        (sum, a) => sum.plus(a.amount),
        new Prisma.Decimal(0),
      );
      const outstanding = expense.amount.sub(paid);
      if (outstanding.lte(0)) continue;
      addCurrencyDecimal(map, expense.currency, outstanding);
    }
    return currencyDecimalMapToRows(map);
  }

  private async buildDueLists(args: {
    companyId: string;
    todayStart: Date;
    dueSoonEnd: Date;
    includePayables: boolean;
    includeLoans: boolean;
    includeExpenses: boolean;
  }): Promise<{ dueSoon: DueItem[]; overdue: DueItem[] }> {
    const candidates: Array<DueItem & { outstandingDec: Prisma.Decimal }> = [];

    if (args.includePayables) {
      const payables = await this.database.client.supplierPayable.findMany({
        where: {
          companyId: args.companyId,
          status: { not: SupplierPayableStatus.CANCELLED },
          dueDate: { not: null },
        },
        select: {
          id: true,
          number: true,
          reference: true,
          currency: true,
          dueDate: true,
          supplier: { select: { name: true } },
          movements: { select: { direction: true, amount: true } },
        },
        take: 500,
      });
      for (const p of payables) {
        if (!p.dueDate) continue;
        let outstanding = new Prisma.Decimal(0);
        for (const m of p.movements) {
          if (m.direction === SupplierLiabilityMovementDirection.INCREASE) {
            outstanding = outstanding.plus(m.amount);
          } else {
            outstanding = outstanding.minus(m.amount);
          }
        }
        if (outstanding.lte(0)) continue;
        candidates.push({
          type: 'SUPPLIER_PAYABLE',
          counterparty: p.supplier.name,
          reference: p.reference,
          number: p.number,
          dueDate: p.dueDate.toISOString(),
          outstanding: outstanding.toFixed(),
          currency: p.currency,
          id: p.id,
          outstandingDec: outstanding,
        });
      }
    }

    if (args.includeLoans) {
      const loans = await this.database.client.loan.findMany({
        where: {
          companyId: args.companyId,
          dueDate: { not: null },
        },
        select: {
          id: true,
          number: true,
          reference: true,
          currency: true,
          dueDate: true,
          lenderName: true,
          disbursements: {
            where: { status: LoanDisbursementStatus.POSTED, reversalOfId: null },
            select: { amount: true },
          },
          repayments: {
            where: { status: LoanRepaymentStatus.POSTED, reversalOfId: null },
            select: { principalAmount: true },
          },
        },
        take: 500,
      });
      for (const loan of loans) {
        if (!loan.dueDate) continue;
        const received = loan.disbursements.reduce(
          (sum, d) => sum.plus(d.amount),
          new Prisma.Decimal(0),
        );
        const repaid = loan.repayments.reduce(
          (sum, r) => sum.plus(r.principalAmount),
          new Prisma.Decimal(0),
        );
        const outstanding = received.minus(repaid);
        if (outstanding.lte(0)) continue;
        candidates.push({
          type: 'LOAN',
          counterparty: loan.lenderName,
          reference: loan.reference,
          number: loan.number,
          dueDate: loan.dueDate.toISOString(),
          outstanding: outstanding.toFixed(),
          currency: loan.currency,
          id: loan.id,
          outstandingDec: outstanding,
        });
      }
    }

    if (args.includeExpenses) {
      const expenses = await this.database.client.expense.findMany({
        where: {
          companyId: args.companyId,
          status: ExpenseStatus.APPROVED,
          paymentStatus: { not: 'PAID' },
          dueDate: { not: null },
        },
        select: {
          id: true,
          number: true,
          reference: true,
          currency: true,
          dueDate: true,
          counterpartyName: true,
          amount: true,
          paymentAllocations: {
            where: { status: ExpensePaymentAllocationStatus.ACTIVE },
            select: { amount: true },
          },
        },
        take: 500,
      });
      for (const expense of expenses) {
        if (!expense.dueDate) continue;
        const paid = expense.paymentAllocations.reduce(
          (sum, a) => sum.plus(a.amount),
          new Prisma.Decimal(0),
        );
        const outstanding = expense.amount.sub(paid);
        if (outstanding.lte(0)) continue;
        candidates.push({
          type: 'EXPENSE',
          counterparty: expense.counterpartyName ?? '—',
          reference: expense.reference,
          number: expense.number,
          dueDate: expense.dueDate.toISOString(),
          outstanding: outstanding.toFixed(),
          currency: expense.currency,
          id: expense.id,
          outstandingDec: outstanding,
        });
      }
    }

    const dueSoon: DueItem[] = [];
    const overdue: DueItem[] = [];
    for (const item of candidates) {
      const due = new Date(item.dueDate);
      const { outstandingDec: _, ...rest } = item;
      if (due < args.todayStart) {
        overdue.push(rest);
      } else if (due >= args.todayStart && due <= args.dueSoonEnd) {
        dueSoon.push(rest);
      }
    }

    const sortByDue = (a: DueItem, b: DueItem) =>
      new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    overdue.sort(sortByDue);
    dueSoon.sort(sortByDue);

    return {
      dueSoon: dueSoon.slice(0, DASHBOARD_DUE_LIST_LIMIT),
      overdue: overdue.slice(0, DASHBOARD_DUE_LIST_LIMIT),
    };
  }

  private async moneyInByCurrency(
    companyId: string,
    from: Date,
    to: Date,
  ): Promise<MoneyRow[]> {
    const rows = await this.database.client.receipt.groupBy({
      by: ['currency'],
      where: {
        companyId,
        status: ReceiptStatus.POSTED,
        effectiveAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
    });
    return rows
      .filter((r) => r._sum.amount && !r._sum.amount.eq(0))
      .map((r) => ({
        currency: r.currency,
        amount: (r._sum.amount ?? new Prisma.Decimal(0)).toFixed(),
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
  }

  private async moneyOutByCurrency(
    companyId: string,
    from: Date,
    to: Date,
  ): Promise<MoneyRow[]> {
    const rows = await this.database.client.payment.groupBy({
      by: ['currency'],
      where: {
        companyId,
        status: PaymentStatus.POSTED,
        effectiveAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
    });
    return rows
      .filter((r) => r._sum.amount && !r._sum.amount.eq(0))
      .map((r) => ({
        currency: r.currency,
        amount: (r._sum.amount ?? new Prisma.Decimal(0)).toFixed(),
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
  }

  private async expensesRecordedByCurrency(
    companyId: string,
    from: Date,
    to: Date,
  ): Promise<MoneyRow[]> {
    // Approved expenses recognized in period (economic expense — not cash payment).
    const approved = await this.database.client.expense.groupBy({
      by: ['currency'],
      where: {
        companyId,
        status: ExpenseStatus.APPROVED,
        expenseDate: { gte: from, lte: to },
      },
      _sum: { amount: true },
    });
    return approved
      .filter((r) => r._sum.amount && !r._sum.amount.eq(0))
      .map((r) => ({
        currency: r.currency,
        amount: (r._sum.amount ?? new Prisma.Decimal(0)).toFixed(),
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
  }

  private async expensesByCategory(
    companyId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ categoryId: string; categoryName: string; currency: string; amount: string }>> {
    const expenses = await this.database.client.expense.findMany({
      where: {
        companyId,
        status: ExpenseStatus.APPROVED,
        expenseDate: { gte: from, lte: to },
      },
      select: {
        currency: true,
        amount: true,
        categoryId: true,
        category: { select: { id: true, name: true } },
      },
    });

    const map = new Map<
      string,
      { categoryId: string; categoryName: string; currency: string; amount: Prisma.Decimal }
    >();
    for (const e of expenses) {
      const key = `${e.currency}:${e.categoryId}`;
      const prev = map.get(key);
      if (prev) {
        prev.amount = prev.amount.plus(e.amount);
      } else {
        map.set(key, {
          categoryId: e.categoryId,
          categoryName: e.category.name,
          currency: e.currency,
          amount: new Prisma.Decimal(e.amount),
        });
      }
    }

    return [...map.values()]
      .map((row) => ({
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        currency: row.currency,
        amount: row.amount.toFixed(),
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency) || b.amount.localeCompare(a.amount));
  }

  private async resolveChartCurrency(
    companyId: string,
    requested: CurrencyCode | undefined,
    baseCurrency: CurrencyCode,
    canReceipts: boolean,
    canPayments: boolean,
  ): Promise<CurrencyCode> {
    if (requested) return requested;
    if (!canReceipts && !canPayments) return baseCurrency;

    const currencies = new Set<CurrencyCode>();
    if (canReceipts) {
      const receiptCurrencies = await this.database.client.receipt.findMany({
        where: { companyId, status: ReceiptStatus.POSTED },
        select: { currency: true },
        distinct: ['currency'],
        take: 20,
      });
      for (const r of receiptCurrencies) currencies.add(r.currency);
    }
    if (canPayments) {
      const paymentCurrencies = await this.database.client.payment.findMany({
        where: { companyId, status: PaymentStatus.POSTED },
        select: { currency: true },
        distinct: ['currency'],
        take: 20,
      });
      for (const p of paymentCurrencies) currencies.add(p.currency);
    }

    if (currencies.has(baseCurrency)) return baseCurrency;
    const first = [...currencies].sort()[0];
    return first ?? baseCurrency;
  }

  private async cashMovementTrend(
    companyId: string,
    range: ResolvedFinanceDashboardRange,
    chartCurrency: CurrencyCode,
    canReceipts: boolean,
    canPayments: boolean,
  ): Promise<TrendPoint[]> {
    const bucketMap = new Map<string, { moneyIn: Prisma.Decimal; moneyOut: Prisma.Decimal }>();

    const ensure = (key: string) => {
      let row = bucketMap.get(key);
      if (!row) {
        row = { moneyIn: new Prisma.Decimal(0), moneyOut: new Prisma.Decimal(0) };
        bucketMap.set(key, row);
      }
      return row;
    };

    if (canReceipts) {
      const receipts = await this.database.client.receipt.findMany({
        where: {
          companyId,
          status: ReceiptStatus.POSTED,
          currency: chartCurrency,
          effectiveAt: { gte: range.from, lte: range.to },
        },
        select: { effectiveAt: true, amount: true },
      });
      for (const r of receipts) {
        const key = financeTrendBucketKey(r.effectiveAt, range.granularity);
        const row = ensure(key);
        row.moneyIn = row.moneyIn.plus(r.amount);
      }
    }

    if (canPayments) {
      const payments = await this.database.client.payment.findMany({
        where: {
          companyId,
          status: PaymentStatus.POSTED,
          currency: chartCurrency,
          effectiveAt: { gte: range.from, lte: range.to },
        },
        select: { effectiveAt: true, amount: true },
      });
      for (const p of payments) {
        const key = financeTrendBucketKey(p.effectiveAt, range.granularity);
        const row = ensure(key);
        row.moneyOut = row.moneyOut.plus(p.amount);
      }
    }

    return [...bucketMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, row]) => ({
        bucket,
        moneyIn: row.moneyIn.toFixed(),
        moneyOut: row.moneyOut.toFixed(),
      }));
  }

  private async recentActivity(companyId: string): Promise<ActivityItem[]> {
    const rows = await this.database.client.auditLog.findMany({
      where: {
        companyId,
        entityType: { in: [...FINANCE_AUDIT_ENTITY_TYPES] },
      },
      orderBy: { createdAt: 'desc' },
      take: DASHBOARD_ACTIVITY_LIMIT,
      select: {
        createdAt: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        actor: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
    });

    return rows.map((row) => {
      const meta =
        row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
      const actorName = row.actor ? prismaUserDisplayName(row.actor) : null;
      const reference =
        typeof meta.reference === 'string'
          ? meta.reference
          : typeof meta.number === 'string'
            ? meta.number
            : undefined;
      const amount =
        typeof meta.amount === 'string'
          ? meta.amount
          : typeof meta.amount === 'number'
            ? String(meta.amount)
            : undefined;
      const currency = typeof meta.currency === 'string' ? meta.currency : undefined;

      return {
        occurredAt: row.createdAt.toISOString(),
        actorName,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        ...(reference ? { reference } : {}),
        ...(amount ? { amount } : {}),
        ...(currency ? { currency } : {}),
      };
    });
  }
}
