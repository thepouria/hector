import {
  CurrencyCode,
  ExpensePaymentAllocationStatus,
  ExpensePaymentStatus,
  ExpenseStatus,
  Prisma,
  PurchaseCostPaymentAllocationStatus,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { EXPENSE_ERROR_MESSAGES } from './finance-expenses.constants';
import { currencyPrecision } from './money/money';

type Tx = Prisma.TransactionClient;

export function deriveExpensePaymentStatus(
  expenseAmount: Prisma.Decimal,
  paidAmount: Prisma.Decimal,
): ExpensePaymentStatus {
  if (paidAmount.lte(0)) return ExpensePaymentStatus.UNPAID;
  if (paidAmount.gte(expenseAmount)) return ExpensePaymentStatus.PAID;
  return ExpensePaymentStatus.PARTIALLY_PAID;
}

export async function sumActiveExpenseAllocations(
  tx: Tx,
  companyId: string,
  expenseId: string,
): Promise<Prisma.Decimal> {
  const agg = await tx.expensePaymentAllocation.aggregate({
    where: {
      companyId,
      expenseId,
      status: ExpensePaymentAllocationStatus.ACTIVE,
    },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? new Prisma.Decimal(0);
}

export async function recomputeExpensePaymentStatusInTx(
  tx: Tx,
  companyId: string,
  expenseId: string,
): Promise<{ paid: Prisma.Decimal; outstanding: Prisma.Decimal; paymentStatus: ExpensePaymentStatus }> {
  const expense = await tx.expense.findFirst({
    where: { id: expenseId, companyId },
    select: { id: true, amount: true, currency: true },
  });
  if (!expense) {
    throw new AppError({
      code: ERROR_CODES.EXPENSE_NOT_FOUND,
      message: EXPENSE_ERROR_MESSAGES.NOT_FOUND,
      statusCode: 404,
    });
  }
  const paid = await sumActiveExpenseAllocations(tx, companyId, expenseId);
  const outstanding = expense.amount.sub(paid);
  if (outstanding.lt(0)) {
    throw new AppError({
      code: ERROR_CODES.EXPENSE_OVER_ALLOCATION,
      message: EXPENSE_ERROR_MESSAGES.OVER_ALLOCATION,
      statusCode: 409,
    });
  }
  const paymentStatus = deriveExpensePaymentStatus(expense.amount, paid);
  await tx.expense.update({
    where: { id: expenseId },
    data: { paymentStatus },
  });
  return { paid, outstanding, paymentStatus };
}

/**
 * Soft-reverse all ACTIVE expense + purchase-cost payment allocations for a payment (FIN-EXP-008).
 * Call inside the same TX as Payment reverse. Does not post AccountMovement.
 */
export async function reversePaymentSettlementLinksInTx(
  tx: Tx,
  args: {
    companyId: string;
    paymentId: string;
    actorUserId: string;
    now?: Date;
  },
): Promise<void> {
  const now = args.now ?? new Date();

  const expenseAllocs = await tx.expensePaymentAllocation.findMany({
    where: {
      companyId: args.companyId,
      paymentId: args.paymentId,
      status: ExpensePaymentAllocationStatus.ACTIVE,
    },
    select: { id: true, expenseId: true },
  });

  if (expenseAllocs.length > 0) {
    await tx.expensePaymentAllocation.updateMany({
      where: {
        companyId: args.companyId,
        paymentId: args.paymentId,
        status: ExpensePaymentAllocationStatus.ACTIVE,
      },
      data: {
        status: ExpensePaymentAllocationStatus.REVERSED,
        reversedAt: now,
        reversedById: args.actorUserId,
      },
    });
    const expenseIds = [...new Set(expenseAllocs.map((a) => a.expenseId))];
    for (const expenseId of expenseIds) {
      await recomputeExpensePaymentStatusInTx(tx, args.companyId, expenseId);
    }
  }

  await tx.purchaseCostPaymentAllocation.updateMany({
    where: {
      companyId: args.companyId,
      paymentId: args.paymentId,
      status: PurchaseCostPaymentAllocationStatus.ACTIVE,
    },
    data: {
      status: PurchaseCostPaymentAllocationStatus.REVERSED,
      reversedAt: now,
      reversedById: args.actorUserId,
    },
  });
}

export async function assertExpenseOutstandingAllows(
  tx: Tx,
  companyId: string,
  expenseId: string,
  allocateAmount: Prisma.Decimal,
  currency: CurrencyCode,
): Promise<{ expenseStatus: ExpenseStatus; expenseCurrency: CurrencyCode }> {
  const locked = await tx.$queryRaw<
    Array<{
      id: string;
      status: ExpenseStatus;
      amount: Prisma.Decimal;
      currency: CurrencyCode;
    }>
  >(Prisma.sql`
    SELECT id, status, amount, currency
    FROM expenses
    WHERE id = ${expenseId}::uuid AND company_id = ${companyId}::uuid
    FOR UPDATE
  `);
  const expense = locked[0];
  if (!expense) {
    throw new AppError({
      code: ERROR_CODES.EXPENSE_NOT_FOUND,
      message: EXPENSE_ERROR_MESSAGES.NOT_FOUND,
      statusCode: 404,
    });
  }
  if (expense.status !== ExpenseStatus.APPROVED) {
    throw new AppError({
      code: ERROR_CODES.EXPENSE_NOT_ALLOCATABLE,
      message: EXPENSE_ERROR_MESSAGES.NOT_ALLOCATABLE,
      statusCode: 409,
    });
  }
  if (expense.currency !== currency) {
    throw new AppError({
      code: ERROR_CODES.EXPENSE_CROSS_CURRENCY,
      message: EXPENSE_ERROR_MESSAGES.CROSS_CURRENCY,
      statusCode: 409,
    });
  }
  const paid = await sumActiveExpenseAllocations(tx, companyId, expenseId);
  const outstanding = expense.amount.sub(paid);
  if (allocateAmount.gt(outstanding)) {
    throw new AppError({
      code: ERROR_CODES.EXPENSE_OVER_ALLOCATION,
      message: EXPENSE_ERROR_MESSAGES.OVER_ALLOCATION,
      statusCode: 409,
    });
  }
  // Precision guard
  if (allocateAmount.decimalPlaces() > currencyPrecision(currency)) {
    throw new AppError({
      code: ERROR_CODES.EXPENSE_INVALID_MONEY,
      message: EXPENSE_ERROR_MESSAGES.INVALID_MONEY,
      statusCode: 400,
    });
  }
  return { expenseStatus: expense.status, expenseCurrency: expense.currency };
}
