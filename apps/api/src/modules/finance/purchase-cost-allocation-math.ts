import { CurrencyCode, Prisma } from '@hector/database';
import { currencyPrecision, roundMoneyAmount } from '../finance/money/money';

export type AllocationWeightTarget = {
  targetId: string;
  /** Non-negative weight used for proportional split (qty or value). */
  weight: Prisma.Decimal;
};

export type AllocatedLine = {
  targetId: string;
  allocatedAmount: Prisma.Decimal;
};

/**
 * Largest-remainder (Hamilton) allocation so sum(lines) === total exactly.
 * Uses currency storage precision. Last non-zero remainder is absorbed by
 * adjusting lines with the largest fractional parts first.
 */
export function allocateByWeights(
  total: Prisma.Decimal,
  currency: CurrencyCode,
  targets: AllocationWeightTarget[],
): AllocatedLine[] {
  if (targets.length === 0) {
    throw new Error('Allocation requires at least one target.');
  }
  if (total.lte(0)) {
    throw new Error('Allocation total must be positive.');
  }
  const weightSum = targets.reduce(
    (acc, t) => acc.add(t.weight),
    new Prisma.Decimal(0),
  );
  if (weightSum.lte(0)) {
    throw new Error('Allocation weights must sum to a positive amount.');
  }

  const precision = currencyPrecision(currency);
  const scale = new Prisma.Decimal(10).pow(precision);
  const totalUnits = total.mul(scale).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);

  const raw = targets.map((t) => {
    const exact = total.mul(t.weight).div(weightSum);
    const flooredUnits = exact.mul(scale).toDecimalPlaces(0, Prisma.Decimal.ROUND_FLOOR);
    const fraction = exact.mul(scale).sub(flooredUnits);
    return {
      targetId: t.targetId,
      flooredUnits,
      fraction,
    };
  });

  const assigned = raw.reduce((acc, r) => acc.add(r.flooredUnits), new Prisma.Decimal(0));
  let remainder = totalUnits.sub(assigned);
  const ranked = [...raw].sort((a, b) => {
    const cmp = b.fraction.cmp(a.fraction);
    if (cmp !== 0) return cmp;
    return a.targetId.localeCompare(b.targetId);
  });

  const bonus = new Map<string, number>();
  let i = 0;
  while (remainder.gt(0) && i < ranked.length) {
    const id = ranked[i]!.targetId;
    bonus.set(id, (bonus.get(id) ?? 0) + 1);
    remainder = remainder.sub(1);
    i += 1;
    if (i >= ranked.length && remainder.gt(0)) i = 0;
  }

  return raw.map((r) => {
    const units = r.flooredUnits.add(bonus.get(r.targetId) ?? 0);
    const amount = units.div(scale);
    return {
      targetId: r.targetId,
      allocatedAmount: roundMoneyAmount(amount, currency),
    };
  });
}

/** Verify sum equals total (exact Decimal compare after rounding policy). */
export function assertAllocationSumExact(
  total: Prisma.Decimal,
  lines: Array<{ allocatedAmount: Prisma.Decimal }>,
): void {
  const sum = lines.reduce(
    (acc, l) => acc.add(l.allocatedAmount),
    new Prisma.Decimal(0),
  );
  if (!sum.eq(total)) {
    throw new Error(`Allocation sum ${sum.toString()} !== total ${total.toString()}`);
  }
}
