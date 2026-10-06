import type {
  PaymentTermType,
  PurchaseCorrectionType,
  PurchaseCostStatus,
  PurchaseCostType,
  PurchaseDiscrepancySource,
  PurchaseDiscrepancyType,
  PurchaseDueStatus,
  PurchaseOrderStatus,
  PurchaseReturnReason,
  PurchaseReturnStatus,
} from '@/types/purchasing';

import { paymentTermLabel, purchaseTypeLabel } from '@/features/purchasing/offer-labels';

export { paymentTermLabel, purchaseTypeLabel };

export function purchaseOrderStatusLabel(status: PurchaseOrderStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'پیش‌نویس';
    case 'APPROVED':
      return 'تأیید شده';
    case 'ORDERED':
      return 'سفارش داده شده';
    case 'PARTIALLY_RECEIVED':
      return 'بخشی دریافت شده';
    case 'RECEIVED':
      return 'دریافت کامل';
    case 'CANCELLED':
      return 'لغو شده';
    default:
      return status;
  }
}

export function purchaseOrderStatusBadgeClass(status: PurchaseOrderStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'border-slate-300 bg-slate-50 text-slate-700';
    case 'APPROVED':
      return 'border-sky-300 bg-sky-50 text-sky-800';
    case 'ORDERED':
      return 'border-emerald-300 bg-emerald-50 text-emerald-800';
    case 'PARTIALLY_RECEIVED':
      return 'border-amber-300 bg-amber-50 text-amber-900';
    case 'RECEIVED':
      return 'border-teal-300 bg-teal-50 text-teal-900';
    case 'CANCELLED':
      return 'border-rose-300 bg-rose-50 text-rose-800';
    default:
      return '';
  }
}

/** Contractual due status — not payment / unpaid. */
export function purchaseDueStatusLabel(status: PurchaseDueStatus): string {
  switch (status) {
    case 'NO_DUE_DATE':
      return 'بدون سررسید';
    case 'UPCOMING':
      return 'آینده';
    case 'DUE_SOON':
      return 'نزدیک سررسید';
    case 'DUE_TODAY':
      return 'امروز';
    case 'OVERDUE':
      return 'گذشته از سررسید';
    default:
      return status;
  }
}

export function purchaseDueStatusBadgeClass(status: PurchaseDueStatus): string {
  switch (status) {
    case 'NO_DUE_DATE':
      return 'border-slate-200 bg-slate-50 text-slate-600';
    case 'UPCOMING':
      return 'border-slate-300 bg-white text-slate-700';
    case 'DUE_SOON':
      return 'border-amber-300 bg-amber-50 text-amber-900';
    case 'DUE_TODAY':
      return 'border-orange-300 bg-orange-50 text-orange-900';
    case 'OVERDUE':
      return 'border-rose-300 bg-rose-50 text-rose-900';
    default:
      return '';
  }
}

export function paymentTermsSummary(
  paymentTermType: PaymentTermType | null | undefined,
  netDays: number | null | undefined,
): string {
  if (!paymentTermType) return '—';
  if (paymentTermType === 'IMMEDIATE') return 'نقدی / فوری';
  if (paymentTermType === 'NET_DAYS') {
    return netDays != null ? `${netDays} روزه` : 'مدت‌دار';
  }
  if (paymentTermType === 'FIXED_DATE') return 'تاریخ سررسید مشخص';
  return paymentTermLabel(paymentTermType);
}

export function purchaseCostTypeLabel(type: PurchaseCostType): string {
  switch (type) {
    case 'COURIER':
      return 'پیک';
    case 'FREIGHT':
      return 'حمل / باربری';
    case 'PURCHASE_FEE':
      return 'کارمزد خرید';
    case 'TRANSFER_FEE':
      return 'کارمزد انتقال';
    case 'PACKAGING':
      return 'بسته‌بندی خرید';
    case 'CUSTOMS':
      return 'گمرک / ترخیص';
    case 'OTHER':
      return 'سایر';
    default:
      return type;
  }
}

export function purchaseCostStatusLabel(status: PurchaseCostStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'فعال';
    case 'VOIDED':
      return 'باطل‌شده';
    default:
      return status;
  }
}

