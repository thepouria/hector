import { describe, expect, it } from 'vitest';
import { NAVIGATION } from '@/components/navigation/nav-config';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { ROUTES } from '@/lib/utils/routes';

describe('purchasing navigation', () => {
  const purchasing = NAVIGATION.find((section) => section.label === 'خرید');

  it('exposes a simple Purchasing hierarchy', () => {
    expect(purchasing).toBeDefined();
    const hrefs = purchasing!.items.map((item) => item.href);
    expect(hrefs).toEqual([
      ROUTES.purchasing,
      ROUTES.purchasingSuppliers,
      ROUTES.purchasingOffers,
      ROUTES.purchasingOrders,
      ROUTES.purchasingReturns,
    ]);
  });

  it('gates every Purchasing nav item on purchasing.read', () => {
    for (const item of purchasing!.items) {
      expect(item.permission).toBe(PERMISSIONS.PURCHASING_READ);
    }
  });

  it('does not create warehouse or finance sidebar children under Purchasing', () => {
    const labels = purchasing!.items.map((item) => item.label);
    expect(labels.join(' ')).not.toMatch(/انبار|پرداخت|مالی/);
  });

  it('uses the Purchase Dashboard as the default Purchasing entry', () => {
    expect(purchasing!.items[0]?.label).toBe('داشبورد خرید');
    expect(purchasing!.items[0]?.href).toBe(ROUTES.purchasing);
  });
});
