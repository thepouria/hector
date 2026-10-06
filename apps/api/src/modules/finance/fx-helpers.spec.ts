import { CurrencyCode, FxRateType, Prisma } from '@hector/database';
import {
  amountsMatchWithinRounding,
  calculateBaseValue,
  calculateFxDifference,
  previewConvertAmount,
} from './fx-helpers';
import { fxQuote } from './money/fx-rate';
import { moneyOf } from './money/money';

describe('FX helpers (Phase 4.5)', () => {
  const usdIrr = fxQuote({
    baseCurrency: CurrencyCode.USD,
    quoteCurrency: CurrencyCode.IRR,
    rate: '250000',
  });

  it('previewConvertAmount converts IRR→USD and USD→IRR', () => {
    const usd = previewConvertAmount({
      fromAmount: '250000000',
      fromCurrency: CurrencyCode.IRR,
      toCurrency: CurrencyCode.USD,
      rateBaseCurrency: CurrencyCode.USD,
      rateQuoteCurrency: CurrencyCode.IRR,
      appliedRate: '250000',
    });
    expect(usd.amount.toString()).toBe('1000');
    expect(usd.currency).toBe(CurrencyCode.USD);

    const irr = previewConvertAmount({
      fromAmount: '1000',
      fromCurrency: CurrencyCode.USD,
      toCurrency: CurrencyCode.IRR,
      rateBaseCurrency: CurrencyCode.USD,
      rateQuoteCurrency: CurrencyCode.IRR,
      appliedRate: '250000',
    });
    expect(irr.amount.toString()).toBe('250000000');
  });

  it('calculateBaseValue returns base amount for convertible quotes', () => {
    const ok = calculateBaseValue({
      amount: '1000',
      currency: CurrencyCode.USD,
      baseCurrency: CurrencyCode.IRR,
      quote: usdIrr,
    });
    expect(ok?.amount.toString()).toBe('250000000');
    expect(ok?.currency).toBe(CurrencyCode.IRR);
  });

  it('calculateFxDifference computes current − historical in same base', () => {
    const historical = moneyOf('250000000', CurrencyCode.IRR);
    const current = moneyOf('270000000', CurrencyCode.IRR);
    const diff = calculateFxDifference({ historicalBase: historical, currentBase: current });
    expect(diff.amount.toString()).toBe('20000000');
    expect(diff.currency).toBe(CurrencyCode.IRR);
  });

  it('amountsMatchWithinRounding requires exact Decimal equality', () => {
    expect(amountsMatchWithinRounding(new Prisma.Decimal('1000'), new Prisma.Decimal('1000'))).toBe(
      true,
    );
    expect(
      amountsMatchWithinRounding(new Prisma.Decimal('1000'), new Prisma.Decimal('1000.000001')),
    ).toBe(false);
  });

  it('position net sign convention: cash − payables − loans', () => {
    const cash = new Prisma.Decimal('10000');
    const payable = new Prisma.Decimal('3000');
    const loan = new Prisma.Decimal('2000');
    const net = cash.minus(payable).minus(loan);
    expect(net.toString()).toBe('5000');
  });

  it('valuation unavailable is distinct from zero', () => {
    const unavailable: { baseAmount: string | null; status: 'UNAVAILABLE' | 'VALUED' } = {
      baseAmount: null,
      status: 'UNAVAILABLE',
    };
    expect(unavailable.baseAmount).toBeNull();
    expect(unavailable.status).toBe('UNAVAILABLE');
    expect(unavailable.baseAmount).not.toBe('0');
  });

  it('documents rate type discrimination', () => {
    expect(FxRateType.REFERENCE).not.toBe(FxRateType.CONVERSION);
    expect(FxRateType.CONVERSION).not.toBe(FxRateType.SETTLEMENT);
    expect(FxRateType.SETTLEMENT).not.toBe(FxRateType.VALUATION);
  });
});

describe('getLatestApplicableRate asOf semantics (unit via ordering contract)', () => {
  it('selects latest effectiveAt <= asOf conceptually', () => {
    const rates = [
      { effectiveAt: new Date('2026-01-01'), rate: '240000' },
      { effectiveAt: new Date('2026-03-01'), rate: '250000' },
      { effectiveAt: new Date('2026-06-01'), rate: '260000' },
    ];
    const asOf = new Date('2026-04-15');
    const applicable = rates
      .filter((r) => r.effectiveAt.getTime() <= asOf.getTime())
      .sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime())[0];
    expect(applicable?.rate).toBe('250000');
  });
});
