import { JournalLineDirection, Prisma } from '@hector/database';
import { assertJournalLinesBalanced } from './journal-balance';
import { formatJournalNumber } from './journal-numbering';

describe('journal-balance', () => {
  it('accepts balanced two-line journal', () => {
    const result = assertJournalLinesBalanced([
      {
        direction: JournalLineDirection.DEBIT,
        baseAmount: new Prisma.Decimal('100'),
      },
      {
        direction: JournalLineDirection.CREDIT,
        baseAmount: new Prisma.Decimal('100'),
      },
    ]);
    expect(result.totalDebitBase.eq(100)).toBe(true);
    expect(result.totalCreditBase.eq(100)).toBe(true);
  });

  it('rejects unbalanced journal', () => {
    expect(() =>
      assertJournalLinesBalanced([
        {
          direction: JournalLineDirection.DEBIT,
          baseAmount: new Prisma.Decimal('100'),
        },
        {
          direction: JournalLineDirection.CREDIT,
          baseAmount: new Prisma.Decimal('90'),
        },
      ]),
    ).toThrow();
  });

  it('rejects single line', () => {
    expect(() =>
      assertJournalLinesBalanced([
        {
          direction: JournalLineDirection.DEBIT,
          baseAmount: new Prisma.Decimal('100'),
        },
      ]),
    ).toThrow();
  });

  it('rejects zero totals', () => {
    expect(() =>
      assertJournalLinesBalanced([
        {
          direction: JournalLineDirection.DEBIT,
          baseAmount: new Prisma.Decimal('0'),
        },
        {
          direction: JournalLineDirection.CREDIT,
          baseAmount: new Prisma.Decimal('0'),
        },
      ]),
    ).toThrow();
  });
});

describe('journal-numbering', () => {
  it('formats JRN-######', () => {
    expect(formatJournalNumber(1)).toBe('JRN-000001');
    expect(formatJournalNumber(42)).toBe('JRN-000042');
  });
});
