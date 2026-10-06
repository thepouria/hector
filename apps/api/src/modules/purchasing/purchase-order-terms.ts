import {
  CurrencyCode,
  PaymentTermType,
  Prisma,
  PurchaseCommercialType,
  PurchaseTermBasis,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import {
  parseUtcBusinessDate,
  toUtcBusinessDate,
  utcBusinessDateKey,
} from './purchase-order-due';
import {
  PURCHASE_ORDER_ERROR_MESSAGES,
  PURCHASE_ORDER_FX_RATE_MAX_DECIMAL_PLACES,
  PURCHASE_ORDER_MAX_NET_DAYS,
  PURCHASE_ORDER_MAX_TOTAL,
} from './purchasing.constants';
import { parsePositiveMoney } from './supplier-offer.validation';

export type PurchaseTermsFields = {
  purchaseType: PurchaseCommercialType | null;
  paymentTermType: PaymentTermType | null;
  netDays: number | null;
  termBasis: PurchaseTermBasis | null;
  dueDate: Date | null;
  obligationAmount: Prisma.Decimal | null;
  obligationCurrency: CurrencyCode | null;
  referenceFxRate: Prisma.Decimal | null;
  referenceFxBaseCurrency: CurrencyCode | null;
  referenceFxQuoteCurrency: CurrencyCode | null;
  referenceFxRateAt: Date | null;
};

export type ResolvePurchaseTermsInput = {
  purchaseType: PurchaseCommercialType | null;
  paymentTermType: PaymentTermType | null;
  netDays: number | null;
  /**
   * Client-supplied due date — authoritative only for FIXED_DATE.
   * Ignored/rejected for NET_DAYS (server calculates) and IMMEDIATE (null).
   */
  dueDate: Date | string | null;
  obligationAmount: string | Prisma.Decimal | null;
  obligationCurrency: CurrencyCode | null;
  referenceFxRate: string | Prisma.Decimal | null;
  referenceFxBaseCurrency: CurrencyCode | null;
  referenceFxQuoteCurrency: CurrencyCode | null;
  referenceFxRateAt: Date | null;
  currency: CurrencyCode;
  orderDate: Date;
  /** Current PO total; used to sync FX obligation. */
  total?: Prisma.Decimal | null;
  /**
   * When true (approve / mark-ordered): purchaseType and type-specific fields must be complete.
   * When false (draft): allow incomplete FX/term fields while editing.
   */
  complete: boolean;
};

type CreditSchedule = {
  paymentTermType: PaymentTermType;
  netDays: number | null;
  termBasis: PurchaseTermBasis | null;
  dueDate: Date | null;
};

function termsError(message: string = PURCHASE_ORDER_ERROR_MESSAGES.INVALID_TERMS): never {
  throw new AppError({
    code: ERROR_CODES.PURCHASE_ORDER_INVALID_TERMS,
    message,
    statusCode: 400,
  });
}

function incompleteError(
  message: string = PURCHASE_ORDER_ERROR_MESSAGES.TERMS_INCOMPLETE,
): never {
  throw new AppError({
    code: ERROR_CODES.PURCHASE_ORDER_TERMS_INCOMPLETE,
    message,
    statusCode: 400,
  });
}

function fxError(message: string = PURCHASE_ORDER_ERROR_MESSAGES.INVALID_FX): never {
  throw new AppError({
    code: ERROR_CODES.PURCHASE_ORDER_INVALID_FX,
    message,
    statusCode: 400,
  });
}

export function defaultPaymentTermType(
  purchaseType: PurchaseCommercialType | null,
): PaymentTermType | null {
  if (purchaseType === PurchaseCommercialType.CASH) return PaymentTermType.IMMEDIATE;
  if (purchaseType === PurchaseCommercialType.TERM_CREDIT) return PaymentTermType.NET_DAYS;
  if (purchaseType === PurchaseCommercialType.FX_CREDIT) return PaymentTermType.NET_DAYS;
  return null;
}

/** UTC calendar date of `orderDate` + `netDays` (calendar days), stored at UTC noon. */
export function calculateDueDateFromOrderDate(orderDate: Date, netDays: number): Date {
  if (!Number.isInteger(netDays) || netDays < 1) {
    termsError('netDays must be a positive integer.');
  }
  const base = toUtcBusinessDate(orderDate);
  return new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + netDays, 12, 0, 0, 0),
  );
}

function parseOptionalDueDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) termsError('dueDate is invalid.');
    return toUtcBusinessDate(value);
  }
  try {
    return parseUtcBusinessDate(value);
  } catch {
    termsError('dueDate is invalid.');
  }
}

