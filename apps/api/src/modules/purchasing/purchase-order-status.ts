import { PurchaseOrderStatus } from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { PURCHASE_ORDER_ERROR_MESSAGES } from './purchasing.constants';

/**
 * Phase 2.9 public lifecycle (docs/purchase-lifecycle.md):
 *
 *   DRAFT -> APPROVED -> ORDERED
 *   DRAFT | APPROVED | ORDERED -> CANCELLED
 *
 * PARTIALLY_RECEIVED / RECEIVED exist for Phase 3 Goods Receipt compatibility.
 * No public Purchasing command may enter those states (status alone ≠ stock).
 *
 * ORDERED -> CANCELLED is allowed only while no Goods Receipt evidence exists
 * (always true in Phase 2.9; Phase 3 must restrict when receipts exist).
 */
export const PURCHASE_ORDER_PUBLIC_TRANSITIONS: Readonly<
  Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]>
> = {
  [PurchaseOrderStatus.DRAFT]: [PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.CANCELLED],
  [PurchaseOrderStatus.APPROVED]: [PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.CANCELLED],
  [PurchaseOrderStatus.ORDERED]: [PurchaseOrderStatus.CANCELLED],
  [PurchaseOrderStatus.PARTIALLY_RECEIVED]: [],
  [PurchaseOrderStatus.RECEIVED]: [],
  [PurchaseOrderStatus.CANCELLED]: [],
};

/**
 * Forward receiving summary transitions when posting new Goods Receipt evidence (Phase 3).
 * Not wired to any public Purchasing endpoint.
 *
 * Receipt *reversal* may also recalculate backward (RECEIVED → PARTIAL → ORDERED).
 * That system-derived path is owned by `canApplyReceivingSummaryTransition`
 * in `contracts/purchase-receiving.policy.ts` — not a public lifecycle command.
 */
export const PURCHASE_ORDER_RECEIVING_TRANSITIONS: Readonly<
  Partial<Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]>>
> = {
  [PurchaseOrderStatus.ORDERED]: [
    PurchaseOrderStatus.PARTIALLY_RECEIVED,
    PurchaseOrderStatus.RECEIVED,
  ],
  [PurchaseOrderStatus.PARTIALLY_RECEIVED]: [PurchaseOrderStatus.RECEIVED],
};

/** @deprecated Use PURCHASE_ORDER_PUBLIC_TRANSITIONS — alias retained for existing imports. */
export const PURCHASE_ORDER_TRANSITIONS = PURCHASE_ORDER_PUBLIC_TRANSITIONS;

export type PurchaseOrderLifecycleAction = 'EDIT' | 'APPROVE' | 'ORDER' | 'CANCEL' | 'ADD_COST';

export function canTransitionPurchaseOrder(
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
): boolean {
  return PURCHASE_ORDER_PUBLIC_TRANSITIONS[from].includes(to);
}

export function assertPurchaseOrderTransition(
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
): void {
  if (!canTransitionPurchaseOrder(from, to)) {
    throw new AppError({
      code: ERROR_CODES.PURCHASE_ORDER_INVALID_STATUS_TRANSITION,
      message: `${PURCHASE_ORDER_ERROR_MESSAGES.INVALID_STATUS_TRANSITION} (${from} -> ${to})`,
      statusCode: 409,
    });
  }
}

/**
 * Phase 3 only. Throws if called from Purchasing public surface accidentally.
 * Warehouse should invoke this after Goods Receipt evidence is recorded.
 */
export function assertReceivingTransition(
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
): void {
  const allowed = PURCHASE_ORDER_RECEIVING_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new AppError({
      code: ERROR_CODES.PURCHASE_ORDER_INVALID_STATUS_TRANSITION,
      message: `${PURCHASE_ORDER_ERROR_MESSAGES.INVALID_STATUS_TRANSITION} (${from} -> ${to}; receiving reserved for Phase 3)`,
      statusCode: 409,
    });
  }
}

/** Header fields (and items) can be fully edited only while DRAFT. */
export function isPurchaseOrderCommerciallyEditable(status: PurchaseOrderStatus): boolean {
  return status === PurchaseOrderStatus.DRAFT;
}

/** Operational metadata (notes, expectedAt) stays editable until the PO is cancelled / received. */
export function isPurchaseOrderMetadataEditable(status: PurchaseOrderStatus): boolean {
  return (
    status === PurchaseOrderStatus.DRAFT ||
    status === PurchaseOrderStatus.APPROVED ||
    status === PurchaseOrderStatus.ORDERED
  );
}

export function assertCommerciallyEditable(status: PurchaseOrderStatus): void {
  if (!isPurchaseOrderCommerciallyEditable(status)) {
    throw new AppError({
      code: ERROR_CODES.PURCHASE_ORDER_NOT_EDITABLE,
      message: PURCHASE_ORDER_ERROR_MESSAGES.NOT_EDITABLE,
      statusCode: 409,
    });
  }
}

/** Cancellation reason required once the PO left DRAFT (APPROVED / ORDERED). */
export function requiresCancellationReason(status: PurchaseOrderStatus): boolean {
  return status === PurchaseOrderStatus.APPROVED || status === PurchaseOrderStatus.ORDERED;
}

/**
 * Server-derived legal next actions for UI (still revalidated on each command).
 */
export function deriveAvailableActions(
  status: PurchaseOrderStatus,
  permissions: {
    canManage: boolean;
    canApprove: boolean;
    canCancel: boolean;
  },
): PurchaseOrderLifecycleAction[] {
  const actions: PurchaseOrderLifecycleAction[] = [];
  if (status === PurchaseOrderStatus.DRAFT && permissions.canManage) {
    actions.push('EDIT');
  }
  if (canTransitionPurchaseOrder(status, PurchaseOrderStatus.APPROVED) && permissions.canApprove) {
    actions.push('APPROVE');
  }
  if (canTransitionPurchaseOrder(status, PurchaseOrderStatus.ORDERED) && permissions.canManage) {
    actions.push('ORDER');
  }
  if (canTransitionPurchaseOrder(status, PurchaseOrderStatus.CANCELLED) && permissions.canCancel) {
    actions.push('CANCEL');
  }
  if (
    permissions.canManage &&
    status !== PurchaseOrderStatus.CANCELLED &&
    status !== PurchaseOrderStatus.RECEIVED
  ) {
    actions.push('ADD_COST');
  }
  return actions;
}
