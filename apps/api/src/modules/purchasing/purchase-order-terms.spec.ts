import {
  CurrencyCode,
  PaymentTermType,
  Prisma,
  PurchaseCommercialType,
  PurchaseTermBasis,
} from '@hector/database';
import {
  calculateDueDateFromOrderDate,
  clearedTermsForType,
  computeReferenceValuation,
  resolvePurchaseTerms,
} from './purchase-order-terms';

const emptyFx = {
  dueDate: null as Date | string | null,
  referenceFxRateAt: null as Date | null,
};

describe('purchase-order-terms', () => {
  const orderDate = new Date('2026-10-03T11:00:00.000Z');

  it('accepts valid CASH and rejects credit/FX fields', () => {
    const terms = resolvePurchaseTerms({
      purchaseType: PurchaseCommercialType.CASH,
      paymentTermType: PaymentTermType.IMMEDIATE,
      netDays: null,
      obligationAmount: null,
      obligationCurrency: null,
      referenceFxRate: null,
      referenceFxBaseCurrency: null,
      referenceFxQuoteCurrency: null,
      ...emptyFx,
      currency: CurrencyCode.IRR,
      orderDate,
      complete: true,
    });
    expect(terms.paymentTermType).toBe(PaymentTermType.IMMEDIATE);
    expect(terms.netDays).toBeNull();
    expect(terms.dueDate).toBeNull();

    expect(() =>
      resolvePurchaseTerms({
        purchaseType: PurchaseCommercialType.CASH,
        paymentTermType: PaymentTermType.IMMEDIATE,
        netDays: 10,
        obligationAmount: null,
        obligationCurrency: null,
        referenceFxRate: null,
        referenceFxBaseCurrency: null,
        referenceFxQuoteCurrency: null,
        ...emptyFx,
        currency: CurrencyCode.IRR,
        orderDate,
        complete: false,
      }),
    ).toThrow(/CASH/);
  });

  it('computes TERM_CREDIT due date from ORDER_DATE + netDays', () => {
    const terms = resolvePurchaseTerms({
      purchaseType: PurchaseCommercialType.TERM_CREDIT,
      paymentTermType: PaymentTermType.NET_DAYS,
      netDays: 10,
      obligationAmount: null,
      obligationCurrency: null,
      referenceFxRate: null,
      referenceFxBaseCurrency: null,
      referenceFxQuoteCurrency: null,
      ...emptyFx,
      currency: CurrencyCode.IRR,
      orderDate,
      complete: true,
    });
    expect(terms.termBasis).toBe(PurchaseTermBasis.ORDER_DATE);
    expect(terms.dueDate?.toISOString()).toBe(
      calculateDueDateFromOrderDate(orderDate, 10).toISOString(),
    );
    expect(terms.dueDate?.toISOString().startsWith('2026-10-13')).toBe(true);
  });

  it('rejects TERM_CREDIT with netDays 0 when complete', () => {
    expect(() =>
      resolvePurchaseTerms({
        purchaseType: PurchaseCommercialType.TERM_CREDIT,
        paymentTermType: PaymentTermType.NET_DAYS,
        netDays: 0,
        obligationAmount: null,
        obligationCurrency: null,
        referenceFxRate: null,
        referenceFxBaseCurrency: null,
        referenceFxQuoteCurrency: null,
        ...emptyFx,
        currency: CurrencyCode.IRR,
        orderDate,
        complete: true,
      }),
    ).toThrow();
  });

  it('persists FX_CREDIT foreign liability 1000 USD exactly (MODEL A from PO total)', () => {
    const total = new Prisma.Decimal('1000');
    const terms = resolvePurchaseTerms({
      purchaseType: PurchaseCommercialType.FX_CREDIT,
      paymentTermType: PaymentTermType.NET_DAYS,
      netDays: 30,
      obligationAmount: null,
      obligationCurrency: null,
      referenceFxRate: '2050000',
      referenceFxBaseCurrency: CurrencyCode.USD,
      referenceFxQuoteCurrency: CurrencyCode.IRR,
      dueDate: null,
      referenceFxRateAt: new Date('2026-10-02T15:00:00.000Z'),
      currency: CurrencyCode.USD,
      orderDate,
      total,
      complete: true,
    });
    expect(terms.obligationAmount?.toString()).toBe('1000');
    expect(terms.obligationCurrency).toBe(CurrencyCode.USD);
    expect(terms.referenceFxRate?.toString()).toBe('2050000');
    expect(terms.referenceFxRateAt?.toISOString()).toBe('2026-10-02T15:00:00.000Z');
    expect(terms.dueDate?.toISOString().startsWith('2026-11-02')).toBe(true);
  });

  it('requires FX_CREDIT obligation + reference FX when complete', () => {
    const total = new Prisma.Decimal('1000.25');
    const terms = resolvePurchaseTerms({
      purchaseType: PurchaseCommercialType.FX_CREDIT,
      paymentTermType: PaymentTermType.NET_DAYS,
      netDays: 30,
      obligationAmount: null,
      obligationCurrency: null,
      referenceFxRate: '2050000',
      referenceFxBaseCurrency: CurrencyCode.USD,
      referenceFxQuoteCurrency: CurrencyCode.IRR,
      dueDate: null,
      ...emptyFx,
      currency: CurrencyCode.USD,
      orderDate,
      total,
      complete: true,
    });
    expect(terms.obligationAmount?.toString()).toBe('1000.25');
    expect(terms.obligationCurrency).toBe(CurrencyCode.USD);
    expect(terms.referenceFxRate?.toString()).toBe('2050000');
    expect(terms.dueDate?.toISOString().startsWith('2026-11-02')).toBe(true);
  });

  it('computes reference local valuation for 1000 USD @ 205k Toman/USD', () => {
    // UI 205,000 Toman/USD → canonical 2,050,000 IRR/USD
    const valuation = computeReferenceValuation('1000', '2050000', CurrencyCode.IRR);
    // 205,000,000 Toman = 2,050,000,000 IRR
    expect(valuation.toString()).toBe('2050000000');
  });

  it('preserves decimal FX obligation exactly in reference valuation', () => {
    const valuation = computeReferenceValuation('1000.25', '2050000');
    expect(valuation.toString()).toBe('2050512500');
  });

  it('keeps foreign liability independent of a later hypothetical settlement rate', () => {
    const obligation = new Prisma.Decimal('1000');
    const purchaseRate = '2050000';
    const laterMarketRate = '2350000';
    const purchaseValuation = computeReferenceValuation(obligation, purchaseRate);
    const laterValuation = computeReferenceValuation(obligation, laterMarketRate);
    expect(purchaseValuation.toString()).toBe('2050000000');
    expect(laterValuation.toString()).toBe('2350000000');
    // Liability is still the stored foreign principal — not rewritten by market FX.
    expect(obligation.toString()).toBe('1000');
  });

  it('rejects FX pair where reference base ≠ obligation currency', () => {
    expect(() =>
      resolvePurchaseTerms({
        purchaseType: PurchaseCommercialType.FX_CREDIT,
        paymentTermType: PaymentTermType.NET_DAYS,
        netDays: 30,
        obligationAmount: null,
        obligationCurrency: null,
        referenceFxRate: '2050000',
        referenceFxBaseCurrency: CurrencyCode.EUR,
        referenceFxQuoteCurrency: CurrencyCode.IRR,
        ...emptyFx,
        currency: CurrencyCode.USD,
        orderDate,
        total: new Prisma.Decimal('1000'),
        complete: false,
      }),
    ).toThrow(/referenceFxBaseCurrency/);
  });

  it('rejects zero / negative / over-precise FX rates', () => {
    const base = {
      purchaseType: PurchaseCommercialType.FX_CREDIT,
      paymentTermType: PaymentTermType.NET_DAYS,
      netDays: 30,
      obligationAmount: null as string | null,
      obligationCurrency: null as CurrencyCode | null,
      referenceFxBaseCurrency: CurrencyCode.USD,
      referenceFxQuoteCurrency: CurrencyCode.IRR,
      ...emptyFx,
      currency: CurrencyCode.USD,
      orderDate,
      complete: false,
    };
    expect(() =>
      resolvePurchaseTerms({ ...base, referenceFxRate: '0' }),
    ).toThrow();
    expect(() =>
      resolvePurchaseTerms({ ...base, referenceFxRate: '-1' }),
    ).toThrow();
    expect(() =>
      resolvePurchaseTerms({ ...base, referenceFxRate: '1.123456789' }),
    ).toThrow(/decimal places/);
  });

  it('handles large FX liability × rate without JS float authority', () => {
    const valuation = computeReferenceValuation('842.75', '235123.45', CurrencyCode.IRR);
    // 842.75 × 235123.45 = 198150287.4875 → HALF_UP to whole rial
    expect(valuation.toString()).toBe('198150287');
  });

  it('clears incompatible fields when switching type', () => {
    const cleared = clearedTermsForType(PurchaseCommercialType.CASH);
    expect(cleared.netDays).toBeNull();
    expect(cleared.obligationAmount).toBeNull();
    expect(cleared.referenceFxRate).toBeNull();
    expect(cleared.referenceFxRateAt).toBeNull();
    expect(cleared.paymentTermType).toBe(PaymentTermType.IMMEDIATE);
  });

  it('allows incomplete FX draft without reference rate', () => {
    const terms = resolvePurchaseTerms({
      purchaseType: PurchaseCommercialType.FX_CREDIT,
      paymentTermType: PaymentTermType.NET_DAYS,
      netDays: null,
      obligationAmount: null,
      obligationCurrency: null,
      referenceFxRate: null,
      referenceFxBaseCurrency: null,
      referenceFxQuoteCurrency: null,
      ...emptyFx,
      currency: CurrencyCode.USD,
      orderDate,
      complete: false,
    });
    expect(terms.purchaseType).toBe(PurchaseCommercialType.FX_CREDIT);
    expect(terms.referenceFxRate).toBeNull();
  });

  it('rejects partial FX pair', () => {
    expect(() =>
      resolvePurchaseTerms({
        purchaseType: PurchaseCommercialType.FX_CREDIT,
        paymentTermType: PaymentTermType.NET_DAYS,
        netDays: 30,
        obligationAmount: null,
        obligationCurrency: null,
        referenceFxRate: '2050000',
        referenceFxBaseCurrency: CurrencyCode.USD,
        referenceFxQuoteCurrency: null,
        ...emptyFx,
        currency: CurrencyCode.USD,
        orderDate,
        complete: false,
      }),
    ).toThrow(/FX/);
  });

  it('accepts TERM_CREDIT FIXED_DATE and rejects netDays / early dueDate', () => {
    const terms = resolvePurchaseTerms({
      purchaseType: PurchaseCommercialType.TERM_CREDIT,
      paymentTermType: PaymentTermType.FIXED_DATE,
      netDays: null,
      dueDate: '2026-11-15',
      obligationAmount: null,
      obligationCurrency: null,
      referenceFxRate: null,
      referenceFxBaseCurrency: null,
      referenceFxQuoteCurrency: null,
      referenceFxRateAt: null,
      currency: CurrencyCode.IRR,
      orderDate,
      complete: true,
    });
    expect(terms.paymentTermType).toBe(PaymentTermType.FIXED_DATE);
    expect(terms.netDays).toBeNull();
    expect(terms.termBasis).toBeNull();
    expect(terms.dueDate?.toISOString().startsWith('2026-11-15')).toBe(true);

    expect(() =>
      resolvePurchaseTerms({
        purchaseType: PurchaseCommercialType.TERM_CREDIT,
        paymentTermType: PaymentTermType.FIXED_DATE,
        netDays: 30,
        dueDate: '2026-11-15',
        obligationAmount: null,
        obligationCurrency: null,
        referenceFxRate: null,
        referenceFxBaseCurrency: null,
        referenceFxQuoteCurrency: null,
        referenceFxRateAt: null,
        currency: CurrencyCode.IRR,
        orderDate,
        complete: false,
      }),
    ).toThrow(/FIXED_DATE/);

    expect(() =>
      resolvePurchaseTerms({
        purchaseType: PurchaseCommercialType.TERM_CREDIT,
        paymentTermType: PaymentTermType.FIXED_DATE,
        netDays: null,
        dueDate: '2026-10-01',
        obligationAmount: null,
        obligationCurrency: null,
        referenceFxRate: null,
        referenceFxBaseCurrency: null,
        referenceFxQuoteCurrency: null,
        referenceFxRateAt: null,
        currency: CurrencyCode.IRR,
        orderDate,
        complete: true,
      }),
    ).toThrow(/before orderDate/);
  });

  it('rejects client-supplied dueDate for NET_DAYS', () => {
    expect(() =>
      resolvePurchaseTerms({
        purchaseType: PurchaseCommercialType.TERM_CREDIT,
        paymentTermType: PaymentTermType.NET_DAYS,
        netDays: 10,
        dueDate: '2026-12-01',
        obligationAmount: null,
        obligationCurrency: null,
        referenceFxRate: null,
        referenceFxBaseCurrency: null,
        referenceFxQuoteCurrency: null,
        referenceFxRateAt: null,
        currency: CurrencyCode.IRR,
        orderDate,
        complete: false,
      }),
    ).toThrow(/server-calculated/);
  });
});
