import { describe, expect, it } from 'vitest';
import { warehouseKeys } from './keys';

describe('warehouseKeys (WH-UI-002)', () => {
  it('includes companyId in dashboard and scanner keys', () => {
    expect(warehouseKeys.dashboard('co-a')).toEqual(['warehouses', 'co-a', 'dashboard', {}]);
    expect(warehouseKeys.scanner.product('co-a', '00123')).toEqual([
      'warehouses',
      'co-a',
      'scanner',
      'product',
      '00123',
    ]);
    expect(warehouseKeys.scanner.location('co-b', 'LOC-01')).toEqual([
      'warehouses',
      'co-b',
      'scanner',
      'location',
      'LOC-01',
    ]);
  });

  it('keeps inventory and document keys company-scoped', () => {
    expect(warehouseKeys.inventory.balances('co-a', { warehouseId: 'w1' })[1]).toBe('co-a');
    expect(warehouseKeys.goodsReceipts.detail('co-a', 'gr1')[1]).toBe('co-a');
    expect(warehouseKeys.transfers.detail('co-b', 't1')[1]).toBe('co-b');
    expect(warehouseKeys.issues.detail('co-c', 'i1')[1]).toBe('co-c');
  });

  it('does not collide company A and company B prefixes', () => {
    const a = warehouseKeys.dashboard('company-a').join('/');
    const b = warehouseKeys.dashboard('company-b').join('/');
    expect(a).not.toBe(b);
  });
});
