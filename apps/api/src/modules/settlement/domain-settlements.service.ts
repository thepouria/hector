import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  FxRateSourceType,
  Prisma,
  SettlementFinanceTxnType,
  SettlementSourceType,
  SettlementStatus,
  SettlementType,
  SupplierPayableStatus,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { CompanyContext } from '../companies/types/company.types';
import {
  deriveAgingBucket,
  derivePayableTotalsFromMovements,
  isPayableOverdue,
} from '../finance/supplier-payable-outstanding';
import {
  computeLoanSettlementTotals,
  resolveSettleableSource,
} from './adapters/source-adapter';
import { isLoanOverdue } from '../finance/loan-outstanding';
import {
  SettlementsCoreService,
  type SettlementView,
} from './settlements-core.service';

type FxInput = {
  rate: string;
  rateBaseCurrency: CurrencyCode;
  rateQuoteCurrency: CurrencyCode;
  rateDate?: string;
  rateSourceType?: FxRateSourceType;
  fxRateId?: string;
};

/**
 * Domain convenience commands on top of the canonical Allocation Engine.
 * Creates/reuses OPEN settlement cases for SUPPLIER_PAYABLE / LOAN.
 */
@Injectable()
export class DomainSettlementsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly core: SettlementsCoreService,
  ) {}

  async settleSupplierPayable(
    company: CompanyContext,
    payableId: string,
    dto: {
      paymentId: string;
      amount: string;
      paymentAmount?: string;
      fx?: FxInput;
      notes?: string;
      requestId?: string;
    },
  ): Promise<SettlementView> {
    if (dto.requestId) {
      const existing = await this.database.client.settlementAllocation.findFirst({
        where: { companyId: company.companyId, requestId: dto.requestId },
      });
      if (existing) {
        return this.core.get(company, existing.settlementId);
      }
    }
    const source = await resolveSettleableSource(
      this.database.client as never,
      company.companyId,
      SettlementSourceType.SUPPLIER_PAYABLE,
      payableId,
    );
    if (!source.settleable) {
      throw new AppError({
        code: ERROR_CODES.SETTLEMENT_SOURCE_UNSUPPORTED,
        message: 'Supplier payable is not settleable.',
        statusCode: 409,
      });
    }
    const { settlementId, itemId } = await this.ensureOpenSettlement(
      company,
      {
        sourceType: SettlementSourceType.SUPPLIER_PAYABLE,
        sourceId: payableId,
        currency: source.currency,
        partyId: source.partyId,
        type: SettlementType.SUPPLIER_PAYABLE,
        notes: dto.notes,
      },
    );
    return this.core.allocate(company, settlementId, {
      settlementItemId: itemId,
      financeTxnType: SettlementFinanceTxnType.PAYMENT,
      financeTxnId: dto.paymentId,
      amount: dto.amount,
      paymentAmount: dto.paymentAmount,
      fx: dto.fx,
      requestId: dto.requestId,
    });
  }

  async repayLoan(
    company: CompanyContext,
    loanId: string,
    dto: {
      paymentId: string;
      amount: string;
      paymentAmount?: string;
      fx?: FxInput;
      notes?: string;
      requestId?: string;
    },
  ): Promise<SettlementView> {
    if (dto.requestId) {
      const existing = await this.database.client.settlementAllocation.findFirst({
        where: { companyId: company.companyId, requestId: dto.requestId },
      });
      if (existing) {
        return this.core.get(company, existing.settlementId);
      }
    }
    const source = await resolveSettleableSource(
      this.database.client as never,
      company.companyId,
      SettlementSourceType.LOAN,
      loanId,
    );
    if (!source.settleable) {
      throw new AppError({
        code: ERROR_CODES.SETTLEMENT_SOURCE_UNSUPPORTED,
        message: 'Loan is not repayable via settlement.',
        statusCode: 409,
      });
    }
    const { settlementId, itemId } = await this.ensureOpenSettlement(
      company,
      {
        sourceType: SettlementSourceType.LOAN,
        sourceId: loanId,
        currency: source.currency,
        partyId: source.partyId,
        type: SettlementType.LOAN,
        notes: dto.notes,
      },
    );
    return this.core.allocate(company, settlementId, {
      settlementItemId: itemId,
      financeTxnType: SettlementFinanceTxnType.PAYMENT,
      financeTxnId: dto.paymentId,
      amount: dto.amount,
      paymentAmount: dto.paymentAmount,
      fx: dto.fx,
      requestId: dto.requestId,
    });
  }

  async getPayableSummary(company: CompanyContext, payableId: string) {
    const source = await resolveSettleableSource(
      this.database.client as never,
      company.companyId,
      SettlementSourceType.SUPPLIER_PAYABLE,
      payableId,
    );
    const payable = await this.database.client.supplierPayable.findFirstOrThrow({
      where: { id: payableId, companyId: company.companyId },
      include: {
        supplier: { select: { id: true, code: true, name: true, partyId: true } },
      },
    });
    return {
      payableId: payable.id,
      number: payable.number,
      supplierId: payable.supplierId,
      supplier: payable.supplier,
      partyId: source.partyId,
      currency: source.currency,
      purchaseType: payable.purchaseType,
      referenceFxRate: payable.referenceFxRate?.toString() ?? null,
      referenceFxBaseCurrency: payable.referenceFxBaseCurrency,
      referenceFxQuoteCurrency: payable.referenceFxQuoteCurrency,
      originalAmount: source.originalAmount.toString(),
      settledAmount: source.settledAmount.toString(),
      outstandingAmount: source.remainingAmount.toString(),
      status: source.statusLabel,
      dueDate: payable.dueDate?.toISOString() ?? null,
      overdue: isPayableOverdue({
        dueDate: payable.dueDate,
        outstanding: source.remainingAmount,
      }),
      agingBucket: deriveAgingBucket({
        dueDate: payable.dueDate,
        outstanding: source.remainingAmount,
      }),
    };
  }

  async getLoanSummary(company: CompanyContext, loanId: string) {
    const source = await resolveSettleableSource(
      this.database.client as never,
      company.companyId,
      SettlementSourceType.LOAN,
      loanId,
    );
    const loan = await this.database.client.loan.findFirstOrThrow({
      where: { id: loanId, companyId: company.companyId },
      include: {
        lenderParty: { select: { id: true, partyCode: true, displayName: true } },
      },
    });
    return {
      loanId: loan.id,
      number: loan.number,
      lenderPartyId: loan.lenderPartyId,
      lenderParty: loan.lenderParty,
      currency: source.currency,
      referenceFxRate: loan.referenceFxRate?.toString() ?? null,
      referenceFxBaseCurrency: loan.referenceFxBaseCurrency,
      referenceFxQuoteCurrency: loan.referenceFxQuoteCurrency,
      originalPrincipal: source.originalAmount.toString(),
      repaidPrincipal: source.settledAmount.toString(),
      outstandingPrincipal: source.remainingAmount.toString(),
      status: source.statusLabel,
      dueDate: loan.dueDate?.toISOString() ?? null,
      overdue: isLoanOverdue({
        dueDate: loan.dueDate,
        outstandingPrincipal: source.remainingAmount,
      }),
    };
  }

  async listOutstandingPayables(
    company: CompanyContext,
    query: {
      currency?: CurrencyCode;
      partyId?: string;
      status?: SupplierPayableStatus;
      dueState?: 'DUE' | 'OVERDUE' | 'NOT_DUE';
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const payables = await this.database.client.supplierPayable.findMany({
      where: {
        companyId: company.companyId,
        ...(query.currency ? { currency: query.currency } : {}),
        ...(query.partyId ? { supplier: { partyId: query.partyId } } : {}),
        status: query.status ?? { not: SupplierPayableStatus.CANCELLED },
      },
      include: {
        supplier: { select: { id: true, code: true, name: true, partyId: true } },
        movements: {
          select: { direction: true, amount: true, type: true },
        },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    });

    const rows = payables
      .map((p) => {
        const totals = derivePayableTotalsFromMovements(p.movements);
        const outstanding = totals.outstanding;
        if (outstanding.lte(0)) return null;
        const overdue = isPayableOverdue({ dueDate: p.dueDate, outstanding });
        if (query.dueState === 'OVERDUE' && !overdue) return null;
        if (query.dueState === 'NOT_DUE' && (overdue || !p.dueDate)) return null;
        if (query.dueState === 'DUE' && (!p.dueDate || overdue)) return null;
        return {
          payableId: p.id,
          number: p.number,
          supplierId: p.supplierId,
          supplier: p.supplier,
          partyId: p.supplier.partyId,
          currency: p.currency,
          originalAmount: totals.recognized.toString(),
          settledAmount: totals.decreased.toString(),
          outstandingAmount: outstanding.toString(),
          status: p.status,
          dueDate: p.dueDate?.toISOString() ?? null,
          overdue,
          agingBucket: deriveAgingBucket({ dueDate: p.dueDate, outstanding }),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const byCurrency = new Map<string, Prisma.Decimal>();
    for (const r of rows) {
      const cur = byCurrency.get(r.currency) ?? new Prisma.Decimal(0);
      byCurrency.set(r.currency, cur.plus(r.outstandingAmount));
    }

    const start = (page - 1) * pageSize;
    return {
      data: rows.slice(start, start + pageSize),
      meta: {
        page,
        pageSize,
        total: rows.length,
        totalsByCurrency: Object.fromEntries(
          [...byCurrency.entries()].map(([k, v]) => [k, v.toString()]),
        ),
      },
    };
  }

  async listOutstandingLoans(
    company: CompanyContext,
    query: {
      currency?: CurrencyCode;
      partyId?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const loans = await this.database.client.loan.findMany({
      where: {
        companyId: company.companyId,
        ...(query.currency ? { currency: query.currency } : {}),
        ...(query.partyId ? { lenderPartyId: query.partyId } : {}),
        status: { in: ['ACTIVE', 'PARTIALLY_REPAID'] },
      },
      include: {
        lenderParty: { select: { id: true, partyCode: true, displayName: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    });

    const rows: Array<{
      loanId: string;
      number: string;
      lenderPartyId: string | null;
      lenderParty: { id: string; partyCode: string; displayName: string } | null;
      currency: CurrencyCode;
      originalPrincipal: string;
      repaidPrincipal: string;
      outstandingPrincipal: string;
      status: string;
      dueDate: string | null;
      overdue: boolean;
    }> = [];

    const byCurrency = new Map<string, Prisma.Decimal>();
    for (const loan of loans) {
      const totals = await computeLoanSettlementTotals(
        this.database.client as never,
        company.companyId,
        loan.id,
      );
      if (totals.outstandingPrincipal.lte(0)) continue;
      const overdue = isLoanOverdue({
        dueDate: loan.dueDate,
        outstandingPrincipal: totals.outstandingPrincipal,
      });
      rows.push({
        loanId: loan.id,
        number: loan.number,
        lenderPartyId: loan.lenderPartyId,
        lenderParty: loan.lenderParty,
        currency: loan.currency,
        originalPrincipal: totals.receivedPrincipal.toString(),
        repaidPrincipal: totals.repaidPrincipal.toString(),
        outstandingPrincipal: totals.outstandingPrincipal.toString(),
        status: loan.status,
        dueDate: loan.dueDate?.toISOString() ?? null,
        overdue,
      });
      const cur = byCurrency.get(loan.currency) ?? new Prisma.Decimal(0);
      byCurrency.set(loan.currency, cur.plus(totals.outstandingPrincipal));
    }

    const start = (page - 1) * pageSize;
    return {
      data: rows.slice(start, start + pageSize),
      meta: {
        page,
        pageSize,
        total: rows.length,
        totalsByCurrency: Object.fromEntries(
          [...byCurrency.entries()].map(([k, v]) => [k, v.toString()]),
        ),
      },
    };
  }

  /**
   * Reuse OPEN/PARTIALLY_SETTLED settlement that already has this source item,
   * otherwise create DRAFT → add item → OPEN.
   */
  private async ensureOpenSettlement(
    company: CompanyContext,
    input: {
      sourceType: SettlementSourceType;
      sourceId: string;
      currency: CurrencyCode;
      partyId: string | null;
      type: SettlementType;
      notes?: string;
    },
  ): Promise<{ settlementId: string; itemId: string }> {
    const existingItem = await this.database.client.settlementItem.findFirst({
      where: {
        companyId: company.companyId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        settlement: {
          status: {
            in: [SettlementStatus.OPEN, SettlementStatus.PARTIALLY_SETTLED],
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existingItem) {
      return { settlementId: existingItem.settlementId, itemId: existingItem.id };
    }

    const created = await this.core.create(company, {
      currency: input.currency,
      type: input.type,
      partyId: input.partyId ?? undefined,
      notes: input.notes,
    });
    const withItem = await this.core.addItem(company, created.id, {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    });
    const opened = await this.core.open(company, withItem.id);
    return {
      settlementId: opened.id,
      itemId: opened.items[0]!.id,
    };
  }
}
