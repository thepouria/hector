import {
  ChannelSettlementStatus,
  CurrencyCode,
  LoanStatus,
  Prisma,
  SettlementAllocationStatus,
  SettlementManualObligationStatus,
  SettlementSourceType,
  SupplierPayableStatus,
} from '@hector/database';
import { ERROR_CODES } from '../../../common/constants';
import { AppError } from '../../../common/exceptions/app.error';
import {
  derivePayableStatus,
  derivePayableTotalsFromMovements,
} from '../../finance/supplier-payable-outstanding';
import {
  deriveLoanOperationalStatus,
  deriveLoanPrincipalTotals,
} from '../../finance/loan-outstanding';
import { SETTLEMENT_ERROR_MESSAGES } from '../settlement.constants';

export type ResolvedSettleableSource = {
  sourceType: SettlementSourceType;
  sourceId: string;
  companyId: string;
  partyId: string | null;
  currency: CurrencyCode;
  /** Authoritative current settleable / recognized obligation. */
  originalAmount: Prisma.Decimal;
  settledAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
  settleable: boolean;
  statusLabel: string;
};

type Tx = Prisma.TransactionClient;

/**
 * Controlled source adapters.
 * 6.2: MANUAL_OBLIGATION, SUPPLIER_PAYABLE, LOAN.
 * 6.3: CHANNEL → ChannelSettlement (expected net receivable).
 */
export async function resolveSettleableSource(
  tx: Tx,
  companyId: string,
  sourceType: SettlementSourceType,
  sourceId: string,
  options?: { lock?: boolean },
): Promise<ResolvedSettleableSource> {
  if (sourceType === SettlementSourceType.MANUAL_OBLIGATION) {
    if (options?.lock) {
      await lockManualObligation(tx, companyId, sourceId);
    }
    const row = await tx.settlementManualObligation.findFirst({
      where: { id: sourceId, companyId },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.SETTLEMENT_OBLIGATION_NOT_FOUND,
        message: SETTLEMENT_ERROR_MESSAGES.OBLIGATION_NOT_FOUND,
        statusCode: 404,
      });
    }
    const settled = await sumActiveObligationAllocated(
      tx,
      companyId,
      SettlementSourceType.MANUAL_OBLIGATION,
      row.id,
    );
    const remaining = Prisma.Decimal.max(row.originalAmount.minus(settled), new Prisma.Decimal(0));
    return {
      sourceType,
      sourceId: row.id,
      companyId: row.companyId,
      partyId: row.partyId,
      currency: row.currency,
      originalAmount: row.originalAmount,
      settledAmount: settled,
      remainingAmount: remaining,
      settleable:
        row.status === SettlementManualObligationStatus.ACTIVE && remaining.gt(0),
      statusLabel: row.status,
    };
  }

  if (sourceType === SettlementSourceType.SUPPLIER_PAYABLE) {
    if (options?.lock) {
      await lockSupplierPayable(tx, companyId, sourceId);
    }
    const payable = await tx.supplierPayable.findFirst({
      where: { id: sourceId, companyId },
      include: {
        supplier: { select: { partyId: true } },
        movements: {
          select: { direction: true, amount: true, type: true },
        },
      },
    });
    if (!payable) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_PAYABLE_NOT_FOUND,
        message: 'Supplier payable was not found.',
        statusCode: 404,
      });
    }
    const totals = derivePayableTotalsFromMovements(payable.movements);
    const status = derivePayableStatus({
      recognized: totals.recognized,
      outstanding: totals.outstanding,
      currentStatus: payable.status,
    });
    const remaining = Prisma.Decimal.max(totals.outstanding, new Prisma.Decimal(0));
    return {
      sourceType,
      sourceId: payable.id,
      companyId: payable.companyId,
      partyId: payable.supplier.partyId,
      currency: payable.currency,
      originalAmount: totals.recognized,
      settledAmount: totals.decreased,
      remainingAmount: remaining,
      settleable:
        status !== SupplierPayableStatus.CANCELLED &&
        status !== SupplierPayableStatus.PAID &&
        remaining.gt(0),
      statusLabel: status,
    };
  }

  if (sourceType === SettlementSourceType.LOAN) {
    if (options?.lock) {
      await lockLoan(tx, companyId, sourceId);
    }
    const loan = await tx.loan.findFirst({
      where: { id: sourceId, companyId },
    });
    if (!loan) {
      throw new AppError({
        code: ERROR_CODES.LOAN_NOT_FOUND,
        message: 'Loan was not found.',
        statusCode: 404,
      });
    }
    const totals = await computeLoanSettlementTotals(tx, companyId, loan.id);
    const status = deriveLoanOperationalStatus({
      receivedPrincipal: totals.receivedPrincipal,
      outstandingPrincipal: totals.outstandingPrincipal,
      currentStatus: loan.status,
    });
    const remaining = Prisma.Decimal.max(totals.outstandingPrincipal, new Prisma.Decimal(0));
    const settleableLifecycle =
      status === LoanStatus.ACTIVE || status === LoanStatus.PARTIALLY_REPAID;
    return {
      sourceType,
      sourceId: loan.id,
      companyId: loan.companyId,
      partyId: loan.lenderPartyId,
      currency: loan.currency,
      originalAmount: totals.receivedPrincipal,
      settledAmount: totals.repaidPrincipal,
      remainingAmount: remaining,
      settleable: settleableLifecycle && remaining.gt(0),
      statusLabel: status,
    };
  }

  if (sourceType === SettlementSourceType.CHANNEL) {
    if (options?.lock) {
      await lockChannelSettlement(tx, companyId, sourceId);
    }
    const row = await tx.channelSettlement.findFirst({
      where: { id: sourceId, companyId },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.CHANNEL_SETTLEMENT_NOT_FOUND,
        message: SETTLEMENT_ERROR_MESSAGES.CHANNEL_SETTLEMENT_NOT_FOUND,
        statusCode: 404,
      });
    }
    const received = await sumActiveObligationAllocated(
      tx,
      companyId,
      SettlementSourceType.CHANNEL,
      row.id,
    );
    const remaining = Prisma.Decimal.max(row.expectedNet.minus(received), new Prisma.Decimal(0));
    const openForReceipt =
      row.status === ChannelSettlementStatus.OPEN ||
      row.status === ChannelSettlementStatus.PARTIALLY_RECEIVED;
    return {
      sourceType,
      sourceId: row.id,
      companyId: row.companyId,
      partyId: null,
      currency: row.currency,
      originalAmount: row.expectedNet,
      settledAmount: received,
      remainingAmount: remaining,
      settleable: openForReceipt && remaining.gt(0),
      statusLabel: row.status,
    };
  }

  if (sourceType === SettlementSourceType.FX_LIABILITY) {
    throw new AppError({
      code: ERROR_CODES.SETTLEMENT_SOURCE_UNSUPPORTED,
      message: SETTLEMENT_ERROR_MESSAGES.SOURCE_UNSUPPORTED,
      statusCode: 409,
    });
  }

  throw new AppError({
    code: ERROR_CODES.SETTLEMENT_SOURCE_UNSUPPORTED,
    message: SETTLEMENT_ERROR_MESSAGES.SOURCE_UNSUPPORTED,
    statusCode: 400,
  });
}

