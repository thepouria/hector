import type { GoodsReceiptStatus } from '@/types/goods-receipt';

export function goodsReceiptStatusLabel(status: GoodsReceiptStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'پیش‌نویس';
    case 'POSTED':
      return 'ثبت نهایی';
    case 'CANCELLED':
      return 'لغو شده';
    default:
      return status;
  }
}
