import {
  CurrencyCode,
  Prisma,
  ReconciliationSourceType,
  SettlementFinanceTxnType,
  SettlementSourceType,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import {
  resolveSettleableSource,
  sumActiveObligationAllocated,
} from '../settlement/adapters/source-adapter';

type Tx = Prisma.TransactionClient;

export function settlementSourceFor(
  sourceType: ReconciliationSourceType,
): SettlementSourceType | null {
  switch (sourceType) {
    case ReconciliationSourceType.CHANNEL:
      return SettlementSourceType.CHANNEL;
    case ReconciliationSourceType.SUPPLIER_PAYABLE:
      return SettlementSourceType.SUPPLIER_PAYABLE;
    case ReconciliationSourceType.LOAN:
      return SettlementSourceType.LOAN;
    case ReconciliationSourceType.SETTLEMENT:
      return null;
    default:
      return null;
  }
}

export function requiredFinanceTxnType(
  sourceType: ReconciliationSourceType,
): SettlementFinanceTxnType {
  if (sourceType === ReconciliationSourceType.CHANNEL) {
    return SettlementFinanceTxnType.RECEIPT;
  }
  if (
    sourceType === ReconciliationSourceType.SUPPLIER_PAYABLE ||
    sourceType === ReconciliationSourceType.LOAN
  ) {
    return SettlementFinanceTxnType.PAYMENT;
  }
  throw new AppError({
    code: ERROR_CODES.RECONCILIATION_SOURCE_UNSUPPORTED,
    message: 'Specify financeTxnType for SETTLEMENT reconciliation sources.',
    statusCode: 400,
  });
}

export async function loadExpectedForReconciliation(
  tx: Tx,
  companyId: string,
  sourceType: ReconciliationSourceType,
  sourceId: string,
): Promise<{
  currency: CurrencyCode;
  expectedAmount: Prisma.Decimal;
  matchedAmount: Prisma.Decimal;
}> {
  const settlementSource = settlementSourceFor(sourceType);
  if (settlementSource) {
    const resolved = await resolveSettleableSource(tx, companyId, settlementSource, sourceId);
    return {
      currency: resolved.currency,
      expectedAmount: resolved.originalAmount,
      matchedAmount: resolved.settledAmount,
    };
  }

  const settlement = await tx.settlement.findFirst({
    where: { id: sourceId, companyId },
    include: { items: true },
  });
  if (!settlement) {
    throw new AppError({
      code: ERROR_CODES.SETTLEMENT_NOT_FOUND,
      message: 'Settlement was not found.',
      statusCode: 404,
    });
  }

  let expectedAmount = new Prisma.Decimal(0);
  let matchedAmount = new Prisma.Decimal(0);
  for (const item of settlement.items) {
    const resolved = await resolveSettleableSource(
      tx,
      companyId,
      item.sourceType,
      item.sourceId,
    );
    expectedAmount = expectedAmount.plus(resolved.originalAmount);
    matchedAmount = matchedAmount.plus(resolved.settledAmount);
  }

  return {
    currency: settlement.currency,
    expectedAmount,
    matchedAmount,
  };
}

export async function sumMatchedForSource(
  tx: Tx,
  companyId: string,
  sourceType: ReconciliationSourceType,
  sourceId: string,
): Promise<Prisma.Decimal> {
  const settlementSource = settlementSourceFor(sourceType);
  if (settlementSource) {
    return sumActiveObligationAllocated(tx, companyId, settlementSource, sourceId);
  }
  const items = await tx.settlementItem.findMany({
    where: { companyId, settlementId: sourceId },
    select: { id: true },
  });
  if (items.length === 0) return new Prisma.Decimal(0);
  const agg = await tx.settlementAllocation.aggregate({
    where: {
      companyId,
      status: 'ACTIVE',
      settlementItemId: { in: items.map((i) => i.id) },
    },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? new Prisma.Decimal(0);
}
