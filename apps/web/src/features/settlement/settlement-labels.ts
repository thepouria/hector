export function formatSettlementMoney(amount: string, currency: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount} ${currency}`;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(n)} ${currency}`;
}

export function channelSettlementStatusLabel(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'پیش‌نویس';
    case 'OPEN':
      return 'باز';
    case 'PARTIALLY_RECEIVED':
      return 'دریافت جزئی';
    case 'RECEIVED':
      return 'دریافت کامل';
    case 'CANCELLED':
      return 'لغو شده';
    default:
      return status;
  }
}

export function reconciliationStatusLabel(status: string): string {
  switch (status) {
    case 'OPEN':
      return 'باز';
    case 'PARTIALLY_MATCHED':
      return 'تطبیق جزئی';
    case 'MATCHED':
      return 'تطبیق کامل';
    case 'DISCREPANCY':
      return 'مغایرت';
    case 'UNDER_REVIEW':
      return 'در حال بررسی';
    case 'RESOLVED':
      return 'حل‌شده';
    case 'CANCELLED':
      return 'لغو شده';
    default:
      return status;
  }
}

export function discrepancyReasonLabel(code: string): string {
  const map: Record<string, string> = {
    BANK_FEE: 'کارمزد بانک',
    COMMISSION_DIFFERENCE: 'اختلاف کمیسیون',
    RETURN_DIFFERENCE: 'اختلاف مرجوعی',
    FEE_DIFFERENCE: 'اختلاف کارمزد',
    ROUNDING: 'گرد کردن',
    TIMING_DIFFERENCE: 'اختلاف زمانی',
    DUPLICATE_TRANSACTION: 'تراکنش تکراری',
    MISSING_TRANSACTION: 'تراکنش مفقود',
    WRONG_AMOUNT: 'مبلغ نادرست',
    WRONG_REFERENCE: 'مرجع نادرست',
    FX_DIFFERENCE: 'اختلاف ارز',
    MANUAL_ADJUSTMENT: 'تعدیل دستی',
    OTHER: 'سایر',
  };
  return map[code] ?? code;
}

export function resolutionTypeLabel(type: string): string {
  const map: Record<string, string> = {
    EXPLAINED: 'توضیح داده شد',
    ADJUSTMENT_CREATED: 'تعدیل ایجاد شد',
    ALLOCATION_CORRECTED: 'تخصیص اصلاح شد',
    SOURCE_CORRECTED: 'منبع اصلاح شد',
    FINANCE_TRANSACTION_CORRECTED: 'تراکنش مالی اصلاح شد',
    ACCEPTED_VARIANCE: 'واریانس پذیرفته شد',
    OTHER: 'سایر',
  };
  return map[type] ?? type;
}

export function componentTypeLabel(type: string): string {
  switch (type) {
    case 'GROSS_SALES':
      return 'فروش ناخالص';
    case 'COMMISSION':
      return 'کمیسیون';
    case 'RETURN':
      return 'مرجوعی';
    case 'FEE':
      return 'کارمزد';
    case 'ADJUSTMENT':
      return 'تعدیل';
    default:
      return type;
  }
}

export function statusBadgeClass(status: string): string {
  if (status.includes('RESOLVED') || status === 'MATCHED' || status === 'RECEIVED' || status === 'PAID') {
    return 'bg-emerald-50 text-emerald-800';
  }
  if (
    status.includes('DISCREPANCY') ||
    status.includes('OVERDUE') ||
    status === 'CANCELLED'
  ) {
    return 'bg-red-50 text-red-800';
  }
  if (status.includes('PARTIAL') || status === 'UNDER_REVIEW' || status === 'OPEN') {
    return 'bg-amber-50 text-amber-900';
  }
  return 'bg-slate-100 text-slate-800';
}
