import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  FxRateType,
  LoanDisbursementStatus,
  LoanRepaymentStatus,
  Prisma,
  SupplierLiabilityMovementDirection,
  SupplierPayableStatus,
} from '@hector/database';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { CompanyContext } from '../companies/types/company.types';
import {
  calculateBaseValue,
  getLatestApplicableRate,
  toFxRateQuote,
} from './fx-helpers';
import { describeFxQuote } from './money/fx-rate';
import type { FxValuationQueryDto } from './dto/fx.dto';
import type {
  FxCurrencyPositionRow,
  FxPositionsView,
  FxValuationLine,
  FxValuationView,
} from './types/finance-fx.types';

/**
 * Read-only currency positions + valuation.
 * Never mutates cash / payable / loan. Missing rates → UNAVAILABLE (not zero).
 *
 * Sign convention:
 *   net = cashBalance − payableOutstanding − loanOutstanding
 * (per currency; no silent cross-currency aggregation).
 */
@Injectable()
export class FxPositionsService {
  constructor(private readonly database: DatabaseService) {}

  async positions(company: CompanyContext): Promise<FxPositionsView> {
    const companyRow = await this.database.client.company.findFirstOrThrow({
      where: { id: company.companyId },
      select: { baseCurrency: true },
    });

    const cashByCurrency = await this.cashBalancesByCurrency(company.companyId);
    const payableByCurrency = await this.payableOutstandingByCurrency(company.companyId);
    const loanByCurrency = await this.loanOutstandingByCurrency(company.companyId);

    const currencies = new Set<CurrencyCode>([
      ...cashByCurrency.keys(),
      ...payableByCurrency.keys(),
      ...loanByCurrency.keys(),
    ]);

    const positions: FxCurrencyPositionRow[] = [...currencies]
      .sort()
      .map((currency) => {
        const cash = cashByCurrency.get(currency) ?? new Prisma.Decimal(0);
        const payable = payableByCurrency.get(currency) ?? new Prisma.Decimal(0);
        const loan = loanByCurrency.get(currency) ?? new Prisma.Decimal(0);
        const net = cash.minus(payable).minus(loan);
        return {
          currency,
          cashBalance: cash.toFixed(),
          payableOutstanding: payable.toFixed(),
          loanOutstanding: loan.toFixed(),
          net: net.toFixed(),
        };
      });

    return {
      baseCurrency: companyRow.baseCurrency,
      positions,
      signConvention:
        'net = cashBalance - payableOutstanding - loanOutstanding (per currency; no silent FX sum)',
    };
  }

  async valuation(
    company: CompanyContext,
    query: FxValuationQueryDto,
  ): Promise<FxValuationView> {
    const asOf = query.asOf ? new Date(query.asOf) : new Date();
    const requestedRateType = query.rateType ?? FxRateType.VALUATION;
    const fallbackRateType =
      requestedRateType === FxRateType.VALUATION ? FxRateType.REFERENCE : null;

    const companyRow = await this.database.client.company.findFirstOrThrow({
      where: { id: company.companyId },
      select: { baseCurrency: true },
    });
    const baseCurrency = companyRow.baseCurrency;
    const positions = await this.positions(company);
    const lines: FxValuationLine[] = [];

    for (const pos of positions.positions) {
      const kinds: Array<{
        kind: FxValuationLine['kind'];
        amount: string;
      }> = [
        { kind: 'CASH', amount: pos.cashBalance },
        { kind: 'PAYABLE', amount: pos.payableOutstanding },
        { kind: 'LOAN', amount: pos.loanOutstanding },
        { kind: 'NET', amount: pos.net },
      ];

      for (const { kind, amount } of kinds) {
        const amountDec = new Prisma.Decimal(amount);
        if (amountDec.eq(0) && kind !== 'NET') {
          // Still include zero NET; skip empty cash/payable/loan noise.
          continue;
        }

        if (pos.currency === baseCurrency) {
          lines.push({
            currency: pos.currency,
            originalAmount: amount,
            kind,
            baseAmount: amount,
            rateUsed: '1',
            rateType: null,
            rateDisplay: `1 ${baseCurrency} = 1 ${baseCurrency}`,
            status: 'VALUED',
          });
          continue;
        }

        const rateRow =
          (await getLatestApplicableRate(this.database.client, {
            companyId: company.companyId,
            baseCurrency:
              pos.currency === CurrencyCode.USD && baseCurrency === CurrencyCode.IRR
                ? CurrencyCode.USD
                : pos.currency,
            quoteCurrency:
              pos.currency === CurrencyCode.USD && baseCurrency === CurrencyCode.IRR
                ? CurrencyCode.IRR
                : baseCurrency,
            rateType: requestedRateType,
            asOf,
          })) ??
          (fallbackRateType
            ? await getLatestApplicableRate(this.database.client, {
                companyId: company.companyId,
                baseCurrency:
                  pos.currency === CurrencyCode.USD && baseCurrency === CurrencyCode.IRR
                    ? CurrencyCode.USD
                    : pos.currency,
                quoteCurrency:
                  pos.currency === CurrencyCode.USD && baseCurrency === CurrencyCode.IRR
                    ? CurrencyCode.IRR
                    : baseCurrency,
                rateType: fallbackRateType,
                asOf,
              })
            : null);

        // Also try inverted stored pair: base=companyBase quote=foreign when needed.
        let resolved = rateRow;
        if (!resolved) {
          resolved =
            (await getLatestApplicableRate(this.database.client, {
              companyId: company.companyId,
              baseCurrency,
              quoteCurrency: pos.currency,
              rateType: requestedRateType,
              asOf,
            })) ??
            (fallbackRateType
              ? await getLatestApplicableRate(this.database.client, {
                  companyId: company.companyId,
                  baseCurrency,
                  quoteCurrency: pos.currency,
                  rateType: fallbackRateType,
                  asOf,
                })
              : null);
        }

        if (!resolved) {
          lines.push({
            currency: pos.currency,
            originalAmount: amount,
            kind,
            baseAmount: null,
            rateUsed: null,
            rateType: null,
            rateDisplay: null,
            status: 'UNAVAILABLE',
          });
          continue;
        }

        const quote = toFxRateQuote(resolved);
        const valued = calculateBaseValue({
          amount: amountDec.abs(),
          currency: pos.currency,
          baseCurrency,
          quote,
        });

        if (!valued) {
          lines.push({
            currency: pos.currency,
            originalAmount: amount,
            kind,
            baseAmount: null,
            rateUsed: null,
            rateType: resolved.rateType,
            rateDisplay: describeFxQuote(quote),
            status: 'UNAVAILABLE',
          });
          continue;
        }

        const signedBase = amountDec.lt(0)
          ? valued.amount.neg()
          : valued.amount;

        lines.push({
          currency: pos.currency,
          originalAmount: amount,
          kind,
          baseAmount: signedBase.toFixed(),
          rateUsed: resolved.rate.toFixed(),
          rateType: resolved.rateType,
          rateDisplay: describeFxQuote(quote),
          status: 'VALUED',
        });
      }
    }

    return {
      asOf: asOf.toISOString(),
      baseCurrency,
      requestedRateType,
      fallbackRateType,
      lines,
      note:
        'Read-only valuation. Does not mutate cash, payables, or loans. UNAVAILABLE when no rate — never fabricated zero.',
    };
  }

