import type { BatchExpiryState } from '@/types/batch';

export function batchExpiryStateLabel(state: BatchExpiryState): string {
  switch (state) {
    case 'NO_EXPIRY':
      return 'بدون انقضا';
    case 'VALID':
      return 'معتبر';
    case 'EXPIRED':
      return 'منقضی';
    default:
      return state;
  }
}

export function batchExpiryBadgeClass(state: BatchExpiryState): string {
  switch (state) {
    case 'NO_EXPIRY':
      return 'border-slate-200 bg-slate-50 text-slate-700';
    case 'VALID':
      return 'border-emerald-200 bg-emerald-50 text-emerald-900';
    case 'EXPIRED':
      return 'border-red-200 bg-red-50 text-red-900';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700';
  }
}

export function formatBatchDateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeZone: 'Asia/Tehran',
  }).format(date);
}
