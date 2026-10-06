import { CurrencyCode, Prisma } from '@hector/database';
import {
  allocateByWeights,
  assertAllocationSumExact,
} from './purchase-cost-allocation-math';

describe('purchase-cost-allocation-math', () => {
  it('splits BY_QUANTITY weights proportionally (FIN-EXP-018)', () => {
    const byQty = allocateByWeights(new Prisma.Decimal('10000000'), CurrencyCode.IRR, [
      { targetId: 'a', weight: new Prisma.Decimal(40) },
      { targetId: 'b', weight: new Prisma.Decimal(60) },
    ]);
    expect(byQty.find((x) => x.targetId === 'a')!.allocatedAmount.toString()).toBe('4000000');
    expect(byQty.find((x) => x.targetId === 'b')!.allocatedAmount.toString()).toBe('6000000');
  });

  it('splits BY_VALUE weights proportionally', () => {
    const byVal = allocateByWeights(new Prisma.Decimal('10000000'), CurrencyCode.IRR, [
      { targetId: 'a', weight: new Prisma.Decimal('200000000') },
      { targetId: 'b', weight: new Prisma.Decimal('300000000') },
    ]);
    expect(byVal.find((x) => x.targetId === 'a')!.allocatedAmount.toString()).toBe('4000000');
    expect(byVal.find((x) => x.targetId === 'b')!.allocatedAmount.toString()).toBe('6000000');
  });

  it('largest-remainder rounding preserves exact total', () => {
    const rounded = allocateByWeights(new Prisma.Decimal('10'), CurrencyCode.IRR, [
      { targetId: 'a', weight: new Prisma.Decimal(1) },
      { targetId: 'b', weight: new Prisma.Decimal(1) },
      { targetId: 'c', weight: new Prisma.Decimal(1) },
    ]);
    const sum = rounded.reduce((a, l) => a.add(l.allocatedAmount), new Prisma.Decimal(0));
    expect(sum.toString()).toBe('10');
    assertAllocationSumExact(
      new Prisma.Decimal('10'),
      rounded.map((l) => ({ allocatedAmount: l.allocatedAmount })),
    );
  });

  it('assertAllocationSumExact rejects mismatch', () => {
    expect(() =>
      assertAllocationSumExact(new Prisma.Decimal('100'), [
        { allocatedAmount: new Prisma.Decimal('40') },
        { allocatedAmount: new Prisma.Decimal('50') },
      ]),
    ).toThrow(/Allocation sum/);
  });
});
