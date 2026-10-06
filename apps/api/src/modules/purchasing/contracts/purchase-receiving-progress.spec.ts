import {
  deriveItemReceivingStatus,
  deriveReceivingOutcome,
  type PurchaseReceivingProgressItem,
} from './purchase-receiving.types';

function item(
  partial: Partial<PurchaseReceivingProgressItem> & {
    orderedQuantity: number;
    receivedQuantity: number;
    shortQuantity: number;
    remainingQuantity: number;
  },
): PurchaseReceivingProgressItem {
  return {
    purchaseOrderItemId: partial.purchaseOrderItemId ?? 'i1',
    skuId: partial.skuId ?? 's1',
    skuCode: 'SKU',
    productName: 'P',
    orderedQuantity: partial.orderedQuantity,
    receivedQuantity: partial.receivedQuantity,
    postedReceivedQuantity: partial.receivedQuantity,
    shortQuantity: partial.shortQuantity,
    closedUnfulfilledQuantity: partial.shortQuantity,
    remainingQuantity: partial.remainingQuantity,
    receivingStatus: deriveItemReceivingStatus(partial),
  };
}

describe('purchase receiving progress derivation (Phase 3.5)', () => {
  it('does not infer shortage from partial receipt', () => {
    expect(
      deriveItemReceivingStatus({
        orderedQuantity: 100,
        receivedQuantity: 90,
        shortQuantity: 0,
        remainingQuantity: 10,
      }),
    ).toBe('PARTIAL');
  });

  it('marks short-closed when remaining is zero with shortage', () => {
    expect(
      deriveItemReceivingStatus({
        orderedQuantity: 100,
        receivedQuantity: 90,
        shortQuantity: 10,
        remainingQuantity: 0,
      }),
    ).toBe('SHORT_CLOSED');
  });

  it('distinguishes fully received from closed-with-shortage at PO level', () => {
    const full = deriveReceivingOutcome([
      item({
        orderedQuantity: 100,
        receivedQuantity: 100,
        shortQuantity: 0,
        remainingQuantity: 0,
      }),
    ]);
    expect(full.receivingOutcome).toBe('FULLY_RECEIVED');
    expect(full.hasShortage).toBe(false);

    const short = deriveReceivingOutcome([
      item({
        orderedQuantity: 100,
        receivedQuantity: 90,
        shortQuantity: 10,
        remainingQuantity: 0,
      }),
    ]);
    expect(short.receivingOutcome).toBe('CLOSED_WITH_SHORTAGE');
    expect(short.hasShortage).toBe(true);
  });
});
