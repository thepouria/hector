import type {
  SupplierReturnExecutionStatus,
  SupplierReturnFulfillmentStatus,
} from '@/types/supplier-return-execution';
import type { SupplierReturnExecutionActorRef } from '@/types/supplier-return-execution';
import { stockClassificationLabel } from '@/features/warehouse/stock-issue-labels';

export function supplierReturnExecutionStatusLabel(
  status: SupplierReturnExecutionStatus,
): string {
  switch (status) {
    case 'DRAFT':
      return 'پیش‌نویس';
    case 'DISPATCHED':
      return 'ارسال‌شده';
    case 'CANCELLED':
      return 'لغو شده';
    default:
      return status;
  }
}

export function supplierReturnFulfillmentStatusLabel(
  status: SupplierReturnFulfillmentStatus,
): string {
  switch (status) {
    case 'NOT_DISPATCHED':
      return 'بدون ارسال';
    case 'PARTIALLY_DISPATCHED':
      return 'ارسال جزئی';
    case 'FULLY_DISPATCHED':
      return 'ارسال کامل';
    default:
      return status;
  }
}

export function actorDisplayName(actor: SupplierReturnExecutionActorRef | null | undefined): string {
  if (!actor) return '—';
  const parts = [actor.firstName, actor.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : actor.id.slice(0, 8);
}

export { stockClassificationLabel };
