/**
 * Phase 4.9 — Liability Settlement constants (Supplier AP ↔ Payment).
 * Expense settlements remain on ExpensePaymentAllocation (FIN-SET-006).
 */

export const SETTLEMENT_ERROR_MESSAGES = {
  NOT_FOUND: 'تسویه یافت نشد.',
  PAYMENT_NOT_POSTED: 'فقط پرداخت‌های ثبت‌شده قابل تسویه هستند.',
  PAYMENT_OVER_ALLOCATED: 'مبلغ تخصیص‌یافته از مبلغ پرداخت بیشتر است.',
  OVER_LIABILITY: 'مبلغ تسویه از مانده بدهی بیشتر است.',
  FX_RATE_REQUIRED: 'برای تسویه چندارزی نرخ SETTLEMENT صریح لازم است.',
  FX_RATE_INVALID: 'نرخ تسویه نامعتبر است یا نوع آن SETTLEMENT نیست.',
  CROSS_CURRENCY_INVALID: 'مبالغ/ارز تسویه چندارزی نامعتبر است.',
  NOT_REVERSIBLE: 'این تسویه قابل برگشت نیست.',
  IDEMPOTENCY_CONFLICT: 'تعارض کلید تکرارناپذیری تسویه.',
  EMPTY_LINES: 'حداقل یک ردیف تسویه لازم است.',
  INVALID_MONEY: 'مبلغ تسویه نامعتبر است.',
  PAYABLE_CANCELLED: 'بدهی لغوشده قابل تسویه نیست.',
} as const;

export const SETTLEMENT_PAYMENT_SOURCE_TYPE = 'PAYMENT' as const;
