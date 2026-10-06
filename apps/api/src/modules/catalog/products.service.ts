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
import { CATALOG_ERROR_MESSAGES, CATALOG_SEARCH_MAX_LENGTH } from './catalog.constants';
import { mapCatalogUniqueViolation } from './catalog-unique.error';
import {
  assertProductCode,
  assertProductName,
  normalizeDisplayName,
  normalizeSearchNameKey,
  normalizeSearchQuery,
} from './catalog.normalization';
import {
  buildProductAttributeWhereClauses,
  parseAttributeFiltersParam,
} from './attribute-filter.util';
import { buildCategoryPath, collectDescendantIds, isCategoryAssignable } from './category-tree.util';
import type { CreateProductDto } from './dto/create-product.dto';
import type { ListProductsQueryDto } from './dto/list-products.query.dto';
import type { UpdateProductDto } from './dto/update-product.dto';
import type { ProductView } from './types/catalog.types';

type ProductRow = {
  id: string;
  companyId: string;
  name: string;
  normalizedName: string;
  code: string | null;
  normalizedCode: string | null;
  description: string | null;
  brandId: string | null;
  categoryId: string | null;
  status: CatalogLifecycleStatus;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  brand?: { id: string; name: string } | null;
  category?: { id: string; name: string } | null;
};

const productInclude = {
  brand: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
} satisfies Prisma.ProductInclude;

