import { CurrencyCode, Prisma } from '@hector/database';
import { AppError } from '../../common/exceptions/app.error';
import { ERROR_CODES } from '../../common/constants';
import {
  assertPurchaseOrderQuantity,
  computeLineSubtotal,
  computePurchaseOrderTotals,
  parsePurchaseOrderUnitPrice,
} from './purchase-order-money';

describe('purchase-order-money', () => {
  it('parses IRR whole rials and USD decimals', () => {
    expect(parsePurchaseOrderUnitPrice('5850000', CurrencyCode.IRR).toString()).toBe('5850000');
    expect(parsePurchaseOrderUnitPrice('1.25', CurrencyCode.USD).toString()).toBe('1.25');
    expect(parsePurchaseOrderUnitPrice('0.000001', CurrencyCode.USD).toString()).toBe('0.000001');
  });

  it('rejects zero, negative, fractional IRR, over-precise USD, junk and out-of-range prices', () => {
    for (const [value, currency] of [
      ['0', CurrencyCode.IRR],
      ['-5', CurrencyCode.IRR],
      ['10.5', CurrencyCode.IRR],
      ['1.1234567', CurrencyCode.USD],
      ['abc', CurrencyCode.USD],
      ['1e5', CurrencyCode.IRR],
      ['', CurrencyCode.IRR],
      ['10000000000', CurrencyCode.IRR],
    ] as const) {
      expect(() => parsePurchaseOrderUnitPrice(value, currency)).toThrow(AppError);
    }
  });

  it('uses the purchase-order price error code for non-positive amounts', () => {
    try {
      parsePurchaseOrderUnitPrice('0', CurrencyCode.IRR);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as AppError).code).toBe(ERROR_CODES.PURCHASE_ORDER_INVALID_PRICE);
    }
  });

  it('validates quantity as a bounded positive integer', () => {
    expect(assertPurchaseOrderQuantity(1)).toBe(1);
    expect(assertPurchaseOrderQuantity(1000)).toBe(1000);
    for (const bad of [0, -1, 1.5, Number.NaN, 10_000_001]) {
      expect(() => assertPurchaseOrderQuantity(bad)).toThrow(AppError);
    }
  });

  it('computes line subtotals and totals without floating point drift', () => {
    expect(computeLineSubtotal(1000, new Prisma.Decimal('4930000')).toString()).toBe('4930000000');
    expect(computeLineSubtotal(3, new Prisma.Decimal('0.1')).toString()).toBe('0.3');

    const totals = computePurchaseOrderTotals([
      { quantity: 1000, unitPrice: '5850000' },
      { quantity: 4440, unitPrice: new Prisma.Decimal('5250000') },
    ]);
    expect(totals.subtotal.toString()).toBe('29160000000');
    expect(totals.total.toString()).toBe(totals.subtotal.toString());
  });

  it('keeps USD totals exact', () => {
    const totals = computePurchaseOrderTotals([
      { quantity: 3, unitPrice: '1.10' },
      { quantity: 7, unitPrice: '0.333333' },
    ]);
    expect(totals.total.toString()).toBe('5.633331');
  });

  it('returns zero totals for an empty line set', () => {
    expect(computePurchaseOrderTotals([]).total.toString()).toBe('0');
  });

  it('rejects totals beyond Decimal(24,6)', () => {
    expect(() =>
      computePurchaseOrderTotals(
        Array.from({ length: 200 }, () => ({ quantity: 10_000_000, unitPrice: '9999999999' })),
      ),
    ).toThrow(AppError);
  });
});
