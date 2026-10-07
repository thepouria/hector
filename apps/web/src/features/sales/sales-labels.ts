import type {
  SalesChannelStatus,
  SalesChannelType,
  SalesOrderPaymentTermType,
  SalesOrderStatus,
  SalesReturnStatus,
} from '@/types/sales';

export function salesOrderStatusLabel(status: SalesOrderStatus | string): string {
  switch (status) {
    case 'DRAFT':
      return 'پیش‌نویس';
    case 'CONFIRMED':
      return 'تأییدشده';
    case 'PROCESSING':
      return 'در حال پردازش';
    case 'PARTIALLY_FULFILLED':
      return 'نیمه‌تحویل';
    case 'FULFILLED':
      return 'تحویل‌شده';
    case 'CANCELLED':
      return 'لغو شده';
    default:
      return status;
  }
}

export function salesOrderStatusBadgeClass(status: SalesOrderStatus | string): string {
  switch (status) {
    case 'DRAFT':
      return 'bg-slate-100 text-slate-700';
    case 'CONFIRMED':
      return 'bg-sky-100 text-sky-800';
    case 'PROCESSING':
      return 'bg-amber-100 text-amber-800';
    case 'PARTIALLY_FULFILLED':
      return 'bg-violet-100 text-violet-800';
    case 'FULFILLED':
      return 'bg-emerald-100 text-emerald-800';
    case 'CANCELLED':
      return 'bg-rose-100 text-rose-800';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

export function paymentTermLabel(term: SalesOrderPaymentTermType | string): string {
  switch (term) {
    case 'CASH':
      return 'نقدی';
    case 'CREDIT':
      return 'اعتباری';
    case 'PARTIAL':
      return 'جزئی';
    default:
      return term;
  }
}

export function channelTypeLabel(type: SalesChannelType | string): string {
  switch (type) {
    case 'WEBSITE':
      return 'وب‌سایت';
    case 'MARKETPLACE':
      return 'مارکت‌پلیس';
    case 'WHOLESALE':
      return 'عمده';
    case 'MANUAL':
      return 'دستی';
    case 'OTHER':
      return 'سایر';
    default:
      return type;
  }
}

export function channelStatusLabel(status: SalesChannelStatus | string): string {
  if (status === 'ACTIVE') return 'فعال';
  if (status === 'INACTIVE') return 'غیرفعال';
  return status;
}

export function returnStatusLabel(status: SalesReturnStatus | string): string {
  switch (status) {
    case 'DRAFT':
      return 'پیش‌نویس';
    case 'APPROVED':
      return 'تأییدشده';
    case 'RECEIVED':
      return 'دریافت‌شده';
    case 'CANCELLED':
      return 'لغو شده';
    default:
      return status;
  }
}

export function formatSalesMoney(amount: string, currency: string): string {
  try {
    const n = Number(amount);
    if (!Number.isFinite(n)) return `${amount} ${currency}`;
    return `${new Intl.NumberFormat('fa-IR').format(n)} ${currency}`;
  } catch {
    return `${amount} ${currency}`;
  }
}
