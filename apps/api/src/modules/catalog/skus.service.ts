import { Injectable } from '@nestjs/common';
import { CatalogLifecycleStatus, Prisma } from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { buildPaginationMeta, type PaginationMeta } from '../../common/dto/pagination-query.dto';
import { AppError } from '../../common/exceptions/app.error';
import { DatabaseService } from '../../infrastructure/database/database.service';
import {
  DOMAIN_EVENTS,
  DomainEventBus,
  DomainEventFactory,
  commitThenPublish,
} from '../../infrastructure/events';
import type { DomainEvent } from '../../infrastructure/events';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { auditSnapshotsEqual } from '../audit/serializers/audit-sanitizer';
import type { CompanyContext } from '../companies/types/company.types';
import {
  BULK_SKU_MAX,
  CATALOG_ERROR_MESSAGES,
  CATALOG_SEARCH_MAX_LENGTH,
} from './catalog.constants';
import { mapCatalogUniqueViolation } from './catalog-unique.error';
import { assertSkuCode, assertSkuName, normalizeSearchQuery, normalizeSearchNameKey } from './catalog.normalization';
import type { BulkCreateSkusDto } from './dto/bulk-create-skus.dto';
import type { CreateSkuDto } from './dto/create-sku.dto';
import type { ListSkusQueryDto } from './dto/list-skus.query.dto';
import type { UpdateSkuDto } from './dto/update-sku.dto';
import { lockProductRow } from './product-lock.util';
import { skuInclude, skuListBarcodeInclude, toSkuView, type SkuRow } from './sku.mapper';
import type { SkuView } from './types/catalog.types';
import { SIMPLE_VARIANT_SIGNATURE } from './variant-signature.util';
import {
  resolveVariantSelection,
  type ResolvedVariantSelection,
  type VariantOptionWithValues,
} from './variant-selection.util';

type Tx = Prisma.TransactionClient;

type PreparedSku = {
  code: string;
  normalizedCode: string;
  name: string | null;
  selection: ResolvedVariantSelection;
};

/**
 * SKU rules (Phase 1.4):
 * - SKU belongs to a company-owned Product; code is company-unique forever (archived reserved).
 * - Zero variant options → exactly one SIMPLE SKU per product.
 * - With options → exactly one value per option; (productId, variantSignature) unique forever.
 * - The signature is always built server-side from validated IDs.
 * - Creating an ACTIVE SKU requires an ACTIVE Product.
 * - SKU carries no inventory, price, barcode or marketplace data.
 */
