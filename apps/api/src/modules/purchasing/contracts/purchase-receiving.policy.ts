import { PurchaseOrderStatus } from '@hector/database';
import { ERROR_CODES } from '../../../common/constants';
import { AppError } from '../../../common/exceptions/app.error';
import { PURCHASE_ORDER_ERROR_MESSAGES } from '../purchasing.constants';
import type {
  AcceptedReceivedLine,
  OrderedReceivingLine,
  PurchaseReceivingSummaryStatus,
} from './purchase-receiving.types';

/**
 * Statuses against which future Warehouse may post finalized receipts.
 * APPROVED is intentionally excluded (not yet ordered from supplier).
 */
export const PURCHASE_RECEIVING_ELIGIBLE_STATUSES: readonly PurchaseOrderStatus[] = [
  PurchaseOrderStatus.ORDERED,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
];

export function isPurchaseReceivingEligible(status: PurchaseOrderStatus): boolean {
  return PURCHASE_RECEIVING_ELIGIBLE_STATUSES.includes(status);
}

export function assertPurchaseReceivingAllowed(status: PurchaseOrderStatus): void {
  if (status === PurchaseOrderStatus.CANCELLED) {
    throw new AppError({
      code: ERROR_CODES.PURCHASE_ORDER_CANCELLED,
      message: PURCHASE_ORDER_ERROR_MESSAGES.CANCELLED,
      statusCode: 409,
    });
  }
  if (status === PurchaseOrderStatus.RECEIVED) {
    throw new AppError({
      code: ERROR_CODES.PURCHASE_ORDER_ALREADY_RECEIVED,
      message: PURCHASE_ORDER_ERROR_MESSAGES.ALREADY_RECEIVED,
      statusCode: 409,
    });
  }
  if (!isPurchaseReceivingEligible(status)) {
    throw new AppError({
      code: ERROR_CODES.PURCHASE_ORDER_NOT_RECEIVABLE,
      message: `${PURCHASE_ORDER_ERROR_MESSAGES.NOT_RECEIVABLE} (status=${status})`,
      statusCode: 409,
    });
  }
}

/**
 * Pure receiving summary derivation from ordered lines + finalized accepted quantities.
 *
 * Warehouse supplies aggregated evidence (draft/reversed receipts already filtered out).
 * Purchasing owns the projection onto ORDERED | PARTIALLY_RECEIVED | RECEIVED.
 *
 * Default over-receipt policy (Phase 2.10): reject when accepted > ordered for any line.
 * Short-close / tolerance policies are Phase 3 extensions.
 */