/**
 * Resolve IMMEDIATE / NET_DAYS / FIXED_DATE schedule for TERM_CREDIT or FX_CREDIT.
 * NET_DAYS dueDate is always server-calculated; FIXED_DATE dueDate is client-agreed.
 */
function resolveCreditSchedule(input: {
  paymentTermType: PaymentTermType | null;
  netDays: number | null;
  dueDate: Date | string | null;
  orderDate: Date;
  complete: boolean;
  /** Default when paymentTermType omitted (TERM_CREDIT / FX_CREDIT → NET_DAYS). */
  defaultTermType: PaymentTermType;
}): CreditSchedule {
  const paymentTermType = input.paymentTermType ?? input.defaultTermType;

  if (paymentTermType === PaymentTermType.IMMEDIATE) {
    if (input.netDays !== null || input.dueDate !== null) {
      termsError('IMMEDIATE payment terms cannot carry netDays or dueDate.');
    }
    return {
      paymentTermType,
      netDays: null,
      termBasis: null,
      dueDate: null,
    };
  }

  if (paymentTermType === PaymentTermType.NET_DAYS) {
    if (input.dueDate !== null) {
      termsError('NET_DAYS dueDate is server-calculated and cannot be set by the client.');
    }
    assertNetDays(input.netDays);
    if (input.complete && (input.netDays === null || input.netDays < 1)) {
      incompleteError('NET_DAYS requires netDays > 0.');
    }
    const netDays = input.netDays;
    const termBasis = netDays !== null ? PurchaseTermBasis.ORDER_DATE : null;
    const dueDate =
      netDays !== null ? calculateDueDateFromOrderDate(input.orderDate, netDays) : null;
    return { paymentTermType, netDays, termBasis, dueDate };
  }

  if (paymentTermType === PaymentTermType.FIXED_DATE) {
    if (input.netDays !== null) {
      termsError('FIXED_DATE cannot carry netDays or termBasis.');
    }
    const dueDate = parseOptionalDueDate(input.dueDate);
    if (input.complete && dueDate === null) {
      incompleteError('FIXED_DATE requires an explicit dueDate.');
    }
    if (dueDate !== null) {
      const orderDay = utcBusinessDateKey(toUtcBusinessDate(input.orderDate));
      const dueDay = utcBusinessDateKey(dueDate);
      if (dueDay < orderDay) {
        termsError('FIXED_DATE dueDate cannot be before orderDate.');
      }
    }
    return {
      paymentTermType,
      netDays: null,
      termBasis: null,
      dueDate,
    };
  }

  termsError('Unsupported paymentTermType for credit purchase.');
}

/**
 * Deterministic reference local valuation (analysis only — not the foreign liability).
 * Not persisted; derived from immutable obligation × reference rate after confirm.
 * IRR quote amounts round HALF_UP to whole rials (scale 0).
 */
export function computeReferenceValuation(
  obligationAmount: Prisma.Decimal | string,
  referenceFxRate: Prisma.Decimal | string,
  quoteCurrency: CurrencyCode = CurrencyCode.IRR,
): Prisma.Decimal {
  const amount =
    obligationAmount instanceof Prisma.Decimal
      ? obligationAmount
      : new Prisma.Decimal(obligationAmount);
  const rate =
    referenceFxRate instanceof Prisma.Decimal
      ? referenceFxRate
      : new Prisma.Decimal(referenceFxRate);
  const product = amount.mul(rate);
  if (quoteCurrency === CurrencyCode.IRR) {
    return product.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  }
  return product.toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
}

function assertNetDays(netDays: number | null): void {
  if (netDays === null) return;
  if (!Number.isInteger(netDays) || netDays < 1 || netDays > PURCHASE_ORDER_MAX_NET_DAYS) {
    termsError(`netDays must be an integer between 1 and ${PURCHASE_ORDER_MAX_NET_DAYS}.`);
  }
}

function parseAmount(
  value: string | Prisma.Decimal | null,
  currency: CurrencyCode,
): Prisma.Decimal | null {
  if (value === null) return null;
  if (value instanceof Prisma.Decimal) {
    if (value.lte(0)) termsError('obligationAmount must be a positive decimal amount.');
    if (currency === CurrencyCode.IRR && !value.equals(value.toDecimalPlaces(0))) {
      throw AppError.validation('IRR amounts must be whole rials (scale 0).');
    }
    return value;
  }
  const amount = parsePositiveMoney(value, currency);
  if (amount.gte(PURCHASE_ORDER_MAX_TOTAL)) {
    throw new AppError({
      code: ERROR_CODES.PURCHASE_ORDER_TOTAL_OUT_OF_RANGE,
      message: PURCHASE_ORDER_ERROR_MESSAGES.TOTAL_OUT_OF_RANGE,
      statusCode: 400,
    });
  }
  return amount;
}

