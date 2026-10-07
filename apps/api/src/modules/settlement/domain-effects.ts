import {
  ChannelSettlementStatus,
  LoanStatus,
  Prisma,
  SettlementSourceType,
  SupplierLiabilityMovementDirection,
  SupplierLiabilityMovementType,
} from '@hector/database';
import {
  deriveLoanOperationalStatus,
} from '../finance/loan-outstanding';
import {
  derivePayableStatus,
  derivePayableTotalsFromMovements,
} from '../finance/supplier-payable-outstanding';
import { SUPPLIER_PAYABLE_LIABILITY_SOURCE_TYPES } from '../finance/finance-supplier-payables.constants';
import {
  computeLoanSettlementTotals,
  sumActiveObligationAllocated,
} from './adapters/source-adapter';

type Tx = Prisma.TransactionClient;

/**
 * Apply domain economic effects after a SettlementAllocation is created.
 * Does NOT move cash (Finance Payment already did). Matching only.
 */
export async function applyDomainAllocationEffect(
  tx: Tx,
  input: {
    companyId: string;
    actorUserId: string;
    sourceType: SettlementSourceType;
    sourceId: string;
    allocationId: string;
    obligationAmount: Prisma.Decimal;
    obligationCurrency: Prisma.Decimal extends never ? never : import('@hector/database').CurrencyCode;
    effectiveAt: Date;
  },
): Promise<void> {
  if (input.sourceType === SettlementSourceType.SUPPLIER_PAYABLE) {
    await applySupplierPayableDecrease(tx, input);
    return;
  }
  if (input.sourceType === SettlementSourceType.LOAN) {
    await refreshLoanStatus(tx, input.companyId, input.sourceId, input.actorUserId);
    return;
  }
  if (input.sourceType === SettlementSourceType.CHANNEL) {
    await refreshChannelSettlementStatus(tx, input.companyId, input.sourceId);
  }
}

export async function reverseDomainAllocationEffect(
  tx: Tx,
  input: {
    companyId: string;
    actorUserId: string;
    sourceType: SettlementSourceType;
    sourceId: string;
    allocationId: string;
    obligationAmount: Prisma.Decimal;
    effectiveAt: Date;
  },
): Promise<void> {
  if (input.sourceType === SettlementSourceType.SUPPLIER_PAYABLE) {
    await applySupplierPayableReversal(tx, input);
    return;
  }
  if (input.sourceType === SettlementSourceType.LOAN) {
    await refreshLoanStatus(tx, input.companyId, input.sourceId, input.actorUserId);
    return;
  }
  if (input.sourceType === SettlementSourceType.CHANNEL) {
    await refreshChannelSettlementStatus(tx, input.companyId, input.sourceId);
  }
}

async function applySupplierPayableDecrease(
  tx: Tx,
  input: {
    companyId: string;
    actorUserId: string;
    sourceId: string;
    allocationId: string;
    obligationAmount: Prisma.Decimal;
    obligationCurrency: import('@hector/database').CurrencyCode;
    effectiveAt: Date;
  },
) {
  const payable = await tx.supplierPayable.findFirstOrThrow({
    where: { id: input.sourceId, companyId: input.companyId },
    include: {
      movements: { select: { direction: true, amount: true, type: true } },
    },
  });
  const before = derivePayableTotalsFromMovements(payable.movements);

  await tx.supplierLiabilityMovement.create({
    data: {
      companyId: input.companyId,
      payableId: input.sourceId,
      supplierId: payable.supplierId,
      direction: SupplierLiabilityMovementDirection.DECREASE,
      type: SupplierLiabilityMovementType.PAYMENT_ALLOCATION,
      amount: input.obligationAmount,
      currency: input.obligationCurrency,
      sourceType: SUPPLIER_PAYABLE_LIABILITY_SOURCE_TYPES.SETTLEMENT_ALLOCATION,
      sourceId: input.allocationId,
      effectiveAt: input.effectiveAt,
      createdById: input.actorUserId,
    },
  });

  const nextOutstanding = before.outstanding.minus(input.obligationAmount);
  const nextStatus = derivePayableStatus({
    recognized: before.recognized,
    outstanding: nextOutstanding,
    currentStatus: payable.status,
  });
  await tx.supplierPayable.update({
    where: { id: input.sourceId },
    data: { status: nextStatus },
  });
}

