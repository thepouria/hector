import {
  Prisma,
  SupplierLiabilityMovementDirection,
  SupplierLiabilityMovementType,
  SupplierPayableStatus,
} from '@hector/database';
import {
  deriveAgingBucket,
  derivePayableStatus,
  derivePayableTotals,
  derivePayableTotalsFromMovements,
  isPayableOverdue,
} from './supplier-payable-outstanding';

describe('supplier payable outstanding derivation', () => {
  it('computes outstanding = increases − decreases', () => {
    const totals = derivePayableTotals({
      increases: [new Prisma.Decimal('4000000'), new Prisma.Decimal('5000000')],
      decreases: [new Prisma.Decimal('2000000')],
    });
    expect(totals.recognized.toFixed()).toBe('9000000');
    expect(totals.decreased.toFixed()).toBe('2000000');
    expect(totals.outstanding.toFixed()).toBe('7000000');
  });

  it('derives OPEN / PARTIALLY_PAID / PAID', () => {
    expect(
      derivePayableStatus({
        recognized: new Prisma.Decimal('1000'),
        outstanding: new Prisma.Decimal('1000'),
        currentStatus: SupplierPayableStatus.OPEN,
      }),
    ).toBe(SupplierPayableStatus.OPEN);

    expect(
      derivePayableStatus({
        recognized: new Prisma.Decimal('1000'),
        outstanding: new Prisma.Decimal('400'),
        currentStatus: SupplierPayableStatus.OPEN,
      }),
    ).toBe(SupplierPayableStatus.PARTIALLY_PAID);

    expect(
      derivePayableStatus({
        recognized: new Prisma.Decimal('1000'),
        outstanding: new Prisma.Decimal('0'),
        currentStatus: SupplierPayableStatus.OPEN,
      }),
    ).toBe(SupplierPayableStatus.PAID);
  });

  it('marks overdue only when due and outstanding', () => {
    expect(
      isPayableOverdue({
        dueDate: new Date('2020-01-01'),
        outstanding: new Prisma.Decimal('100'),
        now: new Date('2026-01-01'),
      }),
    ).toBe(true);

    expect(
      isPayableOverdue({
        dueDate: new Date('2020-01-01'),
        outstanding: new Prisma.Decimal('0'),
        now: new Date('2026-01-01'),
      }),
    ).toBe(false);
  });

  it('REVERSAL increase undoes decrease without inflating recognized', () => {
    const totals = derivePayableTotalsFromMovements([
      {
        direction: SupplierLiabilityMovementDirection.INCREASE,
        amount: new Prisma.Decimal('1000'),
        type: SupplierLiabilityMovementType.OPENING_BALANCE,
      },
      {
        direction: SupplierLiabilityMovementDirection.DECREASE,
        amount: new Prisma.Decimal('400'),
        type: SupplierLiabilityMovementType.PAYMENT_ALLOCATION,
      },
      {
        direction: SupplierLiabilityMovementDirection.INCREASE,
        amount: new Prisma.Decimal('400'),
        type: SupplierLiabilityMovementType.REVERSAL,
      },
    ]);
    expect(totals.recognized.toFixed()).toBe('1000');
    expect(totals.decreased.toFixed()).toBe('0');
    expect(totals.outstanding.toFixed()).toBe('1000');
  });

  it('maps aging buckets', () => {
    const now = new Date('2026-06-15T12:00:00.000Z');
    expect(
      deriveAgingBucket({
        dueDate: new Date('2026-06-20T12:00:00.000Z'),
        outstanding: new Prisma.Decimal('1'),
        now,
      }),
    ).toBe('CURRENT');

    expect(
      deriveAgingBucket({
        dueDate: new Date('2026-06-10T12:00:00.000Z'),
        outstanding: new Prisma.Decimal('1'),
        now,
      }),
    ).toBe('1-7');

    expect(
      deriveAgingBucket({
        dueDate: new Date('2026-05-01T12:00:00.000Z'),
        outstanding: new Prisma.Decimal('1'),
        now,
      }),
    ).toBe('31-60');

    expect(
      deriveAgingBucket({
        dueDate: new Date('2025-01-01T12:00:00.000Z'),
        outstanding: new Prisma.Decimal('1'),
        now,
      }),
    ).toBe('90+');
  });
});
