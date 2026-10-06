import type {
  InventoryAdjustmentDirection,
  InventoryAdjustmentReason,
  InventoryAdjustmentStatus,
} from '@/types/inventory-adjustment';

export {
  actorDisplayName,
  stockClassificationLabel,
} from '@/features/warehouse/stock-issue-labels';

export function inventoryAdjustmentStatusLabel(status: InventoryAdjustmentStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'پیش‌نویس';
    case 'PENDING_APPROVAL':
      return 'در انتظار تأیید';
    case 'APPROVED':
      return 'تأیید شده';
    case 'POSTED':
      return 'ثبت‌شده';
    case 'REJECTED':
      return 'رد شده';
    case 'CANCELLED':
      return 'لغو شده';
    default:
      return status;
  }
}

export function inventoryAdjustmentReasonLabel(reason: InventoryAdjustmentReason): string {
  switch (reason) {
    case 'FOUND':
      return 'یافت‌شده';
    case 'MISSING':
      return 'مفقود';
    case 'REGISTRATION_ERROR':
      return 'خطای ثبت';
    case 'CORRECTION':
      return 'اصلاح';
    case 'OTHER':
      return 'سایر';
    default:
      return reason;
  }
}

export function inventoryAdjustmentDirectionLabel(
  direction: InventoryAdjustmentDirection,
): string {
  return direction === 'IN' ? 'ورود (+)' : 'خروج (−)';
}
