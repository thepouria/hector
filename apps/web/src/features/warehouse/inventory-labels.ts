import type { InventoryMovementType, InventorySourceType } from '@/types/inventory';

export function inventoryMovementTypeLabel(type: InventoryMovementType | string): string {
  switch (type) {
    case 'RECEIVE':
      return 'دریافت';
    case 'ISSUE':
      return 'خروج';
    case 'TRANSFER_OUT':
      return 'انتقال (خروج)';
    case 'TRANSFER_IN':
      return 'انتقال (ورود)';
    case 'RECLASSIFY_OUT':
      return 'تغییر طبقه‌بندی (خروج)';
    case 'RECLASSIFY_IN':
      return 'تغییر طبقه‌بندی (ورود)';
    case 'ADJUSTMENT_IN':
      return 'تعدیل (افزایش)';
    case 'ADJUSTMENT_OUT':
      return 'تعدیل (کاهش)';
    case 'RETURN_IN':
      return 'برگشت (ورود)';
    case 'RETURN_OUT':
      return 'برگشت (خروج)';
    case 'STOCK_COUNT_ADJUSTMENT_IN':
      return 'انبارگردانی (افزایش)';
    case 'STOCK_COUNT_ADJUSTMENT_OUT':
      return 'انبارگردانی (کاهش)';
    case 'OPENING_BALANCE':
      return 'موجودی اول دوره';
    case 'SYSTEM_CORRECTION':
      return 'اصلاح سیستمی';
    default:
      return type;
  }
}

export function inventorySourceTypeLabel(source: InventorySourceType | string): string {
  switch (source) {
    case 'PUTAWAY':
      return 'جایگذاری';
    case 'MANUAL_ADJUSTMENT':
      return 'تعدیل دستی';
    case 'TRANSFER':
      return 'انتقال';
    case 'CLASSIFICATION_CHANGE':
      return 'تغییر طبقه‌بندی';
    case 'STOCK_ISSUE':
      return 'خروج غیرفروشی';
    case 'SALES_FULFILLMENT':
      return 'تحویل فروش';
    case 'CUSTOMER_RETURN':
      return 'برگشت مشتری';
    case 'SUPPLIER_RETURN':
      return 'برگشت به تأمین‌کننده';
    case 'STOCK_COUNT':
      return 'انبارگردانی';
    case 'OPENING_BALANCE':
      return 'موجودی اول دوره';
    case 'SYSTEM_CORRECTION':
      return 'اصلاح سیستمی';
    case 'SEED':
      return 'دادهٔ اولیه';
    default:
      return source;
  }
}

/** Signed quantity for ledger display (e.g. +40, -5). */
export function formatInventoryQuantityDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}
