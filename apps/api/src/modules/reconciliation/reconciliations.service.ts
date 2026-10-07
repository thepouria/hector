import { Injectable } from '@nestjs/common';
import {
  ChannelSettlementStatus,
  Prisma,
  ReconciliationDiscrepancyStatus,
  ReconciliationSourceType,
  ReconciliationStatus,
  SettlementFinanceTxnType,
  SettlementSourceType,
  SettlementStatus,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { getRequestContext } from '../../common/context/request-context';
import { AppError } from '../../common/exceptions/app.error';
import { DatabaseService } from '../../infrastructure/database/database.service';
import {
  DOMAIN_EVENTS,
  DomainEventBus,
  DomainEventFactory,
  commitThenPublish,
} from '../../infrastructure/events';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import type { CompanyContext } from '../companies/types/company.types';
import { ChannelSettlementsService } from '../settlement/channel-settlements.service';
import { DomainSettlementsService } from '../settlement/domain-settlements.service';
import {
  loadExpectedForReconciliation,
  requiredFinanceTxnType,
  settlementSourceFor,
} from './reconciliation-source';
import { ReconciliationCandidatesService } from './reconciliation-candidates.service';
import { RECONCILIATION_ERROR_MESSAGES } from './reconciliation.constants';
import {
  allocateReconciliationSequence,
  formatReconciliationNumber,
} from './reconciliation-numbering';
import {
  applyWorkflowStatus,
  computeReconciliationMetrics,
  deriveAutomaticStatus,
} from './reconciliation-state';
import type { AddReconciliationDiscrepancyDto } from './dto/add-reconciliation-discrepancy.dto';
import type { CreateReconciliationDto } from './dto/create-reconciliation.dto';
import type { ListReconciliationsQueryDto } from './dto/list-reconciliations.query.dto';
import type { ListReconciliationCandidatesQueryDto } from './dto/list-reconciliation-candidates.query.dto';
import type { MatchReconciliationDto } from './dto/match-reconciliation.dto';
import type { ResolveReconciliationDto } from './dto/resolve-reconciliation.dto';
import type { ReverseReconciliationMatchDto } from './dto/reverse-reconciliation-match.dto';
import { SettlementsCoreService } from '../settlement/settlements-core.service';

const TX = { maxWait: 10_000, timeout: 30_000 } as const;

type Tx = Prisma.TransactionClient;

@Injectable()
export class ReconciliationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventBus: DomainEventBus,
    private readonly eventFactory: DomainEventFactory,
    private readonly core: SettlementsCoreService,
    private readonly domain: DomainSettlementsService,
    private readonly channels: ChannelSettlementsService,
    private readonly candidates: ReconciliationCandidatesService,
  ) {}

  async open(company: CompanyContext, dto: CreateReconciliationDto) {
    const actorId = this.requireActorId();
    if (dto.requestId) {
      const existing = await this.database.client.reconciliation.findFirst({
        where: { companyId: company.companyId, requestId: dto.requestId },
      });
      if (existing) return this.get(company, existing.id);
    }

    const existingSource = await this.database.client.reconciliation.findFirst({
      where: {
        companyId: company.companyId,
        sourceType: dto.sourceType,
        sourceId: dto.sourceId,
        status: { not: ReconciliationStatus.CANCELLED },
      },
    });
    if (existingSource) {
      return this.get(company, existingSource.id);
    }

    const { currency } = await this.assertSourceReady(
      this.database.client as Tx,
      company.companyId,
      dto.sourceType,
      dto.sourceId,
    );

    const row = await commitThenPublish(this.eventBus, async (events) => {
      return this.database.client.$transaction(async (tx) => {
        const seq = await allocateReconciliationSequence(tx, company.companyId);
        const created = await tx.reconciliation.create({
          data: {
            companyId: company.companyId,
            number: formatReconciliationNumber(seq),
            sourceType: dto.sourceType,
            sourceId: dto.sourceId,
            currency,
            status: ReconciliationStatus.OPEN,
            notes: dto.notes ?? null,
            requestId: dto.requestId ?? null,
            createdById: actorId,
          },
        });
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.RECONCILIATION_CREATED,
          entityType: AUDIT_ENTITY_TYPES.RECONCILIATION,
          entityId: created.id,
          before: null,
          after: { number: created.number, sourceType: created.sourceType, sourceId: created.sourceId },
        });
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.RECONCILIATION_CREATED,
            payload: { companyId: company.companyId, reconciliationId: created.id },
          }),
        );
        return created;
      }, TX);
    });

    return this.get(company, row.id);
  }

  async get(company: CompanyContext, id: string) {
    const row = await this.requireRow(company.companyId, id);
    return this.toView(row);
  }

  async list(company: CompanyContext, query: ListReconciliationsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.ReconciliationWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
    };

    const [total, rows] = await Promise.all([
      this.database.client.reconciliation.count({ where }),
      this.database.client.reconciliation.findMany({
        where,
        include: { discrepancies: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const views = [];
    for (const row of rows) {
      const view = await this.toView(row);
      if (query.hasDifference === 'true' && view.differenceAmount === '0') continue;
      if (query.hasDifference === 'false' && view.differenceAmount !== '0') continue;
      if (
        query.needsReview === 'true' &&
        view.status !== ReconciliationStatus.DISCREPANCY &&
        view.status !== ReconciliationStatus.UNDER_REVIEW
      ) {
        continue;
      }
      views.push(view);
    }

    return { data: views, meta: { page, pageSize, total } };
  }

  async listCandidates(
    company: CompanyContext,
    id: string,
    query: ListReconciliationCandidatesQueryDto,
  ) {
    const row = await this.requireRow(company.companyId, id);
    const { expectedAmount } = await this.loadLiveMetrics(row);
    const data = await this.candidates.listForReconciliation(
      company,
      row.sourceType,
      row.currency,
      query,
      expectedAmount,
    );
    return { data };
  }

  async match(company: CompanyContext, id: string, dto: MatchReconciliationDto) {
    const row = await this.requireRow(company.companyId, id);
    this.assertMutable(row.status);

    const required = requiredFinanceTxnType(row.sourceType);
    if (dto.financeTxnType !== required) {
      throw new AppError({
        code: ERROR_CODES.RECONCILIATION_FINANCE_DIRECTION_INVALID,
        message: RECONCILIATION_ERROR_MESSAGES.FINANCE_DIRECTION_INVALID,
        statusCode: 409,
      });
    }

    if (row.sourceType === ReconciliationSourceType.CHANNEL) {
      if (dto.financeTxnType !== SettlementFinanceTxnType.RECEIPT) {
        throw new AppError({
          code: ERROR_CODES.RECONCILIATION_FINANCE_DIRECTION_INVALID,
          message: RECONCILIATION_ERROR_MESSAGES.FINANCE_DIRECTION_INVALID,
          statusCode: 409,
        });
      }
      await this.channels.allocateReceipt(company, row.sourceId, {
        receiptId: dto.financeTxnId,
        amount: dto.amount,
        requestId: dto.requestId,
      });
    } else if (row.sourceType === ReconciliationSourceType.SUPPLIER_PAYABLE) {
      await this.domain.settleSupplierPayable(company, row.sourceId, {
        paymentId: dto.financeTxnId,
        amount: dto.amount,
        paymentAmount: dto.paymentAmount,
        requestId: dto.requestId,
      });
    } else if (row.sourceType === ReconciliationSourceType.LOAN) {
      await this.domain.repayLoan(company, row.sourceId, {
        paymentId: dto.financeTxnId,
        amount: dto.amount,
        paymentAmount: dto.paymentAmount,
        requestId: dto.requestId,
      });
    } else {
      const settlementItemId = await this.resolveSettlementItemId(
        company.companyId,
        row.sourceId,
        dto.settlementItemId,
      );
      const item = await this.database.client.settlementItem.findFirstOrThrow({
        where: { id: settlementItemId, companyId: company.companyId },
      });
      await this.core.allocate(company, item.settlementId, {
        settlementItemId,
        financeTxnType: dto.financeTxnType,
        financeTxnId: dto.financeTxnId,
        amount: dto.amount,
        paymentAmount: dto.paymentAmount,
        requestId: dto.requestId,
      });
    }

    await this.refreshPersistedStatus(company.companyId, id);
    return this.get(company, id);
  }

  async reverseMatch(
    company: CompanyContext,
    id: string,
    dto: ReverseReconciliationMatchDto,
  ) {
    const row = await this.requireRow(company.companyId, id);
    this.assertMutable(row.status);

    const allocation = await this.database.client.settlementAllocation.findFirst({
      where: { id: dto.allocationId, companyId: company.companyId, status: 'ACTIVE' },
      include: { settlementItem: true },
    });
    if (!allocation) {
      throw new AppError({
        code: ERROR_CODES.SETTLEMENT_ALLOCATION_NOT_FOUND,
        message: 'Allocation was not found.',
        statusCode: 404,
      });
    }
    await this.assertAllocationBelongsToSource(
      company.companyId,
      row.sourceType,
      row.sourceId,
      allocation.settlementItem,
    );

    await this.core.reverseAllocation(company, allocation.settlementId, dto.allocationId, {
      reason: dto.reason,
    });

    await this.refreshPersistedStatus(company.companyId, id);
    return this.get(company, id);
  }

  async closeMatching(company: CompanyContext, id: string) {
    const actorId = this.requireActorId();
    const row = await this.requireRow(company.companyId, id);
    this.assertMutable(row.status);
    if (row.matchingClosedAt) {
      return this.get(company, id);
    }

    await commitThenPublish(this.eventBus, async (events) => {
      await this.database.client.$transaction(async (tx) => {
        const live = await loadExpectedForReconciliation(
          tx,
          company.companyId,
          row.sourceType,
          row.sourceId,
        );
        const metrics = computeReconciliationMetrics(
          live.expectedAmount,
          live.matchedAmount,
        );
        const automatic = deriveAutomaticStatus({
          matchingClosed: true,
          matchedAmount: metrics.matchedAmount,
          expectedAmount: metrics.expectedAmount,
          remainingExpected: metrics.remainingExpected,
          differenceAmount: metrics.differenceAmount,
        });
        const nextStatus = applyWorkflowStatus(automatic, row.status);

        await tx.reconciliation.update({
          where: { id },
          data: {
            matchingClosedAt: new Date(),
            matchingClosedById: actorId,
            expectedSnapshot: live.expectedAmount,
            status: nextStatus,
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.RECONCILIATION_MATCHING_CLOSED,
          entityType: AUDIT_ENTITY_TYPES.RECONCILIATION,
          entityId: id,
          before: null,
          after: {
            expectedSnapshot: live.expectedAmount.toString(),
            difference: metrics.differenceAmount.toString(),
            status: nextStatus,
          },
        });

        if (nextStatus === ReconciliationStatus.DISCREPANCY) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.RECONCILIATION_DISCREPANCY_DETECTED,
              payload: { companyId: company.companyId, reconciliationId: id },
            }),
          );
        } else if (nextStatus === ReconciliationStatus.MATCHED) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.RECONCILIATION_MATCHED,
              payload: { companyId: company.companyId, reconciliationId: id },
            }),
          );
        }
      }, TX);
    });

    return this.get(company, id);
  }

  async addDiscrepancy(
    company: CompanyContext,
    id: string,
    dto: AddReconciliationDiscrepancyDto,
  ) {
    const actorId = this.requireActorId();
    const row = await this.requireRow(company.companyId, id);
    if (
      row.status !== ReconciliationStatus.DISCREPANCY &&
      row.status !== ReconciliationStatus.UNDER_REVIEW &&
      !row.matchingClosedAt
    ) {
      throw new AppError({
        code: ERROR_CODES.RECONCILIATION_MATCHING_NOT_CLOSED,
        message: RECONCILIATION_ERROR_MESSAGES.MATCHING_NOT_CLOSED,
        statusCode: 409,
      });
    }

    let amount: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(dto.amount);
    } catch {
      throw new AppError({
        code: ERROR_CODES.RECONCILIATION_DISCREPANCY_INVALID,
        message: RECONCILIATION_ERROR_MESSAGES.DISCREPANCY_INVALID,
        statusCode: 400,
      });
    }
    if (amount.eq(0)) {
      throw new AppError({
        code: ERROR_CODES.RECONCILIATION_DISCREPANCY_INVALID,
        message: RECONCILIATION_ERROR_MESSAGES.DISCREPANCY_INVALID,
        statusCode: 400,
      });
    }

    await commitThenPublish(this.eventBus, async (events) => {
      await this.database.client.$transaction(async (tx) => {
        await tx.reconciliationDiscrepancy.create({
          data: {
            companyId: company.companyId,
            reconciliationId: id,
            amount,
            currency: row.currency,
            reasonCode: dto.reasonCode,
            description: dto.description ?? null,
            status: ReconciliationDiscrepancyStatus.OPEN,
            createdById: actorId,
          },
        });
        if (row.status === ReconciliationStatus.PARTIALLY_MATCHED || row.status === ReconciliationStatus.OPEN) {
          await tx.reconciliation.update({
            where: { id },
            data: { status: ReconciliationStatus.DISCREPANCY },
          });
        }
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.RECONCILIATION_DISCREPANCY_ADDED,
          entityType: AUDIT_ENTITY_TYPES.RECONCILIATION,
          entityId: id,
          before: null,
          after: { amount: amount.toString(), reasonCode: dto.reasonCode },
        });
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.RECONCILIATION_DISCREPANCY_DETECTED,
            payload: { companyId: company.companyId, reconciliationId: id },
          }),
        );
      }, TX);
    });

    return this.get(company, id);
  }

  async moveUnderReview(company: CompanyContext, id: string) {
    const actorId = this.requireActorId();
    const row = await this.requireRow(company.companyId, id);
    if (row.status !== ReconciliationStatus.DISCREPANCY) {
      throw new AppError({
        code: ERROR_CODES.RECONCILIATION_INVALID_STATUS,
        message: RECONCILIATION_ERROR_MESSAGES.INVALID_STATUS,
        statusCode: 409,
      });
    }

    await this.database.client.reconciliation.update({
      where: { id },
      data: {
        status: ReconciliationStatus.UNDER_REVIEW,
        reviewStartedAt: new Date(),
        reviewStartedById: actorId,
      },
    });
    return this.get(company, id);
  }

  async resolve(company: CompanyContext, id: string, dto: ResolveReconciliationDto) {
    const actorId = this.requireActorId();
    const row = await this.requireRow(company.companyId, id);
    if (
      row.status !== ReconciliationStatus.DISCREPANCY &&
      row.status !== ReconciliationStatus.UNDER_REVIEW
    ) {
      throw new AppError({
        code: ERROR_CODES.RECONCILIATION_INVALID_STATUS,
        message: RECONCILIATION_ERROR_MESSAGES.INVALID_STATUS,
        statusCode: 409,
      });
    }

    const view = await this.toView(row);
    const discrepancies = await this.database.client.reconciliationDiscrepancy.findMany({
      where: {
        companyId: company.companyId,
        reconciliationId: id,
        status: { not: ReconciliationDiscrepancyStatus.RESOLVED },
      },
    });

    if (discrepancies.length > 0) {
      const sum = discrepancies.reduce(
        (acc, d) => acc.plus(d.amount),
        new Prisma.Decimal(0),
      );
      const diff = new Prisma.Decimal(view.differenceAmount);
      if (!sum.eq(diff)) {
        throw new AppError({
          code: ERROR_CODES.RECONCILIATION_RESOLUTION_INVALID,
          message: 'Discrepancy explanation amounts must sum to the reconciliation difference.',
          statusCode: 409,
        });
      }
    } else {
      const diff = new Prisma.Decimal(view.differenceAmount);
      if (!diff.eq(0)) {
        throw new AppError({
          code: ERROR_CODES.RECONCILIATION_RESOLUTION_INVALID,
          message: RECONCILIATION_ERROR_MESSAGES.RESOLUTION_INVALID,
          statusCode: 409,
        });
      }
    }

    await commitThenPublish(this.eventBus, async (events) => {
      await this.database.client.$transaction(async (tx) => {
        await tx.reconciliation.update({
          where: { id },
          data: {
            status: ReconciliationStatus.RESOLVED,
            resolvedAt: new Date(),
            resolvedById: actorId,
            resolutionType: dto.resolutionType,
            resolutionNotes: dto.resolutionNotes ?? null,
          },
        });
        await tx.reconciliationDiscrepancy.updateMany({
          where: { companyId: company.companyId, reconciliationId: id },
          data: {
            status: ReconciliationDiscrepancyStatus.RESOLVED,
            resolvedAt: new Date(),
            resolvedById: actorId,
            resolutionType: dto.resolutionType,
            resolutionNotes: dto.resolutionNotes ?? null,
            resolutionReference: dto.resolutionReference ?? null,
          },
        });
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.RECONCILIATION_RESOLVED,
          entityType: AUDIT_ENTITY_TYPES.RECONCILIATION,
          entityId: id,
          before: { status: row.status },
          after: {
            status: ReconciliationStatus.RESOLVED,
            resolutionType: dto.resolutionType,
            differenceAmount: view.differenceAmount,
          },
        });
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.RECONCILIATION_RESOLVED,
            payload: { companyId: company.companyId, reconciliationId: id },
          }),
        );
      }, TX);
    });

    return this.get(company, id);
  }

  async cancel(company: CompanyContext, id: string) {
    const actorId = this.requireActorId();
    const row = await this.requireRow(company.companyId, id);
    if (row.status === ReconciliationStatus.CANCELLED) {
      return this.get(company, id);
    }
    if (row.status === ReconciliationStatus.RESOLVED) {
      throw new AppError({
        code: ERROR_CODES.RECONCILIATION_EDIT_BLOCKED,
        message: RECONCILIATION_ERROR_MESSAGES.EDIT_BLOCKED,
        statusCode: 409,
      });
    }

    await this.database.client.reconciliation.update({
      where: { id },
      data: {
        status: ReconciliationStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledById: actorId,
      },
    });
    return this.get(company, id);
  }

  private async refreshPersistedStatus(companyId: string, id: string) {
    const row = await this.requireRow(companyId, id);
    if (
      row.status === ReconciliationStatus.RESOLVED ||
      row.status === ReconciliationStatus.CANCELLED ||
      row.status === ReconciliationStatus.UNDER_REVIEW
    ) {
      return;
    }
    const live = await this.loadLiveMetrics(row);
    const automatic = deriveAutomaticStatus({
      matchingClosed: !!row.matchingClosedAt,
      matchedAmount: live.matchedAmount,
      expectedAmount: live.expectedAmount,
      remainingExpected: live.remainingExpected,
      differenceAmount: live.differenceAmount,
    });
    const next = applyWorkflowStatus(automatic, row.status);
    if (next !== row.status) {
      await this.database.client.reconciliation.update({
        where: { id },
        data: { status: next },
      });
    }
  }

  private async loadLiveMetrics(row: {
    companyId: string;
    sourceType: ReconciliationSourceType;
    sourceId: string;
    expectedSnapshot: Prisma.Decimal | null;
    matchingClosedAt: Date | null;
  }) {
    const live = await loadExpectedForReconciliation(
      this.database.client as Tx,
      row.companyId,
      row.sourceType,
      row.sourceId,
    );
    const expectedAmount =
      row.matchingClosedAt && row.expectedSnapshot != null
        ? row.expectedSnapshot
        : live.expectedAmount;
    return computeReconciliationMetrics(expectedAmount, live.matchedAmount);
  }

  private async toView(row: Awaited<ReturnType<typeof this.requireRow>>) {
    const metrics = await this.loadLiveMetrics(row);
    const allocations = await this.listActiveAllocations(
      row.companyId,
      row.sourceType,
      row.sourceId,
    );

    return {
      id: row.id,
      number: row.number,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      currency: row.currency,
      status: row.status,
      expectedAmount: metrics.expectedAmount.toString(),
      matchedAmount: metrics.matchedAmount.toString(),
      remainingExpected: metrics.remainingExpected.toString(),
      differenceAmount: metrics.differenceAmount.toString(),
      matchingClosedAt: row.matchingClosedAt?.toISOString() ?? null,
      expectedSnapshot: row.expectedSnapshot?.toString() ?? null,
      reviewStartedAt: row.reviewStartedAt?.toISOString() ?? null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      resolutionType: row.resolutionType,
      resolutionNotes: row.resolutionNotes,
      notes: row.notes,
      allocations,
      discrepancies: (row.discrepancies ?? []).map((d) => ({
        id: d.id,
        amount: d.amount.toString(),
        currency: d.currency,
        reasonCode: d.reasonCode,
        description: d.description,
        status: d.status,
        resolvedAt: d.resolvedAt?.toISOString() ?? null,
        resolutionType: d.resolutionType,
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async listActiveAllocations(
    companyId: string,
    sourceType: ReconciliationSourceType,
    sourceId: string,
  ) {
    const settlementSource = settlementSourceFor(sourceType);
    const itemWhere =
      settlementSource != null
        ? { companyId, sourceType: settlementSource, sourceId }
        : { companyId, settlementId: sourceId };

    const items = await this.database.client.settlementItem.findMany({
      where: itemWhere,
      select: { id: true, settlementId: true },
    });
    if (items.length === 0) return [];

    const allocations = await this.database.client.settlementAllocation.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        settlementItemId: { in: items.map((i) => i.id) },
      },
      orderBy: { createdAt: 'asc' },
    });

    return allocations.map((a) => ({
      id: a.id,
      settlementId: a.settlementId,
      settlementItemId: a.settlementItemId,
      financeTxnType: a.financeTxnType,
      financeTxnId: a.financeTxnId,
      amount: a.amount.toString(),
      paymentAmount: a.paymentAmount.toString(),
      createdAt: a.createdAt.toISOString(),
    }));
  }

  private async assertSourceReady(
    tx: Tx,
    companyId: string,
    sourceType: ReconciliationSourceType,
    sourceId: string,
  ): Promise<{ currency: import('@hector/database').CurrencyCode }> {
    if (sourceType === ReconciliationSourceType.CHANNEL) {
      const ch = await tx.channelSettlement.findFirst({
        where: { id: sourceId, companyId },
      });
      if (!ch) {
        throw new AppError({
          code: ERROR_CODES.RECONCILIATION_SOURCE_NOT_FOUND,
          message: RECONCILIATION_ERROR_MESSAGES.SOURCE_NOT_FOUND,
          statusCode: 404,
        });
      }
      if (
        ch.status === ChannelSettlementStatus.DRAFT ||
        ch.status === ChannelSettlementStatus.CANCELLED
      ) {
        throw new AppError({
          code: ERROR_CODES.RECONCILIATION_SOURCE_UNSUPPORTED,
          message: 'Channel settlement must be finalized before reconciliation.',
          statusCode: 409,
        });
      }
      return { currency: ch.currency };
    }
    if (sourceType === ReconciliationSourceType.SUPPLIER_PAYABLE) {
      const p = await tx.supplierPayable.findFirst({ where: { id: sourceId, companyId } });
      if (!p) {
        throw new AppError({
          code: ERROR_CODES.RECONCILIATION_SOURCE_NOT_FOUND,
          message: RECONCILIATION_ERROR_MESSAGES.SOURCE_NOT_FOUND,
          statusCode: 404,
        });
      }
      return { currency: p.currency };
    }
    if (sourceType === ReconciliationSourceType.LOAN) {
      const loan = await tx.loan.findFirst({ where: { id: sourceId, companyId } });
      if (!loan) {
        throw new AppError({
          code: ERROR_CODES.RECONCILIATION_SOURCE_NOT_FOUND,
          message: RECONCILIATION_ERROR_MESSAGES.SOURCE_NOT_FOUND,
          statusCode: 404,
        });
      }
      return { currency: loan.currency };
    }
    const settlement = await tx.settlement.findFirst({ where: { id: sourceId, companyId } });
    if (!settlement || settlement.status === SettlementStatus.CANCELLED) {
      throw new AppError({
        code: ERROR_CODES.RECONCILIATION_SOURCE_NOT_FOUND,
        message: RECONCILIATION_ERROR_MESSAGES.SOURCE_NOT_FOUND,
        statusCode: 404,
      });
    }
    return { currency: settlement.currency };
  }

  private async assertAllocationBelongsToSource(
    _companyId: string,
    sourceType: ReconciliationSourceType,
    sourceId: string,
    item: { sourceType: SettlementSourceType; sourceId: string; settlementId: string },
  ) {
    if (sourceType === ReconciliationSourceType.SETTLEMENT) {
      if (item.settlementId !== sourceId) {
        throw new AppError({
          code: ERROR_CODES.SETTLEMENT_ALLOCATION_NOT_FOUND,
          message: 'Allocation does not belong to this reconciliation.',
          statusCode: 404,
        });
      }
      return;
    }
    const expected = settlementSourceFor(sourceType);
    if (!expected || item.sourceType !== expected || item.sourceId !== sourceId) {
      throw new AppError({
        code: ERROR_CODES.SETTLEMENT_ALLOCATION_NOT_FOUND,
        message: 'Allocation does not belong to this reconciliation.',
        statusCode: 404,
      });
    }
  }

  private async resolveSettlementItemId(
    companyId: string,
    settlementId: string,
    settlementItemId?: string,
  ) {
    if (settlementItemId) return settlementItemId;
    const items = await this.database.client.settlementItem.findMany({
      where: { companyId, settlementId },
    });
    if (items.length !== 1) {
      throw new AppError({
        code: ERROR_CODES.SETTLEMENT_ITEM_NOT_FOUND,
        message: 'settlementItemId is required for multi-item settlements.',
        statusCode: 400,
      });
    }
    return items[0]!.id;
  }

  private assertMutable(status: ReconciliationStatus) {
    if (status === ReconciliationStatus.RESOLVED || status === ReconciliationStatus.CANCELLED) {
      throw new AppError({
        code: ERROR_CODES.RECONCILIATION_EDIT_BLOCKED,
        message: RECONCILIATION_ERROR_MESSAGES.EDIT_BLOCKED,
        statusCode: 409,
      });
    }
  }

  private requireActorId(): string {
    const ctx = getRequestContext();
    if (!ctx?.userId) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Authentication required.',
        statusCode: 401,
      });
    }
    return ctx.userId;
  }

  private async requireRow(companyId: string, id: string) {
    const row = await this.database.client.reconciliation.findFirst({
      where: { id, companyId },
      include: { discrepancies: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.RECONCILIATION_NOT_FOUND,
        message: RECONCILIATION_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }
}
