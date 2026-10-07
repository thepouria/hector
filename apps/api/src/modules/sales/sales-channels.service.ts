import { Injectable } from '@nestjs/common';
import { Prisma, SalesChannelStatus, SalesChannelType } from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import {
  buildPaginationMeta,
  type PaginationMeta,
} from '../../common/dto/pagination-query.dto';
import { AppError } from '../../common/exceptions/app.error';
import { getRequestContext } from '../../common/context/request-context';
import { DatabaseService } from '../../infrastructure/database/database.service';
import {
  DOMAIN_EVENTS,
  DomainEventBus,
  DomainEventFactory,
  commitThenPublish,
} from '../../infrastructure/events';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { auditSnapshotsEqual } from '../audit/serializers/audit-sanitizer';
import type { CompanyContext } from '../companies/types/company.types';
import type { CreateSalesChannelDto } from './dto/create-sales-channel.dto';
import type { ListSalesChannelsQueryDto } from './dto/list-sales-channels.query.dto';
import type { UpdateSalesChannelDto } from './dto/update-sales-channel.dto';
import { SALES_ERROR_MESSAGES } from './sales.constants';
import {
  assertSalesChannelCode,
  assertSalesChannelName,
  assertSalesChannelNotes,
  mapSalesUniqueViolation,
  normalizeSearchQuery,
} from './sales.normalization';

type SalesChannelRow = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  type: SalesChannelType;
  status: SalesChannelStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
  archivedAt: Date | null;
};

export type SalesChannelView = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  type: SalesChannelType;
  status: SalesChannelStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
  archivedAt: Date | null;
};

