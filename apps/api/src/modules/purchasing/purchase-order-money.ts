import { CurrencyCode, Prisma } from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import {
  PURCHASE_ORDER_ERROR_MESSAGES,
  PURCHASE_ORDER_MAX_QUANTITY,
  PURCHASE_ORDER_MAX_TOTAL,
  PURCHASE_ORDER_MAX_UNIT_PRICE,
} from './purchasing.constants';
import { parsePositiveMoney } from './supplier-offer.validation';

function invalidPrice(message: string = PURCHASE_ORDER_ERROR_MESSAGES.INVALID_PRICE): AppError {
  return new AppError({
    code: ERROR_CODES.PURCHASE_ORDER_INVALID_PRICE,
    message,
    statusCode: 400,
  });
}

/**
 * Parses a PO line unit price. Reuses the Supplier Offer money rules
 * (decimal string, > 0, IRR whole rials, USD <= 6 decimals) and adds an upper bound.
 */
export function parsePurchaseOrderUnitPrice(value: string, currency: CurrencyCode): Prisma.Decimal {
  let amount: Prisma.Decimal;
  try {
    amount = parsePositiveMoney(value, currency);
  } catch (error) {
    if (error instanceof AppError) {
      throw invalidPrice(
        error.code === ERROR_CODES.SUPPLIER_OFFER_INVALID_PRICE
          ? PURCHASE_ORDER_ERROR_MESSAGES.INVALID_PRICE
          : error.message,
      );
    }
    throw error;
  }
  if (amount.gte(new Prisma.Decimal(PURCHASE_ORDER_MAX_UNIT_PRICE))) {
    throw invalidPrice('Unit price exceeds the supported range.');
  }
  return amount;
}

export function assertPurchaseOrderQuantity(quantity: number): number {
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > PURCHASE_ORDER_MAX_QUANTITY
  ) {
    throw new AppError({
      code: ERROR_CODES.PURCHASE_ORDER_INVALID_QUANTITY,
      message: PURCHASE_ORDER_ERROR_MESSAGES.INVALID_QUANTITY,
      statusCode: 400,
    });
  }
  return quantity;
}

export function computeLineSubtotal(quantity: number, unitPrice: Prisma.Decimal): Prisma.Decimal {
  return unitPrice.mul(quantity);
}

export type PurchaseOrderTotals = {
  subtotal: Prisma.Decimal;
  /** Equals subtotal in Phase 2.4 (no costs/discounts yet). */
  total: Prisma.Decimal;
};

/** Server-authoritative totals. Client-supplied totals are never trusted. */
export function computePurchaseOrderTotals(
  lines: ReadonlyArray<{ quantity: number; unitPrice: Prisma.Decimal | string }>,
): PurchaseOrderTotals {
  let subtotal = new Prisma.Decimal(0);
  for (const line of lines) {
    subtotal = subtotal.add(computeLineSubtotal(line.quantity, new Prisma.Decimal(line.unitPrice)));
  }
  if (subtotal.gte(new Prisma.Decimal(PURCHASE_ORDER_MAX_TOTAL))) {
    throw new AppError({
      code: ERROR_CODES.PURCHASE_ORDER_TOTAL_OUT_OF_RANGE,
      message: PURCHASE_ORDER_ERROR_MESSAGES.TOTAL_OUT_OF_RANGE,
      statusCode: 400,
    });
  }
  return { subtotal, total: subtotal };
}
