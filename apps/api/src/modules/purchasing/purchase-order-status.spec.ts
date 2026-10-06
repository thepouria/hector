import { PurchaseOrderStatus } from '@hector/database';
import { AppError } from '../../common/exceptions/app.error';
import { ERROR_CODES } from '../../common/constants';
import {
  PURCHASE_ORDER_PUBLIC_TRANSITIONS,
  PURCHASE_ORDER_RECEIVING_TRANSITIONS,
  assertCommerciallyEditable,
  assertPurchaseOrderTransition,
  assertReceivingTransition,
  canTransitionPurchaseOrder,
  deriveAvailableActions,
  isPurchaseOrderCommerciallyEditable,
  isPurchaseOrderMetadataEditable,
  requiresCancellationReason,
} from './purchase-order-status';

const { DRAFT, APPROVED, ORDERED, PARTIALLY_RECEIVED, RECEIVED, CANCELLED } = PurchaseOrderStatus;

describe('purchase-order-status', () => {
  it('allows only the documented public transitions', () => {
    const allowed: Array<[PurchaseOrderStatus, PurchaseOrderStatus]> = [
      [DRAFT, APPROVED],
      [DRAFT, CANCELLED],
      [APPROVED, ORDERED],
      [APPROVED, CANCELLED],
      [ORDERED, CANCELLED],
    ];
    for (const from of Object.values(PurchaseOrderStatus)) {
      for (const to of Object.values(PurchaseOrderStatus)) {
        const expected = allowed.some(([a, b]) => a === from && b === to);
        expect(canTransitionPurchaseOrder(from, to)).toBe(expected);
      }
    }
  });

  it('treats CANCELLED, PARTIALLY_RECEIVED, and RECEIVED as public terminals', () => {
    expect(PURCHASE_ORDER_PUBLIC_TRANSITIONS[CANCELLED]).toHaveLength(0);
    expect(PURCHASE_ORDER_PUBLIC_TRANSITIONS[PARTIALLY_RECEIVED]).toHaveLength(0);
    expect(PURCHASE_ORDER_PUBLIC_TRANSITIONS[RECEIVED]).toHaveLength(0);
  });

  it('forbids skipping APPROVED, receiving jumps, and moving backwards', () => {
    expect(canTransitionPurchaseOrder(DRAFT, ORDERED)).toBe(false);
    expect(canTransitionPurchaseOrder(DRAFT, RECEIVED)).toBe(false);
    expect(canTransitionPurchaseOrder(APPROVED, RECEIVED)).toBe(false);
    expect(canTransitionPurchaseOrder(ORDERED, APPROVED)).toBe(false);
    expect(canTransitionPurchaseOrder(APPROVED, DRAFT)).toBe(false);
    expect(canTransitionPurchaseOrder(CANCELLED, DRAFT)).toBe(false);
    expect(canTransitionPurchaseOrder(CANCELLED, APPROVED)).toBe(false);
    expect(canTransitionPurchaseOrder(RECEIVED, CANCELLED)).toBe(false);
    expect(canTransitionPurchaseOrder(PARTIALLY_RECEIVED, CANCELLED)).toBe(false);
  });

  it('reserves receiving transitions for Phase 3 only', () => {
    expect(PURCHASE_ORDER_RECEIVING_TRANSITIONS[ORDERED]).toEqual([
      PARTIALLY_RECEIVED,
      RECEIVED,
    ]);
    expect(PURCHASE_ORDER_RECEIVING_TRANSITIONS[PARTIALLY_RECEIVED]).toEqual([RECEIVED]);
    expect(() => assertReceivingTransition(ORDERED, PARTIALLY_RECEIVED)).not.toThrow();
    expect(() => assertReceivingTransition(DRAFT, RECEIVED)).toThrow(AppError);
    expect(canTransitionPurchaseOrder(ORDERED, PARTIALLY_RECEIVED)).toBe(false);
    expect(canTransitionPurchaseOrder(ORDERED, RECEIVED)).toBe(false);
  });

  it('throws a 409 AppError for invalid public transitions', () => {
    try {
      assertPurchaseOrderTransition(DRAFT, ORDERED);
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(409);
      expect((error as AppError).code).toBe(ERROR_CODES.PURCHASE_ORDER_INVALID_STATUS_TRANSITION);
    }
    expect(() => assertPurchaseOrderTransition(DRAFT, APPROVED)).not.toThrow();
  });

  it('limits commercial edits to DRAFT and metadata edits until cancelled/received', () => {
    expect(isPurchaseOrderCommerciallyEditable(DRAFT)).toBe(true);
    for (const status of [APPROVED, ORDERED, PARTIALLY_RECEIVED, RECEIVED, CANCELLED]) {
      expect(isPurchaseOrderCommerciallyEditable(status)).toBe(false);
      expect(() => assertCommerciallyEditable(status)).toThrow(AppError);
    }
    expect(isPurchaseOrderMetadataEditable(DRAFT)).toBe(true);
    expect(isPurchaseOrderMetadataEditable(APPROVED)).toBe(true);
    expect(isPurchaseOrderMetadataEditable(ORDERED)).toBe(true);
    expect(isPurchaseOrderMetadataEditable(CANCELLED)).toBe(false);
    expect(isPurchaseOrderMetadataEditable(RECEIVED)).toBe(false);
  });

  it('requires cancellation reason after DRAFT', () => {
    expect(requiresCancellationReason(DRAFT)).toBe(false);
    expect(requiresCancellationReason(APPROVED)).toBe(true);
    expect(requiresCancellationReason(ORDERED)).toBe(true);
  });

  it('derives available actions from status and permissions', () => {
    expect(
      deriveAvailableActions(DRAFT, { canManage: true, canApprove: true, canCancel: true }),
    ).toEqual(['EDIT', 'APPROVE', 'CANCEL', 'ADD_COST']);
    expect(
      deriveAvailableActions(APPROVED, { canManage: true, canApprove: true, canCancel: true }),
    ).toEqual(['ORDER', 'CANCEL', 'ADD_COST']);
    expect(
      deriveAvailableActions(ORDERED, { canManage: true, canApprove: false, canCancel: true }),
    ).toEqual(['CANCEL', 'ADD_COST']);
    expect(
      deriveAvailableActions(CANCELLED, { canManage: true, canApprove: true, canCancel: true }),
    ).toEqual([]);
    expect(
      deriveAvailableActions(RECEIVED, { canManage: true, canApprove: true, canCancel: true }),
    ).toEqual([]);
  });
});
