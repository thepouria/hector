import { Injectable } from '@nestjs/common';
import { CatalogLifecycleStatus, Prisma } from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
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
import { auditSnapshotsEqual } from '../audit/serializers/audit-sanitizer';
import type { CompanyContext } from '../companies/types/company.types';
import {
  CATALOG_ERROR_MESSAGES,
  CATALOG_SEARCH_MAX_LENGTH,
  CATEGORY_MAX_DEPTH,
} from './catalog.constants';
import { mapCatalogUniqueViolation } from './catalog-unique.error';
import {
  assertCategoryName,
  assertInternalCode,
  normalizeSearchQuery,
} from './catalog.normalization';
import {
  buildCategoryPath,
  buildCategoryTree,
  collectDescendantIds,
  computeDepth,
  isAncestorOrSelf,
  type CategoryTreeNode,
} from './category-tree.util';
import type { CreateCategoryDto } from './dto/create-category.dto';
import type { ListCategoriesQueryDto } from './dto/list-categories.query.dto';
import type { MoveCategoryDto } from './dto/move-category.dto';
import type { UpdateCategoryDto } from './dto/update-category.dto';
import type { CatalogOptionView, CategoryView } from './types/catalog.types';

export type CategoryDetailView = CategoryView & {
  path: string;
};

