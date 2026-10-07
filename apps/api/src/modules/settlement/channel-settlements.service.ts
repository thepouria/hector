import { Injectable } from '@nestjs/common';
import {
  ChannelSettlementComponentEffect,
  ChannelSettlementComponentType,
  ChannelSettlementStatus,
  CurrencyCode,
  Prisma,
  SettlementFinanceTxnType,
  SettlementSourceType,
  SettlementStatus,
  SettlementType,
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
import { parseMoneyAmount } from '../finance/money/money';
import {
  sumActiveObligationAllocated,
} from './adapters/source-adapter';
import {
  allocateChannelSettlementSequence,
  formatChannelSettlementNumber,
} from './channel-settlement-numbering';
import {
  calculateExpectedNet,
  componentRequiresDescription,
  isValidComponentEffect,
} from './channel-settlement-expected-net';
import { deriveChannelSettlementStatus } from './domain-effects';
import type {
  AllocateChannelReceiptDto,
  ChannelSettlementComponentDto,
  CreateChannelSettlementDto,
  ReplaceChannelSettlementComponentsDto,
} from './dto/channel-settlement.dto';
import type { ListChannelSettlementsQueryDto } from './dto/list-channel-settlements.query.dto';
import { SETTLEMENT_ERROR_MESSAGES } from './settlement.constants';
import { SettlementsCoreService } from './settlements-core.service';

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

type Tx = Prisma.TransactionClient;

@Injectable()
export class ChannelSettlementsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventBus: DomainEventBus,
    private readonly eventFactory: DomainEventFactory,
    private readonly core: SettlementsCoreService,
  ) {}

  async create(company: CompanyContext, dto: CreateChannelSettlementDto) {
    const actorId = this.requireActorUserId();
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodStart > periodEnd) {
      throw new AppError({
        code: ERROR_CODES.CHANNEL_SETTLEMENT_COMPONENT_INVALID,
        message: 'periodStart must be <= periodEnd.',
        statusCode: 400,
      });
    }

    const normalized = this.normalizeComponents(dto.components, dto.currency);
    const expectedNet = calculateExpectedNet(normalized);
    if (expectedNet.lt(0)) {
      throw new AppError({
        code: ERROR_CODES.CHANNEL_SETTLEMENT_NEGATIVE_NET,
        message: SETTLEMENT_ERROR_MESSAGES.CHANNEL_SETTLEMENT_NEGATIVE_NET,
        statusCode: 409,
      });
    }

    const row = await commitThenPublish(this.eventBus, async (events) => {
    return this.database.client.$transaction(async (tx) => {
      if (dto.requestId) {
        const existing = await tx.channelSettlement.findFirst({
          where: { companyId: company.companyId, requestId: dto.requestId },
          include: { components: { orderBy: { sortOrder: 'asc' } }, channel: true },
        });
        if (existing) return existing;
      }

      const channel = await tx.salesChannel.findFirst({
        where: { id: dto.channelId, companyId: company.companyId },
      });
      if (!channel) {
        throw new AppError({
          code: ERROR_CODES.SALES_CHANNEL_NOT_FOUND,
          message: 'Sales channel was not found.',
          statusCode: 404,
        });
      }

      if (dto.externalReference) {
        const dup = await tx.channelSettlement.findFirst({
          where: {
            companyId: company.companyId,
            channelId: dto.channelId,
            externalReference: dto.externalReference,
          },
        });
        if (dup) {
          throw new AppError({
            code: ERROR_CODES.CHANNEL_SETTLEMENT_DUPLICATE,
            message: SETTLEMENT_ERROR_MESSAGES.CHANNEL_SETTLEMENT_DUPLICATE,
            statusCode: 409,
          });
        }
      }

      const seq = await allocateChannelSettlementSequence(tx, company.companyId);
      const createdBase = await tx.channelSettlement.create({
        data: {
          companyId: company.companyId,
          number: formatChannelSettlementNumber(seq),
          channelId: dto.channelId,
          periodStart,
          periodEnd,
          currency: dto.currency,
          expectedNet,
          status: ChannelSettlementStatus.DRAFT,
          externalReference: dto.externalReference ?? null,
          notes: dto.notes ?? null,
          requestId: dto.requestId ?? null,
          createdById: actorId,
        },
      });
      // Nested create cannot set companyId with composite FK; createMany is explicit.
      await tx.channelSettlementComponent.createMany({
        data: normalized.map((c, i) => ({
          companyId: company.companyId,
          channelSettlementId: createdBase.id,
          type: c.type,
          effect: c.effect,
          amount: c.amount,
          currency: dto.currency,
          description: c.description,
          reference: c.reference,
          notes: c.notes,
          sortOrder: i,
          createdById: actorId,
        })),
      });
      const created = await tx.channelSettlement.findFirstOrThrow({
        where: { id: createdBase.id, companyId: company.companyId },
        include: { components: { orderBy: { sortOrder: 'asc' } }, channel: true },
      });

      await this.auditService.record(tx, {
        action: AUDIT_ACTIONS.CHANNEL_SETTLEMENT_CREATED,
        entityType: AUDIT_ENTITY_TYPES.CHANNEL_SETTLEMENT,
        entityId: created.id,
        before: null,
        after: {
          number: created.number,
          channelId: created.channelId,
          expectedNet: created.expectedNet.toString(),
          currency: created.currency,
          periodStart: created.periodStart.toISOString(),
          periodEnd: created.periodEnd.toISOString(),
        },
      });
      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.CHANNEL_SETTLEMENT_CREATED,
          payload: {
            companyId: company.companyId, channelSettlementId: created.id, number: created.number },
        }),
      );
      return created;
    }, TX_OPTIONS);
    });

    return this.toView(row, new Prisma.Decimal(0));
  }

  async get(company: CompanyContext, id: string) {
    const row = await this.requireRow(company.companyId, id);
    const received = await sumActiveObligationAllocated(
      this.database.client as never,
      company.companyId,
      SettlementSourceType.CHANNEL,
      id,
    );
    return this.toView(row, received);
  }

  async list(company: CompanyContext, query: ListChannelSettlementsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.ChannelSettlementWhereInput = {
      companyId: company.companyId,
      ...(query.channelId ? { channelId: query.channelId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
      ...(query.outstandingOnly === 'true'
        ? {
            status: {
              in: [
                ChannelSettlementStatus.OPEN,
                ChannelSettlementStatus.PARTIALLY_RECEIVED,
              ],
            },
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.database.client.channelSettlement.count({ where }),
      this.database.client.channelSettlement.findMany({
        where,
        include: { channel: true, components: { orderBy: { sortOrder: 'asc' } } },
        orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const views = [];
    for (const row of rows) {
      const received = await sumActiveObligationAllocated(
        this.database.client as never,
        company.companyId,
        SettlementSourceType.CHANNEL,
        row.id,
      );
      if (query.outstandingOnly === 'true' && row.expectedNet.minus(received).lte(0)) {
        continue;
      }
      views.push(this.toView(row, received));
    }

    const byCurrency = new Map<string, Prisma.Decimal>();
    for (const v of views) {
      const outstanding = new Prisma.Decimal(v.outstandingAmount);
      if (outstanding.lte(0)) continue;
      byCurrency.set(
        v.currency,
        (byCurrency.get(v.currency) ?? new Prisma.Decimal(0)).plus(outstanding),
      );
    }

    return {
      data: views,
      meta: {
        page,
        pageSize,
        total,
        outstandingByCurrency: [...byCurrency.entries()].map(([currency, amount]) => ({
          currency,
          amount: amount.toString(),
        })),
      },
    };
  }

  async replaceComponents(
    company: CompanyContext,
    id: string,
    dto: ReplaceChannelSettlementComponentsDto,
  ) {
    const actorId = this.requireActorUserId();
    const row = await commitThenPublish(this.eventBus, async (events) => {
    return this.database.client.$transaction(async (tx) => {
      await this.lockChannel(tx, company.companyId, id);
      const existing = await tx.channelSettlement.findFirstOrThrow({
        where: { id, companyId: company.companyId },
        include: { components: true, channel: true },
      });
      if (existing.status !== ChannelSettlementStatus.DRAFT) {
        throw new AppError({
          code: ERROR_CODES.CHANNEL_SETTLEMENT_EDIT_BLOCKED,
          message: SETTLEMENT_ERROR_MESSAGES.CHANNEL_SETTLEMENT_EDIT_BLOCKED,
          statusCode: 409,
        });
      }
      await this.assertNoActiveAllocations(tx, company.companyId, id);

      const normalized = this.normalizeComponents(dto.components, existing.currency);
      const expectedNet = calculateExpectedNet(normalized);
      if (expectedNet.lt(0)) {
        throw new AppError({
          code: ERROR_CODES.CHANNEL_SETTLEMENT_NEGATIVE_NET,
          message: SETTLEMENT_ERROR_MESSAGES.CHANNEL_SETTLEMENT_NEGATIVE_NET,
          statusCode: 409,
        });
      }

      await tx.channelSettlementComponent.deleteMany({
        where: { companyId: company.companyId, channelSettlementId: id },
      });
      await tx.channelSettlementComponent.createMany({
        data: normalized.map((c, i) => ({
          companyId: company.companyId,
          channelSettlementId: id,
          type: c.type,
          effect: c.effect,
          amount: c.amount,
          currency: existing.currency,
          description: c.description,
          reference: c.reference,
          notes: c.notes,
          sortOrder: i,
          createdById: actorId,
        })),
      });

      const updated = await tx.channelSettlement.update({
        where: { id },
        data: { expectedNet, updatedById: actorId },
        include: { components: { orderBy: { sortOrder: 'asc' } }, channel: true },
      });

      await this.auditService.record(tx, {
        action: AUDIT_ACTIONS.CHANNEL_SETTLEMENT_UPDATED,
        entityType: AUDIT_ENTITY_TYPES.CHANNEL_SETTLEMENT,
        entityId: id,
        before: { expectedNet: existing.expectedNet.toString() },
        after: { expectedNet: expectedNet.toString() },
      });
      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.CHANNEL_SETTLEMENT_UPDATED,
          payload: {
            companyId: company.companyId, channelSettlementId: id },
        }),
      );
      return updated;
    }, TX_OPTIONS);
    });

    return this.toView(row, new Prisma.Decimal(0));
  }

  async finalize(company: CompanyContext, id: string) {
    const actorId = this.requireActorUserId();
    const row = await commitThenPublish(this.eventBus, async (events) => {
    return this.database.client.$transaction(async (tx) => {
      await this.lockChannel(tx, company.companyId, id);
      const existing = await tx.channelSettlement.findFirstOrThrow({
        where: { id, companyId: company.companyId },
        include: { components: { orderBy: { sortOrder: 'asc' } }, channel: true },
      });
      if (existing.status !== ChannelSettlementStatus.DRAFT) {
        throw new AppError({
          code: ERROR_CODES.CHANNEL_SETTLEMENT_INVALID_STATUS,
          message: SETTLEMENT_ERROR_MESSAGES.CHANNEL_SETTLEMENT_INVALID_STATUS,
          statusCode: 409,
        });
      }
      if (existing.components.length === 0) {
        throw new AppError({
          code: ERROR_CODES.CHANNEL_SETTLEMENT_COMPONENT_INVALID,
          message: 'At least one settlement component is required.',
          statusCode: 409,
        });
      }

      const expectedNet = calculateExpectedNet(existing.components);
      if (!expectedNet.eq(existing.expectedNet)) {
        // Self-heal materialized value before open
        await tx.channelSettlement.update({
          where: { id },
          data: { expectedNet },
        });
      }
      if (expectedNet.lt(0)) {
        throw new AppError({
          code: ERROR_CODES.CHANNEL_SETTLEMENT_NEGATIVE_NET,
          message: SETTLEMENT_ERROR_MESSAGES.CHANNEL_SETTLEMENT_NEGATIVE_NET,
          statusCode: 409,
        });
      }

      const nextStatus =
        expectedNet.eq(0)
          ? ChannelSettlementStatus.RECEIVED
          : ChannelSettlementStatus.OPEN;

      const updated = await tx.channelSettlement.update({
        where: { id },
        data: {
          expectedNet,
          status: nextStatus,
          finalizedAt: new Date(),
          finalizedById: actorId,
          updatedById: actorId,
        },
        include: { components: { orderBy: { sortOrder: 'asc' } }, channel: true },
      });

      await this.auditService.record(tx, {
        action: AUDIT_ACTIONS.CHANNEL_SETTLEMENT_FINALIZED,
        entityType: AUDIT_ENTITY_TYPES.CHANNEL_SETTLEMENT,
        entityId: id,
        before: { status: existing.status },
        after: { status: nextStatus, expectedNet: expectedNet.toString() },
      });
      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.CHANNEL_SETTLEMENT_OPENED,
          payload: {
            companyId: company.companyId, channelSettlementId: id, status: nextStatus },
        }),
      );
      return updated;
    }, TX_OPTIONS);
    });

    return this.toView(row, new Prisma.Decimal(0));
  }

  async allocateReceipt(
    company: CompanyContext,
    id: string,
    dto: AllocateChannelReceiptDto,
  ) {
    if (dto.requestId) {
      const existing = await this.database.client.settlementAllocation.findFirst({
        where: { companyId: company.companyId, requestId: dto.requestId },
      });
      if (existing) {
        return this.get(company, id);
      }
    }

    const source = await this.database.client.channelSettlement.findFirst({
      where: { id, companyId: company.companyId },
    });
    if (!source) {
      throw new AppError({
        code: ERROR_CODES.CHANNEL_SETTLEMENT_NOT_FOUND,
        message: SETTLEMENT_ERROR_MESSAGES.CHANNEL_SETTLEMENT_NOT_FOUND,
        statusCode: 404,
      });
    }
    if (
      source.status !== ChannelSettlementStatus.OPEN &&
      source.status !== ChannelSettlementStatus.PARTIALLY_RECEIVED
    ) {
      throw new AppError({
        code: ERROR_CODES.CHANNEL_SETTLEMENT_INVALID_STATUS,
        message: SETTLEMENT_ERROR_MESSAGES.CHANNEL_SETTLEMENT_INVALID_STATUS,
        statusCode: 409,
      });
    }

    const { settlementId, itemId } = await this.ensureOpenCoreSettlement(company, source);

    await this.core.allocate(company, settlementId, {
      settlementItemId: itemId,
      financeTxnType: SettlementFinanceTxnType.RECEIPT,
      financeTxnId: dto.receiptId,
      amount: dto.amount,
      requestId: dto.requestId,
    });

    return this.get(company, id);
  }

  async cancel(company: CompanyContext, id: string) {
    const actorId = this.requireActorUserId();
    await commitThenPublish(this.eventBus, async (events) => {
    await this.database.client.$transaction(async (tx) => {
      await this.lockChannel(tx, company.companyId, id);
      const existing = await tx.channelSettlement.findFirstOrThrow({
        where: { id, companyId: company.companyId },
      });
      if (existing.status === ChannelSettlementStatus.CANCELLED) {
        return;
      }
      await this.assertNoActiveAllocations(tx, company.companyId, id);

      await tx.channelSettlement.update({
        where: { id },
        data: {
          status: ChannelSettlementStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: actorId,
          updatedById: actorId,
        },
      });
      await this.auditService.record(tx, {
        action: AUDIT_ACTIONS.CHANNEL_SETTLEMENT_CANCELLED,
        entityType: AUDIT_ENTITY_TYPES.CHANNEL_SETTLEMENT,
        entityId: id,
        before: { status: existing.status },
        after: { status: ChannelSettlementStatus.CANCELLED },
      });
      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.CHANNEL_SETTLEMENT_CANCELLED,
          payload: {
            companyId: company.companyId, channelSettlementId: id },
        }),
      );
    }, TX_OPTIONS);
    });

    return this.get(company, id);
  }

  private async ensureOpenCoreSettlement(
    company: CompanyContext,
    channelSettlement: {
      id: string;
      currency: CurrencyCode;
      expectedNet: Prisma.Decimal;
      number: string;
    },
  ): Promise<{ settlementId: string; itemId: string }> {
    const existingItem = await this.database.client.settlementItem.findFirst({
      where: {
        companyId: company.companyId,
        sourceType: SettlementSourceType.CHANNEL,
        sourceId: channelSettlement.id,
      },
      include: { settlement: true },
    });
    if (existingItem) {
      if (
        existingItem.settlement.status === SettlementStatus.DRAFT
      ) {
        await this.core.open(company, existingItem.settlementId);
      }
      return { settlementId: existingItem.settlementId, itemId: existingItem.id };
    }

    const created = await this.core.create(company, {
      currency: channelSettlement.currency,
      type: SettlementType.CHANNEL,
      reference: channelSettlement.number,
      notes: `Channel settlement ${channelSettlement.number}`,
    });
    await this.core.addItem(company, created.id, {
      sourceType: SettlementSourceType.CHANNEL,
      sourceId: channelSettlement.id,
    });
    await this.core.open(company, created.id);
    const item = await this.database.client.settlementItem.findFirstOrThrow({
      where: {
        companyId: company.companyId,
        settlementId: created.id,
        sourceType: SettlementSourceType.CHANNEL,
        sourceId: channelSettlement.id,
      },
    });
    return { settlementId: created.id, itemId: item.id };
  }

  private normalizeComponents(
    components: ChannelSettlementComponentDto[],
    currency: CurrencyCode,
  ): Array<{
    type: ChannelSettlementComponentType;
    effect: ChannelSettlementComponentEffect;
    amount: Prisma.Decimal;
    description: string | null;
    reference: string | null;
    notes: string | null;
  }> {
    return components.map((c) => {
      if (!isValidComponentEffect(c.type, c.effect)) {
        throw new AppError({
          code: ERROR_CODES.CHANNEL_SETTLEMENT_COMPONENT_INVALID,
          message: `Invalid effect ${c.effect} for component type ${c.type}.`,
          statusCode: 400,
        });
      }
      if (componentRequiresDescription(c.type) && !c.description?.trim()) {
        throw new AppError({
          code: ERROR_CODES.CHANNEL_SETTLEMENT_COMPONENT_INVALID,
          message: `Description is required for ${c.type} components.`,
          statusCode: 400,
        });
      }
      let amount: Prisma.Decimal;
      try {
        amount = parseMoneyAmount(c.amount, currency);
      } catch {
        throw new AppError({
          code: ERROR_CODES.SETTLEMENT_INVALID_MONEY,
          message: SETTLEMENT_ERROR_MESSAGES.INVALID_AMOUNT,
          statusCode: 400,
        });
      }
      if (amount.lte(0)) {
        throw new AppError({
          code: ERROR_CODES.SETTLEMENT_INVALID_MONEY,
          message: SETTLEMENT_ERROR_MESSAGES.INVALID_AMOUNT,
          statusCode: 400,
        });
      }
      return {
        type: c.type,
        effect: c.effect,
        amount,
        description: c.description?.trim() ?? null,
        reference: c.reference?.trim() ?? null,
        notes: c.notes?.trim() ?? null,
      };
    });
  }

  private toView(
    row: {
      id: string;
      number: string;
      channelId: string;
      periodStart: Date;
      periodEnd: Date;
      currency: CurrencyCode;
      expectedNet: Prisma.Decimal;
      status: ChannelSettlementStatus;
      externalReference: string | null;
      notes: string | null;
      finalizedAt: Date | null;
      cancelledAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      channel?: { id: string; code: string; name: string; type: string };
      components: Array<{
        id: string;
        type: ChannelSettlementComponentType;
        effect: ChannelSettlementComponentEffect;
        amount: Prisma.Decimal;
        currency: CurrencyCode;
        description: string | null;
        reference: string | null;
        notes: string | null;
        sortOrder: number;
      }>;
    },
    received: Prisma.Decimal,
  ) {
    const outstanding = Prisma.Decimal.max(
      row.expectedNet.minus(received),
      new Prisma.Decimal(0),
    );
    const derivedStatus = deriveChannelSettlementStatus({
      expectedNet: row.expectedNet,
      received,
      currentStatus: row.status,
    });
    return {
      id: row.id,
      number: row.number,
      channelId: row.channelId,
      channel: row.channel
        ? {
            id: row.channel.id,
            code: row.channel.code,
            name: row.channel.name,
            type: row.channel.type,
          }
        : undefined,
      periodStart: row.periodStart.toISOString(),
      periodEnd: row.periodEnd.toISOString(),
      currency: row.currency,
      expectedNet: row.expectedNet.toString(),
      actualReceived: received.toString(),
      outstandingAmount: outstanding.toString(),
      difference: received.minus(row.expectedNet).toString(),
      status: derivedStatus,
      externalReference: row.externalReference,
      notes: row.notes,
      finalizedAt: row.finalizedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      components: row.components.map((c) => ({
        id: c.id,
        type: c.type,
        effect: c.effect,
        amount: c.amount.toString(),
        currency: c.currency,
        description: c.description,
        reference: c.reference,
        notes: c.notes,
        sortOrder: c.sortOrder,
      })),
    };
  }

  private async requireRow(companyId: string, id: string) {
    const row = await this.database.client.channelSettlement.findFirst({
      where: { id, companyId },
      include: { components: { orderBy: { sortOrder: 'asc' } }, channel: true },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.CHANNEL_SETTLEMENT_NOT_FOUND,
        message: SETTLEMENT_ERROR_MESSAGES.CHANNEL_SETTLEMENT_NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async lockChannel(tx: Tx, companyId: string, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM channel_settlements
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
      FOR UPDATE
    `);
    if (!rows[0]) {
      throw new AppError({
        code: ERROR_CODES.CHANNEL_SETTLEMENT_NOT_FOUND,
        message: SETTLEMENT_ERROR_MESSAGES.CHANNEL_SETTLEMENT_NOT_FOUND,
        statusCode: 404,
      });
    }
  }

  private async assertNoActiveAllocations(tx: Tx, companyId: string, id: string) {
    const allocated = await sumActiveObligationAllocated(
      tx,
      companyId,
      SettlementSourceType.CHANNEL,
      id,
    );
    if (allocated.gt(0)) {
      throw new AppError({
        code: ERROR_CODES.CHANNEL_SETTLEMENT_CANCEL_BLOCKED,
        message: 'Reverse active receipt allocations before changing or cancelling.',
        statusCode: 409,
      });
    }
  }

  private requireActorUserId(): string {
    const userId = getRequestContext()?.userId;
    if (!userId) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Authentication required.',
        statusCode: 401,
      });
    }
    return userId;
  }
}
