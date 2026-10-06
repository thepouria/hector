import type { StockCountLineStatus, StockCountStatus, StockCountType } from '@/types/stock-count';

export {
  actorDisplayName,
  stockClassificationLabel,
} from '@/features/warehouse/stock-issue-labels';

export function stockCountTypeLabel(type: StockCountType): string {
  switch (type) {
    case 'FULL':
      return 'کامل';
    case 'CYCLE':
      return 'چرخه‌ای';
    default:
      return type;
  }
}

export function stockCountStatusLabel(status: StockCountStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'پیش‌نویس';
    case 'IN_PROGRESS':
      return 'در حال شمارش';
    case 'SUBMITTED':
      return 'ارسال‌شده';
    case 'RECOUNT_REQUIRED':
      return 'نیاز به شمارش مجدد';
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

export function stockCountLineStatusLabel(status: StockCountLineStatus): string {
  switch (status) {
    case 'PENDING':
      return 'در انتظار';
    case 'COUNTED':
      return 'شمارش‌شده';
    case 'SKIPPED':
      return 'رد شده';
    case 'RECOUNT_REQUIRED':
      return 'شمارش مجدد';
    default:
      return status;
  }
}

export function stockCountDifferenceDisplay(
  difference: number | null,
  label: string | null,
): string {
  if (label) return label;
  if (difference === null) return '—';
  if (difference === 0) return 'MATCH';
  if (difference > 0) return `+${difference}`;
  return String(difference);
}