@Injectable()
export class SalesChannelsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    query: ListSalesChannelsQueryDto,
  ): Promise<{ data: SalesChannelView[]; meta: PaginationMeta }> {
    const search = normalizeSearchQuery(query.search);
    const where: Prisma.SalesChannelWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const orderBy: Prisma.SalesChannelOrderByWithRelationInput = {
      [query.sortBy]: query.sortOrder,
    };

    const [total, rows] = await this.database.client.$transaction([
      this.database.client.salesChannel.count({ where }),
      this.database.client.salesChannel.findMany({
        where,
        orderBy,
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      data: rows.map((row) => this.toView(row)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, channelId: string): Promise<SalesChannelView> {
    const row = await this.requireChannel(company.companyId, channelId);
    return this.toView(row);
  }

  async create(company: CompanyContext, dto: CreateSalesChannelDto): Promise<SalesChannelView> {
    const code = assertSalesChannelCode(dto.code);
    const name = assertSalesChannelName(dto.name);
    const notes = assertSalesChannelNotes(dto.notes) ?? null;
    const createdById = this.optionalActorUserId();

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const created = await this.database.client.$transaction(async (tx) => {
          const channel = await tx.salesChannel.create({
            data: {
              companyId: company.companyId,
              code,
              name,
              type: dto.type,
              notes,
              status: SalesChannelStatus.ACTIVE,
              createdById,
            },
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.SALES_CHANNEL_CREATED,
            entityType: AUDIT_ENTITY_TYPES.SALES_CHANNEL,
            entityId: channel.id,
            before: null,
            after: this.snapshot(channel),
          });

          return channel;
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.SALES_CHANNEL_CREATED,
            payload: {
              companyId: company.companyId,
              channelId: created.id,
              type: created.type,
              status: created.status,
            },
          }),
        );

        return this.toView(created);
      } catch (error) {
        mapSalesUniqueViolation(error);
      }
    });
  }

  async update(
    company: CompanyContext,
    channelId: string,
    dto: UpdateSalesChannelDto,
  ): Promise<SalesChannelView> {
    const current = await this.requireChannel(company.companyId, channelId);
    if (
      dto.code === undefined &&
      dto.name === undefined &&
      dto.type === undefined &&
      dto.notes === undefined
    ) {
      throw AppError.validation('At least one field is required to update the sales channel.');
    }

    const next = {
      code: dto.code !== undefined ? assertSalesChannelCode(dto.code) : current.code,
      name: dto.name !== undefined ? assertSalesChannelName(dto.name) : current.name,
      type: dto.type !== undefined ? dto.type : current.type,
      notes:
        dto.notes !== undefined ? (assertSalesChannelNotes(dto.notes) ?? null) : current.notes,
    };

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          const channel = await tx.salesChannel.update({
            where: { id: current.id },
            data: next,
          });

          const before = this.snapshot(current);
          const after = this.snapshot(channel);
          const audited = await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.SALES_CHANNEL_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.SALES_CHANNEL,
            entityId: channel.id,
            before,
            after,
          });

          if (audited) {
            const changedFields = Object.keys(before).filter(
              (key) =>
                !auditSnapshotsEqual(
                  (before as Record<string, unknown>)[key],
                  (after as Record<string, unknown>)[key],
                ),
            );
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.SALES_CHANNEL_UPDATED,
                payload: {
                  companyId: company.companyId,
                  channelId: channel.id,
                  type: channel.type,
                  status: channel.status,
                  changedFields,
                },
              }),
            );
          }

          return channel;
        });

        return this.toView(updated);
      } catch (error) {
        mapSalesUniqueViolation(error);
      }
    });
  }

  async activate(company: CompanyContext, channelId: string): Promise<SalesChannelView> {
    return this.changeStatus(
      company,
      channelId,
      SalesChannelStatus.ACTIVE,
      AUDIT_ACTIONS.SALES_CHANNEL_ACTIVATED,
    );
  }

  async deactivate(company: CompanyContext, channelId: string): Promise<SalesChannelView> {
    return this.changeStatus(
      company,
      channelId,
      SalesChannelStatus.INACTIVE,
      AUDIT_ACTIONS.SALES_CHANNEL_DEACTIVATED,
    );
  }

  private async changeStatus(
    company: CompanyContext,
    channelId: string,
    status: SalesChannelStatus,
    action: string,
  ): Promise<SalesChannelView> {
    const current = await this.requireChannel(company.companyId, channelId);
    if (current.status === status) {
      return this.toView(current);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const channel = await tx.salesChannel.update({
          where: { id: current.id },
          data: {
            status,
            archivedAt: status === SalesChannelStatus.INACTIVE ? new Date() : null,
          },
        });

        await this.auditService.record(tx, {
          action,
          entityType: AUDIT_ENTITY_TYPES.SALES_CHANNEL,
          entityId: channel.id,
          before: this.snapshot(current),
          after: this.snapshot(channel),
        });

        return channel;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.SALES_CHANNEL_STATUS_CHANGED,
          payload: {
            companyId: company.companyId,
            channelId: updated.id,
            type: updated.type,
            previousStatus: current.status,
            newStatus: updated.status,
          },
        }),
      );

      return this.toView(updated);
    });
  }

  async requireChannel(companyId: string, channelId: string): Promise<SalesChannelRow> {
    const row = await this.database.client.salesChannel.findFirst({
      where: { id: channelId, companyId },
    });
    if (!row) {
      throw this.notFound();
    }
    return row;
  }

  private optionalActorUserId(): string | null {
    return getRequestContext()?.userId ?? null;
  }

  private notFound(): AppError {
    return new AppError({
      code: ERROR_CODES.SALES_CHANNEL_NOT_FOUND,
      message: SALES_ERROR_MESSAGES.SALES_CHANNEL_NOT_FOUND,
      statusCode: 404,
    });
  }

  private snapshot(channel: SalesChannelRow) {
    return {
      id: channel.id,
      code: channel.code,
      name: channel.name,
      type: channel.type,
      status: channel.status,
      notes: channel.notes,
      archivedAt: channel.archivedAt?.toISOString() ?? null,
    };
  }

  private toView(row: SalesChannelRow): SalesChannelView {
    return {
      id: row.id,
      companyId: row.companyId,
      code: row.code,
      name: row.name,
      type: row.type,
      status: row.status,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdById: row.createdById,
      archivedAt: row.archivedAt,
    };
  }
}