  private async cashBalancesByCurrency(
    companyId: string,
  ): Promise<Map<CurrencyCode, Prisma.Decimal>> {
    const rows = await this.database.client.$queryRaw<
      Array<{ currency: CurrencyCode; balance: Prisma.Decimal }>
    >(Prisma.sql`
      SELECT a.currency,
        COALESCE(SUM(
          CASE
            WHEN m.direction = 'IN' THEN m.amount
            WHEN m.direction = 'OUT' THEN -m.amount
            ELSE 0
          END
        ), 0) AS balance
      FROM financial_accounts a
      LEFT JOIN financial_account_movements m
        ON m.account_id = a.id AND m.company_id = a.company_id
      WHERE a.company_id = ${companyId}::uuid
      GROUP BY a.currency
    `);
    const map = new Map<CurrencyCode, Prisma.Decimal>();
    for (const row of rows) {
      map.set(row.currency, new Prisma.Decimal(row.balance));
    }
    return map;
  }

  private async payableOutstandingByCurrency(
    companyId: string,
  ): Promise<Map<CurrencyCode, Prisma.Decimal>> {
    const payables = await this.database.client.supplierPayable.findMany({
      where: {
        companyId,
        status: { not: SupplierPayableStatus.CANCELLED },
      },
      select: {
        currency: true,
        movements: {
          select: { direction: true, amount: true },
        },
      },
    });

    const map = new Map<CurrencyCode, Prisma.Decimal>();
    for (const payable of payables) {
      let outstanding = new Prisma.Decimal(0);
      for (const m of payable.movements) {
        if (m.direction === SupplierLiabilityMovementDirection.INCREASE) {
          outstanding = outstanding.plus(m.amount);
        } else {
          outstanding = outstanding.minus(m.amount);
        }
      }
      if (outstanding.lte(0)) continue;
      const prev = map.get(payable.currency) ?? new Prisma.Decimal(0);
      map.set(payable.currency, prev.plus(outstanding));
    }
    return map;
  }

  private async loanOutstandingByCurrency(
    companyId: string,
  ): Promise<Map<CurrencyCode, Prisma.Decimal>> {
    const loans = await this.database.client.loan.findMany({
      where: { companyId },
      select: {
        currency: true,
        disbursements: {
          where: {
            status: LoanDisbursementStatus.POSTED,
            reversalOfId: null,
          },
          select: { amount: true },
        },
        repayments: {
          where: {
            status: LoanRepaymentStatus.POSTED,
            reversalOfId: null,
          },
          select: { principalAmount: true },
        },
      },
    });

    const map = new Map<CurrencyCode, Prisma.Decimal>();
    for (const loan of loans) {
      const received = loan.disbursements.reduce(
        (sum, d) => sum.plus(d.amount),
        new Prisma.Decimal(0),
      );
      const repaid = loan.repayments.reduce(
        (sum, r) => sum.plus(r.principalAmount),
        new Prisma.Decimal(0),
      );
      const outstanding = received.minus(repaid);
      if (outstanding.lte(0)) continue;
      const prev = map.get(loan.currency) ?? new Prisma.Decimal(0);
      map.set(loan.currency, prev.plus(outstanding));
    }
    return map;
  }
}
