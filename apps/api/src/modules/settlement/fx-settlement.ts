import { CurrencyCode, FxRateSourceType, Prisma } from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { buildExplicitSettlementQuote } from '../finance/settlement-fx';
import { convertMoney, parseFxRate } from '../finance/money/fx-rate';
import { moneyOf, parseMoneyAmount, roundMoneyAmount } from '../finance/money/money';
import { SETTLEMENT_ERROR_MESSAGES } from './settlement.constants';

export type FxSettlementInput = {
  rate: string;
  rateBaseCurrency: CurrencyCode;
  rateQuoteCurrency: CurrencyCode;
  rateDate?: string;
  rateSourceType?: FxRateSourceType;
  fxRateId?: string;
};

export type ResolvedFxSettlement = {
  obligationAmount: Prisma.Decimal;
  obligationCurrency: CurrencyCode;
  paymentAmount: Prisma.Decimal;
  paymentCurrency: CurrencyCode;
  rate: Prisma.Decimal;
  rateBaseCurrency: CurrencyCode;
  rateQuoteCurrency: CurrencyCode;
  rateDate: Date;
  rateSourceType: FxRateSourceType;
  fxRateId: string | null;
  roundingDifference: Prisma.Decimal;
};

/**
 * Resolve same-currency or cross-currency settlement dimensions.
 * Obligation amount always reduces the liability in obligation currency.
 * Payment amount always consumes Finance Payment capacity.
 */
export function resolveAllocationMoney(input: {
  obligationCurrency: CurrencyCode;
  paymentCurrency: CurrencyCode;
  /** Obligation amount to settle (required). */
  obligationAmountRaw: string;
  /** Optional explicit payment amount; required for cross-currency when not derived. */
  paymentAmountRaw?: string;
  fx?: FxSettlementInput;
}): ResolvedFxSettlement {
  const obligationAmount = parseMoneySafe(input.obligationAmountRaw, input.obligationCurrency);

  if (input.obligationCurrency === input.paymentCurrency) {
    if (input.fx) {
      throw new AppError({
        code: ERROR_CODES.SETTLEMENT_CROSS_CURRENCY_INVALID,
        message: 'FX evidence is not allowed for same-currency settlement.',
        statusCode: 400,
      });
    }
    const paymentAmount = input.paymentAmountRaw
      ? parseMoneySafe(input.paymentAmountRaw, input.paymentCurrency)
      : obligationAmount;
    if (!paymentAmount.eq(obligationAmount)) {
      throw new AppError({
        code: ERROR_CODES.SETTLEMENT_CROSS_CURRENCY_INVALID,
        message: 'Same-currency settlement requires payment amount equal to obligation amount.',
        statusCode: 409,
      });
    }
    return {
      obligationAmount,
      obligationCurrency: input.obligationCurrency,
      paymentAmount,
      paymentCurrency: input.paymentCurrency,
      rate: new Prisma.Decimal(1),
      rateBaseCurrency: input.obligationCurrency,
      rateQuoteCurrency: input.obligationCurrency,
      rateDate: new Date(),
      rateSourceType: FxRateSourceType.SYSTEM,
      fxRateId: null,
      roundingDifference: new Prisma.Decimal(0),
    };
  }

  // Cross-currency — FX evidence mandatory
  if (!input.fx) {
    throw new AppError({
      code: ERROR_CODES.SETTLEMENT_FX_RATE_REQUIRED,
      message: SETTLEMENT_ERROR_MESSAGES.CURRENCY_MISMATCH,
      statusCode: 409,
    });
  }

  let rate: Prisma.Decimal;
  try {
    rate = parseFxRate(input.fx.rate);
  } catch {
    throw new AppError({
      code: ERROR_CODES.SETTLEMENT_FX_RATE_INVALID,
      message: 'FX settlement rate must be a positive Decimal.',
      statusCode: 400,
    });
  }

  const quote = buildExplicitSettlementQuote({
    rate,
    baseCurrency: input.fx.rateBaseCurrency,
    quoteCurrency: input.fx.rateQuoteCurrency,
  });

  // Expected payment from obligation × rate
  let expectedPayment: Prisma.Decimal;
  try {
    expectedPayment = convertMoney({
      money: moneyOf(obligationAmount, input.obligationCurrency),
      toCurrency: input.paymentCurrency,
      quote,
    }).amount;
  } catch {
    throw new AppError({
      code: ERROR_CODES.SETTLEMENT_FX_RATE_INVALID,
      message:
        'FX rate pair cannot convert obligation currency to payment currency. Use 1 USD = N IRR style pairs.',
      statusCode: 409,
    });
  }

  const paymentAmount = input.paymentAmountRaw
    ? parseMoneySafe(input.paymentAmountRaw, input.paymentCurrency)
    : expectedPayment;

  const roundingDifference = paymentAmount.minus(expectedPayment);
  // Allow exact match or ±1 minor unit after rounding (IRR = 0 dp → ±1)
  const maxAbsDiff = new Prisma.Decimal(1);
  if (roundingDifference.abs().gt(maxAbsDiff)) {
    throw new AppError({
      code: ERROR_CODES.SETTLEMENT_CROSS_CURRENCY_INVALID,
      message: `Payment amount ${paymentAmount.toString()} is inconsistent with obligation ${obligationAmount.toString()} × rate ${rate.toString()} (expected ${expectedPayment.toString()}).`,
      statusCode: 409,
    });
  }

  return {
    obligationAmount,
    obligationCurrency: input.obligationCurrency,
    paymentAmount,
    paymentCurrency: input.paymentCurrency,
    rate,
    rateBaseCurrency: input.fx.rateBaseCurrency,
    rateQuoteCurrency: input.fx.rateQuoteCurrency,
    rateDate: input.fx.rateDate ? new Date(input.fx.rateDate) : new Date(),
    rateSourceType: input.fx.rateSourceType ?? FxRateSourceType.MANUAL,
    fxRateId: input.fx.fxRateId ?? null,
    roundingDifference: roundMoneyAmount(roundingDifference, input.paymentCurrency),
  };
}

function parseMoneySafe(value: string, currency: CurrencyCode): Prisma.Decimal {
  try {
    return parseMoneyAmount(value, currency);
  } catch {
    throw new AppError({
      code: ERROR_CODES.SETTLEMENT_INVALID_MONEY,
      message: SETTLEMENT_ERROR_MESSAGES.INVALID_AMOUNT,
      statusCode: 400,
    });
  }
}