/**
 * Loan outstanding for settlement = posted disbursements − posted repayments − ACTIVE core allocations.
 * Core allocations do not create cash LoanRepayment (Payment already moved cash).
 */
export async function computeLoanSettlementTotals(
  tx: Tx,
  companyId: string,
  loanId: string,
): Promise<{
  receivedPrincipal: Prisma.Decimal;
  repaidPrincipal: Prisma.Decimal;
  outstandingPrincipal: Prisma.Decimal;
}> {
  const [disbursements, repayments, coreSettled] = await Promise.all([
    tx.loanDisbursement.findMany({
      where: {
        companyId,
        loanId,
        status: 'POSTED',
        reversalOfId: null,
      },
      select: { amount: true },
    }),
    tx.loanRepayment.findMany({
      where: {
        companyId,
        loanId,
        status: 'POSTED',
        reversalOfId: null,
      },
      select: { principalAmount: true },
    }),
    sumActiveObligationAllocated(tx, companyId, SettlementSourceType.LOAN, loanId),
  ]);

  const base = deriveLoanPrincipalTotals({
    postedDisbursementAmounts: disbursements.map((d) => d.amount),
    postedPrincipalRepayments: repayments.map((r) => r.principalAmount),
  });
  const repaidPrincipal = base.repaidPrincipal.plus(coreSettled);
  const outstandingPrincipal = base.receivedPrincipal.minus(repaidPrincipal);
  return {
    receivedPrincipal: base.receivedPrincipal,
    repaidPrincipal,
    outstandingPrincipal,
  };
}

export async function sumActiveObligationAllocated(
  tx: Tx,
  companyId: string,
  sourceType: SettlementSourceType,
  sourceId: string,
): Promise<Prisma.Decimal> {
  const items = await tx.settlementItem.findMany({
    where: { companyId, sourceType, sourceId },
    select: { id: true },
  });
  if (items.length === 0) return new Prisma.Decimal(0);
  const agg = await tx.settlementAllocation.aggregate({
    where: {
      companyId,
      settlementItemId: { in: items.map((i) => i.id) },
      status: SettlementAllocationStatus.ACTIVE,
    },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? new Prisma.Decimal(0);
}

async function lockManualObligation(tx: Tx, companyId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM settlement_manual_obligations
    WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
    FOR UPDATE
  `);
  if (!rows[0]) {
    throw new AppError({
      code: ERROR_CODES.SETTLEMENT_OBLIGATION_NOT_FOUND,
      message: SETTLEMENT_ERROR_MESSAGES.OBLIGATION_NOT_FOUND,
      statusCode: 404,
    });
  }
}

async function lockSupplierPayable(tx: Tx, companyId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM supplier_payables
    WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
    FOR UPDATE
  `);
  if (!rows[0]) {
    throw new AppError({
      code: ERROR_CODES.SUPPLIER_PAYABLE_NOT_FOUND,
      message: 'Supplier payable was not found.',
      statusCode: 404,
    });
  }
}

async function lockLoan(tx: Tx, companyId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM loans
    WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
    FOR UPDATE
  `);
  if (!rows[0]) {
    throw new AppError({
      code: ERROR_CODES.LOAN_NOT_FOUND,
      message: 'Loan was not found.',
      statusCode: 404,
    });
  }
}

async function lockChannelSettlement(tx: Tx, companyId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM channel_settlements
    WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
    FOR UPDATE
  `);
  if (!rows[0]) {
    throw new AppError({
      code: ERROR_CODES.CHANNEL_SETTLEMENT_NOT_FOUND,
      message: SETTLEMENT_ERROR_MESSAGES.CHANNEL_SETTLEMENT_NOT_FOUND,
      statusCode: 404,
    });
  }
}
