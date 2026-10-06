import {
  CurrencyCode,
  InventoryCostComponentSourceType,
  InventoryValuationStatus,
  Prisma,
  PurchaseCostType,
} from '@hector/database';
import { applyCapitalizableCostToLayersInTx } from './inventory-cost-capitalization';

describe('applyCapitalizableCostToLayersInTx', () => {
  it('raises unit cost, leaves quantity fields untouched, creates InventoryCostComponent', async () => {
    const layerId = '11111111-1111-1111-1111-111111111111';
    const companyId = '22222222-2222-2222-2222-222222222222';
    const costId = '33333333-3333-3333-3333-333333333333';
    const qty = 100;
    const prevUnit = new Prisma.Decimal(500_000);
    const shipping = new Prisma.Decimal(10_000_000);

    const update = jest.fn().mockResolvedValue({});
    const create = jest.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: layerId,
          original_quantity: qty,
          remaining_quantity: qty,
          base_currency_unit_cost: prevUnit,
          original_unit_amount: prevUnit,
          original_currency: CurrencyCode.IRR,
          has_unallocated_purchase_costs: true,
          valuation_status: InventoryValuationStatus.VALUED,
        },
      ]),
      inventoryCostLayer: { update },
      inventoryCostComponent: { create },
    };

    await applyCapitalizableCostToLayersInTx(
      tx as unknown as Prisma.TransactionClient,
      companyId,
      [
        {
          layerId,
          allocatedAmount: shipping,
          currency: CurrencyCode.IRR,
          baseAmount: shipping,
          costType: PurchaseCostType.FREIGHT,
          sourceId: costId,
        },
      ],
    );

    const expectedUnit = prevUnit.mul(qty).add(shipping).div(qty);
    expect(update).toHaveBeenCalledWith({
      where: { id: layerId },
      data: expect.objectContaining({
        baseCurrencyUnitCost: expectedUnit,
        originalUnitAmount: expectedUnit,
        originalCurrency: CurrencyCode.IRR,
        valuationStatus: InventoryValuationStatus.VALUED,
      }),
    });
    const updateData = update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(updateData).not.toHaveProperty('originalQuantity');
    expect(updateData).not.toHaveProperty('remainingQuantity');

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId,
        layerId,
        sourceType: InventoryCostComponentSourceType.PURCHASE_ORDER_COST,
        sourceId: costId,
        costType: PurchaseCostType.FREIGHT,
        allocatedAmount: shipping,
        currency: CurrencyCode.IRR,
        baseAmount: shipping,
      }),
    });
  });

  it('rejects non-positive increments', async () => {
    const tx = {
      $queryRaw: jest.fn(),
      inventoryCostLayer: { update: jest.fn() },
      inventoryCostComponent: { create: jest.fn() },
    };
    await expect(
      applyCapitalizableCostToLayersInTx(
        tx as unknown as Prisma.TransactionClient,
        '22222222-2222-2222-2222-222222222222',
        [
          {
            layerId: '11111111-1111-1111-1111-111111111111',
            allocatedAmount: new Prisma.Decimal(0),
            currency: CurrencyCode.IRR,
            baseAmount: new Prisma.Decimal(0),
            costType: PurchaseCostType.FREIGHT,
            sourceId: '33333333-3333-3333-3333-333333333333',
          },
        ],
      ),
    ).rejects.toThrow(/positive/);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
