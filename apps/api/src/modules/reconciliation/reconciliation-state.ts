import { Prisma, ReconciliationStatus } from '@hector/database';

/**
 * Signed convention (REC-018): difference = actualMatched − expectedAmount.
 * Negative → under-receipt/underpayment; positive → over-receipt/overpayment vs expected.
 */
export type ReconciliationMetrics = {
  expectedAmount: Prisma.Decimal;
  matchedAmount: Prisma.Decimal;
  remainingExpected: Prisma.Decimal;
  differenceAmount: Prisma.Decimal;
};

export function computeReconciliationMetrics(
  expectedAmount: Prisma.Decimal,
  matchedAmount: Prisma.Decimal,
): ReconciliationMetrics {
  const remainingExpected = Prisma.Decimal.max(
    expectedAmount.minus(matchedAmount),
    new Prisma.Decimal(0),
  );
  const differenceAmount = matchedAmount.minus(expectedAmount);
  return { expectedAmount, matchedAmount, remainingExpected, differenceAmount };
}

export function deriveAutomaticStatus(input: {
  matchingClosed: boolean;
  matchedAmount: Prisma.Decimal;
  expectedAmount: Prisma.Decimal;
  remainingExpected: Prisma.Decimal;
  differenceAmount: Prisma.Decimal;
}): ReconciliationStatus {
  if (input.matchedAmount.eq(0)) {
    return ReconciliationStatus.OPEN;
  }
  if (!input.matchingClosed) {
    if (input.remainingExpected.gt(0)) {
      return ReconciliationStatus.PARTIALLY_MATCHED;
    }
    if (input.differenceAmount.eq(0)) {
      return ReconciliationStatus.MATCHED;
    }
    return ReconciliationStatus.PARTIALLY_MATCHED;
  }
  if (input.differenceAmount.eq(0)) {
    return ReconciliationStatus.MATCHED;
  }
  return ReconciliationStatus.DISCREPANCY;
}

export function applyWorkflowStatus(
  automatic: ReconciliationStatus,
  current: ReconciliationStatus,
): ReconciliationStatus {
  if (current === ReconciliationStatus.CANCELLED) {
    return ReconciliationStatus.CANCELLED;
  }
  if (current === ReconciliationStatus.RESOLVED) {
    return ReconciliationStatus.RESOLVED;
  }
  if (current === ReconciliationStatus.UNDER_REVIEW) {
    return ReconciliationStatus.UNDER_REVIEW;
  }
  return automatic;
}
