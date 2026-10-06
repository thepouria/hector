import {
  CurrencyCode,
  PaymentTermType,
  PurchaseCommercialType,
  PurchasingLifecycleStatus,
} from '@hector/database';
import {
  assertOfferCommercialTerms,
  assertOfferFxReference,
  assertOfferValidity,
  assertSupplierAssignableForOffer,
  deriveOfferExpiry,
  parsePositiveMoney,
} from './supplier-offer.validation';
import { AppError } from '../../common/exceptions/app.error';
import { Prisma } from '@hector/database';

describe('supplier-offer.validation', () => {
  it('parses positive IRR/USD money and rejects zero/negative', () => {
    expect(parsePositiveMoney('5850000', CurrencyCode.IRR).toString()).toBe('5850000');
    expect(parsePositiveMoney('1.25', CurrencyCode.USD).toString()).toBe('1.25');
    expect(() => parsePositiveMoney('0', CurrencyCode.IRR)).toThrow(AppError);
    expect(() => parsePositiveMoney('-1', CurrencyCode.USD)).toThrow(AppError);
    expect(() => parsePositiveMoney('5850000.5', CurrencyCode.IRR)).toThrow(AppError);
  });

  it('validates commercial terms', () => {
    expect(() =>
      assertOfferCommercialTerms({
        purchaseType: PurchaseCommercialType.CASH,
        paymentTermType: PaymentTermType.NET_DAYS,
        netDays: 30,
      }),
    ).toThrow(AppError);

    expect(() =>
      assertOfferCommercialTerms({
        purchaseType: PurchaseCommercialType.TERM_CREDIT,
        paymentTermType: PaymentTermType.NET_DAYS,
        netDays: 30,
      }),
    ).not.toThrow();
  });

  it('requires complete FX pair', () => {
    expect(() =>
      assertOfferFxReference({
        referenceFxRate: new Prisma.Decimal('2050000'),
        referenceFxBaseCurrency: CurrencyCode.USD,
        referenceFxQuoteCurrency: null,
      }),
    ).toThrow(AppError);

    expect(() =>
      assertOfferFxReference({
        referenceFxRate: new Prisma.Decimal('2050000'),
        referenceFxBaseCurrency: CurrencyCode.USD,
        referenceFxQuoteCurrency: CurrencyCode.IRR,
      }),
    ).not.toThrow();
  });

  it('rejects validUntil before quotedAt', () => {
    const quotedAt = new Date('2026-10-03T10:00:00.000Z');
    expect(() =>
      assertOfferValidity(quotedAt, new Date('2026-10-02T10:00:00.000Z')),
    ).toThrow(AppError);
    expect(() => assertOfferValidity(quotedAt, new Date('2026-10-04T10:00:00.000Z'))).not.toThrow();
  });

  it('blocks archived suppliers for new offers', () => {
    expect(() =>
      assertSupplierAssignableForOffer(PurchasingLifecycleStatus.ARCHIVED),
    ).toThrow(AppError);
    expect(() =>
      assertSupplierAssignableForOffer(PurchasingLifecycleStatus.ACTIVE),
    ).not.toThrow();
  });

  it('derives expiry state', () => {
    const now = new Date('2026-10-03T12:00:00.000Z');
    expect(deriveOfferExpiry(null, null, now)).toBe('NO_EXPIRY');
    expect(deriveOfferExpiry(new Date('2026-10-04T00:00:00.000Z'), null, now)).toBe('CURRENT');
    expect(deriveOfferExpiry(new Date('2026-10-02T00:00:00.000Z'), null, now)).toBe('EXPIRED');
    expect(deriveOfferExpiry(null, new Date('2026-10-01T00:00:00.000Z'), now)).toBe('ARCHIVED');
  });
});
