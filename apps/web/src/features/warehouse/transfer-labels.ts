import type { StockTransferActorRef, StockTransferStatus } from '@/types/stock-transfer';

export function stockTransferStatusLabel(status: StockTransferStatus | string): string {
  switch (status) {
    case 'DRAFT':
      return 'پیش‌نویس';
    case 'IN_TRANSIT':
      return 'در مسیر';
    case 'COMPLETED':
      return 'تکمیل‌شده';
    case 'CANCELLED':
      return 'لغو شده';
    default:
      return status;
  }
}

export function formatStockTransferActor(actor: StockTransferActorRef | null | undefined): string {
  if (!actor) return '—';
  const parts = [actor.firstName, actor.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : '—';
}

export function formatTransferLocationLabel(loc: {
  code: string;
  name: string | null;
  barcode: string;
}): string {
  const name = loc.name ? ` · ${loc.name}` : '';
  return `${loc.code}${name}`;
}
