import {
  CurrencyCode,
  Prisma,
  PurchaseCostStatus,
  PurchaseCostType,
  PurchaseOrderStatus,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import {
  aggregateActiveCostsByCurrency,
  assertPoAcceptsCostMutation,
  assertPurchaseCostDescription,
  deriveReferenceAcquisitionTotal,
  isPurchaseCostDraftEditable,
  parsePurchaseCostAmount,
} from './purchase-order-costs';

describe('purchase-order-costs', () => {
  it('parses COURIER amount in canonical IRR (2M Toman → 20M rials string)', () => {
    // UI Toman→rials conversion is client-side; API stores canonical IRR.
    const amount = parsePurchaseCostAmount('20000000', CurrencyCode.IRR);
    expect(amount.toString()).toBe('20000000');
  });

  it('accepts FREIGHT and PURCHASE_FEE positive amounts', () => {
    expect(parsePurchaseCostAmount('30000000', CurrencyCode.IRR).toString()).toBe('30000000');
    expect(parsePurchaseCostAmount('12000000', CurrencyCode.IRR).toString()).toBe('12000000');
  });

  it('rejects zero and negative amounts', () => {
    expect(() => parsePurchaseCostAmount('0', CurrencyCode.IRR)).toThrow(AppError);
    expect(() => parsePurchaseCostAmount('-1', CurrencyCode.IRR)).toThrow(AppError);
    try {
      parsePurchaseCostAmount('0', CurrencyCode.IRR);
    } catch (error) {
      expect((error as AppError).code).toBe(ERROR_CODES.PURCHASE_COST_INVALID_AMOUNT);
    }
  });

  it('preserves USD fractional precision', () => {
    expect(parsePurchaseCostAmount('10.50', CurrencyCode.USD).toString()).toBe('10.5');
    expect(parsePurchaseCostAmount('10.123456', CurrencyCode.USD).toString()).toBe('10.123456');
  });

  it('requires description for OTHER and allows optional description otherwise', () => {
    expect(() => assertPurchaseCostDescription(PurchaseCostType.OTHER, null)).toThrow(AppError);
    expect(() => assertPurchaseCostDescription(PurchaseCostType.OTHER, '  ')).toThrow(AppError);
    expect(assertPurchaseCostDescription(PurchaseCostType.OTHER, 'هزینه بارگیری')).toBe(
      'هزینه بارگیری',
    );
    expect(assertPurchaseCostDescription(PurchaseCostType.COURIER, null)).toBeNull();
    expect(assertPurchaseCostDescription(PurchaseCostType.FREIGHT, 'باربری تهران')).toBe(
      'باربری تهران',
    );
  });

  it('aggregates ACTIVE costs by currency without collapsing mixed currencies', () => {
    const totals = aggregateActiveCostsByCurrency([
      { amount: '20000000', currency: CurrencyCode.IRR, status: PurchaseCostStatus.ACTIVE },
      { amount: '10000000', currency: CurrencyCode.IRR, status: PurchaseCostStatus.ACTIVE },
      { amount: '10', currency: CurrencyCode.USD, status: PurchaseCostStatus.ACTIVE },
      { amount: '5000000', currency: CurrencyCode.IRR, status: PurchaseCostStatus.VOIDED },
      { amount: '5', currency: CurrencyCode.USD, status: PurchaseCostStatus.VOIDED },
    ]);
    expect(totals).toEqual([
      { currency: 'IRR', amount: '30000000' },
      { currency: 'USD', amount: '10' },
    ]);
  });

  it('derives same-currency reference acquisition total and skips mixed currencies', () => {
    const same = deriveReferenceAcquisitionTotal({
      merchandiseTotal: '5000000000',
      merchandiseCurrency: CurrencyCode.IRR,
      costTotalsByCurrency: [{ currency: CurrencyCode.IRR, amount: '30000000' }],
    });
    expect(same).toEqual({ amount: '5030000000', currency: 'IRR' });

    const mixed = deriveReferenceAcquisitionTotal({
      merchandiseTotal: '1000',
      merchandiseCurrency: CurrencyCode.USD,
      costTotalsByCurrency: [
        { currency: CurrencyCode.USD, amount: '10' },
        { currency: CurrencyCode.IRR, amount: '20000000' },
      ],
    });
    expect(mixed).toBeNull();
  });

  it('excludes VOIDED rows from ACTIVE aggregates', () => {
    const before = aggregateActiveCostsByCurrency([
      { amount: new Prisma.Decimal('10000000'), currency: CurrencyCode.IRR, status: PurchaseCostStatus.ACTIVE },
    ]);
    expect(before[0]?.amount).toBe('10000000');
    const after = aggregateActiveCostsByCurrency([
      { amount: '10000000', currency: CurrencyCode.IRR, status: PurchaseCostStatus.VOIDED },
    ]);
    expect(after).toEqual([]);
  });

  it('allows cost mutations except on CANCELLED/RECEIVED; draft-only editability', () => {
    expect(() => assertPoAcceptsCostMutation(PurchaseOrderStatus.DRAFT)).not.toThrow();
    expect(() => assertPoAcceptsCostMutation(PurchaseOrderStatus.APPROVED)).not.toThrow();
    expect(() => assertPoAcceptsCostMutation(PurchaseOrderStatus.ORDERED)).not.toThrow();
    expect(() => assertPoAcceptsCostMutation(PurchaseOrderStatus.PARTIALLY_RECEIVED)).not.toThrow();
    expect(() => assertPoAcceptsCostMutation(PurchaseOrderStatus.CANCELLED)).toThrow(AppError);
    expect(() => assertPoAcceptsCostMutation(PurchaseOrderStatus.RECEIVED)).toThrow(AppError);
    expect(isPurchaseCostDraftEditable(PurchaseOrderStatus.DRAFT)).toBe(true);
    expect(isPurchaseCostDraftEditable(PurchaseOrderStatus.ORDERED)).toBe(false);
  });
});
