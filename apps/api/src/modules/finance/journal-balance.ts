import { CurrencyCode, JournalLineDirection, Prisma } from '@hector/database';
import { JOURNAL_ERROR_MESSAGES } from './finance-journals.constants';

export type JournalLineDraftInput = {
  ledgerAccountId: string;
  direction: JournalLineDirection;
  originalAmount: Prisma.Decimal;
  originalCurrency: CurrencyCode;
  baseAmount: Prisma.Decimal;
  baseCurrency: CurrencyCode;
  fxRate?: Prisma.Decimal | null;
  fxRateSource?: string | null;
  description?: string | null;
  lineOrder?: number;
};

export type JournalBalanceResult = {
  totalDebitBase: Prisma.Decimal;
  totalCreditBase: Prisma.Decimal;
};

/**
 * Assert journal draft lines are balanced in base currency with >=2 non-zero lines.
 * Uses Decimal exact equality (no epsilon).
 */
export function assertJournalLinesBalanced(
  lines: ReadonlyArray<Pick<JournalLineDraftInput, 'direction' | 'baseAmount'>>,
): JournalBalanceResult {
  if (lines.length < 2) {
    throw new Error(JOURNAL_ERROR_MESSAGES.TOO_FEW_LINES);
  }

  let totalDebitBase = new Prisma.Decimal(0);
  let totalCreditBase = new Prisma.Decimal(0);

  for (const line of lines) {
    if (line.baseAmount.lte(0)) {
      throw new Error(JOURNAL_ERROR_MESSAGES.INVALID_LINE_AMOUNT);
    }
    if (line.direction === JournalLineDirection.DEBIT) {
      totalDebitBase = totalDebitBase.plus(line.baseAmount);
    } else {
      totalCreditBase = totalCreditBase.plus(line.baseAmount);
    }
  }

  if (totalDebitBase.eq(0) || totalCreditBase.eq(0)) {
    throw new Error(JOURNAL_ERROR_MESSAGES.ZERO_TOTAL);
  }

  if (!totalDebitBase.eq(totalCreditBase)) {
    throw new Error(JOURNAL_ERROR_MESSAGES.UNBALANCED);
  }

  return { totalDebitBase, totalCreditBase };
}
