import { formatDateTime } from '@/lib/formatters';
import type {
  OfferCurrency,
  PaymentTermType,
  PurchaseCommercialType,
  SupplierOfferExpiryState,
  SupplierOfferValidityFilter,
} from '@/types/purchasing';

export function purchaseTypeLabel(value: PurchaseCommercialType | null | undefined): string {
  if (value === 'CASH') return 'نقدی';
  if (value === 'TERM_CREDIT') return 'اعتباری ریالی';
  if (value === 'FX_CREDIT') return 'اعتباری ارزی';
  return '—';
}

export function paymentTermLabel(value: PaymentTermType | null | undefined): string {
  if (value === 'IMMEDIATE') return 'فوری';
  if (value === 'NET_DAYS') return 'NET';
  if (value === 'FIXED_DATE') return 'تاریخ ثابت';
  return '—';
}

export function currencyLabel(currency: OfferCurrency): string {
  return currency === 'IRR' ? 'ریال (API)' : 'USD';
}

export function expiryStateLabel(state: SupplierOfferExpiryState): string {
  if (state === 'CURRENT') return 'جاری';
  if (state === 'EXPIRED') return 'منقضی';
  if (state === 'NO_EXPIRY') return 'بدون انقضا';
  if (state === 'ARCHIVED') return 'بایگانی';
  return state;
}

export function validityFilterLabel(value: SupplierOfferValidityFilter | ''): string {
  if (value === 'CURRENT') return 'جاری';
  if (value === 'ACTIVE') return 'فعال (غیر بایگانی)';
  if (value === 'EXPIRED') return 'منقضی';
  if (value === 'NO_EXPIRY') return 'بدون انقضا';
  if (value === 'ARCHIVED') return 'بایگانی';
  return 'همه';
}

const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;

function tehranCalendarDay(date: Date): string {
  const shifted = new Date(date.getTime() + TEHRAN_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${shifted.getUTCMonth()}-${shifted.getUTCDate()}`;
}

/** Relative quote age in Persian plus exact datetime on second line context. */
export function formatQuoteAge(quotedAt: string): { relative: string; exact: string } {
  const date = new Date(quotedAt);
  const exact = formatDateTime(quotedAt);
  if (Number.isNaN(date.getTime())) return { relative: '—', exact };

  const now = new Date();
  const today = tehranCalendarDay(now);
  const quotedDay = tehranCalendarDay(date);
  if (quotedDay === today) return { relative: 'امروز', exact };

  const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (quotedDay === tehranCalendarDay(yesterdayDate)) return { relative: 'دیروز', exact };

  const diffMs = now.getTime() - date.getTime();
  const days = Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
  if (days < 30) return { relative: `${days} روز پیش`, exact };
  return { relative: exact, exact };
}
