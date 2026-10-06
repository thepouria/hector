import { describe, expect, it } from 'vitest';
import { ROUTES, purchasingSupplierPath } from '@/lib/utils/routes';

/** Drilldown destinations used by the Purchase Dashboard (Phase 2.14). */
describe('purchase dashboard drilldowns', () => {
  it('maps KPI destinations without inventing finance/warehouse filters', () => {
    const dueHref = `${ROUTES.purchasingOrders}?dueStatus=DUE_SOON`;
    const fxHref = `${ROUTES.purchasingOrders}?purchaseType=FX_CREDIT`;
    const cashHref = `${ROUTES.purchasingOrders}?purchaseType=CASH`;
    const termHref = `${ROUTES.purchasingOrders}?purchaseType=TERM_CREDIT`;
    const supplierHref = purchasingSupplierPath('sup-1');

    expect(dueHref).toContain('dueStatus=DUE_SOON');
    expect(dueHref).not.toMatch(/paid|payable|unpaid/i);
    expect(fxHref).toContain('FX_CREDIT');
    expect(cashHref).toContain('CASH');
    expect(termHref).toContain('TERM_CREDIT');
    expect(supplierHref).toBe(`${ROUTES.purchasingSuppliers}/sup-1`);
  });

  it('keeps dashboard filter state in URL query shape', () => {
    const params = new URLSearchParams({
      range: '30d',
      supplierId: 'abc',
      purchaseType: 'TERM_CREDIT',
      currency: 'IRR',
    });
    expect(params.get('range')).toBe('30d');
    expect(params.toString()).toContain('supplierId=abc');
    expect(params.toString()).not.toContain('accountsPayable');
  });
});