export function derivePurchaseReceivingStatus(
  orderedLines: readonly OrderedReceivingLine[],
  acceptedReceived: readonly AcceptedReceivedLine[],
): PurchaseReceivingSummaryStatus {
  if (orderedLines.length === 0) {
    throw new AppError({
      code: ERROR_CODES.PURCHASE_ORDER_EMPTY,
      message: PURCHASE_ORDER_ERROR_MESSAGES.EMPTY,
      statusCode: 409,
    });
  }

  const orderedById = new Map<string, { ordered: number; closed: number }>();
  for (const line of orderedLines) {
    if (!line.purchaseOrderItemId) {
      throw invalidQuantity('Purchase order item id is required.');
    }
    if (orderedById.has(line.purchaseOrderItemId)) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_ORDER_ITEM_MISMATCH,
        message: PURCHASE_ORDER_ERROR_MESSAGES.ITEM_MISMATCH_DUPLICATE,
        statusCode: 400,
      });
    }
    assertNonNegativeInteger(line.orderedQuantity, 'ordered');
    if (line.orderedQuantity <= 0) {
      throw invalidQuantity('Ordered quantity must be greater than zero.');
    }
    const closed = line.closedUnfulfilledQuantity ?? 0;
    assertNonNegativeInteger(closed, 'closed');
    if (closed > line.orderedQuantity) {
      throw invalidQuantity('Closed unfulfilled quantity cannot exceed ordered quantity.');
    }
    orderedById.set(line.purchaseOrderItemId, { ordered: line.orderedQuantity, closed });
  }

  const receivedById = new Map<string, number>();
  for (const line of acceptedReceived) {
    if (!line.purchaseOrderItemId) {
      throw invalidQuantity('Purchase order item id is required on receipt evidence.');
    }
    if (!orderedById.has(line.purchaseOrderItemId)) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_ORDER_ITEM_NOT_FOUND,
        message: PURCHASE_ORDER_ERROR_MESSAGES.ITEM_NOT_FOUND,
        statusCode: 404,
      });
    }
    assertNonNegativeInteger(line.acceptedReceivedQuantity, 'received');
    const previous = receivedById.get(line.purchaseOrderItemId) ?? 0;
    receivedById.set(line.purchaseOrderItemId, previous + line.acceptedReceivedQuantity);
  }

  let anyReceived = false;
  let allComplete = true;

  for (const [itemId, { ordered, closed }] of orderedById) {
    const received = receivedById.get(itemId) ?? 0;
    // Over-receipt checks against ordered only (short-close does not expand capacity).
    if (received > ordered) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_ORDER_OVER_RECEIPT_NOT_ALLOWED,
        message: PURCHASE_ORDER_ERROR_MESSAGES.OVER_RECEIPT_NOT_ALLOWED,
        statusCode: 409,
      });
    }
    if (received + closed > ordered) {
      throw invalidQuantity(
        'Accepted received + short-closed quantity cannot exceed ordered quantity.',
      );
    }
    if (received > 0) anyReceived = true;
    // Line complete when nothing remains expected: received + short-closed >= ordered.
    if (received + closed < ordered) allComplete = false;
  }

  // Short-close-only completion (zero physical receipt) still yields RECEIVED as
  // "receiving process complete" until a distinct CLOSED status exists (Phase 3).
  if (!anyReceived && !allComplete) return PurchaseOrderStatus.ORDERED;
  if (!anyReceived && allComplete) return PurchaseOrderStatus.RECEIVED;
  if (allComplete) return PurchaseOrderStatus.RECEIVED;
  return PurchaseOrderStatus.PARTIALLY_RECEIVED;
}

/**
 * System-derived receiving transitions (Phase 3).
 * Includes forward posting and backward recalculation after receipt reversal.
 * Not a public Purchasing lifecycle command.
 */
export function canApplyReceivingSummaryTransition(
  from: PurchaseOrderStatus,
  to: PurchaseReceivingSummaryStatus,
): boolean {
  if (from === to) return true;
  if (from === PurchaseOrderStatus.CANCELLED) return false;
  if (from === PurchaseOrderStatus.DRAFT || from === PurchaseOrderStatus.APPROVED) return false;

  const receiving =
    from === PurchaseOrderStatus.ORDERED ||
    from === PurchaseOrderStatus.PARTIALLY_RECEIVED ||
    from === PurchaseOrderStatus.RECEIVED;
  if (!receiving) return false;

  // Any derived summary among ORDERED / PARTIAL / RECEIVED is legal after evidence change.
  return (
    to === PurchaseOrderStatus.ORDERED ||
    to === PurchaseOrderStatus.PARTIALLY_RECEIVED ||
    to === PurchaseOrderStatus.RECEIVED
  );
}

export function assertCanApplyReceivingSummaryTransition(
  from: PurchaseOrderStatus,
  to: PurchaseReceivingSummaryStatus,
): void {
  if (!canApplyReceivingSummaryTransition(from, to)) {
    throw new AppError({
      code: ERROR_CODES.PURCHASE_ORDER_INVALID_STATUS_TRANSITION,
      message: `${PURCHASE_ORDER_ERROR_MESSAGES.INVALID_STATUS_TRANSITION} (${from} -> ${to}; receiving summary recalculation)`,
      statusCode: 409,
    });
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw invalidQuantity(`${label} quantity must be a non-negative integer.`);
  }
}

function invalidQuantity(message: string): AppError {
  return new AppError({
    code: ERROR_CODES.PURCHASE_ORDER_RECEIVED_QUANTITY_INVALID,
    message,
    statusCode: 400,
  });
}
