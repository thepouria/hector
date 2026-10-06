import { Injectable } from '@nestjs/common';
import { Prisma } from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { getRequestContext } from '../../common/context/request-context';
import { AppError } from '../../common/exceptions/app.error';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { AUDIT_SOURCE_API } from './audit.constants';
import {
  auditSnapshotsEqual,
  sanitizeAuditSnapshot,
  sanitizeAuditValue,
} from './serializers/audit-sanitizer';
import type {
  ExplicitAuditContext,
  JsonValue,
  RecordAuditInput,
} from './types/audit.types';
import type { ListAuditLogsQueryDto } from './dto/list-audit-logs.query.dto';
import { buildPaginationMeta, type PaginationMeta } from '../../common/dto/pagination-query.dto';
import { getCatalogMutationContext } from '../catalog/catalog-mutation.context';

export type AuditDbClient = Prisma.TransactionClient | DatabaseService['client'];

@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Append-only audit write. Prefer calling inside the same Prisma transaction
   * as the business mutation so both commit or roll back together.
   */
  async record(tx: AuditDbClient, input: RecordAuditInput): Promise<{ id: string } | null> {
    const before = input.before ?? null;
    const after = input.after ?? null;

    if (auditSnapshotsEqual(before, after)) {
      return null;
    }

    const context = this.resolveContext(input.context);
    const metadata = this.buildMetadata(input.metadata);

    const created = await tx.auditLog.create({
      data: {
        companyId: context.companyId,
        actorUserId: context.actorUserId,
        actorCompanyMemberId: context.actorCompanyMemberId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        before: sanitizeAuditSnapshot(before) as Prisma.InputJsonValue,
        after: sanitizeAuditSnapshot(after) as Prisma.InputJsonValue,
        metadata: metadata as Prisma.InputJsonValue,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      select: { id: true },
    });

    return created;
  }

  async list(
    companyId: string,
    query: ListAuditLogsQueryDto,
    options?: { restrictEntityTypes?: readonly string[] },
  ): Promise<{ data: AuditListItem[]; meta: PaginationMeta }> {
    if (options?.restrictEntityTypes && query.entityType) {
      if (!options.restrictEntityTypes.includes(query.entityType)) {
        throw new AppError({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'entityType is outside the allowed finance audit set.',
          statusCode: 400,
        });
      }
    }

    const where = this.buildWhere(companyId, query, options?.restrictEntityTypes);
    const skip = (query.page - 1) * query.pageSize;
    const order: Prisma.SortOrder = query.sortOrder ?? 'desc';

    const [total, rows] = await this.database.client.$transaction([
      this.database.client.auditLog.count({ where }),
      this.database.client.auditLog.findMany({
        where,
        orderBy: { createdAt: order },
        skip,
        take: query.pageSize,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          requestId: true,
          createdAt: true,
          actorUserId: true,
          actorCompanyMemberId: true,
          before: true,
          after: true,
          metadata: true,
          actor: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
    ]);

    return {
      data: rows.map((row) => this.toListItem(row)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async getById(
    companyId: string,
    auditLogId: string,
    options?: { restrictEntityTypes?: readonly string[] },
  ): Promise<AuditDetail> {
    const row = await this.database.client.auditLog.findFirst({
      where: {
        id: auditLogId,
        companyId,
      },
      include: {
        actor: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!row) {
      throw new AppError({
        code: ERROR_CODES.NOT_FOUND,
        message: 'Audit log not found.',
        statusCode: 404,
      });
    }

    if (
      options?.restrictEntityTypes &&
      !options.restrictEntityTypes.includes(row.entityType)
    ) {
      throw new AppError({
        code: ERROR_CODES.NOT_FOUND,
        message: 'Audit log not found.',
        statusCode: 404,
      });
    }

    return this.toDetail(row);
  }

  private resolveContext(explicit?: ExplicitAuditContext) {
    const store = getRequestContext();
    const companyId = explicit?.companyId ?? store?.companyId;
    const actorUserId =
      explicit && 'actorUserId' in explicit
        ? (explicit.actorUserId ?? null)
        : (store?.userId ?? null);
    const actorCompanyMemberId =
      explicit && 'actorCompanyMemberId' in explicit
        ? (explicit.actorCompanyMemberId ?? null)
        : (store?.companyMemberId ?? null);

    if (!companyId) {
      throw new AppError({
        code: ERROR_CODES.INTERNAL_SERVER_ERROR,
        message: 'Audit context is missing company attribution.',
        statusCode: 500,
      });
    }

    // Authenticated company mutations must have actor attribution.
    if (!explicit && (!actorUserId || !actorCompanyMemberId)) {
      throw new AppError({
        code: ERROR_CODES.INTERNAL_SERVER_ERROR,
        message: 'Audit context is missing actor attribution.',
        statusCode: 500,
      });
    }

    return {
      companyId,
      actorUserId,
      actorCompanyMemberId,
      requestId: explicit?.requestId ?? store?.requestId ?? null,
      ipAddress: explicit?.ipAddress ?? store?.ipAddress ?? null,
      userAgent: explicit?.userAgent ?? store?.userAgent ?? null,
    };
  }

  private buildMetadata(
    metadata: Record<string, JsonValue> | null | undefined,
  ): Record<string, JsonValue> {
    const mutation = getCatalogMutationContext();
    const base: Record<string, JsonValue> = {
      source: AUDIT_SOURCE_API,
      ...(mutation?.bulkOperationId ? { bulkOperationId: mutation.bulkOperationId } : {}),
    };
    if (!metadata) {
      return base;
    }
    return sanitizeAuditValue({ ...base, ...metadata }) as Record<string, JsonValue>;
  }

  private buildWhere(
    companyId: string,
    query: ListAuditLogsQueryDto,
    restrictEntityTypes?: readonly string[],
  ): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = { companyId };

    if (query.action) where.action = query.action;
    if (query.entityType) {
      where.entityType = query.entityType;
    } else if (restrictEntityTypes && restrictEntityTypes.length > 0) {
      where.entityType = { in: [...restrictEntityTypes] };
    }
    if (query.entityId) where.entityId = query.entityId;
    if (query.actorUserId) where.actorUserId = query.actorUserId;
    if (query.actorCompanyMemberId) where.actorCompanyMemberId = query.actorCompanyMemberId;
    if (query.requestId) where.requestId = query.requestId;

    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = query.from;
      if (query.to) where.createdAt.lte = query.to;
    }

    return where;
  }

  private toListItem(row: {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    requestId: string | null;
    createdAt: Date;
    actorUserId: string | null;
    actorCompanyMemberId: string | null;
    before?: Prisma.JsonValue;
    after?: Prisma.JsonValue;
    metadata?: Prisma.JsonValue;
    actor: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
    } | null;
  }): AuditListItem {
    return {
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      requestId: row.requestId,
      createdAt: row.createdAt,
      bulkOperationId: extractBulkOperationId(row.metadata),
      before: row.before ?? null,
      after: row.after ?? null,
      actor: {
        userId: row.actorUserId,
        companyMemberId: row.actorCompanyMemberId,
        email: row.actor?.email ?? null,
        displayName: row.actor
          ? `${row.actor.firstName} ${row.actor.lastName}`.trim()
          : null,
      },
    };
  }

  private toDetail(row: {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    before: Prisma.JsonValue;
    after: Prisma.JsonValue;
    metadata: Prisma.JsonValue;
    requestId: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Date;
    actorUserId: string | null;
    actorCompanyMemberId: string | null;
    actor: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
    } | null;
  }): AuditDetail {
    return {
      ...this.toListItem(row),
      metadata: row.metadata,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
    };
  }
}

export type AuditListItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  requestId: string | null;
  createdAt: Date;
  /** Present when mutation ran inside a Catalog Bulk Operation ALS context. */
  bulkOperationId: string | null;
  before: Prisma.JsonValue | null;
  after: Prisma.JsonValue | null;
  actor: {
    userId: string | null;
    companyMemberId: string | null;
    email: string | null;
    displayName: string | null;
  };
};

export type AuditDetail = AuditListItem & {
  metadata: Prisma.JsonValue;
  ipAddress: string | null;
  userAgent: string | null;
};

function extractBulkOperationId(metadata: Prisma.JsonValue | undefined): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>).bulkOperationId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}
