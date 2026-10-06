import { PurchaseOrderStatus } from '@hector/database';
import { ERROR_CODES } from '../../../common/constants';
import { AppError } from '../../../common/exceptions/app.error';
import {
  assertCanApplyReceivingSummaryTransition,
  assertPurchaseReceivingAllowed,
  canApplyReceivingSummaryTransition,
  derivePurchaseReceivingStatus,
  isPurchaseReceivingEligible,
} from './purchase-receiving.policy';

const { DRAFT, APPROVED, ORDERED, PARTIALLY_RECEIVED, RECEIVED, CANCELLED } = PurchaseOrderStatus;

describe('purchase-receiving.policy', () => {
  describe('eligibility', () => {
    it('allows ORDERED and PARTIALLY_RECEIVED only', () => {
      expect(isPurchaseReceivingEligible(ORDERED)).toBe(true);
      expect(isPurchaseReceivingEligible(PARTIALLY_RECEIVED)).toBe(true);
      expect(isPurchaseReceivingEligible(DRAFT)).toBe(false);
      expect(isPurchaseReceivingEligible(APPROVED)).toBe(false);
      expect(isPurchaseReceivingEligible(RECEIVED)).toBe(false);
      expect(isPurchaseReceivingEligible(CANCELLED)).toBe(false);
    });

    it('assertReceivingAllowed fails for DRAFT / APPROVED / CANCELLED / RECEIVED', () => {
      expect(() => assertPurchaseReceivingAllowed(DRAFT)).toThrow(AppError);
      expect(() => assertPurchaseReceivingAllowed(APPROVED)).toThrow(AppError);
      try {
        assertPurchaseReceivingAllowed(CANCELLED);
        throw new Error('expected throw');
      } catch (error) {
        expect((error as AppError).code).toBe(ERROR_CODES.PURCHASE_ORDER_CANCELLED);
      }
      try {
        assertPurchaseReceivingAllowed(RECEIVED);
        throw new Error('expected throw');
      } catch (error) {
        expect((error as AppError).code).toBe(ERROR_CODES.PURCHASE_ORDER_ALREADY_RECEIVED);
      }
      expect(() => assertPurchaseReceivingAllowed(ORDERED)).not.toThrow();
      expect(() => assertPurchaseReceivingAllowed(PARTIALLY_RECEIVED)).not.toThrow();
    });
  });

  describe('derivePurchaseReceivingStatus', () => {
    const lines = [
      { purchaseOrderItemId: 'a', orderedQuantity: 500 },
      { purchaseOrderItemId: 'b', orderedQuantity: 500 },
    ];

    it('returns ORDERED when all accepted received quantities are zero', () => {
      expect(derivePurchaseReceivingStatus(lines, [])).toBe(ORDERED);
      expect(
        derivePurchaseReceivingStatus(lines, [
          { purchaseOrderItemId: 'a', acceptedReceivedQuantity: 0 },
          { purchaseOrderItemId: 'b', acceptedReceivedQuantity: 0 },
        ]),
      ).toBe(ORDERED);
    });

    it('returns PARTIALLY_RECEIVED for partial evidence', () => {
      expect(
        derivePurchaseReceivingStatus(lines, [
          { purchaseOrderItemId: 'a', acceptedReceivedQuantity: 500 },
          { purchaseOrderItemId: 'b', acceptedReceivedQuantity: 100 },
        ]),
      ).toBe(PARTIALLY_RECEIVED);
    });

    it('returns RECEIVED when every line is fully accepted', () => {
      expect(
        derivePurchaseReceivingStatus(lines, [
          { purchaseOrderItemId: 'a', acceptedReceivedQuantity: 500 },
          { purchaseOrderItemId: 'b', acceptedReceivedQuantity: 500 },
        ]),
      ).toBe(RECEIVED);
    });

    it('aggregates duplicate evidence rows for the same PO item', () => {
      expect(
        derivePurchaseReceivingStatus(lines, [
          { purchaseOrderItemId: 'a', acceptedReceivedQuantity: 200 },
          { purchaseOrderItemId: 'a', acceptedReceivedQuantity: 300 },
          { purchaseOrderItemId: 'b', acceptedReceivedQuantity: 500 },
        ]),
      ).toBe(RECEIVED);
    });

    it('treats missing receipt lines as zero received', () => {
      expect(
        derivePurchaseReceivingStatus(
          [
            { purchaseOrderItemId: 'a', orderedQuantity: 500 },
            { purchaseOrderItemId: 'b', orderedQuantity: 300 },
            { purchaseOrderItemId: 'c', orderedQuantity: 200 },
          ],
          [{ purchaseOrderItemId: 'a', acceptedReceivedQuantity: 500 }],
        ),
      ).toBe(PARTIALLY_RECEIVED);
    });

    it('supports multi-line exact complete and near-complete', () => {
      const three = [
        { purchaseOrderItemId: 'a', orderedQuantity: 500 },
        { purchaseOrderItemId: 'b', orderedQuantity: 300 },
        { purchaseOrderItemId: 'c', orderedQuantity: 200 },
      ];
      expect(
        derivePurchaseReceivingStatus(three, [
          { purchaseOrderItemId: 'a', acceptedReceivedQuantity: 500 },
          { purchaseOrderItemId: 'b', acceptedReceivedQuantity: 300 },
          { purchaseOrderItemId: 'c', acceptedReceivedQuantity: 199 },
        ]),
      ).toBe(PARTIALLY_RECEIVED);
      expect(
        derivePurchaseReceivingStatus(three, [
          { purchaseOrderItemId: 'a', acceptedReceivedQuantity: 500 },
          { purchaseOrderItemId: 'b', acceptedReceivedQuantity: 300 },
          { purchaseOrderItemId: 'c', acceptedReceivedQuantity: 200 },
        ]),
      ).toBe(RECEIVED);
    });

    it('treats short-close as completing remaining expected quantity', () => {
      expect(
        derivePurchaseReceivingStatus(
          [
            { purchaseOrderItemId: 'a', orderedQuantity: 1000, closedUnfulfilledQuantity: 100 },
            { purchaseOrderItemId: 'b', orderedQuantity: 500, closedUnfulfilledQuantity: 0 },
          ],
          [
            { purchaseOrderItemId: 'a', acceptedReceivedQuantity: 900 },
            { purchaseOrderItemId: 'b', acceptedReceivedQuantity: 500 },
          ],
        ),
      ).toBe(RECEIVED);

      // Short-close alone (no physical receipt yet) completes receiving process.
      expect(
        derivePurchaseReceivingStatus(
          [{ purchaseOrderItemId: 'a', orderedQuantity: 100, closedUnfulfilledQuantity: 100 }],
          [],
        ),
      ).toBe(RECEIVED);
    });

    it('recalculates backward after receipt reversal evidence', () => {
      // Fully received…
      expect(
        derivePurchaseReceivingStatus(lines, [
          { purchaseOrderItemId: 'a', acceptedReceivedQuantity: 500 },
          { purchaseOrderItemId: 'b', acceptedReceivedQuantity: 500 },
        ]),
      ).toBe(RECEIVED);
      // …then one receipt reversed → partial
      expect(
        derivePurchaseReceivingStatus(lines, [
          { purchaseOrderItemId: 'a', acceptedReceivedQuantity: 500 },
          { purchaseOrderItemId: 'b', acceptedReceivedQuantity: 100 },
        ]),
      ).toBe(PARTIALLY_RECEIVED);
      // …all evidence reversed → ORDERED
      expect(derivePurchaseReceivingStatus(lines, [])).toBe(ORDERED);
    });

    it('rejects unknown PO item, negatives, over-receipt, and empty ordered set', () => {
      try {
        derivePurchaseReceivingStatus(lines, [
          { purchaseOrderItemId: 'unknown', acceptedReceivedQuantity: 1 },
        ]);
        throw new Error('expected throw');
      } catch (error) {
        expect((error as AppError).code).toBe(ERROR_CODES.PURCHASE_ORDER_ITEM_NOT_FOUND);
      }

      try {
        derivePurchaseReceivingStatus(lines, [
          { purchaseOrderItemId: 'a', acceptedReceivedQuantity: -1 },
        ]);
        throw new Error('expected throw');
      } catch (error) {
        expect((error as AppError).code).toBe(ERROR_CODES.PURCHASE_ORDER_RECEIVED_QUANTITY_INVALID);
      }

      try {
        derivePurchaseReceivingStatus(lines, [
          { purchaseOrderItemId: 'a', acceptedReceivedQuantity: 501 },
        ]);
        throw new Error('expected throw');
      } catch (error) {
        expect((error as AppError).code).toBe(ERROR_CODES.PURCHASE_ORDER_OVER_RECEIPT_NOT_ALLOWED);
      }

      expect(() => derivePurchaseReceivingStatus([], [])).toThrow(AppError);
      expect(() =>
        derivePurchaseReceivingStatus(
          [
            { purchaseOrderItemId: 'a', orderedQuantity: 1 },
            { purchaseOrderItemId: 'a', orderedQuantity: 2 },
          ],
          [],
        ),
      ).toThrow(AppError);
    });
  });

  describe('system-derived receiving summary transitions', () => {
    it('allows forward and backward recalculation among receiving summaries', () => {
      expect(canApplyReceivingSummaryTransition(ORDERED, PARTIALLY_RECEIVED)).toBe(true);
      expect(canApplyReceivingSummaryTransition(ORDERED, RECEIVED)).toBe(true);
      expect(canApplyReceivingSummaryTransition(PARTIALLY_RECEIVED, RECEIVED)).toBe(true);
      expect(canApplyReceivingSummaryTransition(RECEIVED, PARTIALLY_RECEIVED)).toBe(true);
      expect(canApplyReceivingSummaryTransition(PARTIALLY_RECEIVED, ORDERED)).toBe(true);
      expect(canApplyReceivingSummaryTransition(RECEIVED, ORDERED)).toBe(true);
      expect(canApplyReceivingSummaryTransition(ORDERED, ORDERED)).toBe(true);
    });

    it('forbids applying receiving summary from DRAFT / APPROVED / CANCELLED', () => {
      expect(canApplyReceivingSummaryTransition(DRAFT, ORDERED)).toBe(false);
      expect(canApplyReceivingSummaryTransition(APPROVED, PARTIALLY_RECEIVED)).toBe(false);
      expect(canApplyReceivingSummaryTransition(CANCELLED, ORDERED)).toBe(false);
      expect(() => assertCanApplyReceivingSummaryTransition(APPROVED, RECEIVED)).toThrow(AppError);
    });
  });
});
