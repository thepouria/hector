import { CurrencyCode, Prisma } from '@hector/database';
import { convertMoney, describeFxQuote, fxQuote, parseFxRate } from './fx-rate';
import {
  addMoney,
  currencyPrecision,
  moneyOf,
  parseMoneyAmount,
  roundMoneyAmount,
  subtractMoney,
} from './money';

describe('Finance money primitive (Phase 4.1)', () => {
  it('parses IRR as whole rials only', () => {
    expect(parseMoneyAmount('2500000000', CurrencyCode.IRR).toString()).toBe('2500000000');
    expect(() => parseMoneyAmount('1.5', CurrencyCode.IRR)).toThrow(/precision/);
  });

  it('parses USD with up to 6 decimal places', () => {
    expect(parseMoneyAmount('1000.123456', CurrencyCode.USD).toString()).toBe('1000.123456');
    expect(() => parseMoneyAmount('1.1234567', CurrencyCode.USD)).toThrow(/precision/);
  });

  it('rejects JS-style invalid formats', () => {
    expect(() => parseMoneyAmount('1e6', CurrencyCode.IRR)).toThrow();
    expect(() => parseMoneyAmount('-10', CurrencyCode.USD)).toThrow();
    expect(() => parseMoneyAmount('', CurrencyCode.USD)).toThrow();
  });

  it('adds and subtracts same-currency money with Decimal', () => {
    const a = moneyOf('10000', CurrencyCode.USD);
    const b = moneyOf('3000', CurrencyCode.USD);
    expect(addMoney(a, b).amount.toString()).toBe('13000');
    expect(subtractMoney(a, b).amount.toString()).toBe('7000');
    expect(() => subtractMoney(b, a)).toThrow(/negative/);
  });

  it('refuses cross-currency add without explicit FX', () => {
    expect(() =>
      addMoney(moneyOf('1', CurrencyCode.USD), moneyOf('1', CurrencyCode.IRR)),
    ).toThrow(/Cannot add/);
  });

  it('exposes central precision policy', () => {
    expect(currencyPrecision(CurrencyCode.IRR)).toBe(0);
    expect(currencyPrecision(CurrencyCode.USD)).toBe(6);
  });
});

describe('Finance FX rate semantics (Phase 4.1)', () => {
  it('documents 1 USD = N IRR unambiguously', () => {
    const quote = fxQuote({
      baseCurrency: CurrencyCode.USD,
      quoteCurrency: CurrencyCode.IRR,
      rate: '250000',
    });
    expect(describeFxQuote(quote)).toBe('1 USD = 250000 IRR');
    expect(quote.rate).toBeInstanceOf(Prisma.Decimal);
  });

  it('converts USD → IRR and IRR → USD with Decimal', () => {
    const quote = fxQuote({
      baseCurrency: CurrencyCode.USD,
      quoteCurrency: CurrencyCode.IRR,
      rate: '250000',
    });
    const irr = convertMoney({
      money: moneyOf('10000', CurrencyCode.USD),
      toCurrency: CurrencyCode.IRR,
      quote,
    });
    expect(irr.amount.toString()).toBe('2500000000');
    const usd = convertMoney({
      money: irr,
      toCurrency: CurrencyCode.USD,
      quote,
    });
    expect(usd.amount.toString()).toBe('10000');
  });

  it('preserves original USD obligation after FX market change (architecture)', () => {
    const principal = moneyOf('1000', CurrencyCode.USD);
    const purchaseRef = fxQuote({
      baseCurrency: CurrencyCode.USD,
      quoteCurrency: CurrencyCode.IRR,
      rate: '235000',
    });
    const laterMarket = fxQuote({
      baseCurrency: CurrencyCode.USD,
      quoteCurrency: CurrencyCode.IRR,
      rate: '260000',
    });
    const refValue = convertMoney({
      money: principal,
      toCurrency: CurrencyCode.IRR,
      quote: purchaseRef,
    });
    const laterValue = convertMoney({
      money: principal,
      toCurrency: CurrencyCode.IRR,
      quote: laterMarket,
    });
    // Canonical obligation unchanged
    expect(principal.amount.toString()).toBe('1000');
    expect(principal.currency).toBe(CurrencyCode.USD);
    expect(refValue.amount.toString()).toBe('235000000');
    expect(laterValue.amount.toString()).toBe('260000000');
  });

  it('rejects invalid FX rates and same-currency quotes', () => {
    expect(() => parseFxRate('0')).toThrow();
    expect(() =>
      fxQuote({
        baseCurrency: CurrencyCode.USD,
        quoteCurrency: CurrencyCode.USD,
        rate: '1',
      }),
    ).toThrow(/distinct/);
  });

  it('rounds conversion results with central half-up policy', () => {
    const rounded = roundMoneyAmount(new Prisma.Decimal('1.2345674'), CurrencyCode.USD);
    expect(rounded.toString()).toBe('1.234567');
    const irr = roundMoneyAmount(new Prisma.Decimal('10.6'), CurrencyCode.IRR);
    expect(irr.toString()).toBe('11');
  });
});
