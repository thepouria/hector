import {
  deriveFulfillmentLifecycleStatus,
  fulfillableQuantity,
  fulfilledReturnableQuantity,
  openQuantity,
  remainingQuantity,
  reservableQuantity,
  returnableQuantity,
} from './sales-order-quantities';

describe('sales-order-quantities', () => {
  it('computes open / reservable / fulfillable / remaining', () => {
    const item = {
      quantity: 10,
      cancelledQuantity: 2,
      fulfilledQuantity: 3,
      returnedQuantity: 1,
      reservedRemaining: 2,
    };
    expect(openQuantity(item)).toBe(8);
    expect(fulfillableQuantity(item)).toBe(5);
    expect(remainingQuantity(item)).toBe(5);
    expect(reservableQuantity(item)).toBe(3); // 8 - 3 - 2
  });

  it('computes fulfilled returnable', () => {
    expect(
      fulfilledReturnableQuantity({ fulfilledQuantity: 5, returnedQuantity: 2 }),
    ).toBe(3);
    expect(returnableQuantity({ fulfilledQuantity: 5, returnedQuantity: 2 })).toBe(3);
    expect(
      fulfilledReturnableQuantity({ fulfilledQuantity: 1, returnedQuantity: 5 }),
    ).toBe(0);
  });

  it('derives lifecycle from item trackers', () => {
    expect(
      deriveFulfillmentLifecycleStatus([
        { quantity: 10, cancelledQuantity: 0, fulfilledQuantity: 0 },
      ]),
    ).toBe('PROCESSING');
    expect(
      deriveFulfillmentLifecycleStatus([
        { quantity: 10, cancelledQuantity: 0, fulfilledQuantity: 4 },
      ]),
    ).toBe('PARTIALLY_FULFILLED');
    expect(
      deriveFulfillmentLifecycleStatus([
        { quantity: 10, cancelledQuantity: 2, fulfilledQuantity: 8 },
      ]),
    ).toBe('FULFILLED');
    expect(
      deriveFulfillmentLifecycleStatus([
        { quantity: 10, cancelledQuantity: 10, fulfilledQuantity: 0 },
      ]),
    ).toBe('UNCHANGED');
  });
});