async function applySupplierPayableReversal(
  tx: Tx,
  input: {
    companyId: string;
    actorUserId: string;
    sourceId: string;
    allocationId: string;
    obligationAmount: Prisma.Decimal;
    effectiveAt: Date;
  },
) {
  const payable = await tx.supplierPayable.findFirstOrThrow({
    where: { id: input.sourceId, companyId: input.companyId },
  });

  await tx.supplierLiabilityMovement.create({
    data: {
      companyId: input.companyId,
      payableId: input.sourceId,
      supplierId: payable.supplierId,
      direction: SupplierLiabilityMovementDirection.INCREASE,
      type: SupplierLiabilityMovementType.REVERSAL,
      amount: input.obligationAmount,
      currency: payable.currency,
      sourceType: SUPPLIER_PAYABLE_LIABILITY_SOURCE_TYPES.SETTLEMENT_ALLOCATION,
      sourceId: input.allocationId,
      effectiveAt: input.effectiveAt,
      createdById: input.actorUserId,
      notes: 'Settlement allocation reversal',
    },
  });

  const movements = await tx.supplierLiabilityMovement.findMany({
    where: { companyId: input.companyId, payableId: input.sourceId },
    select: { direction: true, amount: true, type: true },
  });
  const totals = derivePayableTotalsFromMovements(movements);
  const nextStatus = derivePayableStatus({
    recognized: totals.recognized,
    outstanding: totals.outstanding,
    currentStatus: payable.status,
  });
  await tx.supplierPayable.update({
    where: { id: input.sourceId },
    data: { status: nextStatus },
  });
}

async function refreshLoanStatus(
  tx: Tx,
  companyId: string,
  loanId: string,
  _actorUserId: string,
) {
  const loan = await tx.loan.findFirstOrThrow({ where: { id: loanId, companyId } });
  if (loan.status === LoanStatus.CANCELLED || loan.status === LoanStatus.REVERSED) {
    return;
  }
  const totals = await computeLoanSettlementTotals(tx, companyId, loanId);
  const next = deriveLoanOperationalStatus({
    receivedPrincipal: totals.receivedPrincipal,
    outstandingPrincipal: totals.outstandingPrincipal,
    currentStatus: loan.status,
  });
  const settledAt =
    next === LoanStatus.SETTLED
      ? loan.settledAt ?? new Date()
      : next === LoanStatus.DRAFT
        ? null
        : loan.settledAt;
  if (next !== loan.status || settledAt !== loan.settledAt) {
    await tx.loan.update({
      where: { id: loanId },
      data: { status: next, settledAt },
    });
  }
}

/**
 * Derive ChannelSettlement status from Expected Net vs active Receipt allocations.
 * DRAFT / CANCELLED are lifecycle-managed elsewhere.
 */
export async function refreshChannelSettlementStatus(
  tx: Tx,
  companyId: string,
  channelSettlementId: string,
): Promise<ChannelSettlementStatus> {
  const row = await tx.channelSettlement.findFirstOrThrow({
    where: { id: channelSettlementId, companyId },
  });
  if (
    row.status === ChannelSettlementStatus.DRAFT ||
    row.status === ChannelSettlementStatus.CANCELLED
  ) {
    return row.status;
  }

  const received = await sumActiveObligationAllocated(
    tx,
    companyId,
    SettlementSourceType.CHANNEL,
    channelSettlementId,
  );
  const outstanding = Prisma.Decimal.max(row.expectedNet.minus(received), new Prisma.Decimal(0));

  let next: ChannelSettlementStatus;
  if (outstanding.lte(0)) {
    next = ChannelSettlementStatus.RECEIVED;
  } else if (received.gt(0)) {
    next = ChannelSettlementStatus.PARTIALLY_RECEIVED;
  } else {
    next = ChannelSettlementStatus.OPEN;
  }

  if (next !== row.status) {
    await tx.channelSettlement.update({
      where: { id: channelSettlementId },
      data: { status: next },
    });
  }
  return next;
}

export function deriveChannelSettlementStatus(input: {
  expectedNet: Prisma.Decimal;
  received: Prisma.Decimal;
  currentStatus: ChannelSettlementStatus;
}): ChannelSettlementStatus {
  if (
    input.currentStatus === ChannelSettlementStatus.DRAFT ||
    input.currentStatus === ChannelSettlementStatus.CANCELLED
  ) {
    return input.currentStatus;
  }
  const outstanding = Prisma.Decimal.max(
    input.expectedNet.minus(input.received),
    new Prisma.Decimal(0),
  );
  if (outstanding.lte(0)) return ChannelSettlementStatus.RECEIVED;
  if (input.received.gt(0)) return ChannelSettlementStatus.PARTIALLY_RECEIVED;
  return ChannelSettlementStatus.OPEN;
}
