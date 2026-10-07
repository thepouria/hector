import { CurrencyCode, Prisma } from '@hector/database';
import { AppError } from '../../common/exceptions/app.error';
import {
  commercialReturnableQuantity,
  computeSalesOrderLineMoney,
  computeSalesOrderTotals,
  parseSalesOrderNonNegativeMoney,
  parseSalesOrderUnitPrice,
  remainingCancellableQuantity,
} from './sales-order-money';

describe('sales-order-money', () => {
  it('parses positive unit prices and rejects zero/negative', () => {
    expect(parseSalesOrderUnitPrice('5850000', CurrencyCode.IRR).toString()).toBe('5850000');
    expect(() => parseSalesOrderUnitPrice('0', CurrencyCode.IRR)).toThrow(AppError);
    expect(() => parseSalesOrderUnitPrice('-1', CurrencyCode.USD)).toThrow(AppError);
  });

  it('allows zero non-negative money for discounts/shipping', () => {
    expect(parseSalesOrderNonNegativeMoney('0', CurrencyCode.IRR).toString()).toBe('0');
    expect(parseSalesOrderNonNegativeMoney('1000', CurrencyCode.IRR).toString()).toBe('1000');
  });

  it('computes line subtotal and net with discount', () => {
    const line = computeSalesOrderLineMoney({
      quantity: 3,
      unitPrice: '1000',
      discountAmount: '500',
    });
    expect(line.lineSubtotal.toString()).toBe('3000');
    expect(line.lineNetTotal.toString()).toBe('2500');
  });

  it('rejects discount greater than line subtotal', () => {
    expect(() =>
      computeSalesOrderLineMoney({
        quantity: 1,
        unitPrice: '100',
        discountAmount: '101',
      }),
    ).toThrow(AppError);
  });

  it('aggregates order totals with order discount and charges', () => {
    const totals = computeSalesOrderTotals({
      lines: [
        { quantity: 2, unitPrice: '10000', discountAmount: '1000' },
        { quantity: 1, unitPrice: '5000', discountAmount: '0' },
      ],
      orderDiscountTotal: '500',
      shippingAmount: '200',
      otherCharges: '100',
    });
    expect(totals.subtotal.toString()).toBe('25000');
    expect(totals.itemDiscountTotal.toString()).toBe('1000');
    expect(totals.netItemsTotal.toString()).toBe('24000');
    expect(totals.orderDiscountTotal.toString()).toBe('500');
    expect(totals.grandTotal.toString()).toBe('23800');
  });

  it('rejects order discount exceeding net items', () => {
    expect(() =>
      computeSalesOrderTotals({
        lines: [{ quantity: 1, unitPrice: '100' }],
        orderDiscountTotal: '101',
      }),
    ).toThrow(AppError);
  });

  it('computes commercial returnable and cancellable quantities', () => {
    expect(
      commercialReturnableQuantity({ quantity: 10, cancelledQuantity: 2, returnedQuantity: 3 }),
    ).toBe(5);
    expect(remainingCancellableQuantity({ quantity: 10, cancelledQuantity: 4 })).toBe(6);
    expect(
      commercialReturnableQuantity({
        quantity: 5,
        cancelledQuantity: 5,
        returnedQuantity: 0,
      }),
    ).toBe(0);
  });

  it('handles large IRR wholesale totals', () => {
    const totals = computeSalesOrderTotals({
      lines: [{ quantity: 100, unitPrice: new Prisma.Decimal('2500000') }],
      shippingAmount: '0',
    });
    expect(totals.grandTotal.toString()).toBe('250000000');
  });
});