@Injectable()
export class CategoriesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    query: ListCategoriesQueryDto,
  ): Promise<{ data: (CategoryDetailView | CatalogOptionView)[]; meta: PaginationMeta }> {
    const optionsView = query.view === 'options';
    const search = normalizeSearchQuery(query.search, CATALOG_SEARCH_MAX_LENGTH);
    const where: Prisma.CategoryWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.rootOnly ? { parentId: null } : {}),
      ...(query.parentId && !query.rootOnly ? { parentId: query.parentId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const orderBy: Prisma.CategoryOrderByWithRelationInput[] =
      query.sortBy === 'sortOrder'
        ? [{ sortOrder: query.sortOrder }, { name: 'asc' }]
        : [{ [query.sortBy]: query.sortOrder }];

    const [total, rows, allForPath] = await Promise.all([
      this.database.client.category.count({ where }),
      this.database.client.category.findMany({
        where,
        orderBy,
        skip,
        take: query.pageSize,
        ...(optionsView
          ? { select: { id: true, name: true, code: true, status: true } }
          : {}),
      }),
      optionsView
        ? Promise.resolve([])
        : this.database.client.category.findMany({
            where: { companyId: company.companyId },
            select: { id: true, parentId: true, name: true },
          }),
    ]);

    return {
      data: optionsView
        ? (rows as CatalogOptionView[])
        : rows.map((row) => ({
            ...this.toView(row as Parameters<CategoriesService['toView']>[0]),
            path: buildCategoryPath(allForPath, row.id),
          })),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async tree(company: CompanyContext): Promise<CategoryTreeNode[]> {
    const rows = await this.database.client.category.findMany({
      where: { companyId: company.companyId },
      select: {
        id: true,
        parentId: true,
        name: true,
        code: true,
        status: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
        archivedAt: true,
      },
    });
    return buildCategoryTree(rows);
  }

  async get(company: CompanyContext, categoryId: string): Promise<CategoryDetailView> {
    const row = await this.requireCategory(company.companyId, categoryId);
    const all = await this.database.client.category.findMany({
      where: { companyId: company.companyId },
      select: { id: true, parentId: true, name: true },
    });
    return {
      ...this.toView(row),
      path: buildCategoryPath(all, row.id),
    };
  }

  async create(company: CompanyContext, dto: CreateCategoryDto): Promise<CategoryView> {
    const { name, normalizedName } = assertCategoryName(dto.name);
    const code = dto.code !== undefined ? assertInternalCode(dto.code, 'category') : null;
    const parentId = dto.parentId ?? null;
    const sortOrder = dto.sortOrder ?? 0;

    if (parentId) {
      await this.assertValidParent(company.companyId, parentId, null);
    }

    const all = await this.database.client.category.findMany({
      where: { companyId: company.companyId },
      select: { id: true, parentId: true },
    });
    // Depth of new node = parent depth + 1 (or 1 if root)
    const depth = parentId
      ? (computeDepth(all, parentId) ?? 0) + 1
      : 1;
    if (depth > CATEGORY_MAX_DEPTH) {
      throw new AppError({
        code: ERROR_CODES.CATEGORY_DEPTH_EXCEEDED,
        message: CATALOG_ERROR_MESSAGES.CATEGORY_DEPTH_EXCEEDED,
        statusCode: 400,
      });
    }

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const created = await this.database.client.$transaction(async (tx) => {
          const category = await tx.category.create({
            data: {
              companyId: company.companyId,
              name,
              normalizedName,
              code,
              parentId,
              sortOrder,
              status: CatalogLifecycleStatus.ACTIVE,
            },
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.CATEGORY_CREATED,
            entityType: AUDIT_ENTITY_TYPES.CATEGORY,
            entityId: category.id,
            before: null,
            after: this.snapshot(category),
          });

          return category;
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.CATALOG_CATEGORY_CREATED,
            payload: { companyId: company.companyId, categoryId: created.id },
          }),
        );

        return this.toView(created);
      } catch (error) {
        this.mapCreateUnique(error);
      }
    });
  }

  async update(
    company: CompanyContext,
    categoryId: string,
    dto: UpdateCategoryDto,
  ): Promise<CategoryView> {
    const current = await this.requireCategory(company.companyId, categoryId);
    if (dto.name === undefined && dto.code === undefined && dto.sortOrder === undefined) {
      throw AppError.validation('At least one field is required to update the category.');
    }

    const nextName =
      dto.name !== undefined
        ? assertCategoryName(dto.name)
        : { name: current.name, normalizedName: current.normalizedName };
    const nextCode =
      dto.code === undefined
        ? current.code
        : dto.code === null
          ? null
          : assertInternalCode(dto.code, 'category');
    const nextSortOrder = dto.sortOrder ?? current.sortOrder;

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          const category = await tx.category.update({
            where: { id: current.id },
            data: {
              name: nextName.name,
              normalizedName: nextName.normalizedName,
              code: nextCode,
              sortOrder: nextSortOrder,
            },
          });

          const before = this.snapshot(current);
          const after = this.snapshot(category);
          const audited = await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.CATEGORY_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.CATEGORY,
            entityId: category.id,
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
                type: DOMAIN_EVENTS.CATALOG_CATEGORY_UPDATED,
                payload: {
                  companyId: company.companyId,
                  categoryId: category.id,
                  changedFields,
                },
              }),
            );
          }

          return category;
        });

        return this.toView(updated);
      } catch (error) {
        this.mapCreateUnique(error);
      }
    });
  }

  async move(
    company: CompanyContext,
    categoryId: string,
    dto: MoveCategoryDto,
  ): Promise<CategoryView> {
    const current = await this.requireCategory(company.companyId, categoryId);
    const newParentId = dto.parentId === undefined ? null : dto.parentId;

    if (newParentId === current.id) {
      throw new AppError({
        code: ERROR_CODES.CATEGORY_CYCLE_DETECTED,
        message: CATALOG_ERROR_MESSAGES.CATEGORY_CYCLE_DETECTED,
        statusCode: 400,
      });
    }

    if (newParentId === current.parentId) {
      return this.toView(current);
    }

    if (newParentId) {
      await this.assertValidParent(company.companyId, newParentId, categoryId);
    }

    const all = await this.database.client.category.findMany({
      where: { companyId: company.companyId },
      select: { id: true, parentId: true },
    });

    if (newParentId && isAncestorOrSelf(all, newParentId, categoryId)) {
      throw new AppError({
        code: ERROR_CODES.CATEGORY_CYCLE_DETECTED,
        message: CATALOG_ERROR_MESSAGES.CATEGORY_CYCLE_DETECTED,
        statusCode: 400,
      });
    }

    const depth = computeDepth(all, categoryId, newParentId);
    if (depth === null || depth > CATEGORY_MAX_DEPTH) {
      throw new AppError({
        code: ERROR_CODES.CATEGORY_DEPTH_EXCEEDED,
        message: CATALOG_ERROR_MESSAGES.CATEGORY_DEPTH_EXCEEDED,
        statusCode: 400,
      });
    }

    // Also ensure deepest descendant under new parent stays within max depth.
    const descendants = collectDescendantIds(all, categoryId);
    let maxExtra = 0;
    for (const descId of descendants) {
      const d = computeDepth(all, descId);
      const selfDepth = computeDepth(all, categoryId) ?? 1;
      if (d !== null) {
        maxExtra = Math.max(maxExtra, d - selfDepth);
      }
    }
    if (depth + maxExtra > CATEGORY_MAX_DEPTH) {
      throw new AppError({
        code: ERROR_CODES.CATEGORY_DEPTH_EXCEEDED,
        message: CATALOG_ERROR_MESSAGES.CATEGORY_DEPTH_EXCEEDED,
        statusCode: 400,
      });
    }

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const moved = await this.database.client.$transaction(async (tx) => {
          const category = await tx.category.update({
            where: { id: current.id },
            data: { parentId: newParentId },
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.CATEGORY_MOVED,
            entityType: AUDIT_ENTITY_TYPES.CATEGORY,
            entityId: category.id,
            before: { parentId: current.parentId },
            after: { parentId: newParentId },
            metadata: {
              categoryId: category.id,
              oldParentId: current.parentId,
              newParentId,
            },
          });

          return category;
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.CATALOG_CATEGORY_MOVED,
            payload: {
              companyId: company.companyId,
              categoryId: moved.id,
              oldParentId: current.parentId,
              newParentId,
            },
          }),
        );

        return this.toView(moved);
      } catch (error) {
        this.mapCreateUnique(error);
      }
    });
  }

  async archive(company: CompanyContext, categoryId: string): Promise<CategoryView> {
    const current = await this.requireCategory(company.companyId, categoryId);
    if (current.status === CatalogLifecycleStatus.ARCHIVED) {
      return this.toView(current);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const archived = await this.database.client.$transaction(async (tx) => {
        const category = await tx.category.update({
          where: { id: current.id },
          data: {
            status: CatalogLifecycleStatus.ARCHIVED,
            archivedAt: new Date(),
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.CATEGORY_ARCHIVED,
          entityType: AUDIT_ENTITY_TYPES.CATEGORY,
          entityId: category.id,
          before: this.snapshot(current),
          after: this.snapshot(category),
        });

        return category;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.CATALOG_CATEGORY_ARCHIVED,
          payload: { companyId: company.companyId, categoryId: archived.id },
        }),
      );

      return this.toView(archived);
    });
  }

  async activate(company: CompanyContext, categoryId: string): Promise<CategoryView> {
    const current = await this.requireCategory(company.companyId, categoryId);
    if (current.status === CatalogLifecycleStatus.ACTIVE) {
      return this.toView(current);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const activated = await this.database.client.$transaction(async (tx) => {
        const category = await tx.category.update({
          where: { id: current.id },
          data: {
            status: CatalogLifecycleStatus.ACTIVE,
            archivedAt: null,
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.CATEGORY_ACTIVATED,
          entityType: AUDIT_ENTITY_TYPES.CATEGORY,
          entityId: category.id,
          before: this.snapshot(current),
          after: this.snapshot(category),
        });

        return category;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.CATALOG_CATEGORY_ACTIVATED,
          payload: { companyId: company.companyId, categoryId: activated.id },
        }),
      );

      return this.toView(activated);
    });
  }

  /** Returns descendant ids for parent-selector exclusion (UX + server). */
  async getDescendantIds(companyId: string, categoryId: string): Promise<string[]> {
    const all = await this.database.client.category.findMany({
      where: { companyId },
      select: { id: true, parentId: true },
    });
    return [...collectDescendantIds(all, categoryId)];
  }

  private async assertValidParent(
    companyId: string,
    parentId: string,
    movingCategoryId: string | null,
  ): Promise<void> {
    if (movingCategoryId && parentId === movingCategoryId) {
      throw new AppError({
        code: ERROR_CODES.CATEGORY_CYCLE_DETECTED,
        message: CATALOG_ERROR_MESSAGES.CATEGORY_CYCLE_DETECTED,
        statusCode: 400,
      });
    }

    const parent = await this.database.client.category.findFirst({
      where: { id: parentId, companyId },
      select: { id: true },
    });
    if (!parent) {
      throw new AppError({
        code: ERROR_CODES.CATEGORY_CROSS_COMPANY_PARENT,
        message: CATALOG_ERROR_MESSAGES.CATEGORY_CROSS_COMPANY_PARENT,
        statusCode: 400,
      });
    }
  }

  private mapCreateUnique(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = error.meta?.target;
      const joined = Array.isArray(target)
        ? target.join(',').toLowerCase()
        : String(target ?? '').toLowerCase();
      if (joined.includes('normalized_name') || joined.includes('root_normalized')) {
        mapCatalogUniqueViolation(error, 'category_name');
      }
      if (joined.includes('code')) {
        mapCatalogUniqueViolation(error, 'category_code');
      }
    }
    mapCatalogUniqueViolation(error, 'category_name');
  }

  private async requireCategory(companyId: string, categoryId: string) {
    const row = await this.database.client.category.findFirst({
      where: { id: categoryId, companyId },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.CATEGORY_NOT_FOUND,
        message: CATALOG_ERROR_MESSAGES.CATEGORY_NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private snapshot(category: {
    id: string;
    name: string;
    code: string | null;
    parentId: string | null;
    sortOrder: number;
    status: CatalogLifecycleStatus;
    archivedAt: Date | null;
  }) {
    return {
      id: category.id,
      name: category.name,
      code: category.code,
      parentId: category.parentId,
      sortOrder: category.sortOrder,
      status: category.status,
      archivedAt: category.archivedAt?.toISOString() ?? null,
    };
  }

  private toView(row: {
    id: string;
    companyId: string;
    name: string;
    code: string | null;
    parentId: string | null;
    sortOrder: number;
    status: CatalogLifecycleStatus;
    createdAt: Date;
    updatedAt: Date;
    archivedAt: Date | null;
  }): CategoryView {
    return {
      id: row.id,
      companyId: row.companyId,
      name: row.name,
      code: row.code,
      parentId: row.parentId,
      sortOrder: row.sortOrder,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
    };
  }
}