function parseFxRate(value: string | Prisma.Decimal | null): Prisma.Decimal | null {
  if (value === null) return null;
  const rate =
    value instanceof Prisma.Decimal
      ? value
      : (() => {
          const trimmed = value.trim();
          if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) fxError();
          return new Prisma.Decimal(trimmed);
        })();
  if (rate.lte(0)) fxError();
  if (rate.decimalPlaces() > PURCHASE_ORDER_FX_RATE_MAX_DECIMAL_PLACES) {
    fxError(
      `referenceFxRate precision exceeds ${PURCHASE_ORDER_FX_RATE_MAX_DECIMAL_PLACES} decimal places.`,
    );
  }
  return rate;
}

function emptyTerms(): PurchaseTermsFields {
  return {
    purchaseType: null,
    paymentTermType: null,
    netDays: null,
    termBasis: null,
    dueDate: null,
    obligationAmount: null,
    obligationCurrency: null,
    referenceFxRate: null,
    referenceFxBaseCurrency: null,
    referenceFxQuoteCurrency: null,
    referenceFxRateAt: null,
  };
}

/**
 * After a purchase-type change, drop fields that cannot apply to the new type.
 * Call before merging client patches into `resolvePurchaseTerms`.
 */
export function clearedTermsForType(
  purchaseType: PurchaseCommercialType | null,
): Omit<PurchaseTermsFields, 'purchaseType'> {
  if (purchaseType === PurchaseCommercialType.CASH) {
    return {
      paymentTermType: PaymentTermType.IMMEDIATE,
      netDays: null,
      termBasis: null,
      dueDate: null,
      obligationAmount: null,
      obligationCurrency: null,
      referenceFxRate: null,
      referenceFxBaseCurrency: null,
      referenceFxQuoteCurrency: null,
      referenceFxRateAt: null,
    };
  }
  if (purchaseType === PurchaseCommercialType.TERM_CREDIT) {
    return {
      paymentTermType: PaymentTermType.NET_DAYS,
      netDays: null,
      termBasis: null,
      dueDate: null,
      obligationAmount: null,
      obligationCurrency: null,
      referenceFxRate: null,
      referenceFxBaseCurrency: null,
      referenceFxQuoteCurrency: null,
      referenceFxRateAt: null,
    };
  }
  if (purchaseType === PurchaseCommercialType.FX_CREDIT) {
    return {
      paymentTermType: PaymentTermType.NET_DAYS,
      netDays: null,
      termBasis: null,
      dueDate: null,
      obligationAmount: null,
      obligationCurrency: null,
      referenceFxRate: null,
      referenceFxBaseCurrency: null,
      referenceFxQuoteCurrency: null,
      referenceFxRateAt: null,
    };
  }
  return emptyTerms();
}

/**
 * Resolve and validate purchase-type commercial terms from a fully merged input.
 */
