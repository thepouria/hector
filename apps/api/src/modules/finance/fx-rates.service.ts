import { Injectable } from '@nestjs/common';
import { FxRateSourceType, Prisma } from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { getRequestContext } from '../../common/context/request-context';
import {
  buildPaginationMeta,
  type PaginationMeta,
} from '../../common/dto/pagination-query.dto';
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
import {
  FX_RATE_ERROR_MESSAGES,
  FX_RATE_NOTES_MAX_LENGTH,
  FX_RATE_SOURCE_REFERENCE_MAX_LENGTH,
} from './finance-fx.constants';
import { assertOptionalText, normalizeSearchQuery } from './finance-accounts.normalization';
import { getLatestApplicableRate } from './fx-helpers';
import { describeFxQuote, parseFxRate } from './money/fx-rate';
import type {
  CreateFxRateDto,
  LatestFxRateQueryDto,
  ListFxRatesQueryDto,
} from './dto/fx.dto';
import type { FxRateView } from './types/finance-fx.types';

type FxRateRow = Prisma.FxRateGetPayload<object>;

@Injectable()
export class FxRatesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    query: ListFxRatesQueryDto,
  ): Promise<{ data: FxRateView[]; meta: PaginationMeta }> {
    const search = normalizeSearchQuery(query.q);
    const asOf = query.asOf ? new Date(query.asOf) : undefined;
    const where: Prisma.FxRateWhereInput = {
      companyId: company.companyId,
      ...(query.baseCurrency ? { baseCurrency: query.baseCurrency } : {}),
      ...(query.quoteCurrency ? { quoteCurrency: query.quoteCurrency } : {}),
      ...(query.rateType ? { rateType: query.rateType } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
      ...(query.includeArchived === true ? {} : { archivedAt: null }),
      ...(asOf ? { effectiveAt: { lte: asOf } } : {}),
      ...(search
        ? {
            OR: [
              { notes: { contains: search, mode: 'insensitive' } },
              { sourceReference: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.fxRate.count({ where }),
      this.database.client.fxRate.findMany({
        where,
        orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      data: rows.map((row) => this.toView(row)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, rateId: string): Promise<FxRateView> {
    const row = await this.database.client.fxRate.findFirst({
      where: { id: rateId, companyId: company.companyId },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.FX_RATE_NOT_FOUND,
        message: FX_RATE_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return this.toView(row);
  }

  async latest(
    company: CompanyContext,
    query: LatestFxRateQueryDto,
  ): Promise<{ data: FxRateView | null }> {
    const asOf = query.asOf ? new Date(query.asOf) : new Date();
    const row = await getLatestApplicableRate(this.database.client, {
      companyId: company.companyId,
      baseCurrency: query.base,
      quoteCurrency: query.quote,
      rateType: query.rateType,
      asOf,
    });
    if (!row) {
      return { data: null };
    }
    const full = await this.database.client.fxRate.findFirstOrThrow({
      where: { id: row.id, companyId: company.companyId },
    });
    return { data: this.toView(full) };
  }

  /**
   * Rates are immutable: always create a new row. Never mutate an existing rate.
   */
  async create(company: CompanyContext, dto: CreateFxRateDto): Promise<FxRateView> {
    const actorUserId = this.requireActorUserId();
    if (dto.baseCurrency === dto.quoteCurrency) {
      throw new AppError({
        code: ERROR_CODES.FX_RATE_SAME_CURRENCY,
        message: FX_RATE_ERROR_MESSAGES.SAME_CURRENCY,
        statusCode: 400,
      });
    }

    let rate: Prisma.Decimal;
    try {
      rate = parseFxRate(dto.rate);
    } catch {
      throw new AppError({
        code: ERROR_CODES.FX_RATE_INVALID,
        message: FX_RATE_ERROR_MESSAGES.INVALID_RATE,
        statusCode: 400,
      });
    }
    if (rate.lte(0)) {
      throw new AppError({
        code: ERROR_CODES.FX_RATE_ZERO,
        message: FX_RATE_ERROR_MESSAGES.ZERO_RATE,
        statusCode: 400,
      });
    }

    const notes = assertOptionalText(
      dto.notes,
      FX_RATE_NOTES_MAX_LENGTH,
      FX_RATE_ERROR_MESSAGES.INVALID_NOTES,
    );
    const sourceReference = assertOptionalText(
      dto.sourceReference,
      FX_RATE_SOURCE_REFERENCE_MAX_LENGTH,
      FX_RATE_ERROR_MESSAGES.INVALID_SOURCE_REFERENCE,
    );
    const effectiveAt = dto.effectiveAt ? new Date(dto.effectiveAt) : new Date();
    const sourceType = dto.sourceType ?? FxRateSourceType.MANUAL;

    return commitThenPublish(this.eventBus, async (events) => {
      const row = await this.database.client.$transaction(async (tx) => {
        const created = await tx.fxRate.create({
          data: {
            companyId: company.companyId,
            baseCurrency: dto.baseCurrency,
            quoteCurrency: dto.quoteCurrency,
            rate,
            rateType: dto.rateType,
            sourceType,
            sourceReference,
            effectiveAt,
            notes,
            createdById: actorUserId,
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.FX_RATE_CREATED,
          entityType: AUDIT_ENTITY_TYPES.FX_RATE,
          entityId: created.id,
          before: null,
          after: {
            baseCurrency: created.baseCurrency,
            quoteCurrency: created.quoteCurrency,
            rate: created.rate.toFixed(),
            rateType: created.rateType,
            sourceType: created.sourceType,
            effectiveAt: created.effectiveAt.toISOString(),
            rateDisplay: describeFxQuote({
              baseCurrency: created.baseCurrency,
              quoteCurrency: created.quoteCurrency,
              rate: created.rate,
            }),
          },
        });

        return created;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.FX_RATE_CREATED,
          payload: {
            companyId: company.companyId,
            fxRateId: row.id,
            baseCurrency: row.baseCurrency,
            quoteCurrency: row.quoteCurrency,
            rate: row.rate.toFixed(),
            rateType: row.rateType,
          },
        }),
      );

      return this.toView(row);
    });
  }

  /** Soft-archive. Reject hard-delete path when referenced by a conversion. */
  async archive(company: CompanyContext, rateId: string): Promise<FxRateView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const row = await this.database.client.$transaction(async (tx) => {
        const existing = await tx.fxRate.findFirst({
          where: { id: rateId, companyId: company.companyId },
        });
        if (!existing) {
          throw new AppError({
            code: ERROR_CODES.FX_RATE_NOT_FOUND,
            message: FX_RATE_ERROR_MESSAGES.NOT_FOUND,
            statusCode: 404,
          });
        }
        if (existing.archivedAt) {
          return existing;
        }

        const referenced = await tx.fxConversion.count({
          where: { companyId: company.companyId, fxRateId: existing.id },
        });
        // Archive is always allowed; hard-delete is never exposed.
        void referenced;
        void actorUserId;

        const updated = await tx.fxRate.update({
          where: { id: existing.id },
          data: { archivedAt: new Date() },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.FX_RATE_ARCHIVED,
          entityType: AUDIT_ENTITY_TYPES.FX_RATE,
          entityId: updated.id,
          before: { archivedAt: null },
          after: { archivedAt: updated.archivedAt?.toISOString() ?? null },
        });

        return updated;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.FX_RATE_ARCHIVED,
          payload: {
            companyId: company.companyId,
            fxRateId: row.id,
          },
        }),
      );

      return this.toView(row);
    });
  }

  private toView(row: FxRateRow): FxRateView {
    return {
      id: row.id,
      companyId: row.companyId,
      baseCurrency: row.baseCurrency,
      quoteCurrency: row.quoteCurrency,
      rate: row.rate.toFixed(),
      rateDisplay: describeFxQuote({
        baseCurrency: row.baseCurrency,
        quoteCurrency: row.quoteCurrency,
        rate: row.rate,
      }),
      rateType: row.rateType,
      sourceType: row.sourceType,
      sourceReference: row.sourceReference,
      effectiveAt: row.effectiveAt.toISOString(),
      notes: row.notes,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private requireActorUserId(): string {
    const userId = getRequestContext()?.userId;
    if (!userId) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Authenticated actor is required.',
        statusCode: 401,
      });
    }
    return userId;
  }
}
