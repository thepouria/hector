import { SalesOrderStatus } from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { SALES_ERROR_MESSAGES } from './sales.constants';

/**
 * Phase 5.3 public lifecycle:
 *
 *   DRAFT -> CONFIRMED | CANCELLED
 *   CONFIRMED -> PROCESSING | PARTIALLY_FULFILLED | FULFILLED | CANCELLED
 *   PROCESSING -> PARTIALLY_FULFILLED | FULFILLED | CANCELLED
 *   PARTIALLY_FULFILLED -> FULFILLED | CANCELLED
 *   FULFILLED -> (none; no reverse to draft)
 *   CANCELLED -> none
 *
 * CONFIRMED may jump straight to fulfillment statuses when reserve is skipped
 * and the first complete posts stock immediately.
 */
export const SALES_ORDER_TRANSITIONS: Readonly<
  Record<SalesOrderStatus, readonly SalesOrderStatus[]>
> = {
  [SalesOrderStatus.DRAFT]: [SalesOrderStatus.CONFIRMED, SalesOrderStatus.CANCELLED],
  [SalesOrderStatus.CONFIRMED]: [
    SalesOrderStatus.PROCESSING,
    SalesOrderStatus.PARTIALLY_FULFILLED,
    SalesOrderStatus.FULFILLED,
    SalesOrderStatus.CANCELLED,
  ],
  [SalesOrderStatus.PROCESSING]: [
    SalesOrderStatus.PARTIALLY_FULFILLED,
    SalesOrderStatus.FULFILLED,
    SalesOrderStatus.CANCELLED,
  ],
  [SalesOrderStatus.PARTIALLY_FULFILLED]: [
    SalesOrderStatus.FULFILLED,
    SalesOrderStatus.CANCELLED,
  ],
  [SalesOrderStatus.FULFILLED]: [],
  [SalesOrderStatus.CANCELLED]: [],
};

export function canTransitionSalesOrder(
  from: SalesOrderStatus,
  to: SalesOrderStatus,
): boolean {
  return SALES_ORDER_TRANSITIONS[from].includes(to);
}

export function assertSalesOrderTransition(
  from: SalesOrderStatus,
  to: SalesOrderStatus,
): void {
  if (!canTransitionSalesOrder(from, to)) {
    throw new AppError({
      code: ERROR_CODES.SALES_ORDER_INVALID_STATUS_TRANSITION,
      message: `${SALES_ERROR_MESSAGES.SALES_ORDER_INVALID_STATUS_TRANSITION} (${from} -> ${to})`,
      statusCode: 409,
    });
  }
}

/** Header + items commercially editable only while DRAFT (expense/PO pattern). */
export function isSalesOrderCommerciallyEditable(status: SalesOrderStatus): boolean {
  return status === SalesOrderStatus.DRAFT;
}

export function assertSalesOrderEditable(status: SalesOrderStatus): void {
  if (!isSalesOrderCommerciallyEditable(status)) {
    throw new AppError({
      code: ERROR_CODES.SALES_ORDER_NOT_EDITABLE,
      message: SALES_ERROR_MESSAGES.SALES_ORDER_NOT_EDITABLE,
      statusCode: 409,
    });
  }
}

/**
 * Statuses that may accept a sales return.
 * Primary: PARTIALLY_FULFILLED | FULFILLED (fulfillment truth).
 * CONFIRMED / PROCESSING kept for safety when fulfilledQuantity > 0 on lines.
 */
export const SALES_ORDER_RETURNABLE_STATUSES: ReadonlySet<SalesOrderStatus> = new Set([
  SalesOrderStatus.CONFIRMED,
  SalesOrderStatus.PROCESSING,
  SalesOrderStatus.PARTIALLY_FULFILLED,
  SalesOrderStatus.FULFILLED,
]);
