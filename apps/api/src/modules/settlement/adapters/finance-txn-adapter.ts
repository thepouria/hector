import {
  CurrencyCode,
  Prisma,
  SettlementFinanceTxnType,
} from '@hector/database';
import { ERROR_CODES } from '../../../common/constants';
import { AppError } from '../../../common/exceptions/app.error';
import {
  lockPaymentForAllocation,
  sumPaymentAllocatedAmount,
} from '../../finance/payment-allocation-capacity';
import {
  lockReceiptForAllocation,
  sumReceiptAllocatedAmount,
} from '../../finance/receipt-allocation-capacity';
import { SETTLEMENT_ERROR_MESSAGES } from '../settlement.constants';

export type ResolvedFinanceTransaction = {
  financeTxnType: SettlementFinanceTxnType;
  financeTxnId: string;
  paymentId: string | null;
  receiptId: string | null;
  companyId: string;
  currency: CurrencyCode;
  amount: Prisma.Decimal;
  allocated: Prisma.Decimal;
  remaining: Prisma.Decimal;
  allocatable: boolean;
};

type Tx = Prisma.TransactionClient;

/**
 * Finance transaction adapter.
 * PAYMENT → supplier/loan settlement. RECEIPT → channel settlement (Phase 6.3).
 * Does not mutate Finance balances or amounts.
 */
export async function resolveFinanceTransaction(
  tx: Tx,
  companyId: string,
  financeTxnType: SettlementFinanceTxnType,
  financeTxnId: string,
  options?: { lock?: boolean },
): Promise<ResolvedFinanceTransaction> {
  if (financeTxnType === SettlementFinanceTxnType.PAYMENT) {
    return resolvePayment(tx, companyId, financeTxnId, options);
  }
  if (financeTxnType === SettlementFinanceTxnType.RECEIPT) {
    return resolveReceipt(tx, companyId, financeTxnId, options);
  }

  throw new AppError({
    code: ERROR_CODES.SETTLEMENT_FINANCE_TXN_UNSUPPORTED,
    message: SETTLEMENT_ERROR_MESSAGES.FINANCE_TXN_UNSUPPORTED,
    statusCode: 409,
  });
}

async function resolvePayment(
  tx: Tx,
  companyId: string,
  financeTxnId: string,
  options?: { lock?: boolean },
): Promise<ResolvedFinanceTransaction> {
  if (options?.lock) {
    try {
      await lockPaymentForAllocation(tx, companyId, financeTxnId);
    } catch {
      throw new AppError({
        code: ERROR_CODES.PAYMENT_NOT_FOUND,
        message: SETTLEMENT_ERROR_MESSAGES.PAYMENT_NOT_FOUND,
        statusCode: 404,
      });
    }
  }

  const payment = await tx.payment.findFirst({
    where: { id: financeTxnId, companyId },
  });
  if (!payment) {
    throw new AppError({
      code: ERROR_CODES.PAYMENT_NOT_FOUND,
      message: SETTLEMENT_ERROR_MESSAGES.PAYMENT_NOT_FOUND,
      statusCode: 404,
    });
  }

  const allocated = await sumPaymentAllocatedAmount(tx, companyId, payment.id);
  const remaining = Prisma.Decimal.max(payment.amount.minus(allocated), new Prisma.Decimal(0));

  return {
    financeTxnType: SettlementFinanceTxnType.PAYMENT,
    financeTxnId: payment.id,
    paymentId: payment.id,
    receiptId: null,
    companyId: payment.companyId,
    currency: payment.currency,
    amount: payment.amount,
    allocated,
    remaining,
    allocatable: payment.status === 'POSTED',
  };
}

async function resolveReceipt(
  tx: Tx,
  companyId: string,
  financeTxnId: string,
  options?: { lock?: boolean },
): Promise<ResolvedFinanceTransaction> {
  if (options?.lock) {
    try {
      await lockReceiptForAllocation(tx, companyId, financeTxnId);
    } catch {
      throw new AppError({
        code: ERROR_CODES.RECEIPT_NOT_FOUND,
        message: SETTLEMENT_ERROR_MESSAGES.RECEIPT_NOT_FOUND,
        statusCode: 404,
      });
    }
  }

  const receipt = await tx.receipt.findFirst({
    where: { id: financeTxnId, companyId },
  });
  if (!receipt) {
    throw new AppError({
      code: ERROR_CODES.RECEIPT_NOT_FOUND,
      message: SETTLEMENT_ERROR_MESSAGES.RECEIPT_NOT_FOUND,
      statusCode: 404,
    });
  }

  const allocated = await sumReceiptAllocatedAmount(tx, companyId, receipt.id);
  const remaining = Prisma.Decimal.max(receipt.amount.minus(allocated), new Prisma.Decimal(0));

  return {
    financeTxnType: SettlementFinanceTxnType.RECEIPT,
    financeTxnId: receipt.id,
    paymentId: null,
    receiptId: receipt.id,
    companyId: receipt.companyId,
    currency: receipt.currency,
    amount: receipt.amount,
    allocated,
    remaining,
    allocatable: receipt.status === 'POSTED',
  };
}