export function resolvePurchaseTerms(input: ResolvePurchaseTermsInput): PurchaseTermsFields {
  const purchaseType = input.purchaseType;
  const currency = input.currency;
  const orderDate = input.orderDate;

  if (purchaseType === null) {
    if (input.complete) {
      incompleteError('purchaseType is required before approval.');
    }
    return emptyTerms();
  }

  assertNetDays(input.netDays);
  const obligationAmount = parseAmount(input.obligationAmount, currency);
  const referenceFxRate = parseFxRate(input.referenceFxRate);

  if (purchaseType === PurchaseCommercialType.CASH) {
    if (
      input.netDays !== null ||
      input.dueDate !== null ||
      obligationAmount !== null ||
      input.obligationCurrency !== null ||
      referenceFxRate !== null ||
      input.referenceFxBaseCurrency !== null ||
      input.referenceFxQuoteCurrency !== null ||
      input.referenceFxRateAt !== null ||
      (input.paymentTermType !== null &&
        input.paymentTermType !== PaymentTermType.IMMEDIATE)
    ) {
      termsError('CASH purchase orders cannot carry credit or FX obligation fields.');
    }
    return {
      purchaseType,
      paymentTermType: PaymentTermType.IMMEDIATE,
      netDays: null,
      termBasis: null,
      dueDate: null,
      obligationAmount: null,
      obligationCurrency: null,
      referenceFxRate: null,
      referenceFxBaseCurrency: null,
      referenceFxQuoteCurrency: null,
      referenceFxRateAt: null,
    };
  }

  if (purchaseType === PurchaseCommercialType.TERM_CREDIT) {
    if (
      obligationAmount !== null ||
      input.obligationCurrency !== null ||
      referenceFxRate !== null ||
      input.referenceFxBaseCurrency !== null ||
      input.referenceFxQuoteCurrency !== null ||
      input.referenceFxRateAt !== null
    ) {
      termsError('TERM_CREDIT cannot carry FX obligation or reference FX fields.');
    }
    const schedule = resolveCreditSchedule({
      paymentTermType: input.paymentTermType,
      netDays: input.netDays,
      dueDate: input.dueDate,
      orderDate,
      complete: input.complete,
      defaultTermType: PaymentTermType.NET_DAYS,
    });
    if (
      schedule.paymentTermType !== PaymentTermType.NET_DAYS &&
      schedule.paymentTermType !== PaymentTermType.FIXED_DATE
    ) {
      termsError('TERM_CREDIT requires NET_DAYS or FIXED_DATE payment terms.');
    }
    return {
      purchaseType,
      ...schedule,
      obligationAmount: null,
      obligationCurrency: null,
      referenceFxRate: null,
      referenceFxBaseCurrency: null,
      referenceFxQuoteCurrency: null,
      referenceFxRateAt: null,
    };
  }

  // FX_CREDIT — MODEL A: PO currency = obligation currency; line prices in foreign units.
  const schedule = resolveCreditSchedule({
    paymentTermType: input.paymentTermType,
    netDays: input.netDays,
    dueDate: input.dueDate,
    orderDate,
    complete: input.complete,
    defaultTermType: PaymentTermType.NET_DAYS,
  });

  let obligationCurrency = input.obligationCurrency;
  let resolvedObligation = obligationAmount;

  const fxBase = input.referenceFxBaseCurrency;
  const fxQuote = input.referenceFxQuoteCurrency;
  const fxAny = referenceFxRate !== null || fxBase !== null || fxQuote !== null;
  if (fxAny) {
    if (referenceFxRate === null || fxBase === null || fxQuote === null) {
      fxError();
    }
    if (fxBase === fxQuote) {
      fxError('FX base and quote currencies must differ.');
    }
    // No cross-rate chains: base must be the foreign obligation currency (PO currency).
    if (fxBase !== currency) {
      fxError('referenceFxBaseCurrency must equal the FX obligation currency (PO currency).');
    }
  }

  if (obligationCurrency !== null && obligationCurrency !== currency) {
    termsError('FX_CREDIT obligationCurrency must match PO currency (MODEL A).');
  }

  const referenceFxRateAt = input.referenceFxRateAt;

  if (input.complete) {
    if (!input.total || input.total.lte(0)) {
      incompleteError('FX_CREDIT requires a positive PO total as the foreign obligation.');
    }
    resolvedObligation = input.total;
    obligationCurrency = currency;

    if (!referenceFxRate || !fxBase || !fxQuote) {
      incompleteError(
        'FX_CREDIT requires referenceFxRate with referenceFxBaseCurrency and referenceFxQuoteCurrency.',
      );
    }
    if (fxBase !== obligationCurrency) {
      fxError('referenceFxBaseCurrency must equal the FX obligation currency (PO currency).');
    }
  } else if (input.total && input.total.gt(0)) {
    // MODEL A draft: keep foreign obligation aligned with PO total whenever lines exist.
    resolvedObligation = input.total;
    if (obligationCurrency === null) {
      obligationCurrency = currency;
    }
  }
  if (resolvedObligation !== null && obligationCurrency === null) {
    obligationCurrency = currency;
  }

  return {
    purchaseType,
    ...schedule,
    obligationAmount: resolvedObligation,
    obligationCurrency,
    referenceFxRate,
    referenceFxBaseCurrency: fxBase,
    referenceFxQuoteCurrency: fxQuote,
    referenceFxRateAt,
  };
}

/** After item mutations that change `total`, keep FX obligation in sync. */
export function syncFxObligationFromTotal(
  purchaseType: PurchaseCommercialType | null,
  currency: CurrencyCode,
  total: Prisma.Decimal,
): { obligationAmount: Prisma.Decimal; obligationCurrency: CurrencyCode } | null {
  if (purchaseType !== PurchaseCommercialType.FX_CREDIT) return null;
  return { obligationAmount: total, obligationCurrency: currency };
}