/** Client preview: orderDate (YYYY-MM-DD or ISO) + netDays → YYYY-MM-DD. */
export function previewDueDateFromOrderDate(
  orderDateInput: string,
  netDays: number,
): string | null {
  if (!Number.isInteger(netDays) || netDays < 1) return null;
  const day = orderDateInput.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [y, m, d] = day.split('-').map(Number);
  const due = new Date(Date.UTC(y, m - 1, d + netDays, 12, 0, 0, 0));
  const yy = due.getUTCFullYear();
  const mm = String(due.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(due.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Client-side decimal multiply (no JS Number). Analysis / preview only. */
export function multiplyDecimalStrings(a: string, b: string): string | null {
  const left = a.trim();
  const right = b.trim();
  if (!/^\d+(\.\d+)?$/.test(left) || !/^\d+(\.\d+)?$/.test(right)) return null;
  const [aw, af = ''] = left.split('.');
  const [bw, bf = ''] = right.split('.');
  const scale = af.length + bf.length;
  const ad = `${aw}${af}`.replace(/^0+(?=\d)/, '') || '0';
  const bd = `${bw}${bf}`.replace(/^0+(?=\d)/, '') || '0';
  try {
    const product = (BigInt(ad) * BigInt(bd)).toString();
    if (scale === 0) return product;
    const padded = product.padStart(scale + 1, '0');
    const cut = padded.length - scale;
    const intPart = padded.slice(0, cut).replace(/^0+(?=\d)/, '') || '0';
    const fracPart = padded.slice(cut).replace(/0+$/, '');
    return fracPart ? `${intPart}.${fracPart}` : intPart;
  } catch {
    return null;
  }
}

/** Client-side line preview only — server totals remain authoritative. */
export function previewLineSubtotal(
  quantity: number,
  unitPrice: string,
): string | null {
  if (!Number.isInteger(quantity) || quantity <= 0) return null;
  return multiplyDecimalStrings(String(quantity), unitPrice);
}

export function purchaseReturnStatusLabel(status: PurchaseReturnStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'پیش‌نویس';
    case 'APPROVED':
      return 'تأیید شده';
    case 'CANCELLED':
      return 'لغو شده';
    default:
      return status;
  }
}

export function purchaseReturnReasonLabel(reason: PurchaseReturnReason): string {
  switch (reason) {
    case 'DAMAGED':
      return 'آسیب‌دیده';
    case 'DEFECTIVE':
      return 'معیوب';
    case 'WRONG_ITEM':
      return 'کالای اشتباه';
    case 'OVER_SHIPMENT':
      return 'اضافه تحویل';
    case 'QUALITY_ISSUE':
      return 'کیفیت';
    case 'EXPIRED':
      return 'منقضی';
    case 'SUPPLIER_AGREEMENT':
      return 'توافق تأمین‌کننده';
    case 'OTHER':
      return 'سایر';
    default:
      return reason;
  }
}

export function purchaseCorrectionTypeLabel(type: PurchaseCorrectionType): string {
  switch (type) {
    case 'DATA_ENTRY_ERROR':
      return 'خطای ورود داده';
    case 'QUANTITY_CORRECTION':
      return 'اصلاح تعداد';
    case 'PRICE_CORRECTION':
      return 'اصلاح قیمت';
    case 'COMMERCIAL_TERM_CORRECTION':
      return 'اصلاح شرایط تجاری';
    case 'SUPPLIER_CORRECTION':
      return 'اصلاح تأمین‌کننده';
    case 'OTHER':
      return 'سایر';
    default:
      return type;
  }
}

export function purchaseDiscrepancyTypeLabel(type: PurchaseDiscrepancyType): string {
  switch (type) {
    case 'SHORT_SHIPMENT':
      return 'کسری تأمین';
    case 'OVER_SHIPMENT':
      return 'اضافه تحویل';
    case 'DAMAGED':
      return 'آسیب‌دیده';
    case 'WRONG_ITEM':
      return 'کالای اشتباه';
    case 'MISSING':
      return 'کسری';
    case 'OTHER':
      return 'سایر';
    default:
      return type;
  }
}

export function purchaseDiscrepancySourceLabel(source: PurchaseDiscrepancySource): string {
  switch (source) {
    case 'BEFORE_RECEIPT':
      return 'قبل از دریافت';
    case 'AT_RECEIPT':
      return 'هنگام دریافت';
    case 'AFTER_RECEIPT':
      return 'بعد از دریافت';
    default:
      return source;
  }
}
