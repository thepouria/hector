import {
  Prisma,
  SupplierLiabilityMovementDirection,
  SupplierLiabilityMovementType,
  SupplierPayableStatus,
} from '@hector/database';

export type PayableTotals = {
  recognized: Prisma.Decimal;
  decreased: Prisma.Decimal;
  outstanding: Prisma.Decimal;
};

/**
 * Outstanding = SUM(INCREASE) − SUM(DECREASE). Never an editable column.
 */
export function derivePayableTotals(input: {
  increases: Prisma.Decimal[];
  decreases: Prisma.Decimal[];
}): PayableTotals {
  const recognized = input.increases.reduce(
    (sum, amount) => sum.plus(amount),
    new Prisma.Decimal(0),
  );
  const decreased = input.decreases.reduce(
    (sum, amount) => sum.plus(amount),
    new Prisma.Decimal(0),
  );
  const outstanding = recognized.minus(decreased);
  return { recognized, decreased, outstanding };
}

/**
 * Movement-aware totals (Phase 4.9): REVERSAL INCREASE undoes a prior decrease
 * and must not inflate recognized purchase liability.
 */
export function derivePayableTotalsFromMovements(
  movements: Array<{
    direction: SupplierLiabilityMovementDirection;
    amount: Prisma.Decimal;
    type: SupplierLiabilityMovementType;
  }>,
): PayableTotals {
  let recognized = new Prisma.Decimal(0);
  let decreased = new Prisma.Decimal(0);
  for (const m of movements) {
    if (m.direction === SupplierLiabilityMovementDirection.INCREASE) {
      if (m.type === SupplierLiabilityMovementType.REVERSAL) {
        decreased = decreased.minus(m.amount);
      } else {
        recognized = recognized.plus(m.amount);
      }
    } else {
      decreased = decreased.plus(m.amount);
    }
  }
  return {
    recognized,
    decreased,
    outstanding: recognized.minus(decreased),
  };
}

/**
 * Status from liability truth.
 * CANCELLED is lifecycle-managed and preserved when still cancelled with zero outstanding.
 */
export function derivePayableStatus(input: {
  recognized: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  currentStatus: SupplierPayableStatus;
}): SupplierPayableStatus {
  if (input.currentStatus === SupplierPayableStatus.CANCELLED) {
    return SupplierPayableStatus.CANCELLED;
  }
  if (input.outstanding.lte(0)) {
    return SupplierPayableStatus.PAID;
  }
  if (input.outstanding.lt(input.recognized)) {
    return SupplierPayableStatus.PARTIALLY_PAID;
  }
  return SupplierPayableStatus.OPEN;
}

export function isPayableOverdue(input: {
  dueDate: Date | null;
  outstanding: Prisma.Decimal;
  now?: Date;
}): boolean {
  if (!input.dueDate) return false;
  if (input.outstanding.lte(0)) return false;
  const now = input.now ?? new Date();
  return input.dueDate.getTime() < now.getTime();
}

export const PAYABLE_AGING_BUCKETS = [
  'CURRENT',
  '1-7',
  '8-30',
  '31-60',
  '61-90',
  '90+',
] as const;

export type PayableAgingBucket = (typeof PAYABLE_AGING_BUCKETS)[number];

/** Days past due → aging bucket. Non-overdue / no due date → CURRENT. */
export function deriveAgingBucket(input: {
  dueDate: Date | null;
  outstanding: Prisma.Decimal;
  now?: Date;
}): PayableAgingBucket {
  if (input.outstanding.lte(0)) return 'CURRENT';
  if (!input.dueDate) return 'CURRENT';
  const now = input.now ?? new Date();
  const ms = now.getTime() - input.dueDate.getTime();
  if (ms <= 0) return 'CURRENT';
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days <= 7) return '1-7';
  if (days <= 30) return '8-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}
