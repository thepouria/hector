import {
  CurrencyCode,
  FinancialAccountMovementDirection,
  FinancialAccountMovementType,
  FinancialAccountStatus,
  Prisma,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { computeAccountBalance, lockAccountsForUpdate } from './accounts.balance';
import { FINANCIAL_ACCOUNT_ERROR_MESSAGES } from './finance-accounts.constants';

type Tx = Prisma.TransactionClient;

export type AccountMovementLineInput = {
  accountId: string;
  direction: FinancialAccountMovementDirection;
  amount: Prisma.Decimal;
  currency: CurrencyCode;
  type: FinancialAccountMovementType;
  sourceType: string;
  sourceId: string | null;
  effectiveAt: Date;
  description?: string | null;
  requestId?: string | null;
};

/**
 * Canonical writer for FinancialAccountMovement rows.
 * Locks accounts, validates ACTIVE + currency, optionally guards OUT balances.
 */
export async function postMovementsInTx(
  tx: Tx,
  opts: {
    companyId: string;
    actorUserId: string;
    lines: AccountMovementLineInput[];
    checkBalances?: boolean;
    postedAt?: Date;
  },
): Promise<void> {
  if (opts.lines.length === 0) {
    return;
  }

  const accountIds = opts.lines.map((line) => line.accountId);
  await lockAccountsForUpdate(tx, opts.companyId, accountIds);

  const accounts = await tx.financialAccount.findMany({
    where: { companyId: opts.companyId, id: { in: [...new Set(accountIds)] } },
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const outTotals = new Map<string, Prisma.Decimal>();

  for (const line of opts.lines) {
    if (!line.amount.gt(0)) {
      throw AppError.validation('Movement amount must be positive.');
    }

    const account = byId.get(line.accountId);
    if (!account) {
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_NOT_FOUND,
        message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    if (account.status !== FinancialAccountStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_INACTIVE,
        message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.INACTIVE,
        statusCode: 409,
      });
    }
    if (account.currency !== line.currency) {
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_CURRENCY_IMMUTABLE,
        message:
          'Movement currency must match the financial account currency. Cross-currency FX is deferred.',
        statusCode: 409,
      });
    }

    if (line.direction === FinancialAccountMovementDirection.OUT) {
      const prev = outTotals.get(line.accountId) ?? new Prisma.Decimal(0);
      outTotals.set(line.accountId, prev.plus(line.amount));
    }
  }

  if (opts.checkBalances) {
    for (const [accountId, outAmount] of outTotals) {
      const balance = await computeAccountBalance(tx, opts.companyId, accountId);
      if (balance.lt(outAmount)) {
        throw new AppError({
          code: ERROR_CODES.FINANCIAL_ACCOUNT_INSUFFICIENT_BALANCE,
          message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.INSUFFICIENT_BALANCE,
          statusCode: 409,
        });
      }
    }
  }

  const postedAt = opts.postedAt ?? new Date();
  await tx.financialAccountMovement.createMany({
    data: opts.lines.map((line) => ({
      companyId: opts.companyId,
      accountId: line.accountId,
      direction: line.direction,
      amount: line.amount,
      currency: line.currency,
      type: line.type,
      sourceType: line.sourceType,
      sourceId: line.sourceId,
      effectiveAt: line.effectiveAt,
      postedAt,
      description: line.description ?? null,
      requestId: line.requestId ?? null,
      createdById: opts.actorUserId,
    })),
  });
}
