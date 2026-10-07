import { Injectable } from '@nestjs/common';
import {
  ChannelSettlementStatus,
  LoanStatus,
  Prisma,
  ReconciliationStatus,
  SettlementSourceType,
  SupplierPayableStatus,
} from '@hector/database';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { CompanyContext } from '../companies/types/company.types';
import {
  derivePayableTotalsFromMovements,
  isPayableOverdue,
} from '../finance/supplier-payable-outstanding';
import {
  computeLoanSettlementTotals,
  sumActiveObligationAllocated,
} from './adapters/source-adapter';

type MoneyRow = { currency: string; amount: string; count: number };

function moneyMapToRows(map: Map<string, { amount: Prisma.Decimal; count: number }>): MoneyRow[] {
  return [...map.entries()]
    .map(([currency, row]) => ({
      currency,
      amount: row.amount.toString(),
      count: row.count,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

function addMoney(
  map: Map<string, { amount: Prisma.Decimal; count: number }>,
  currency: string,
  amount: Prisma.Decimal,
  count = 1,
): void {
  const prev = map.get(currency) ?? { amount: new Prisma.Decimal(0), count: 0 };
  map.set(currency, {
    amount: prev.amount.plus(amount),
    count: prev.count + count,
  });
}

const ATTENTION_LIMIT = 25;
const RECENT_LIMIT = 10;

/**
 * Phase 6.5 — Settlement operational dashboard.
 * Currency-aware aggregates only; never sums incompatible currencies.
 */
@Injectable()
export class SettlementDashboardService {
  constructor(private readonly database: DatabaseService) {}

  async getDashboard(company: CompanyContext) {
    const companyId = company.companyId;
    const asOf = new Date();
    const dueSoonEnd = new Date(asOf);
    dueSoonEnd.setUTCDate(dueSoonEnd.getUTCDate() + 7);

    const [
      payables,
      loans,
      channelOpen,
      channelPartial,
      reconciliationCounts,
      recentChannels,
      recentReconciliations,
    ] = await Promise.all([
      this.database.client.supplierPayable.findMany({
        where: {
          companyId,
          status: {
            in: [SupplierPayableStatus.OPEN, SupplierPayableStatus.PARTIALLY_PAID],
          },
        },
        include: {
          supplier: { select: { id: true, code: true, name: true } },
          movements: { select: { direction: true, amount: true, type: true } },
        },
        take: 500,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      }),
      this.database.client.loan.findMany({
        where: {
          companyId,
          status: { in: [LoanStatus.ACTIVE, LoanStatus.PARTIALLY_REPAID] },
        },
        include: {
          lenderParty: { select: { id: true, displayName: true, partyCode: true } },
        },
        take: 500,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      }),
      this.database.client.channelSettlement.count({
        where: {
          companyId,
          status: {
            in: [ChannelSettlementStatus.OPEN, ChannelSettlementStatus.PARTIALLY_RECEIVED],
          },
        },
      }),
      this.database.client.channelSettlement.count({
        where: {
          companyId,
          status: ChannelSettlementStatus.PARTIALLY_RECEIVED,
        },
      }),
      this.database.client.reconciliation.groupBy({
        by: ['status'],
        where: { companyId, status: { not: ReconciliationStatus.CANCELLED } },
        _count: { _all: true },
      }),
      this.database.client.channelSettlement.findMany({
        where: { companyId, status: { not: ChannelSettlementStatus.CANCELLED } },
        include: { channel: { select: { id: true, code: true, name: true } } },
        orderBy: { updatedAt: 'desc' },
        take: RECENT_LIMIT,
      }),
      this.database.client.reconciliation.findMany({
        where: { companyId, status: { not: ReconciliationStatus.CANCELLED } },
        orderBy: { updatedAt: 'desc' },
        take: RECENT_LIMIT,
      }),
    ]);

    const openPayablesByCurrency = new Map<string, { amount: Prisma.Decimal; count: number }>();
    const overduePayablesByCurrency = new Map<string, { amount: Prisma.Decimal; count: number }>();
    const dueSoonPayablesByCurrency = new Map<string, { amount: Prisma.Decimal; count: number }>();
    let openPayableCount = 0;
    let overduePayableCount = 0;
    let partiallySettledPayableCount = 0;
    const attention: Array<{
      kind: string;
      id: string;
      label: string;
      currency: string;
      amount: string;
      status: string;
      hrefHint: string;
    }> = [];

    for (const p of payables) {
      const totals = derivePayableTotalsFromMovements(p.movements);
      const outstanding = totals.outstanding;
      if (outstanding.lte(0)) continue;
      openPayableCount += 1;
      addMoney(openPayablesByCurrency, p.currency, outstanding);
      if (p.status === SupplierPayableStatus.PARTIALLY_PAID) {
        partiallySettledPayableCount += 1;
      }
      const overdue = isPayableOverdue({ dueDate: p.dueDate, outstanding });
      if (overdue) {
        overduePayableCount += 1;
        addMoney(overduePayablesByCurrency, p.currency, outstanding);
        if (attention.length < ATTENTION_LIMIT) {
          attention.push({
            kind: 'OVERDUE_PAYABLE',
            id: p.id,
            label: `${p.number} · ${p.supplier.name}`,
            currency: p.currency,
            amount: outstanding.toString(),
            status: 'OVERDUE',
            hrefHint: 'payables',
          });
        }
      } else if (
        p.dueDate &&
        p.dueDate >= asOf &&
        p.dueDate <= dueSoonEnd
      ) {
        addMoney(dueSoonPayablesByCurrency, p.currency, outstanding);
      }
    }

    const loanOutstandingByCurrency = new Map<
      string,
      { amount: Prisma.Decimal; count: number }
    >();
    let openLoanCount = 0;
    for (const loan of loans) {
      const totals = await computeLoanSettlementTotals(
        this.database.client as never,
        companyId,
        loan.id,
      );
      const outstanding = totals.outstandingPrincipal;
      if (outstanding.lte(0)) continue;
      openLoanCount += 1;
      addMoney(loanOutstandingByCurrency, loan.currency, outstanding);
      if (
        loan.dueDate &&
        loan.dueDate < asOf &&
        attention.length < ATTENTION_LIMIT
      ) {
        attention.push({
          kind: 'OVERDUE_LOAN',
          id: loan.id,
          label: `${loan.number} · ${loan.lenderParty?.displayName ?? 'Lender'}`,
          currency: loan.currency,
          amount: outstanding.toString(),
          status: loan.status,
          hrefHint: 'loans',
        });
      }
    }

    const channelExpectedByCurrency = new Map<
      string,
      { amount: Prisma.Decimal; count: number }
    >();
    const openChannels = await this.database.client.channelSettlement.findMany({
      where: {
        companyId,
        status: {
          in: [ChannelSettlementStatus.OPEN, ChannelSettlementStatus.PARTIALLY_RECEIVED],
        },
      },
      include: { channel: { select: { code: true, name: true } } },
      take: 200,
      orderBy: { periodEnd: 'asc' },
    });

    for (const ch of openChannels) {
      const received = await sumActiveObligationAllocated(
        this.database.client as never,
        companyId,
        SettlementSourceType.CHANNEL,
        ch.id,
      );
      const outstanding = ch.expectedNet.minus(received);
      if (outstanding.lte(0)) continue;
      addMoney(channelExpectedByCurrency, ch.currency, outstanding);
      if (attention.length < ATTENTION_LIMIT) {
        attention.push({
          kind: 'CHANNEL_AWAITING_RECEIPT',
          id: ch.id,
          label: `${ch.number} · ${ch.channel.code}`,
          currency: ch.currency,
          amount: outstanding.toString(),
          status: ch.status,
          hrefHint: 'channels',
        });
      }
    }

    const statusCount = (status: ReconciliationStatus) =>
      reconciliationCounts.find((r) => r.status === status)?._count._all ?? 0;

    const needsMatching =
      statusCount(ReconciliationStatus.OPEN) +
      statusCount(ReconciliationStatus.PARTIALLY_MATCHED);
    const openDiscrepancies = statusCount(ReconciliationStatus.DISCREPANCY);
    const underReview = statusCount(ReconciliationStatus.UNDER_REVIEW);

    if (openDiscrepancies > 0 || underReview > 0) {
      const reviewRows = await this.database.client.reconciliation.findMany({
        where: {
          companyId,
          status: {
            in: [ReconciliationStatus.DISCREPANCY, ReconciliationStatus.UNDER_REVIEW],
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: Math.min(ATTENTION_LIMIT, 10),
      });
      for (const r of reviewRows) {
        if (attention.length >= ATTENTION_LIMIT) break;
        attention.push({
          kind:
            r.status === ReconciliationStatus.UNDER_REVIEW
              ? 'RECONCILIATION_UNDER_REVIEW'
              : 'RECONCILIATION_DISCREPANCY',
          id: r.id,
          label: r.number,
          currency: r.currency,
          amount: r.expectedSnapshot?.toString() ?? '0',
          status: r.status,
          hrefHint: 'reconciliation',
        });
      }
    }

    return {
      asOf: asOf.toISOString(),
      kpis: {
        openPayableCount,
        overduePayableCount,
        partiallySettledPayableCount,
        openLoanCount,
        openChannelSettlementCount: channelOpen,
        partiallyReceivedChannelCount: channelPartial,
        needsMatchingCount: needsMatching,
        openDiscrepancyCount: openDiscrepancies,
        underReviewCount: underReview,
        matchedReconciliationCount: statusCount(ReconciliationStatus.MATCHED),
        resolvedReconciliationCount: statusCount(ReconciliationStatus.RESOLVED),
      },
      outstandingPayablesByCurrency: moneyMapToRows(openPayablesByCurrency),
      overduePayablesByCurrency: moneyMapToRows(overduePayablesByCurrency),
      dueSoonPayablesByCurrency: moneyMapToRows(dueSoonPayablesByCurrency),
      outstandingLoansByCurrency: moneyMapToRows(loanOutstandingByCurrency),
      expectedChannelReceiptsByCurrency: moneyMapToRows(channelExpectedByCurrency),
      attentionQueue: attention,
      recent: {
        channelSettlements: recentChannels.map((c) => ({
          id: c.id,
          number: c.number,
          channelCode: c.channel.code,
          channelName: c.channel.name,
          currency: c.currency,
          expectedNet: c.expectedNet.toString(),
          status: c.status,
          periodStart: c.periodStart.toISOString(),
          periodEnd: c.periodEnd.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        })),
        reconciliations: recentReconciliations.map((r) => ({
          id: r.id,
          number: r.number,
          sourceType: r.sourceType,
          sourceId: r.sourceId,
          currency: r.currency,
          status: r.status,
          updatedAt: r.updatedAt.toISOString(),
        })),
      },
      semantics: {
        currenciesNeverCombined: true as const,
        outstandingIsNotDiscrepancy: true as const,
        financeRemainsMoneyTruth: true as const,
      },
    };
  }
}
