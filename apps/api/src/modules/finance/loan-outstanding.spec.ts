import { LoanStatus, Prisma } from '@hector/database';
import {
  deriveLoanOperationalStatus,
  deriveLoanPrincipalTotals,
  fundingRolesAreIndependent,
  isCapitalFundingType,
  isLoanOverdue,
} from './loan-outstanding';

describe('loan outstanding derivation', () => {
  it('computes outstanding = received − repaid', () => {
    const totals = deriveLoanPrincipalTotals({
      postedDisbursementAmounts: [new Prisma.Decimal('10000'), new Prisma.Decimal('5000')],
      postedPrincipalRepayments: [new Prisma.Decimal('3000')],
    });
    expect(totals.receivedPrincipal.toFixed()).toBe('15000');
    expect(totals.repaidPrincipal.toFixed()).toBe('3000');
    expect(totals.outstandingPrincipal.toFixed()).toBe('12000');
  });

  it('derives ACTIVE / PARTIALLY_REPAID / SETTLED', () => {
    expect(
      deriveLoanOperationalStatus({
        receivedPrincipal: new Prisma.Decimal('10000'),
        outstandingPrincipal: new Prisma.Decimal('10000'),
        currentStatus: LoanStatus.ACTIVE,
      }),
    ).toBe(LoanStatus.ACTIVE);

    expect(
      deriveLoanOperationalStatus({
        receivedPrincipal: new Prisma.Decimal('10000'),
        outstandingPrincipal: new Prisma.Decimal('4000'),
        currentStatus: LoanStatus.ACTIVE,
      }),
    ).toBe(LoanStatus.PARTIALLY_REPAID);

    expect(
      deriveLoanOperationalStatus({
        receivedPrincipal: new Prisma.Decimal('10000'),
        outstandingPrincipal: new Prisma.Decimal('0'),
        currentStatus: LoanStatus.ACTIVE,
      }),
    ).toBe(LoanStatus.SETTLED);
  });

  it('marks overdue only when due and outstanding', () => {
    expect(
      isLoanOverdue({
        dueDate: new Date('2020-01-01'),
        outstandingPrincipal: new Prisma.Decimal('1'),
        now: new Date('2026-01-01'),
      }),
    ).toBe(true);
    expect(
      isLoanOverdue({
        dueDate: new Date('2020-01-01'),
        outstandingPrincipal: new Prisma.Decimal('0'),
        now: new Date('2026-01-01'),
      }),
    ).toBe(false);
  });
});

describe('funding type separation', () => {
  it('rejects LOAN as capital funding type', () => {
    expect(isCapitalFundingType('PARTNER_EQUITY')).toBe(true);
    expect(isCapitalFundingType('LOAN')).toBe(false);
    expect(isCapitalFundingType('LOAN_RECEIVED')).toBe(false);
  });

  it('keeps equity and debt roles independent for same person', () => {
    expect(fundingRolesAreIndependent()).toBe(true);
  });
});
