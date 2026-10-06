import {
  CurrencyCode,
  PaymentTermType,
  Prisma,
  PurchaseCommercialType,
  PurchasingLifecycleStatus,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import {
  PURCHASING_ERROR_MESSAGES,
  SUPPLIER_OFFER_NOTES_MAX_LENGTH,
} from './purchasing.constants';
import { normalizeDisplayText } from './purchasing.normalization';

export function parsePositiveMoney(
  value: string,
  currency: CurrencyCode,
): Prisma.Decimal {
  const trimmed = value.trim();
  if (!trimmed || !/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new AppError({
      code: ERROR_CODES.SUPPLIER_OFFER_INVALID_PRICE,
      message: PURCHASING_ERROR_MESSAGES.SUPPLIER_OFFER_INVALID_PRICE,
      statusCode: 400,
    });
  }
  const amount = new Prisma.Decimal(trimmed);
  if (amount.lte(0)) {
    throw new AppError({
      code: ERROR_CODES.SUPPLIER_OFFER_INVALID_PRICE,
      message: PURCHASING_ERROR_MESSAGES.SUPPLIER_OFFER_INVALID_PRICE,
      statusCode: 400,
    });
  }
  if (currency === CurrencyCode.IRR && !amount.equals(amount.toDecimalPlaces(0))) {
    throw AppError.validation('IRR unit prices must be whole rials (scale 0).');
  }
  if (currency === CurrencyCode.USD && amount.decimalPlaces() > 6) {
    throw AppError.validation('USD unit price precision exceeds supported scale.');
  }
  return amount;
}

export function parseOptionalPositiveFxRate(
  value: string | null | undefined,
): Prisma.Decimal | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new AppError({
      code: ERROR_CODES.SUPPLIER_OFFER_INVALID_FX,
      message: PURCHASING_ERROR_MESSAGES.SUPPLIER_OFFER_INVALID_FX,
      statusCode: 400,
    });
  }
  const rate = new Prisma.Decimal(trimmed);
  if (rate.lte(0)) {
    throw new AppError({
      code: ERROR_CODES.SUPPLIER_OFFER_INVALID_FX,
      message: PURCHASING_ERROR_MESSAGES.SUPPLIER_OFFER_INVALID_FX,
      statusCode: 400,
    });
  }
  return rate;
}

export function assertOfferCommercialTerms(input: {
  purchaseType: PurchaseCommercialType | null | undefined;
  paymentTermType: PaymentTermType | null | undefined;
  netDays: number | null | undefined;
}): void {
  const purchaseType = input.purchaseType ?? null;
  const paymentTermType = input.paymentTermType ?? null;
  const netDays = input.netDays ?? null;

  if (purchaseType === PurchaseCommercialType.CASH) {
    if (paymentTermType === PaymentTermType.NET_DAYS || paymentTermType === PaymentTermType.FIXED_DATE) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_OFFER_INVALID_TERMS,
        message: PURCHASING_ERROR_MESSAGES.SUPPLIER_OFFER_INVALID_TERMS,
        statusCode: 400,
      });
    }
    if (netDays !== null) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_OFFER_INVALID_TERMS,
        message: PURCHASING_ERROR_MESSAGES.SUPPLIER_OFFER_INVALID_TERMS,
        statusCode: 400,
      });
    }
  }

  if (purchaseType === PurchaseCommercialType.TERM_CREDIT) {
    if (paymentTermType === PaymentTermType.IMMEDIATE) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_OFFER_INVALID_TERMS,
        message: PURCHASING_ERROR_MESSAGES.SUPPLIER_OFFER_INVALID_TERMS,
        statusCode: 400,
      });
    }
    if (paymentTermType === PaymentTermType.NET_DAYS && (netDays === null || netDays < 1)) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_OFFER_INVALID_TERMS,
        message: 'TERM_CREDIT with NET_DAYS requires netDays > 0.',
        statusCode: 400,
      });
    }
  }

  if (paymentTermType === PaymentTermType.NET_DAYS && (netDays === null || netDays < 1)) {
    throw new AppError({
      code: ERROR_CODES.SUPPLIER_OFFER_INVALID_TERMS,
      message: 'NET_DAYS requires netDays > 0.',
      statusCode: 400,
    });
  }

  if (
    netDays !== null &&
    paymentTermType !== PaymentTermType.NET_DAYS &&
    purchaseType !== PurchaseCommercialType.TERM_CREDIT
  ) {
    throw new AppError({
      code: ERROR_CODES.SUPPLIER_OFFER_INVALID_TERMS,
      message: PURCHASING_ERROR_MESSAGES.SUPPLIER_OFFER_INVALID_TERMS,
      statusCode: 400,
    });
  }
}

export function assertOfferFxReference(input: {
  referenceFxRate: Prisma.Decimal | null | undefined;
  referenceFxBaseCurrency: CurrencyCode | null | undefined;
  referenceFxQuoteCurrency: CurrencyCode | null | undefined;
}): void {
  const rate = input.referenceFxRate ?? null;
  const base = input.referenceFxBaseCurrency ?? null;
  const quote = input.referenceFxQuoteCurrency ?? null;
  const anySet = rate !== null || base !== null || quote !== null;
  if (!anySet) return;
  if (rate === null || base === null || quote === null) {
    throw new AppError({
      code: ERROR_CODES.SUPPLIER_OFFER_INVALID_FX,
      message: PURCHASING_ERROR_MESSAGES.SUPPLIER_OFFER_INVALID_FX,
      statusCode: 400,
    });
  }
  if (base === quote) {
    throw new AppError({
      code: ERROR_CODES.SUPPLIER_OFFER_INVALID_FX,
      message: 'FX base and quote currencies must differ.',
      statusCode: 400,
    });
  }
}

export function assertOfferValidity(quotedAt: Date, validUntil: Date | null | undefined): void {
  if (validUntil == null) return;
  if (validUntil.getTime() < quotedAt.getTime()) {
    throw new AppError({
      code: ERROR_CODES.SUPPLIER_OFFER_INVALID_VALIDITY,
      message: PURCHASING_ERROR_MESSAGES.SUPPLIER_OFFER_INVALID_VALIDITY,
      statusCode: 400,
    });
  }
}

export function assertSupplierAssignableForOffer(status: PurchasingLifecycleStatus): void {
  if (status === PurchasingLifecycleStatus.ARCHIVED) {
    throw new AppError({
      code: ERROR_CODES.SUPPLIER_OFFER_SUPPLIER_NOT_ASSIGNABLE,
      message: PURCHASING_ERROR_MESSAGES.SUPPLIER_OFFER_SUPPLIER_NOT_ASSIGNABLE,
      statusCode: 409,
    });
  }
}

export function assertOptionalOfferNotes(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const notes = normalizeDisplayText(value);
  if (!notes) return null;
  if (notes.length > SUPPLIER_OFFER_NOTES_MAX_LENGTH) {
    throw AppError.validation(
      `Notes exceed maximum length of ${SUPPLIER_OFFER_NOTES_MAX_LENGTH}.`,
    );
  }
  return notes;
}

export function deriveOfferExpiry(
  validUntil: Date | null,
  archivedAt: Date | null,
  now = new Date(),
): 'ARCHIVED' | 'EXPIRED' | 'CURRENT' | 'NO_EXPIRY' {
  if (archivedAt) return 'ARCHIVED';
  if (!validUntil) return 'NO_EXPIRY';
  return validUntil.getTime() < now.getTime() ? 'EXPIRED' : 'CURRENT';
}
