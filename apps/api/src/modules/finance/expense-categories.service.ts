import { Injectable } from '@nestjs/common';
import {
  ExpenseCategoryStatus,
  Prisma,
} from '@hector/database';
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
import { assertOptionalText, normalizeSearchQuery } from './finance-accounts.normalization';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_CODE_MAX_LENGTH,
  EXPENSE_CATEGORY_DESCRIPTION_MAX_LENGTH,
  EXPENSE_CATEGORY_ERROR_MESSAGES,
  EXPENSE_CATEGORY_NAME_MAX_LENGTH,
  EXPENSE_ERROR_MESSAGES,
} from './finance-expenses.constants';
import type {
  CreateExpenseCategoryDto,
  ListExpenseCategoriesQueryDto,
  UpdateExpenseCategoryDto,
} from './dto/expense.dto';

export type ExpenseCategoryView = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  status: ExpenseCategoryStatus;
  description: string | null;
  isSystem: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class ExpenseCategoriesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    query: ListExpenseCategoriesQueryDto,
  ): Promise<{ data: ExpenseCategoryView[]; meta: PaginationMeta }> {
    const search = normalizeSearchQuery(query.q);
    const where: Prisma.ExpenseCategoryWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
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
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.expenseCategory.count({ where }),
      this.database.client.expenseCategory.findMany({
        where,
        orderBy: [{ code: 'asc' }],
        skip,
        take: query.pageSize,
      }),
    ]);
    return {
      data: rows.map((r) => this.toView(r)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, id: string): Promise<ExpenseCategoryView> {
    return this.toView(await this.require(company.companyId, id));
  }

  async create(
    company: CompanyContext,
    dto: CreateExpenseCategoryDto,
  ): Promise<ExpenseCategoryView> {
    const actorUserId = this.requireActorUserId();
    const code = this.normalizeCode(dto.code);
    const name = dto.name.trim();
    if (!name || name.length > EXPENSE_CATEGORY_NAME_MAX_LENGTH) {
      throw new AppError({
        code: ERROR_CODES.EXPENSE_CATEGORY_NOT_FOUND,
        message: EXPENSE_CATEGORY_ERROR_MESSAGES.NAME_INVALID,
        statusCode: 400,
      });
    }
    const description = assertOptionalText(
      dto.description,
      EXPENSE_CATEGORY_DESCRIPTION_MAX_LENGTH,
      EXPENSE_CATEGORY_ERROR_MESSAGES.NAME_INVALID,
    );

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const row = await this.database.client.$transaction(async (tx) => {
          const created = await tx.expenseCategory.create({
            data: {
              companyId: company.companyId,
              code,
              name,
              description,
              createdById: actorUserId,
            },
          });
          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.EXPENSE_CATEGORY_CREATED,
            entityType: AUDIT_ENTITY_TYPES.EXPENSE_CATEGORY,
            entityId: created.id,
            after: { code: created.code, name: created.name },
          });
          return created;
        });
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.EXPENSE_CATEGORY_CREATED,
            payload: {
              companyId: company.companyId,
              categoryId: row.id,
              code: row.code,
            },
          }),
        );
        return this.toView(row);
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new AppError({
            code: ERROR_CODES.EXPENSE_CATEGORY_CODE_TAKEN,
            message: EXPENSE_ERROR_MESSAGES.CATEGORY_CODE_TAKEN,
            statusCode: 409,
          });
        }
        throw err;
      }
    });
  }

  async update(
    company: CompanyContext,
    id: string,
    dto: UpdateExpenseCategoryDto,
  ): Promise<ExpenseCategoryView> {
    const existing = await this.require(company.companyId, id);
    if (existing.status !== ExpenseCategoryStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.EXPENSE_CATEGORY_INACTIVE,
        message: EXPENSE_CATEGORY_ERROR_MESSAGES.NOT_EDITABLE,
        statusCode: 409,
      });
    }
    const name =
      dto.name !== undefined ? dto.name.trim() : existing.name;
    if (!name || name.length > EXPENSE_CATEGORY_NAME_MAX_LENGTH) {
      throw new AppError({
        code: ERROR_CODES.EXPENSE_CATEGORY_NOT_FOUND,
        message: EXPENSE_CATEGORY_ERROR_MESSAGES.NAME_INVALID,
        statusCode: 400,
      });
    }
    const description =
      dto.description === undefined
        ? existing.description
        : assertOptionalText(
            dto.description ?? undefined,
            EXPENSE_CATEGORY_DESCRIPTION_MAX_LENGTH,
            EXPENSE_CATEGORY_ERROR_MESSAGES.NAME_INVALID,
          );

    const row = await this.database.client.$transaction(async (tx) => {
      const updated = await tx.expenseCategory.update({
        where: { id },
        data: { name, description },
      });
      await this.auditService.record(tx, {
        action: AUDIT_ACTIONS.EXPENSE_CATEGORY_UPDATED,
        entityType: AUDIT_ENTITY_TYPES.EXPENSE_CATEGORY,
        entityId: updated.id,
        before: { name: existing.name },
        after: { name: updated.name },
      });
      return updated;
    });
    return this.toView(row);
  }

  async archive(company: CompanyContext, id: string): Promise<ExpenseCategoryView> {
    const existing = await this.require(company.companyId, id);
    if (existing.status === ExpenseCategoryStatus.ARCHIVED) {
      return this.toView(existing);
    }
    return commitThenPublish(this.eventBus, async (events) => {
      const row = await this.database.client.$transaction(async (tx) => {
        const updated = await tx.expenseCategory.update({
          where: { id },
          data: {
            status: ExpenseCategoryStatus.ARCHIVED,
            archivedAt: new Date(),
          },
        });
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.EXPENSE_CATEGORY_ARCHIVED,
          entityType: AUDIT_ENTITY_TYPES.EXPENSE_CATEGORY,
          entityId: updated.id,
          before: { status: existing.status },
          after: { status: updated.status },
        });
        return updated;
      });
      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.EXPENSE_CATEGORY_ARCHIVED,
          payload: { companyId: company.companyId, categoryId: row.id, code: row.code },
        }),
      );
      return this.toView(row);
    });
  }

  /** Idempotent seed of default system categories for a company. */
  async ensureDefaultCategories(
    tx: Prisma.TransactionClient,
    companyId: string,
    actorUserId?: string | null,
  ): Promise<void> {
    for (const cat of DEFAULT_EXPENSE_CATEGORIES) {
      await tx.expenseCategory.upsert({
        where: { companyId_code: { companyId, code: cat.code } },
        create: {
          companyId,
          code: cat.code,
          name: cat.name,
          isSystem: true,
          createdById: actorUserId ?? null,
        },
        update: {},
      });
    }
  }

  private async require(companyId: string, id: string) {
    const row = await this.database.client.expenseCategory.findFirst({
      where: { id, companyId },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.EXPENSE_CATEGORY_NOT_FOUND,
        message: EXPENSE_ERROR_MESSAGES.CATEGORY_NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private normalizeCode(raw: string): string {
    const code = raw.trim().toUpperCase();
    if (!/^[A-Z0-9_]{2,40}$/.test(code) || code.length > EXPENSE_CATEGORY_CODE_MAX_LENGTH) {
      throw new AppError({
        code: ERROR_CODES.EXPENSE_CATEGORY_CODE_TAKEN,
        message: EXPENSE_CATEGORY_ERROR_MESSAGES.CODE_INVALID,
        statusCode: 400,
      });
    }
    return code;
  }

  private toView(row: {
    id: string;
    companyId: string;
    code: string;
    name: string;
    status: ExpenseCategoryStatus;
    description: string | null;
    isSystem: boolean;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): ExpenseCategoryView {
    return {
      id: row.id,
      companyId: row.companyId,
      code: row.code,
      name: row.name,
      status: row.status,
      description: row.description,
      isSystem: row.isSystem,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private requireActorUserId(): string {
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
}
