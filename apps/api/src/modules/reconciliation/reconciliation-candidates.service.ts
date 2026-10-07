import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  Prisma,
  ReconciliationSourceType,
  SettlementFinanceTxnType,
} from '@hector/database';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { CompanyContext } from '../companies/types/company.types';
import { sumPaymentAllocatedAmount } from '../finance/payment-allocation-capacity';
import { sumReceiptAllocatedAmount } from '../finance/receipt-allocation-capacity';
import { requiredFinanceTxnType } from './reconciliation-source';
import type { ListReconciliationCandidatesQueryDto } from './dto/list-reconciliation-candidates.query.dto';

export type FinanceCandidate = {
  financeTxnType: SettlementFinanceTxnType;
  financeTxnId: string;
  amount: string;
  currency: CurrencyCode;
  remainingCapacity: string;
  occurredAt: string;
  reference: string | null;
  description: string | null;
  rankHints: string[];
};

const CANDIDATE_LIMIT = 50;

@Injectable()
export class ReconciliationCandidatesService {
  constructor(private readonly database: DatabaseService) {}

  async listForReconciliation(
    company: CompanyContext,
    sourceType: ReconciliationSourceType,
    currency: CurrencyCode,
    query: ListReconciliationCandidatesQueryDto,
    expectedAmount?: Prisma.Decimal,
  ): Promise<FinanceCandidate[]> {
    const financeTxnType =
      query.financeTxnType ?? requiredFinanceTxnType(sourceType);

    const from = query.dateFrom ? new Date(query.dateFrom) : undefined;
    const to = query.dateTo ? new Date(query.dateTo) : undefined;

    if (financeTxnType === SettlementFinanceTxnType.RECEIPT) {
      return this.listReceiptCandidates(
        company.companyId,
        currency,
        from,
        to,
        query.reference,
        expectedAmount,
      );
    }
    return this.listPaymentCandidates(
      company.companyId,
      currency,
      from,
      to,
      query.reference,
      expectedAmount,
    );
  }

  private async listReceiptCandidates(
    companyId: string,
    currency: CurrencyCode,
    from?: Date,
    to?: Date,
    reference?: string,
    expectedAmount?: Prisma.Decimal,
  ): Promise<FinanceCandidate[]> {
    const receipts = await this.database.client.receipt.findMany({
      where: {
        companyId,
        currency,
        status: 'POSTED',
        ...(from || to
          ? {
              effectiveAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
        ...(reference
          ? {
              OR: [
                { reference: { contains: reference, mode: 'insensitive' } },
                { notes: { contains: reference, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { effectiveAt: 'desc' },
      take: CANDIDATE_LIMIT,
    });

    const out: FinanceCandidate[] = [];
    for (const r of receipts) {
      const allocated = await sumReceiptAllocatedAmount(
        this.database.client as never,
        companyId,
        r.id,
      );
      const remaining = Prisma.Decimal.max(r.amount.minus(allocated), new Prisma.Decimal(0));
      if (remaining.lte(0)) continue;

      const hints: string[] = [];
      if (expectedAmount && remaining.eq(expectedAmount)) {
        hints.push('EXACT_AMOUNT');
      }
      if (reference && r.reference?.toLowerCase().includes(reference.toLowerCase())) {
        hints.push('SAME_REFERENCE');
      }

      out.push({
        financeTxnType: SettlementFinanceTxnType.RECEIPT,
        financeTxnId: r.id,
        amount: r.amount.toString(),
        currency: r.currency,
        remainingCapacity: remaining.toString(),
        occurredAt: r.effectiveAt.toISOString(),
        reference: r.reference,
        description: r.notes,
        rankHints: hints,
      });
    }
    return out.sort((a, b) => b.rankHints.length - a.rankHints.length);
  }

  private async listPaymentCandidates(
    companyId: string,
    currency: CurrencyCode,
    from?: Date,
    to?: Date,
    reference?: string,
    expectedAmount?: Prisma.Decimal,
  ): Promise<FinanceCandidate[]> {
    const payments = await this.database.client.payment.findMany({
      where: {
        companyId,
        currency,
        status: 'POSTED',
        ...(from || to
          ? {
              effectiveAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
        ...(reference
          ? {
              OR: [
                { reference: { contains: reference, mode: 'insensitive' } },
                { notes: { contains: reference, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { effectiveAt: 'desc' },
      take: CANDIDATE_LIMIT,
    });

    const out: FinanceCandidate[] = [];
    for (const p of payments) {
      const allocated = await sumPaymentAllocatedAmount(
        this.database.client as never,
        companyId,
        p.id,
      );
      const remaining = Prisma.Decimal.max(p.amount.minus(allocated), new Prisma.Decimal(0));
      if (remaining.lte(0)) continue;

      const hints: string[] = [];
      if (expectedAmount && remaining.eq(expectedAmount)) {
        hints.push('EXACT_AMOUNT');
      }
      if (reference && p.reference?.toLowerCase().includes(reference.toLowerCase())) {
        hints.push('SAME_REFERENCE');
      }

      out.push({
        financeTxnType: SettlementFinanceTxnType.PAYMENT,
        financeTxnId: p.id,
        amount: p.amount.toString(),
        currency: p.currency,
        remainingCapacity: remaining.toString(),
        occurredAt: p.effectiveAt.toISOString(),
        reference: p.reference,
        description: p.notes,
        rankHints: hints,
      });
    }
    return out.sort((a, b) => b.rankHints.length - a.rankHints.length);
  }
}
