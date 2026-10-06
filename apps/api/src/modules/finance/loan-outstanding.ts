import { LoanStatus, Prisma } from '@hector/database';

export type LoanPrincipalTotals = {
  receivedPrincipal: Prisma.Decimal;
  repaidPrincipal: Prisma.Decimal;
  outstandingPrincipal: Prisma.Decimal;
};

/**
 * Outstanding = posted received principal − posted principal repayments.
 * Never an editable field.
 */
export function deriveLoanPrincipalTotals(input: {
  postedDisbursementAmounts: Prisma.Decimal[];
  postedPrincipalRepayments: Prisma.Decimal[];
}): LoanPrincipalTotals {
  const receivedPrincipal = input.postedDisbursementAmounts.reduce(
    (sum, amount) => sum.plus(amount),
    new Prisma.Decimal(0),
  );
  const repaidPrincipal = input.postedPrincipalRepayments.reduce(
    (sum, amount) => sum.plus(amount),
    new Prisma.Decimal(0),
  );
  const outstandingPrincipal = receivedPrincipal.minus(repaidPrincipal);
  return { receivedPrincipal, repaidPrincipal, outstandingPrincipal };
}

/**
 * Status from financial truth (not free-form user mutation of SETTLED while money remains).
 * CANCELLED / DRAFT / REVERSED are lifecycle states managed by the service.
 */
export function deriveLoanOperationalStatus(input: {
  receivedPrincipal: Prisma.Decimal;
  outstandingPrincipal: Prisma.Decimal;
  currentStatus: LoanStatus;
}): LoanStatus {
  if (
    input.currentStatus === LoanStatus.CANCELLED ||
    input.currentStatus === LoanStatus.REVERSED ||
    input.currentStatus === LoanStatus.DRAFT
  ) {
    if (input.receivedPrincipal.lte(0)) {
      return input.currentStatus;
    }
  }

  if (input.receivedPrincipal.lte(0)) {
    return LoanStatus.DRAFT;
  }
  if (input.outstandingPrincipal.lte(0)) {
    return LoanStatus.SETTLED;
  }
  if (input.outstandingPrincipal.lt(input.receivedPrincipal)) {
    return LoanStatus.PARTIALLY_REPAID;
  }
  return LoanStatus.ACTIVE;
}

/** Equity funding types never include LOAN — loans are a separate entity. */
export const CAPITAL_FUNDING_TYPES = [
  'OWNER_EQUITY',
  'PARTNER_EQUITY',
  'OTHER_FUNDING',
] as const;

export type CapitalFundingTypeValue = (typeof CAPITAL_FUNDING_TYPES)[number];

export function isCapitalFundingType(value: string): value is CapitalFundingTypeValue {
  return (CAPITAL_FUNDING_TYPES as readonly string[]).includes(value);
}

/** Same person may be partner equity contributor AND loan lender — type is explicit. */
export function fundingRolesAreIndependent(): true {
  return true;
}

export function isLoanOverdue(input: {
  dueDate: Date | null;
  outstandingPrincipal: Prisma.Decimal;
  now?: Date;
}): boolean {
  if (!input.dueDate) return false;
  if (input.outstandingPrincipal.lte(0)) return false;
  const now = input.now ?? new Date();
  return input.dueDate.getTime() < now.getTime();
}
