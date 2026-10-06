import type { StockIssueReason, StockIssueStatus } from '@/types/stock-issue';
import type { StockClassification } from '@/types/stock-classification';

export function stockIssueStatusLabel(status: StockIssueStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'پیش‌نویس';
    case 'POSTED':
      return 'ثبت‌شده';
    case 'CANCELLED':
      return 'لغو شده';
    default:
      return status;
  }
}

export function stockIssueReasonLabel(reason: StockIssueReason): string {
  switch (reason) {
    case 'COMPANY_USE':
      return 'مصرف داخلی';
    case 'SAMPLE':
      return 'نمونه';
    case 'DAMAGE':
      return 'امحا / امحای آسیب‌دیده';
    case 'MANUAL':
      return 'دستی';
    case 'OTHER':
      return 'سایر';
    default:
      return reason;
  }
}

export function stockClassificationLabel(classification: StockClassification): string {
  switch (classification) {
    case 'SELLABLE':
      return 'قابل فروش';
    case 'TESTER':
      return 'تستر';
    case 'DAMAGED':
      return 'آسیب‌دیده';
    case 'QUARANTINE':
      return 'قرنطینه';
    default:
      return classification;
  }
}

export function actorDisplayName(actor: {
  firstName: string | null;
  lastName: string | null;
} | null | undefined): string {
  if (!actor) return '—';
  return `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim() || '—';
}
