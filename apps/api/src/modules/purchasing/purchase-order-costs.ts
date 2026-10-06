import {
  CurrencyCode,
  Prisma,
  PurchaseCostAllocationMethod,
  PurchaseCostStatus,
  PurchaseCostType,
  PurchaseOrderStatus,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { parseUtcBusinessDate, toUtcBusinessDate } from './purchase-order-due';
import {
  PURCHASE_COST_DESCRIPTION_MAX_LENGTH,
  PURCHASE_COST_ERROR_MESSAGES,
  PURCHASE_COST_NOTES_MAX_LENGTH,
  PURCHASE_COST_PAYEE_NAME_MAX_LENGTH,
  PURCHASE_COST_REFERENCE_MAX_LENGTH,
  PURCHASE_ORDER_MAX_TOTAL,
} from './purchasing.constants';
import { parsePositiveMoney } from './supplier-offer.validation';
import { assertOptionalDisplay } from './purchasing.normalization';

export type PurchaseCostAmountRow = {
  amount: Prisma.Decimal | string;
  currency: CurrencyCode;
  status: PurchaseCostStatus;
};

export type PurchaseCostTotalsByCurrency = Array<{
  currency: CurrencyCode;
  amount: string;
}>;

/**
 * Sum ACTIVE costs grouped by currency. Never collapses mixed currencies.
 */
export function aggregateActiveCostsByCurrency(
  rows: ReadonlyArray<PurchaseCostAmountRow>,
): PurchaseCostTotalsByCurrency {
  const map = new Map<CurrencyCode, Prisma.Decimal>();
  for (const row of rows) {
    if (row.status !== PurchaseCostStatus.ACTIVE) continue;
    const amount = new Prisma.Decimal(row.amount);
    map.set(row.currency, (map.get(row.currency) ?? new Prisma.Decimal(0)).add(amount));
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({ currency, amount: amount.toString() }));
}

/**
 * Same-currency Purchasing reference figure only.
 * merchandiseTotal + ACTIVE costs in that currency.
 * Returns null when costs exist in other currencies or when no merchandise currency match is safe.
 */
export function deriveReferenceAcquisitionTotal(input: {
  merchandiseTotal: Prisma.Decimal | string;
  merchandiseCurrency: CurrencyCode;
  costTotalsByCurrency: PurchaseCostTotalsByCurrency;
}): { amount: string; currency: CurrencyCode } | null {
  const merchandise = new Prisma.Decimal(input.merchandiseTotal);
  const otherCurrencies = input.costTotalsByCurrency.filter(
    (row) => row.currency !== input.merchandiseCurrency,
  );
  if (otherCurrencies.length > 0) return null;

  const same = input.costTotalsByCurrency.find(
    (row) => row.currency === input.merchandiseCurrency,
  );
  const costs = same ? new Prisma.Decimal(same.amount) : new Prisma.Decimal(0);
  const total = merchandise.add(costs);
  if (total.gte(new Prisma.Decimal(PURCHASE_ORDER_MAX_TOTAL))) {
    throw new AppError({
      code: ERROR_CODES.PURCHASE_ORDER_TOTAL_OUT_OF_RANGE,
      message: 'Reference acquisition total exceeds the supported range.',
      statusCode: 400,
    });
  }
  return { amount: total.toString(), currency: input.merchandiseCurrency };
}

export function parsePurchaseCostAmount(
  value: string,
  currency: CurrencyCode,
): Prisma.Decimal {
  try {
    const amount = parsePositiveMoney(value, currency);
    if (amount.gte(new Prisma.Decimal(PURCHASE_ORDER_MAX_TOTAL))) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_COST_INVALID_AMOUNT,
        message: PURCHASE_COST_ERROR_MESSAGES.INVALID_AMOUNT,
        statusCode: 400,
      });
    }
    return amount;
  } catch (error) {
    if (error instanceof AppError) {
      if (
        error.code === ERROR_CODES.SUPPLIER_OFFER_INVALID_PRICE ||
        error.code === ERROR_CODES.PURCHASE_COST_INVALID_AMOUNT
      ) {
        throw new AppError({
          code: ERROR_CODES.PURCHASE_COST_INVALID_AMOUNT,
          message: PURCHASE_COST_ERROR_MESSAGES.INVALID_AMOUNT,
          statusCode: 400,
        });
      }
      throw error;
    }
    throw error;
  }
}

export function assertPurchaseCostDescription(
  type: PurchaseCostType,
  description: string | null | undefined,
): string | null {
  const normalized = assertOptionalDisplay(description, PURCHASE_COST_DESCRIPTION_MAX_LENGTH);
  const value = normalized === undefined ? null : normalized;
  if (type === PurchaseCostType.OTHER) {
    if (!value) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_COST_INVALID_OTHER,
        message: PURCHASE_COST_ERROR_MESSAGES.INVALID_OTHER,
        statusCode: 400,
      });
    }
    return value;
  }
  return value;
}

export function normalizeOptionalCostText(
  value: string | null | undefined,
  maxLength: number,
): string | null | undefined {
  return assertOptionalDisplay(value, maxLength);
}

export function parseCostDate(value: string | Date | undefined, fallback: Date): Date {
  if (value === undefined) return toUtcBusinessDate(fallback);
  if (value instanceof Date) return toUtcBusinessDate(value);
  return parseUtcBusinessDate(value);
}

export function assertPoAcceptsCostMutation(status: PurchaseOrderStatus): void {
  // CANCELLED / RECEIVED: no further acquisition-cost mutations.
  // PARTIALLY_RECEIVED still allows append/void for late courier/freight discoveries.
  if (
    status === PurchaseOrderStatus.CANCELLED ||
    status === PurchaseOrderStatus.RECEIVED
  ) {
    throw new AppError({
      code: ERROR_CODES.PURCHASE_COST_PO_NOT_ACCEPTING,
      message: PURCHASE_COST_ERROR_MESSAGES.PO_NOT_ACCEPTING,
      statusCode: 409,
    });
  }
}

/** DRAFT costs may be edited/removed; post-DRAFT historical ACTIVE rows are append/void only. */
export function isPurchaseCostDraftEditable(poStatus: PurchaseOrderStatus): boolean {
  return poStatus === PurchaseOrderStatus.DRAFT;
}

export function defaultAllocationMethod(
  value: PurchaseCostAllocationMethod | null | undefined,
): PurchaseCostAllocationMethod {
  return value ?? PurchaseCostAllocationMethod.UNALLOCATED;
}

export {
  PURCHASE_COST_DESCRIPTION_MAX_LENGTH,
  PURCHASE_COST_NOTES_MAX_LENGTH,
  PURCHASE_COST_PAYEE_NAME_MAX_LENGTH,
  PURCHASE_COST_REFERENCE_MAX_LENGTH,
};
