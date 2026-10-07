import { Prisma, ReconciliationStatus } from '@hector/database';
import {
  applyWorkflowStatus,
  computeReconciliationMetrics,
  deriveAutomaticStatus,
} from './reconciliation-state';

describe('reconciliation-state', () => {
  it('computes difference as matched − expected', () => {
    const m = computeReconciliationMetrics(
      new Prisma.Decimal('1000'),
      new Prisma.Decimal('950'),
    );
    expect(m.differenceAmount.toString()).toBe('-50');
    expect(m.remainingExpected.toString()).toBe('50');
  });

  it('partial match before close', () => {
    const m = computeReconciliationMetrics(
      new Prisma.Decimal('1000'),
      new Prisma.Decimal('600'),
    );
    const status = deriveAutomaticStatus({
      matchingClosed: false,
      ...m,
    });
    expect(status).toBe(ReconciliationStatus.PARTIALLY_MATCHED);
  });

  it('exact match before close', () => {
    const m = computeReconciliationMetrics(
      new Prisma.Decimal('1000'),
      new Prisma.Decimal('1000'),
    );
    const status = deriveAutomaticStatus({
      matchingClosed: false,
      ...m,
    });
    expect(status).toBe(ReconciliationStatus.MATCHED);
  });

  it('discrepancy after close with under-receipt', () => {
    const m = computeReconciliationMetrics(
      new Prisma.Decimal('1475000000'),
      new Prisma.Decimal('1470000000'),
    );
    const status = deriveAutomaticStatus({
      matchingClosed: true,
      ...m,
    });
    expect(status).toBe(ReconciliationStatus.DISCREPANCY);
    expect(m.differenceAmount.toString()).toBe('-5000000');
  });

  it('preserves RESOLVED workflow status', () => {
    const automatic = ReconciliationStatus.DISCREPANCY;
    expect(
      applyWorkflowStatus(automatic, ReconciliationStatus.RESOLVED),
    ).toBe(ReconciliationStatus.RESOLVED);
  });
});