@Injectable()
export class SkusService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    query: ListSkusQueryDto,
  ): Promise<{ data: SkuView[]; meta: PaginationMeta }> {
    const where = this.buildListWhere(company.companyId, query);
    const skip = (query.page - 1) * query.pageSize;
    const orderBy: Prisma.SkuOrderByWithRelationInput[] = [
      { [query.sortBy]: query.sortOrder },
      { id: 'asc' },
    ];

    const [total, rows] = await this.database.client.$transaction([
      this.database.client.sku.count({ where }),
      this.database.client.sku.findMany({
        where,
        include: { ...skuInclude, ...skuListBarcodeInclude },
        orderBy,
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      data: rows.map((row) => {
        const { barcodes, ...skuRow } = row;
        return toSkuView(skuRow as SkuRow, barcodes);
      }),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  /**
   * Shared SKU where builder for list + bulk QUERY selection (Phase 1.9 filters).
   */
  buildListWhere(
    companyId: string,
    query: {
      search?: string;
      status?: CatalogLifecycleStatus;
      productId?: string;
      hasBarcode?: boolean;
      variantValueId?: string;
    },
  ): Prisma.SkuWhereInput {
    const search = normalizeSearchQuery(query.search, CATALOG_SEARCH_MAX_LENGTH);
    const upper = search?.toUpperCase();
    const nameKey = search ? normalizeSearchNameKey(search) : undefined;
    return {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.variantValueId
        ? { optionValues: { some: { optionValueId: query.variantValueId } } }
        : {}),
      ...(query.hasBarcode === true
        ? { barcodes: { some: { archivedAt: null } } }
        : {}),
      ...(query.hasBarcode === false
        ? { barcodes: { none: { archivedAt: null } } }
        : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
              { normalizedCode: { contains: upper } },
              {
                product: {
                  OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { code: { contains: search, mode: 'insensitive' } },
                    { normalizedName: { contains: nameKey } },
                  ],
                },
              },
              {
                optionValues: {
                  some: {
                    optionValue: {
                      OR: [
                        { value: { contains: search, mode: 'insensitive' } },
                        { normalizedValue: { contains: nameKey } },
                      ],
                    },
                  },
                },
              },
              {
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
            ],
          }
        : {}),
    };
  }

  async listForProduct(
    company: CompanyContext,
    productId: string,
    query: ListSkusQueryDto,
  ): Promise<{ data: SkuView[]; meta: PaginationMeta }> {
    await this.requireProductExists(company.companyId, productId);
    return this.list(company, { ...query, productId });
  }

  async get(company: CompanyContext, skuId: string): Promise<SkuView> {
    const row = await this.database.client.sku.findFirst({
      where: { id: skuId, companyId: company.companyId },
      include: { ...skuInclude, ...skuListBarcodeInclude },
    });
    if (!row) throw this.skuNotFound();
    const { barcodes, ...skuRow } = row;
    return toSkuView(skuRow as SkuRow, barcodes);
  }

  async create(company: CompanyContext, productId: string, dto: CreateSkuDto): Promise<SkuView> {
    const code = assertSkuCode(dto.code);
    const name = assertSkuName(dto.name);

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const created = await this.database.client.$transaction(async (tx) => {
          await this.lockAndRequireActiveProduct(tx, company.companyId, productId);
          const options = await this.loadOptions(tx, company.companyId, productId);
          const selection = resolveVariantSelection(options, dto.optionValueIds);
          const prepared: PreparedSku = {
            code: code.code,
            normalizedCode: code.normalizedCode,
            name,
            selection,
          };
          await this.assertNoConflicts(tx, company.companyId, productId, [prepared]);
          return this.insertSku(tx, company.companyId, productId, prepared, events, false);
        });
        return toSkuView(created);
      } catch (error) {
        this.mapSkuUnique(error);
      }
    });
  }

  async bulkCreate(
    company: CompanyContext,
    productId: string,
    dto: BulkCreateSkusDto,
  ): Promise<{ data: SkuView[]; meta: { created: number } }> {
    if (dto.items.length > BULK_SKU_MAX) {
      throw new AppError({
        code: ERROR_CODES.BULK_SKU_LIMIT_EXCEEDED,
        message: CATALOG_ERROR_MESSAGES.BULK_SKU_LIMIT_EXCEEDED,
        statusCode: 400,
        details: { max: BULK_SKU_MAX },
      });
    }

    // Normalise + validate every item up-front (no DB writes yet).
    const normalized = dto.items.map((item, index) => {
      try {
        const code = assertSkuCode(item.code);
        return { index, code, name: assertSkuName(item.name), optionValueIds: item.optionValueIds };
      } catch (error) {
        if (error instanceof AppError) {
          throw new AppError({
            code: error.code,
            message: error.message,
            statusCode: error.statusCode,
            details: { index },
          });
        }
        throw error;
      }
    });

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const created = await this.database.client.$transaction(
          async (tx) => {
            await this.lockAndRequireActiveProduct(tx, company.companyId, productId);
            const options = await this.loadOptions(tx, company.companyId, productId);

            const prepared: PreparedSku[] = normalized.map((item) => {
              try {
                return {
                  code: item.code.code,
                  normalizedCode: item.code.normalizedCode,
                  name: item.name,
                  selection: resolveVariantSelection(options, item.optionValueIds),
                };
              } catch (error) {
                if (error instanceof AppError) {
                  throw new AppError({
                    code: error.code,
                    message: error.message,
                    statusCode: error.statusCode,
                    details: { index: item.index },
                  });
                }
                throw error;
              }
            });

            await this.assertNoConflicts(tx, company.companyId, productId, prepared);

            const rows: SkuRow[] = [];
            for (const item of prepared) {
              rows.push(
                await this.insertSku(tx, company.companyId, productId, item, events, true),
              );
            }
            return rows;
          },
          { timeout: 60_000, maxWait: 10_000 },
        );
        return {
          data: created.map((row) => toSkuView(row)),
          meta: { created: created.length },
        };
      } catch (error) {
        this.mapSkuUnique(error);
      }
    });
  }

  async update(company: CompanyContext, skuId: string, dto: UpdateSkuDto): Promise<SkuView> {
    if (dto.code === undefined && dto.name === undefined && dto.optionValueIds === undefined) {
      throw AppError.validation('At least one field is required to update the SKU.');
    }

    const nextCode = dto.code !== undefined ? assertSkuCode(dto.code) : null;

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          const current = await this.loadSkuLocked(tx, company.companyId, skuId);
          if (current.status === CatalogLifecycleStatus.ARCHIVED) {
            throw new AppError({
              code: ERROR_CODES.CATALOG_ITEM_ARCHIVED,
              message: CATALOG_ERROR_MESSAGES.CATALOG_ITEM_ARCHIVED,
              statusCode: 409,
            });
          }

          const before = this.snapshot(current);

          const code = nextCode?.code ?? current.code;
          const normalizedCode = nextCode?.normalizedCode ?? current.normalizedCode;
          const name =
            dto.name === undefined
              ? current.name
              : dto.name === null
                ? null
                : assertSkuName(dto.name);

          let signature = current.variantSignature;
          let nextOptionValueIds = current.optionValues.map((l) => l.optionValue.id).sort();
          let selection: ResolvedVariantSelection | null = null;

          if (dto.optionValueIds !== undefined) {
            const options = await this.loadOptions(tx, company.companyId, current.productId);
            selection = resolveVariantSelection(
              options,
              dto.optionValueIds,
              new Set(nextOptionValueIds),
            );
            signature = selection.signature;
            nextOptionValueIds = selection.optionValueIds;
          }

          if (normalizedCode !== current.normalizedCode) {
            const clash = await tx.sku.findFirst({
              where: { companyId: company.companyId, normalizedCode, id: { not: current.id } },
              select: { id: true },
            });
            if (clash) {
              throw new AppError({
                code: ERROR_CODES.SKU_CODE_ALREADY_EXISTS,
                message: CATALOG_ERROR_MESSAGES.SKU_CODE_ALREADY_EXISTS,
                statusCode: 409,
              });
            }
          }

          const signatureChanged = signature !== current.variantSignature;
          if (signatureChanged) {
            const clash = await tx.sku.findFirst({
              where: {
                productId: current.productId,
                variantSignature: signature,
                id: { not: current.id },
              },
              select: { id: true },
            });
            if (clash) throw this.signatureConflict(signature);
          }

          await tx.sku.update({
            where: { id: current.id },
            data: { code, normalizedCode, name, variantSignature: signature },
          });

          if (selection && signatureChanged) {
            await tx.skuOptionValue.deleteMany({
              where: { skuId: current.id, companyId: company.companyId },
            });
            if (selection.pairs.length > 0) {
              await tx.skuOptionValue.createMany({
                data: selection.pairs.map((pair) => ({
                  companyId: company.companyId,
                  skuId: current.id,
                  optionId: pair.optionId,
                  optionValueId: pair.optionValueId,
                })),
              });
            }
          }

          const row = await tx.sku.findFirstOrThrow({
            where: { id: current.id, companyId: company.companyId },
            include: skuInclude,
          });
          const after = this.snapshot(row);

          const audited = await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.SKU_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.SKU,
            entityId: row.id,
            before,
            after,
            metadata: {
              productId: row.productId,
              ...(before.code !== after.code ? { oldCode: before.code, newCode: after.code } : {}),
              ...(signatureChanged
                ? {
                    oldOptionValueIds: before.optionValueIds,
                    newOptionValueIds: after.optionValueIds,
                  }
                : {}),
            },
          });

          if (audited) {
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.CATALOG_SKU_UPDATED,
                payload: {
                  companyId: company.companyId,
                  productId: row.productId,
                  skuId: row.id,
                  changedFields: this.changedFields(before, after),
                },
              }),
            );
          }

          return row;
        });

        return toSkuView(updated);
      } catch (error) {
        this.mapSkuUnique(error);
      }
    });
  }

  async deactivate(company: CompanyContext, skuId: string): Promise<SkuView> {
    return commitThenPublish(this.eventBus, async (events) => {
      const result = await this.database.client.$transaction(async (tx) => {
        const current = await this.loadSkuLocked(tx, company.companyId, skuId);
        if (current.status === CatalogLifecycleStatus.ARCHIVED) throw this.alreadyArchived();
        if (current.status === CatalogLifecycleStatus.INACTIVE) return current;

        await tx.sku.update({
          where: { id: current.id },
          data: { status: CatalogLifecycleStatus.INACTIVE },
        });
        const row = await tx.sku.findFirstOrThrow({
          where: { id: current.id, companyId: company.companyId },
          include: skuInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SKU_DEACTIVATED,
          entityType: AUDIT_ENTITY_TYPES.SKU,
          entityId: row.id,
          before: this.snapshot(current),
          after: this.snapshot(row),
          metadata: { productId: row.productId },
        });
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.CATALOG_SKU_DEACTIVATED,
            payload: { companyId: company.companyId, productId: row.productId, skuId: row.id },
          }),
        );
        return row;
      });
      return toSkuView(result);
    });
  }

  async activate(company: CompanyContext, skuId: string): Promise<SkuView> {
    return commitThenPublish(this.eventBus, async (events) => {
      const result = await this.database.client.$transaction(async (tx) => {
        const current = await this.loadSkuLocked(tx, company.companyId, skuId);
        if (current.status === CatalogLifecycleStatus.ARCHIVED) throw this.alreadyArchived();
        if (current.status === CatalogLifecycleStatus.ACTIVE) return current;

        // Activation requires an ACTIVE product and a still-valid, complete, active selection.
        if (current.product.status !== CatalogLifecycleStatus.ACTIVE) {
          throw this.activationBlocked();
        }
        const options = await this.loadOptions(tx, company.companyId, current.productId);
        try {
          const selection = resolveVariantSelection(
            options,
            current.optionValues.map((link) => link.optionValue.id),
          );
          if (selection.signature !== current.variantSignature) {
            throw this.activationBlocked();
          }
        } catch (error) {
          if (error instanceof AppError && error.code === ERROR_CODES.SKU_ACTIVATION_BLOCKED) {
            throw error;
          }
          throw this.activationBlocked();
        }

        await tx.sku.update({
          where: { id: current.id },
          data: { status: CatalogLifecycleStatus.ACTIVE },
        });
        const row = await tx.sku.findFirstOrThrow({
          where: { id: current.id, companyId: company.companyId },
          include: skuInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SKU_ACTIVATED,
          entityType: AUDIT_ENTITY_TYPES.SKU,
          entityId: row.id,
          before: this.snapshot(current),
          after: this.snapshot(row),
          metadata: { productId: row.productId },
        });
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.CATALOG_SKU_ACTIVATED,
            payload: { companyId: company.companyId, productId: row.productId, skuId: row.id },
          }),
        );
        return row;
      });
      return toSkuView(result);
    });
  }

  async archive(company: CompanyContext, skuId: string): Promise<SkuView> {
    return commitThenPublish(this.eventBus, async (events) => {
      const result = await this.database.client.$transaction(async (tx) => {
        const current = await this.loadSkuLocked(tx, company.companyId, skuId);
        if (current.status === CatalogLifecycleStatus.ARCHIVED) return current;

        // Code + variant signature stay reserved: the row is never deleted.
        await tx.sku.update({
          where: { id: current.id },
          data: { status: CatalogLifecycleStatus.ARCHIVED, archivedAt: new Date() },
        });
        const row = await tx.sku.findFirstOrThrow({
          where: { id: current.id, companyId: company.companyId },
          include: skuInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SKU_ARCHIVED,
          entityType: AUDIT_ENTITY_TYPES.SKU,
          entityId: row.id,
          before: this.snapshot(current),
          after: this.snapshot(row),
          metadata: { productId: row.productId },
        });
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.CATALOG_SKU_ARCHIVED,
            payload: { companyId: company.companyId, productId: row.productId, skuId: row.id },
          }),
        );
        return row;
      });
      return toSkuView(result);
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async insertSku(
    tx: Tx,
    companyId: string,
    productId: string,
    item: PreparedSku,
    events: DomainEvent[],
    bulk: boolean,
  ): Promise<SkuRow> {
    const sku = await tx.sku.create({
      data: {
        companyId,
        productId,
        code: item.code,
        normalizedCode: item.normalizedCode,
        name: item.name,
        variantSignature: item.selection.signature,
        status: CatalogLifecycleStatus.ACTIVE,
      },
      select: { id: true },
    });

    if (item.selection.pairs.length > 0) {
      await tx.skuOptionValue.createMany({
        data: item.selection.pairs.map((pair) => ({
          companyId,
          skuId: sku.id,
          optionId: pair.optionId,
          optionValueId: pair.optionValueId,
        })),
      });
    }

    const row = await tx.sku.findFirstOrThrow({
      where: { id: sku.id, companyId },
      include: skuInclude,
    });

    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.SKU_CREATED,
      entityType: AUDIT_ENTITY_TYPES.SKU,
      entityId: row.id,
      before: null,
      after: this.snapshot(row),
      metadata: { productId, ...(bulk ? { bulk: true } : {}) },
    });

    events.push(
      this.eventFactory.create({
        type: DOMAIN_EVENTS.CATALOG_SKU_CREATED,
        payload: { companyId, productId, skuId: row.id },
      }),
    );

    return row;
  }

  /** Validates the whole batch (in-request duplicates, then DB conflicts) before any insert. */
  private async assertNoConflicts(
    tx: Tx,
    companyId: string,
    productId: string,
    items: PreparedSku[],
  ): Promise<void> {
    const seenCodes = new Set<string>();
    const seenSignatures = new Set<string>();
    items.forEach((item, index) => {
      const isSimple = item.selection.signature === SIMPLE_VARIANT_SIGNATURE;
      if (seenCodes.has(item.normalizedCode)) {
        throw new AppError({
          code: ERROR_CODES.BULK_SKU_DUPLICATE_IN_REQUEST,
          message: CATALOG_ERROR_MESSAGES.BULK_SKU_DUPLICATE_IN_REQUEST,
          statusCode: 400,
          details: { index, code: item.normalizedCode },
        });
      }
      if (seenSignatures.has(item.selection.signature)) {
        if (isSimple) throw this.signatureConflict(item.selection.signature);
        throw new AppError({
          code: ERROR_CODES.BULK_SKU_DUPLICATE_IN_REQUEST,
          message: CATALOG_ERROR_MESSAGES.BULK_SKU_DUPLICATE_IN_REQUEST,
          statusCode: 400,
          details: { index, code: item.normalizedCode },
        });
      }
      seenCodes.add(item.normalizedCode);
      seenSignatures.add(item.selection.signature);
    });

    const codeClash = await tx.sku.findFirst({
      where: { companyId, normalizedCode: { in: [...seenCodes] } },
      select: { normalizedCode: true },
    });
    if (codeClash) {
      throw new AppError({
        code: ERROR_CODES.SKU_CODE_ALREADY_EXISTS,
        message: CATALOG_ERROR_MESSAGES.SKU_CODE_ALREADY_EXISTS,
        statusCode: 409,
        details: { code: codeClash.normalizedCode },
      });
    }

    const signatureClash = await tx.sku.findFirst({
      where: { productId, companyId, variantSignature: { in: [...seenSignatures] } },
      select: { variantSignature: true },
    });
    if (signatureClash) throw this.signatureConflict(signatureClash.variantSignature);
  }

  private signatureConflict(signature: string): AppError {
    if (signature === SIMPLE_VARIANT_SIGNATURE) {
      return new AppError({
        code: ERROR_CODES.SKU_SIMPLE_LIMIT,
        message: CATALOG_ERROR_MESSAGES.SKU_SIMPLE_LIMIT,
        statusCode: 409,
      });
    }
    return new AppError({
      code: ERROR_CODES.SKU_VARIANT_ALREADY_EXISTS,
      message: CATALOG_ERROR_MESSAGES.SKU_VARIANT_ALREADY_EXISTS,
      statusCode: 409,
    });
  }

  private async loadOptions(
    tx: Tx,
    companyId: string,
    productId: string,
  ): Promise<VariantOptionWithValues[]> {
    return tx.variantOption.findMany({
      where: { companyId, productId },
      select: {
        id: true,
        name: true,
        values: { select: { id: true, value: true, isActive: true } },
      },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
  }

  /** Locks the product row (serialises SKU/variant mutations) and requires ACTIVE status. */
  private async lockAndRequireActiveProduct(
    tx: Tx,
    companyId: string,
    productId: string,
  ): Promise<void> {
    await lockProductRow(tx, productId, companyId);
    const product = await tx.product.findFirst({
      where: { id: productId, companyId },
      select: { id: true, status: true },
    });
    if (!product) {
      throw new AppError({
        code: ERROR_CODES.PRODUCT_NOT_FOUND,
        message: CATALOG_ERROR_MESSAGES.PRODUCT_NOT_FOUND,
        statusCode: 404,
      });
    }
    if (product.status !== CatalogLifecycleStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.PRODUCT_NOT_ACTIVE,
        message: CATALOG_ERROR_MESSAGES.PRODUCT_NOT_ACTIVE,
        statusCode: 409,
      });
    }
  }

  private async requireProductExists(companyId: string, productId: string): Promise<void> {
    const product = await this.database.client.product.findFirst({
      where: { id: productId, companyId },
      select: { id: true },
    });
    if (!product) {
      throw new AppError({
        code: ERROR_CODES.PRODUCT_NOT_FOUND,
        message: CATALOG_ERROR_MESSAGES.PRODUCT_NOT_FOUND,
        statusCode: 404,
      });
    }
  }

  /** Loads a company-scoped SKU after locking its product row. */
  private async loadSkuLocked(tx: Tx, companyId: string, skuId: string): Promise<SkuRow> {
    const head = await tx.sku.findFirst({
      where: { id: skuId, companyId },
      select: { productId: true },
    });
    if (!head) throw this.skuNotFound();
    await lockProductRow(tx, head.productId, companyId);
    const row = await tx.sku.findFirst({
      where: { id: skuId, companyId },
      include: skuInclude,
    });
    if (!row) throw this.skuNotFound();
    return row;
  }

  private skuNotFound(): AppError {
    return new AppError({
      code: ERROR_CODES.SKU_NOT_FOUND,
      message: CATALOG_ERROR_MESSAGES.SKU_NOT_FOUND,
      statusCode: 404,
    });
  }

  private alreadyArchived(): AppError {
    return new AppError({
      code: ERROR_CODES.SKU_ALREADY_ARCHIVED,
      message: CATALOG_ERROR_MESSAGES.SKU_ALREADY_ARCHIVED,
      statusCode: 409,
    });
  }

  private activationBlocked(): AppError {
    return new AppError({
      code: ERROR_CODES.SKU_ACTIVATION_BLOCKED,
      message: CATALOG_ERROR_MESSAGES.SKU_ACTIVATION_BLOCKED,
      statusCode: 409,
    });
  }

  /** Distinguishes code vs variant-signature unique violations (final authority under races). */
  private mapSkuUnique(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const meta = JSON.stringify(error.meta ?? {}).toLowerCase();
      if (meta.includes('variant_signature') || meta.includes('variantsignature')) {
        // SIMPLE vs combination cannot be told apart from meta; treat as variant conflict unless
        // the message names SIMPLE-only products (rare race). Prefer the specific variant error.
        mapCatalogUniqueViolation(error, 'sku_variant');
      }
      mapCatalogUniqueViolation(error, 'sku_code');
    }
    throw error;
  }

  private snapshot(sku: SkuRow) {
    return {
      id: sku.id,
      productId: sku.productId,
      code: sku.code,
      normalizedCode: sku.normalizedCode,
      name: sku.name,
      variantSignature: sku.variantSignature,
      optionValueIds: sku.optionValues.map((link) => link.optionValue.id).sort(),
      status: sku.status,
      archivedAt: sku.archivedAt?.toISOString() ?? null,
    };
  }

  private changedFields(
    before: ReturnType<SkusService['snapshot']>,
    after: ReturnType<SkusService['snapshot']>,
  ): string[] {
    return Object.keys(before).filter(
      (key) =>
        !auditSnapshotsEqual(
          (before as Record<string, unknown>)[key],
          (after as Record<string, unknown>)[key],
        ),
    );
  }
}
