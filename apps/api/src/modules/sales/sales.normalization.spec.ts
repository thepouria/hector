import {
  assertSalesChannelCode,
  normalizeSalesCode,
  setDefaultCustomerAddressInTx,
} from './sales.normalization';

describe('sales.normalization', () => {
  it('normalizes channel codes to UPPER trim', () => {
    expect(normalizeSalesCode('  khanoumi  ')).toBe('KHANOUMI');
    expect(assertSalesChannelCode('snapp_shop')).toBe('SNAPP_SHOP');
  });

  it('rejects invalid channel codes', () => {
    expect(() => assertSalesChannelCode('')).toThrow();
    expect(() => assertSalesChannelCode('bad code')).toThrow();
  });

  it('setDefaultCustomerAddressInTx clears others then sets target', async () => {
    const updates: Array<{ where: unknown; data: unknown }> = [];
    const tx = {
      customerAddress: {
        updateMany: async (args: { where: unknown; data: unknown }) => {
          updates.push(args);
          return { count: 1 };
        },
        update: async (args: { where: unknown; data: unknown }) => {
          updates.push(args);
          return { id: 'a2' };
        },
      },
    };

    await setDefaultCustomerAddressInTx(tx as never, {
      companyId: 'c1',
      customerId: 'cust1',
      addressId: 'a2',
    });

    expect(updates).toHaveLength(2);
    expect(updates[0].data).toEqual({ isDefault: false });
    expect(updates[1].data).toEqual({ isDefault: true });
  });
});
