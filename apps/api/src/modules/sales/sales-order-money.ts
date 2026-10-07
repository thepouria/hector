import { CurrencyCode, Prisma } from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { parseMoneyAmount } from '../finance/money/money';
import { parsePositiveMoney } from '../purchasing/supplier-offer.validation';
import {
  SALES_ERROR_MESSAGES,
  SALES_ORDER_MAX_GRAND_TOTAL,
  SALES_ORDER_MAX_QUANTITY,
  SALES_ORDER_MAX_UNIT_PRICE,
} from './sales.constants';

/**
 * Sales order money rules (Phase 5.2):
 * - Unit price: reject zero and negative (no gift/zero-price flag in 5.2).
 * - Discounts / shipping / other charges: non-negative; zero allowed.
 * - Server computes all line and order totals; client totals are never trusted.
 */

function invalidPrice(message: string = SALES_ERROR_MESSAGES.SALES_ORDER_INVALID_PRICE): AppError {
  return new AppError({
    code: ERROR_CODES.SALES_ORDER_INVALID_PRICE,
    message,
    statusCode: 400,
  });
}

function invalidMoney(message: string): AppError {
  return new AppError({
    code: ERROR_CODES.SALES_ORDER_INVALID_MONEY,
    message,
    statusCode: 400,
  });
}

/** Unit price > 0. Rejects zero/negative for simplicity (gifts deferred). */
export function parseSalesOrderUnitPrice(value: string, currency: CurrencyCode): Prisma.Decimal {
  let amount: Prisma.Decimal;
  try {
    amount = parsePositiveMoney(value, currency);
  } catch (error) {
    if (error instanceof AppError) {
      throw invalidPrice(
        error.code === ERROR_CODES.SUPPLIER_OFFER_INVALID_PRICE
          ? SALES_ERROR_MESSAGES.SALES_ORDER_INVALID_PRICE
          : error.message,
      );
    }
    throw error;
  }
  if (amount.gte(new Prisma.Decimal(SALES_ORDER_MAX_UNIT_PRICE))) {
    throw invalidPrice('Unit price exceeds the supported range.');
  }
  return amount;
}

/** Non-negative money (discounts, shipping, other charges). Zero allowed. */
export function parseSalesOrderNonNegativeMoney(
  value: string,
  currency: CurrencyCode,
): Prisma.Decimal {
  try {
    return parseMoneyAmount(value, currency, { allowZero: true });
  } catch (error) {
    throw invalidMoney(error instanceof Error ? error.message : 'Invalid money amount.');
  }
}

export function assertSalesOrderQuantity(quantity: number): number {
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > SALES_ORDER_MAX_QUANTITY
  ) {
    throw new AppError({
      code: ERROR_CODES.SALES_ORDER_INVALID_QUANTITY,
      message: SALES_ERROR_MESSAGES.SALES_ORDER_INVALID_QUANTITY,
      statusCode: 400,
    });
  }
  return quantity;
}

export function computeLineSubtotal(quantity: number, unitPrice: Prisma.Decimal): Prisma.Decimal {
  return unitPrice.mul(quantity);
}

export function computeLineNetTotal(
  lineSubtotal: Prisma.Decimal,
  discountAmount: Prisma.Decimal,
): Prisma.Decimal {
  if (discountAmount.lt(0)) {
    throw invalidMoney('Line discount cannot be negative.');
  }
  if (discountAmount.gt(lineSubtotal)) {
    throw new AppError({
      code: ERROR_CODES.SALES_ORDER_DISCOUNT_EXCEEDS_SUBTOTAL,
      message: SALES_ERROR_MESSAGES.SALES_ORDER_DISCOUNT_EXCEEDS_SUBTOTAL,
      statusCode: 400,
    });
  }
  return lineSubtotal.sub(discountAmount);
}

export type SalesOrderLineMoneyInput = {
  quantity: number;
  unitPrice: Prisma.Decimal | string;
  discountAmount?: Prisma.Decimal | string;
};

export type SalesOrderLineMoney = {
  quantity: number;
  unitPrice: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  lineSubtotal: Prisma.Decimal;
  lineNetTotal: Prisma.Decimal;
};

