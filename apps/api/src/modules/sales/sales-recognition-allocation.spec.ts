import { CurrencyCode, Prisma } from '@hector/database';
import { allocateSalesRecognition } from './sales-recognition-allocation';

describe('sales-recognition-allocation', () => {
  it('allocates pro-rata line nets and order discount with largest-remainder', () => {
    const result = allocateSalesRecognition({
      currency: CurrencyCode.IRR,
      netItemsTotal: new Prisma.Decimal(1000),
      orderDiscountTotal: new Prisma.Decimal(100),
      shippingAmount: new Prisma.Decimal(50),
      otherCharges: new Prisma.Decimal(25),
      isFirstFulfillment: true,
      orderItems: [
        {
          salesOrderItemId: 'a',
          skuId: 'sku-a',
          orderedQuantity: 10,
          lineNetTotal: new Prisma.Decimal(600),
          fulfilledQuantity: 5,
        },
        {
          salesOrderItemId: 'b',
          skuId: 'sku-b',
          orderedQuantity: 4,
          lineNetTotal: new Prisma.Decimal(400),
          fulfilledQuantity: 4,
        },
      ],
      fulfillmentItemLinks: [
        {
          salesFulfillmentItemId: 'fa',
          salesOrderItemId: 'a',
          skuId: 'sku-a',
          quantity: 5,
        },
        {
          salesFulfillmentItemId: 'fb',
          salesOrderItemId: 'b',
          skuId: 'sku-b',
          quantity: 4,
        },
      ],
    });

    // line slices: 300 + 400 = 700; discount share = 100 * 700/1000 = 70
    expect(result.lineNetRecognized.toString()).toBe('700');
    expect(result.orderDiscountShare.toString()).toBe('70');
    expect(result.shippingAmount.toString()).toBe('50');
    expect(result.otherCharges.toString()).toBe('25');
    // 700 - 70 + 50 + 25 = 705
    expect(result.totalAmount.toString()).toBe('705');

    const itemLines = result.lines.filter((l) => l.salesOrderItemId);
    const sumItems = itemLines.reduce((acc, l) => acc.add(l.amount), new Prisma.Decimal(0));
    expect(sumItems.toString()).toBe('630'); // 700 - 70
  });

  it('skips shipping/otherCharges on subsequent fulfillments', () => {
    const result = allocateSalesRecognition({
      currency: CurrencyCode.IRR,
      netItemsTotal: new Prisma.Decimal(1000),
      orderDiscountTotal: new Prisma.Decimal(0),
      shippingAmount: new Prisma.Decimal(50),
      otherCharges: new Prisma.Decimal(25),
      isFirstFulfillment: false,
      orderItems: [
        {
          salesOrderItemId: 'a',
          skuId: 'sku-a',
          orderedQuantity: 10,
          lineNetTotal: new Prisma.Decimal(1000),
          fulfilledQuantity: 2,
        },
      ],
      fulfillmentItemLinks: [
        {
          salesFulfillmentItemId: 'fa',
          salesOrderItemId: 'a',
          skuId: 'sku-a',
          quantity: 2,
        },
      ],
    });
    expect(result.shippingAmount.toString()).toBe('0');
    expect(result.otherCharges.toString()).toBe('0');
    expect(result.totalAmount.toString()).toBe('200');
  });
});
