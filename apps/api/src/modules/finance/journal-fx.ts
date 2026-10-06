import { CurrencyCode, FxRateType, Prisma } from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { getLatestApplicableRate, toFxRateQuote } from './fx-helpers';
import { convertMoney, fxQuote } from './money/fx-rate';
import { moneyOf } from './money/money';
import { JOURNAL_ERROR_MESSAGES } from './finance-journals.constants';

type Tx = Prisma.TransactionClient;

export type JournalBaseAmountResult = {
  baseAmount: Prisma.Decimal;
  baseCurrency: CurrencyCode;
  fxRate: Prisma.Decimal | null;
  fxRateSource: string | null;
};

/**
 * Resolve original → company base for a journal line.
 * Same currency: identity. Foreign: explicit rate or latest REFERENCE rate.
 * Never invents FX gain/loss.
 */
export async function resolveJournalBaseAmount(
  tx: Tx,
  input: {
    companyId: string;
    baseCurrency: CurrencyCode;
    originalAmount: Prisma.Decimal;
    originalCurrency: CurrencyCode;
    asOf: Date;
    explicitFxRate?: Prisma.Decimal | null;
    explicitFxBaseCurrency?: CurrencyCode | null;
    explicitFxQuoteCurrency?: CurrencyCode | null;
    explicitFxRateSource?: string | null;
  },
): Promise<JournalBaseAmountResult> {
  if (input.originalCurrency === input.baseCurrency) {
    return {
      baseAmount: input.originalAmount,
      baseCurrency: input.baseCurrency,
      fxRate: null,
      fxRateSource: null,
    };
  }

  if (
    input.explicitFxRate &&
    input.explicitFxBaseCurrency &&
    input.explicitFxQuoteCurrency
  ) {
    const quote = fxQuote({
      baseCurrency: input.explicitFxBaseCurrency,
      quoteCurrency: input.explicitFxQuoteCurrency,
      rate: input.explicitFxRate,
    });
    const converted = convertMoney({
      money: moneyOf(input.originalAmount, input.originalCurrency),
      toCurrency: input.baseCurrency,
      quote,
    });
    return {
      baseAmount: converted.amount,
      baseCurrency: input.baseCurrency,
      fxRate: input.explicitFxRate,
      fxRateSource: input.explicitFxRateSource ?? 'EXPLICIT',
    };
  }

  // Prefer USD/IRR REFERENCE when converting foreign → base.
  const direct = await getLatestApplicableRate(tx, {
    companyId: input.companyId,
    baseCurrency: input.originalCurrency,
    quoteCurrency: input.baseCurrency,
    rateType: FxRateType.REFERENCE,
    asOf: input.asOf,
  });
  if (direct) {
    const converted = convertMoney({
      money: moneyOf(input.originalAmount, input.originalCurrency),
      toCurrency: input.baseCurrency,
      quote: toFxRateQuote(direct),
    });
    return {
      baseAmount: converted.amount,
      baseCurrency: input.baseCurrency,
      fxRate: direct.rate,
      fxRateSource: `FX_RATE:${direct.id}`,
    };
  }

  const inverted = await getLatestApplicableRate(tx, {
    companyId: input.companyId,
    baseCurrency: input.baseCurrency,
    quoteCurrency: input.originalCurrency,
    rateType: FxRateType.REFERENCE,
    asOf: input.asOf,
  });
  if (inverted) {
    const converted = convertMoney({
      money: moneyOf(input.originalAmount, input.originalCurrency),
      toCurrency: input.baseCurrency,
      quote: toFxRateQuote(inverted),
    });
    return {
      baseAmount: converted.amount,
      baseCurrency: input.baseCurrency,
      fxRate: inverted.rate,
      fxRateSource: `FX_RATE:${inverted.id}`,
    };
  }

  throw new AppError({
    code: ERROR_CODES.JOURNAL_FX_RATE_REQUIRED,
    message: JOURNAL_ERROR_MESSAGES.FX_RATE_REQUIRED,
    statusCode: 409,
  });
}