export function computeSalesOrderLineMoney(input: SalesOrderLineMoneyInput): SalesOrderLineMoney {
  const quantity = assertSalesOrderQuantity(input.quantity);
  const unitPrice = new Prisma.Decimal(input.unitPrice);
  if (unitPrice.lte(0)) {
    throw invalidPrice();
  }
  const discountAmount = new Prisma.Decimal(input.discountAmount ?? 0);
  const lineSubtotal = computeLineSubtotal(quantity, unitPrice);
  const lineNetTotal = computeLineNetTotal(lineSubtotal, discountAmount);
  return { quantity, unitPrice, discountAmount, lineSubtotal, lineNetTotal };
}

export type SalesOrderTotalsInput = {
  lines: ReadonlyArray<SalesOrderLineMoneyInput>;
  orderDiscountTotal?: Prisma.Decimal | string;
  shippingAmount?: Prisma.Decimal | string;
  otherCharges?: Prisma.Decimal | string;
};

export type SalesOrderTotals = {
  subtotal: Prisma.Decimal;
  itemDiscountTotal: Prisma.Decimal;
  orderDiscountTotal: Prisma.Decimal;
  netItemsTotal: Prisma.Decimal;
  shippingAmount: Prisma.Decimal;
  otherCharges: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
  lines: SalesOrderLineMoney[];
};

/** Server-authoritative order aggregates. */
export function computeSalesOrderTotals(input: SalesOrderTotalsInput): SalesOrderTotals {
  const lines = input.lines.map((line) => computeSalesOrderLineMoney(line));

  let subtotal = new Prisma.Decimal(0);
  let itemDiscountTotal = new Prisma.Decimal(0);
  let netItemsTotal = new Prisma.Decimal(0);
  for (const line of lines) {
    subtotal = subtotal.add(line.lineSubtotal);
    itemDiscountTotal = itemDiscountTotal.add(line.discountAmount);
    netItemsTotal = netItemsTotal.add(line.lineNetTotal);
  }

  const orderDiscountTotal = new Prisma.Decimal(input.orderDiscountTotal ?? 0);
  if (orderDiscountTotal.lt(0)) {
    throw invalidMoney('Order discount cannot be negative.');
  }
  if (orderDiscountTotal.gt(netItemsTotal)) {
    throw new AppError({
      code: ERROR_CODES.SALES_ORDER_DISCOUNT_EXCEEDS_SUBTOTAL,
      message: SALES_ERROR_MESSAGES.SALES_ORDER_DISCOUNT_EXCEEDS_SUBTOTAL,
      statusCode: 400,
    });
  }

  const shippingAmount = new Prisma.Decimal(input.shippingAmount ?? 0);
  const otherCharges = new Prisma.Decimal(input.otherCharges ?? 0);
  if (shippingAmount.lt(0) || otherCharges.lt(0)) {
    throw invalidMoney('Shipping and other charges cannot be negative.');
  }

  const afterOrderDiscount = netItemsTotal.sub(orderDiscountTotal);
  const grandTotal = afterOrderDiscount.add(shippingAmount).add(otherCharges);

  if (grandTotal.gte(new Prisma.Decimal(SALES_ORDER_MAX_GRAND_TOTAL))) {
    throw new AppError({
      code: ERROR_CODES.SALES_ORDER_TOTAL_OUT_OF_RANGE,
      message: SALES_ERROR_MESSAGES.SALES_ORDER_TOTAL_OUT_OF_RANGE,
      statusCode: 400,
    });
  }

  return {
    subtotal,
    itemDiscountTotal,
    orderDiscountTotal,
    netItemsTotal,
    shippingAmount,
    otherCharges,
    grandTotal,
    lines,
  };
}

/**
 * @deprecated Phase 5.2 transitional helper. Prefer {@link fulfilledReturnableQuantity}.
 * Kept for tests that assert the old commercial upper bound.
 */
export function commercialReturnableQuantity(input: {
  quantity: number;
  cancelledQuantity: number;
  returnedQuantity: number;
}): number {
  return Math.max(0, input.quantity - input.cancelledQuantity - input.returnedQuantity);
}

/** Phase 5.3 returnable: fulfilled − returned. Re-exported for convenience. */
export { fulfilledReturnableQuantity } from './sales-order-quantities';

export function remainingCancellableQuantity(input: {
  quantity: number;
  cancelledQuantity: number;
}): number {
  return Math.max(0, input.quantity - input.cancelledQuantity);
}
