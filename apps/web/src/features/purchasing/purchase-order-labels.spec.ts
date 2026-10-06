import { describe, expect, it } from 'vitest';
import {
  previewDueDateFromOrderDate,
  previewLineSubtotal,
  purchaseCorrectionTypeLabel,
  purchaseDiscrepancyTypeLabel,
  purchaseOrderStatusLabel,
  purchaseTypeLabel,
} from '@/features/purchasing/purchase-order-labels';

describe('purchase order labels', () => {
  it('maps lifecycle statuses to Persian', () => {
    expect(purchaseOrderStatusLabel('DRAFT')).toBe('پیش‌نویس');
    expect(purchaseOrderStatusLabel('APPROVED')).toBe('تأیید شده');
    expect(purchaseOrderStatusLabel('ORDERED')).toBe('سفارش داده شده');
    expect(purchaseOrderStatusLabel('PARTIALLY_RECEIVED')).toBe('بخشی دریافت شده');
    expect(purchaseOrderStatusLabel('RECEIVED')).toBe('دریافت کامل');
    expect(purchaseOrderStatusLabel('CANCELLED')).toBe('لغو شده');
  });

  it('maps purchase types without hiding enum meaning', () => {
    expect(purchaseTypeLabel('CASH')).toContain('نقد');
    expect(purchaseTypeLabel('FX_CREDIT')).toMatch(/ارز/);
    expect(purchaseTypeLabel('TERM_CREDIT')).toMatch(/اعتبار/);
  });

  it('maps correction and discrepancy types', () => {
    expect(purchaseCorrectionTypeLabel('PRICE_CORRECTION')).toBe('اصلاح قیمت');
    expect(purchaseDiscrepancyTypeLabel('SHORT_SHIPMENT')).toBe('کسری تأمین');
  });

  it('previews line totals with decimal strings', () => {
    expect(previewLineSubtotal(100, '5850000')).toBe('585000000');
  });

  it('previews net-days due date from order date', () => {
    const due = previewDueDateFromOrderDate('2026-01-01T12:00:00.000Z', 30);
    expect(due).toMatch(/2026-01-31/);
  });
});
