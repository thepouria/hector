/**
 * Sales order quantity helpers (Phase 5.3).
 * Ordered `quantity` is never rewritten; trackers (cancelled / fulfilled / returned) drive open qty.
 */

export type OrderItemQuantityState = {
  quantity: number;
  cancelledQuantity: number;
  fulfilledQuantity: number;
  returnedQuantity: number;
  /** ACTIVE reservation remaining for this order line (0 if none). */
  reservedRemaining?: number;
};

/** Open commercial quantity still eligible for fulfillment / reservation. */
export function openQuantity(item: Pick<OrderItemQuantityState, 'quantity' | 'cancelledQuantity'>): number {
  return Math.max(0, item.quantity - item.cancelledQuantity);
}

/** Quantity still eligible to reserve (open − fulfilled − active reserved remaining). */
export function reservableQuantity(item: OrderItemQuantityState): number {
  const reserved = item.reservedRemaining ?? 0;
  return Math.max(0, openQuantity(item) - item.fulfilledQuantity - reserved);
}

/** Quantity still eligible to fulfill (open − already fulfilled). */
export function fulfillableQuantity(
  item: Pick<OrderItemQuantityState, 'quantity' | 'cancelledQuantity' | 'fulfilledQuantity'>,
): number {
  return Math.max(0, openQuantity(item) - item.fulfilledQuantity);
}

/**
 * Physical/commercial returnable after fulfillment truth:
 *   fulfilledQuantity − returnedQuantity
 */
export function fulfilledReturnableQuantity(
  item: Pick<OrderItemQuantityState, 'fulfilledQuantity' | 'returnedQuantity'>,
): number {
  return Math.max(0, item.fulfilledQuantity - item.returnedQuantity);
}

/** Alias used by returns services (Phase 5.3 policy). */
export function returnableQuantity(
  item: Pick<OrderItemQuantityState, 'fulfilledQuantity' | 'returnedQuantity'>,
): number {
  return fulfilledReturnableQuantity(item);
}

/** Remaining unfulfilled open quantity (same as fulfillable). */
export function remainingQuantity(
  item: Pick<OrderItemQuantityState, 'quantity' | 'cancelledQuantity' | 'fulfilledQuantity'>,
): number {
  return fulfillableQuantity(item);
}

/**
 * Derive order header fulfillment status from item trackers.
 * Caller must only apply when order is in an executable status
 * (CONFIRMED / PROCESSING / PARTIALLY_FULFILLED).
 */
export function deriveFulfillmentLifecycleStatus(
  items: Array<Pick<OrderItemQuantityState, 'quantity' | 'cancelledQuantity' | 'fulfilledQuantity'>>,
): 'FULFILLED' | 'PARTIALLY_FULFILLED' | 'PROCESSING' | 'UNCHANGED' {
  if (items.length === 0) return 'UNCHANGED';
  let anyFulfilled = false;
  let allOpenFulfilled = true;
  let anyOpen = false;

  for (const item of items) {
    const open = openQuantity(item);
    if (open <= 0) continue;
    anyOpen = true;
    if (item.fulfilledQuantity > 0) anyFulfilled = true;
    if (item.fulfilledQuantity < open) allOpenFulfilled = false;
  }

  if (!anyOpen) {
    // All lines cancelled — cancel path owns CANCELLED.
    return 'UNCHANGED';
  }
  if (allOpenFulfilled && anyFulfilled) return 'FULFILLED';
  if (anyFulfilled) return 'PARTIALLY_FULFILLED';
  return 'PROCESSING';
}