/**
 * Product Core rules (Phase 1.3):
 * - Brand/Category new assignment requires ACTIVE (+ Category ACTIVE ancestors).
 * - Existing Product may retain archived/inactive Brand/Category references.
 * - Activation requires current Brand/Category (if set) to be assignable.
 * - categoryId filter is exact match only (not descendants).
 * - Product may exist with zero SKUs; archive does not cascade to SKUs.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    query: ListProductsQueryDto,
  ): Promise<{ data: ProductView[]; meta: PaginationMeta }> {
    const where = await this.buildListWhere(company.companyId, query);

    const skip = (query.page - 1) * query.pageSize;
    const orderBy: Prisma.ProductOrderByWithRelationInput[] = [
      { [query.sortBy]: query.sortOrder },
      { id: 'asc' },
    ];

    const [total, rows] = await this.database.client.$transaction([
      this.database.client.product.count({ where }),
      this.database.client.product.findMany({
        where,
        include: {
          ...productInclude,
          _count: { select: { skus: true } },
        },
        orderBy,
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      data: rows.map((row) => {
        const { _count, ...productRow } = row;
        return this.toView(productRow, null, _count.skus, null);
      }),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  /**
   * Shared Product where builder for list + bulk QUERY selection (Phase 1.9 filters).
   */
  async buildListWhere(
    companyId: string,
    query: {
      search?: string;
      status?: CatalogLifecycleStatus;
      brandId?: string;
      categoryId?: string;
      includeDescendants?: boolean;
      hasSku?: boolean;
      attrs?: string;
    },
  ): Promise<Prisma.ProductWhereInput> {
    const search = normalizeSearchQuery(query.search, CATALOG_SEARCH_MAX_LENGTH);
    const includeDescendants = query.includeDescendants ?? true;
    const categoryFilter = await this.resolveCategoryFilter(
      companyId,
      query.categoryId,
      includeDescendants,
    );

    const attrFilters = parseAttributeFiltersParam(query.attrs);
    const attributeClauses = await buildProductAttributeWhereClauses(
      companyId,
      attrFilters,
      async (cid, codes) => {
        const rows = await this.database.client.attributeDefinition.findMany({
          where: { companyId: cid, code: { in: codes } },
          select: { id: true, code: true, type: true },
        });
        return rows;
      },
    );

    return {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(categoryFilter ? { categoryId: categoryFilter } : {}),
      ...(query.hasSku === true ? { skus: { some: {} } } : {}),
      ...(query.hasSku === false ? { skus: { none: {} } } : {}),
      ...(search ? { OR: this.buildProductSearchOr(search) } : {}),
      ...(attributeClauses.length > 0 ? { AND: attributeClauses } : {}),
    };
  }

  private buildProductSearchOr(search: string): Prisma.ProductWhereInput[] {
    const upper = search.toUpperCase();
    const nameKey = normalizeSearchNameKey(search);
    return [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
      { normalizedName: { contains: nameKey } },
      { normalizedCode: { contains: upper } },
      { brand: { name: { contains: search, mode: 'insensitive' } } },
      { brand: { normalizedName: { contains: nameKey } } },
      { category: { name: { contains: search, mode: 'insensitive' } } },
      { category: { normalizedName: { contains: nameKey } } },
      {
        skus: {
          some: {
            OR: [
              { code: { contains: search, mode: 'insensitive' } },
              { normalizedCode: { contains: upper } },
              { name: { contains: search, mode: 'insensitive' } },
            ],
          },
        },
      },
      {
        skus: {
          some: {
            barcodes: {
              some: {
                archivedAt: null,
                OR: [
                  { value: { contains: search, mode: 'insensitive' } },
                  { normalizedValue: { equals: upper } },
                  { normalizedValue: { contains: upper } },
                ],
              },
            },
          },
        },
      },
    ];
  }

  private async resolveCategoryFilter(
    companyId: string,
    categoryId: string | undefined,
    includeDescendants: boolean | undefined,
  ): Promise<Prisma.StringFilter | string | undefined> {
    if (!categoryId) return undefined;
    if (!includeDescendants) return categoryId;

    const categories = await this.database.client.category.findMany({
      where: { companyId },
      select: { id: true, parentId: true },
    });
    const descendants = collectDescendantIds(categories, categoryId);
    const ids = [categoryId, ...descendants];
    return { in: [...ids] };
  }

  async get(company: CompanyContext, productId: string): Promise<ProductView> {
    const row = await this.requireProduct(company.companyId, productId);
    let categoryPath: string | null = null;
    if (row.categoryId) {
      const categories = await this.database.client.category.findMany({
        where: { companyId: company.companyId },
        select: { id: true, parentId: true, name: true },
      });
      categoryPath = buildCategoryPath(categories, row.categoryId);
    }
    const [skuCount, activeSkuCount] = await this.database.client.$transaction([
      this.database.client.sku.count({ where: { companyId: company.companyId, productId } }),
      this.database.client.sku.count({
        where: { companyId: company.companyId, productId, status: CatalogLifecycleStatus.ACTIVE },
      }),
    ]);
    return this.toView(row, categoryPath, skuCount, activeSkuCount);
  }

  async create(company: CompanyContext, dto: CreateProductDto): Promise<ProductView> {
    const { name, normalizedName } = assertProductName(dto.name);
    const codeFields =
      dto.code !== undefined ? assertProductCode(dto.code) : { code: null, normalizedCode: null };
    const description =
      dto.description !== undefined ? normalizeDisplayName(dto.description) || null : null;

    await this.assertBrandAssignable(company.companyId, dto.brandId ?? null, {
      allowExisting: false,
    });
    await this.assertCategoryAssignable(company.companyId, dto.categoryId ?? null, {
      allowExisting: false,
    });

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const created = await this.database.client.$transaction(async (tx) => {
          const product = await tx.product.create({
            data: {
              companyId: company.companyId,
              name,
              normalizedName,
              code: codeFields.code,
              normalizedCode: codeFields.normalizedCode,
              description,
              brandId: dto.brandId ?? null,
              categoryId: dto.categoryId ?? null,
              status: CatalogLifecycleStatus.ACTIVE,
            },
            include: productInclude,
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.PRODUCT_CREATED,
            entityType: AUDIT_ENTITY_TYPES.PRODUCT,
            entityId: product.id,
            before: null,
            after: this.snapshot(product),
          });

          return product;
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.CATALOG_PRODUCT_CREATED,
            payload: {
              companyId: company.companyId,
              productId: created.id,
            },
          }),
        );

        return this.toView(created);
      } catch (error) {
        mapCatalogUniqueViolation(error, 'product_code');
      }
    });
  }

  async update(
    company: CompanyContext,
    productId: string,
    dto: UpdateProductDto,
  ): Promise<ProductView> {
    const current = await this.requireProduct(company.companyId, productId);
    if (current.status === CatalogLifecycleStatus.ARCHIVED) {
      throw new AppError({
        code: ERROR_CODES.PRODUCT_ALREADY_ARCHIVED,
        message: CATALOG_ERROR_MESSAGES.PRODUCT_ALREADY_ARCHIVED,
        statusCode: 409,
      });
    }

    if (
      dto.name === undefined &&
      dto.code === undefined &&
      dto.description === undefined &&
      dto.brandId === undefined &&
      dto.categoryId === undefined
    ) {
      throw AppError.validation('At least one field is required to update the product.');
    }

    const nextName =
      dto.name !== undefined
        ? assertProductName(dto.name)
        : { name: current.name, normalizedName: current.normalizedName };

    const nextCode =
      dto.code === undefined
        ? { code: current.code, normalizedCode: current.normalizedCode }
        : dto.code === null
          ? { code: null, normalizedCode: null }
          : assertProductCode(dto.code);

    const nextDescription =
      dto.description === undefined
        ? current.description
        : dto.description === null
          ? null
          : normalizeDisplayName(dto.description) || null;

    const nextBrandId = dto.brandId === undefined ? current.brandId : dto.brandId;
    const nextCategoryId = dto.categoryId === undefined ? current.categoryId : dto.categoryId;

    if (nextBrandId !== current.brandId) {
      await this.assertBrandAssignable(company.companyId, nextBrandId, {
        allowExisting: false,
        previousId: current.brandId,
      });
    }
    if (nextCategoryId !== current.categoryId) {
      await this.assertCategoryAssignable(company.companyId, nextCategoryId, {
        allowExisting: false,
        previousId: current.categoryId,
      });
    }

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          const product = await tx.product.update({
            where: { id: current.id },
            data: {
              name: nextName.name,
              normalizedName: nextName.normalizedName,
              code: nextCode.code,
              normalizedCode: nextCode.normalizedCode,
              description: nextDescription,
              brandId: nextBrandId,
              categoryId: nextCategoryId,
            },
            include: productInclude,
          });

          const before = this.snapshot(current);
          const after = this.snapshot(product);
          const brandChanged = before.brand?.id !== after.brand?.id;
          const categoryChanged = before.category?.id !== after.category?.id;
          const audited = await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.PRODUCT_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.PRODUCT,
            entityId: product.id,
            before,
            after,
            metadata: {
              ...(brandChanged
                ? {
                    oldBrandId: before.brand?.id ?? null,
                    newBrandId: after.brand?.id ?? null,
                  }
                : {}),
              ...(categoryChanged
                ? {
                    oldCategoryId: before.category?.id ?? null,
                    newCategoryId: after.category?.id ?? null,
                  }
                : {}),
            },
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
                type: DOMAIN_EVENTS.CATALOG_PRODUCT_UPDATED,
                payload: {
                  companyId: company.companyId,
                  productId: product.id,
                  changedFields,
                },
              }),
            );
          }

          return product;
        });

        return this.toView(updated);
      } catch (error) {
        mapCatalogUniqueViolation(error, 'product_code');
      }
    });
  }

  async deactivate(company: CompanyContext, productId: string): Promise<ProductView> {
    const current = await this.requireProduct(company.companyId, productId);
    if (current.status === CatalogLifecycleStatus.ARCHIVED) {
      throw new AppError({
        code: ERROR_CODES.PRODUCT_ALREADY_ARCHIVED,
        message: CATALOG_ERROR_MESSAGES.PRODUCT_ALREADY_ARCHIVED,
        statusCode: 409,
      });
    }
    if (current.status === CatalogLifecycleStatus.INACTIVE) {
      return this.toView(current);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const deactivated = await this.database.client.$transaction(async (tx) => {
        const product = await tx.product.update({
          where: { id: current.id },
          data: { status: CatalogLifecycleStatus.INACTIVE },
          include: productInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PRODUCT_DEACTIVATED,
          entityType: AUDIT_ENTITY_TYPES.PRODUCT,
          entityId: product.id,
          before: this.snapshot(current),
          after: this.snapshot(product),
        });

        return product;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.CATALOG_PRODUCT_DEACTIVATED,
          payload: { companyId: company.companyId, productId: deactivated.id },
        }),
      );

      return this.toView(deactivated);
    });
  }

  async activate(company: CompanyContext, productId: string): Promise<ProductView> {
    const current = await this.requireProduct(company.companyId, productId);
    if (current.status === CatalogLifecycleStatus.ACTIVE) {
      return this.toView(current);
    }

    // Activation requires current classification dependencies to be assignable.
    await this.assertBrandAssignable(company.companyId, current.brandId, {
      allowExisting: false,
      forActivation: true,
    });
    await this.assertCategoryAssignable(company.companyId, current.categoryId, {
      allowExisting: false,
      forActivation: true,
    });

    return commitThenPublish(this.eventBus, async (events) => {
      const activated = await this.database.client.$transaction(async (tx) => {
        const product = await tx.product.update({
          where: { id: current.id },
          data: {
            status: CatalogLifecycleStatus.ACTIVE,
            archivedAt: null,
          },
          include: productInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PRODUCT_ACTIVATED,
          entityType: AUDIT_ENTITY_TYPES.PRODUCT,
          entityId: product.id,
          before: this.snapshot(current),
          after: this.snapshot(product),
        });

        return product;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.CATALOG_PRODUCT_ACTIVATED,
          payload: { companyId: company.companyId, productId: activated.id },
        }),
      );

      return this.toView(activated);
    });
  }

  async archive(company: CompanyContext, productId: string): Promise<ProductView> {
    const current = await this.requireProduct(company.companyId, productId);
    if (current.status === CatalogLifecycleStatus.ARCHIVED) {
      return this.toView(current);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const archived = await this.database.client.$transaction(async (tx) => {
        const product = await tx.product.update({
          where: { id: current.id },
          data: {
            status: CatalogLifecycleStatus.ARCHIVED,
            archivedAt: new Date(),
          },
          include: productInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PRODUCT_ARCHIVED,
          entityType: AUDIT_ENTITY_TYPES.PRODUCT,
          entityId: product.id,
          before: this.snapshot(current),
          after: this.snapshot(product),
        });

        return product;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.CATALOG_PRODUCT_ARCHIVED,
          payload: {
            companyId: company.companyId,
            productId: archived.id,
          },
        }),
      );

      return this.toView(archived);
    });
  }

  private async requireProduct(companyId: string, productId: string): Promise<ProductRow> {
    const row = await this.database.client.product.findFirst({
      where: { id: productId, companyId },
      include: productInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.PRODUCT_NOT_FOUND,
        message: CATALOG_ERROR_MESSAGES.PRODUCT_NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  /**
   * Brand assignability:
   * - Missing / foreign → PRODUCT_BRAND_NOT_FOUND (no existence leak across tenants)
   * - New assignment of INACTIVE/ARCHIVED → PRODUCT_BRAND_NOT_ASSIGNABLE
   * - Retaining existing reference (same id) is allowed without re-check when allowExisting
   * - Activation uses forActivation → PRODUCT_ACTIVATION_BLOCKED
   */
  private async assertBrandAssignable(
    companyId: string,
    brandId: string | null | undefined,
    options: {
      allowExisting: boolean;
      previousId?: string | null;
      forActivation?: boolean;
    },
  ) {
    if (!brandId) return;
    if (options.allowExisting && brandId === options.previousId) return;

    const brand = await this.database.client.brand.findFirst({
      where: { id: brandId, companyId },
      select: { id: true, status: true },
    });
    if (!brand) {
      throw new AppError({
        code: ERROR_CODES.PRODUCT_BRAND_NOT_FOUND,
        message: CATALOG_ERROR_MESSAGES.PRODUCT_BRAND_NOT_FOUND,
        statusCode: 404,
      });
    }
    if (brand.status !== CatalogLifecycleStatus.ACTIVE) {
      throw new AppError({
        code: options.forActivation
          ? ERROR_CODES.PRODUCT_ACTIVATION_BLOCKED
          : ERROR_CODES.PRODUCT_BRAND_NOT_ASSIGNABLE,
        message: options.forActivation
          ? CATALOG_ERROR_MESSAGES.PRODUCT_ACTIVATION_BLOCKED
          : CATALOG_ERROR_MESSAGES.PRODUCT_BRAND_NOT_ASSIGNABLE,
        statusCode: 409,
      });
    }
  }

  private async assertCategoryAssignable(
    companyId: string,
    categoryId: string | null | undefined,
    options: {
      allowExisting: boolean;
      previousId?: string | null;
      forActivation?: boolean;
    },
  ) {
    if (!categoryId) return;
    if (options.allowExisting && categoryId === options.previousId) return;

    const categories = await this.database.client.category.findMany({
      where: { companyId },
      select: { id: true, parentId: true, status: true },
    });
    const found = categories.find((c) => c.id === categoryId);
    if (!found) {
      throw new AppError({
        code: ERROR_CODES.PRODUCT_CATEGORY_NOT_FOUND,
        message: CATALOG_ERROR_MESSAGES.PRODUCT_CATEGORY_NOT_FOUND,
        statusCode: 404,
      });
    }
    if (!isCategoryAssignable(categories, categoryId, CatalogLifecycleStatus.ACTIVE)) {
      throw new AppError({
        code: options.forActivation
          ? ERROR_CODES.PRODUCT_ACTIVATION_BLOCKED
          : ERROR_CODES.PRODUCT_CATEGORY_NOT_ASSIGNABLE,
        message: options.forActivation
          ? CATALOG_ERROR_MESSAGES.PRODUCT_ACTIVATION_BLOCKED
          : CATALOG_ERROR_MESSAGES.PRODUCT_CATEGORY_NOT_ASSIGNABLE,
        statusCode: 409,
      });
    }
  }

  private snapshot(product: {
    id: string;
    name: string;
    code: string | null;
    description: string | null;
    brandId: string | null;
    categoryId: string | null;
    status: CatalogLifecycleStatus;
    archivedAt: Date | null;
    brand?: { id: string; name: string } | null;
    category?: { id: string; name: string } | null;
  }) {
    return {
      id: product.id,
      name: product.name,
      code: product.code,
      description: product.description,
      brand: product.brandId
        ? { id: product.brandId, label: product.brand?.name ?? null }
        : null,
      category: product.categoryId
        ? { id: product.categoryId, label: product.category?.name ?? null }
        : null,
      status: product.status,
      archivedAt: product.archivedAt?.toISOString() ?? null,
    };
  }

  private toView(
    row: ProductRow,
    categoryPath: string | null = null,
    skuCount = 0,
    activeSkuCount: number | null = null,
  ): ProductView {
    return {
      id: row.id,
      companyId: row.companyId,
      name: row.name,
      code: row.code,
      description: row.description,
      brandId: row.brandId,
      categoryId: row.categoryId,
      brand: row.brand ? { id: row.brand.id, name: row.brand.name } : null,
      category: row.category ? { id: row.category.id, name: row.category.name } : null,
      categoryPath,
      status: row.status,
      skuCount,
      activeSkuCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
    };
  }
}
