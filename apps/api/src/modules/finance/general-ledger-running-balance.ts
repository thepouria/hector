import { JournalLineDirection, Prisma } from '@hector/database';

export type SignedLedgerLine = {
  direction: JournalLineDirection;
  baseAmount: Prisma.Decimal | string | number;
};

/**
 * Signed base delta for a journal line: DEBIT +, CREDIT −.
 * Matches trial-balance net (debit − credit).
 */
export function signedBaseDelta(line: SignedLedgerLine): Prisma.Decimal {
  const amount =
    line.baseAmount instanceof Prisma.Decimal
      ? line.baseAmount
      : new Prisma.Decimal(line.baseAmount);
  return line.direction === JournalLineDirection.DEBIT ? amount : amount.neg();
}

/**
 * Running balances in base currency starting from `openingBalanceBase`.
 * Returns one runningBalanceBase string per input line (same order).
 */
export function computeRunningBalances(
  openingBalanceBase: Prisma.Decimal | string | number,
  lines: ReadonlyArray<SignedLedgerLine>,
): { runningBalances: string[]; closingBalanceBase: string } {
  let running =
    openingBalanceBase instanceof Prisma.Decimal
      ? openingBalanceBase
      : new Prisma.Decimal(openingBalanceBase);
  const runningBalances: string[] = [];
  for (const line of lines) {
    running = running.plus(signedBaseDelta(line));
    runningBalances.push(running.toFixed());
  }
  return {
    runningBalances,
    closingBalanceBase: running.toFixed(),
  };
}
