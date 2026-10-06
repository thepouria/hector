import type { PutawayStatus, ReceiptPutawayProgress } from '@/types/putaway';

export function putawayStatusLabel(status: PutawayStatus | string): string {
  switch (status) {
    case 'DRAFT':
      return 'پیش‌نویس';
    case 'IN_PROGRESS':
      return 'در حال جایگذاری';
    case 'COMPLETED':
      return 'تکمیل‌شده';
    case 'CANCELLED':
      return 'لغو شده';
    default:
      return status;
  }
}

export function receiptPutawayProgressLabel(progress: ReceiptPutawayProgress | string): string {
  switch (progress) {
    case 'NOT_PUT_AWAY':
      return 'جایگذاری نشده';
    case 'PARTIALLY_PUT_AWAY':
      return 'جایگذاری جزئی';
    case 'FULLY_PUT_AWAY':
      return 'جایگذاری کامل';
    default:
      return progress;
  }
}

export function formatPutawayLocationPath(location: {
  path: string[];
  code: string;
  name?: string | null;
}): string {
  const segments = [...location.path, location.code].filter(Boolean);
  const pathText = segments.join(' › ');
  if (location.name?.trim()) {
    return `${pathText} (${location.name.trim()})`;
  }
  return pathText;
}
