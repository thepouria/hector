import { Injectable } from '@nestjs/common';
import {
  BulkOperationStatus,
  CatalogLifecycleStatus,
  Prisma,
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
import {
  BULK_FAILURE_DETAILS_MAX,
  BULK_OPERATIONS,
  BULK_PREVIEW_SAMPLE_MAX,
  BULK_QUERY_RESOLVE_MAX,
  CATALOG_ERROR_MESSAGES,
  type BulkOperationType,
} from './catalog.constants';
import { runWithCatalogBulkContext } from './catalog-mutation.context';
import {
  assertBulkSelectionValid,
  isProductBulkOperation,
  isSkuBulkOperation,
  type BulkProductQueryFilters,
  type BulkSkuQueryFilters,
} from './catalog-bulk.selection';
import type { BulkCommandDto } from './dto/bulk-operation.dto';
import type { PutEntityAttributeItemDto } from './dto/put-entity-attributes.dto';
import { EntityAttributesService } from './entity-attributes.service';
import { ProductsService } from './products.service';
import { SkusService } from './skus.service';

type BulkFailure = { id: string; code: string; message: string };
type EntityOutcome = 'succeeded' | 'failed' | 'skipped';

type BulkExecuteResult = {
  operationId: string;
  matched: number;
  succeeded: number;
  failed: number;
  skipped: number;
  failures: BulkFailure[];
};

type BulkPreviewResult = {
  matched: number;
  eligible: number;
  ineligible: number;
  warnings: string[];
  sample: Array<{ id: string; label: string; eligible: boolean; reason?: string }>;
};

type BulkOperationView = {
  id: string;
  type: string;
  status: BulkOperationStatus;
  selectionMode: string;
  matchedCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  selectionSummary: unknown;
  payloadSummary: unknown;
  resultSummary: unknown;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
};

/**
 * Catalog bulk commands (Phase 1.10).
 *
 * Atomicity: BEST_EFFORT per entity — each mutation reuses existing domain services
 * (own transaction + audit + events). Sync only; no queue. Cap QUERY at BULK_QUERY_RESOLVE_MAX.
 */
@Injectable()
export class CatalogBulkService {
  constructor(
    private readonly database: DatabaseService,
    private readonly productsService: ProductsService,
    private readonly skusService: SkusService,
    private readonly entityAttributesService: EntityAttributesService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async preview(company: CompanyContext, dto: BulkCommandDto): Promise<BulkPreviewResult> {
    this.assertKnownOperation(dto.operation);
    this.assertPayload(dto);
    const resolved = await this.resolveSelection(company, dto);
    const classified = await this.classifyEligibility(company, dto.operation, resolved.ids, dto);

    return {
      matched: resolved.ids.length,
      eligible: classified.eligible.length,
      ineligible: classified.ineligible.length,
      warnings: classified.warnings,
      sample: classified.sample,
    };
  }

  async execute(company: CompanyContext, dto: BulkCommandDto): Promise<BulkExecuteResult> {
    this.assertKnownOperation(dto.operation);
    this.assertPayload(dto);
    const resolved = await this.resolveSelection(company, dto);
    const actorUserId = getRequestContext()?.userId ?? null;

    const operation = await this.database.client.bulkOperation.create({
      data: {
        companyId: company.companyId,
        actorUserId,
        type: dto.operation,
        status: BulkOperationStatus.RUNNING,
        selectionMode: dto.selection.mode,
        selectionSummary: {
          mode: dto.selection.mode,
          idCount: dto.selection.mode === 'IDS' ? resolved.ids.length : undefined,
          excludedCount: dto.selection.excludedIds?.length ?? 0,
          selectAll: dto.selection.selectAll === true,
          query: dto.selection.mode === 'QUERY' ? dto.selection.query ?? {} : undefined,
        } as Prisma.InputJsonValue,
        payloadSummary: this.sanitizePayloadSummary(dto) as Prisma.InputJsonValue,
        matchedCount: resolved.ids.length,
        startedAt: new Date(),
      },
    });

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    const failures: BulkFailure[] = [];

    await runWithCatalogBulkContext(operation.id, async () => {
      for (const id of resolved.ids) {
        try {
          const outcome = await this.applyOne(company, dto, id);
          if (outcome === 'succeeded') succeeded += 1;
          else skipped += 1;
        } catch (error) {
          failed += 1;
          if (failures.length < BULK_FAILURE_DETAILS_MAX) {
            failures.push(this.toFailure(id, error));
          }
        }
      }
    });

    const status =
      failed === 0 && succeeded + skipped === resolved.ids.length
        ? BulkOperationStatus.COMPLETED
        : failed > 0 && succeeded === 0 && skipped === 0
          ? BulkOperationStatus.FAILED
          : failed > 0
            ? BulkOperationStatus.PARTIALLY_COMPLETED
            : BulkOperationStatus.COMPLETED;

    const resultSummary = {
      failures,
      truncatedFailures: failed > failures.length,
    };

    await commitThenPublish(this.eventBus, async (events) => {
      await this.database.client.$transaction(async (tx) => {
        await tx.bulkOperation.update({
          where: { id: operation.id },
          data: {
            status,
            successCount: succeeded,
            failureCount: failed,
            skippedCount: skipped,
            resultSummary: resultSummary as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.CATALOG_BULK_EXECUTED,
          entityType: AUDIT_ENTITY_TYPES.BULK_OPERATION,
          entityId: operation.id,
          before: null,
          after: {
            type: dto.operation,
            status,
            matched: resolved.ids.length,
            succeeded,
            failed,
            skipped,
          },
          metadata: {
            bulkOperationId: operation.id,
            selectionMode: dto.selection.mode,
          },
        });
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.CATALOG_BULK_OPERATION_COMPLETED,
          payload: {
            companyId: company.companyId,
            operationId: operation.id,
            type: dto.operation,
            matched: resolved.ids.length,
            succeeded,
            failed,
            skipped,
          },
        }),
      );
    });

    return {
      operationId: operation.id,
      matched: resolved.ids.length,
      succeeded,
      failed,
      skipped,
      failures,
    };
  }

  async get(company: CompanyContext, operationId: string): Promise<BulkOperationView> {
    const row = await this.database.client.bulkOperation.findFirst({
      where: { id: operationId, companyId: company.companyId },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.BULK_OPERATION_NOT_FOUND,
        message: CATALOG_ERROR_MESSAGES.BULK_OPERATION_NOT_FOUND,
        statusCode: 404,
      });
    }
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      selectionMode: row.selectionMode,
      matchedCount: row.matchedCount,
      successCount: row.successCount,
      failureCount: row.failureCount,
      skippedCount: row.skippedCount,
      selectionSummary: row.selectionSummary,
      payloadSummary: row.payloadSummary,
      resultSummary: row.resultSummary,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
    };
  }

  private assertKnownOperation(operation: string): asserts operation is BulkOperationType {
    if (!Object.values(BULK_OPERATIONS).includes(operation as BulkOperationType)) {
      throw new AppError({
        code: ERROR_CODES.BULK_INVALID_OPERATION,
        message: CATALOG_ERROR_MESSAGES.BULK_INVALID_OPERATION,
        statusCode: 400,
      });
    }
  }

  private assertPayload(dto: BulkCommandDto): void {
    const op = dto.operation;
    const payload = dto.payload ?? {};

    if (op === BULK_OPERATIONS.PRODUCT_CHANGE_BRAND) {
      if (!('brandId' in payload)) {
        throw this.invalidPayload('brandId is required (use null to clear).');
      }
      return;
    }
    if (op === BULK_OPERATIONS.PRODUCT_CHANGE_CATEGORY) {
      if (!('categoryId' in payload)) {
        throw this.invalidPayload('categoryId is required (use null to clear).');
      }
      return;
    }
    if (
      op === BULK_OPERATIONS.PRODUCT_ATTRIBUTE_SET ||
      op === BULK_OPERATIONS.SKU_ATTRIBUTE_SET
    ) {
      if (typeof payload.attributeId !== 'string') {
        throw this.invalidPayload('attributeId is required for attribute set.');
      }
      return;
    }
    if (
      op === BULK_OPERATIONS.PRODUCT_ATTRIBUTE_REMOVE ||
      op === BULK_OPERATIONS.SKU_ATTRIBUTE_REMOVE
    ) {
      if (typeof payload.attributeId !== 'string') {
        throw this.invalidPayload('attributeId is required for attribute remove.');
      }
      return;
    }
  }

  private invalidPayload(message: string): AppError {
    return new AppError({
      code: ERROR_CODES.BULK_INVALID_PAYLOAD,
      message: `${CATALOG_ERROR_MESSAGES.BULK_INVALID_PAYLOAD} ${message}`,
      statusCode: 400,
    });
  }

  private sanitizePayloadSummary(dto: BulkCommandDto): Record<string, unknown> {
    const payload = dto.payload ?? {};
    if (
      dto.operation === BULK_OPERATIONS.PRODUCT_CHANGE_BRAND ||
      dto.operation === BULK_OPERATIONS.PRODUCT_CHANGE_CATEGORY
    ) {
      return { ...payload };
    }
    if (
      dto.operation === BULK_OPERATIONS.PRODUCT_ATTRIBUTE_SET ||
      dto.operation === BULK_OPERATIONS.SKU_ATTRIBUTE_SET ||
      dto.operation === BULK_OPERATIONS.PRODUCT_ATTRIBUTE_REMOVE ||
      dto.operation === BULK_OPERATIONS.SKU_ATTRIBUTE_REMOVE
    ) {
      return {
        attributeId: payload.attributeId,
        hasText: payload.textValue != null,
        hasNumber: payload.numberValue != null,
        hasBoolean: payload.booleanValue != null,
        optionCount: Array.isArray(payload.optionIds) ? payload.optionIds.length : 0,
      };
    }
    return {};
  }

  private async resolveSelection(
    company: CompanyContext,
    dto: BulkCommandDto,
  ): Promise<{ ids: string[] }> {
    const entity = isProductBulkOperation(dto.operation) ? 'PRODUCT' : 'SKU';
    if (!isProductBulkOperation(dto.operation) && !isSkuBulkOperation(dto.operation)) {
      throw new AppError({
        code: ERROR_CODES.BULK_INVALID_OPERATION,
        message: CATALOG_ERROR_MESSAGES.BULK_INVALID_OPERATION,
        statusCode: 400,
      });
    }

    const { ids: explicitIds, excludedIds } = assertBulkSelectionValid(
      dto.selection,
      entity,
    );

    if (dto.selection.mode === 'IDS') {
      const rows =
        entity === 'PRODUCT'
          ? await this.database.client.product.findMany({
              where: { companyId: company.companyId, id: { in: explicitIds } },
              select: { id: true },
            })
          : await this.database.client.sku.findMany({
              where: { companyId: company.companyId, id: { in: explicitIds } },
              select: { id: true },
            });
      // Preserve request order for matched company-scoped ids; foreign ids are dropped.
      const found = new Set(rows.map((r) => r.id));
      const ordered = explicitIds.filter((id) => found.has(id));
      if (ordered.length === 0) {
        throw new AppError({
          code: ERROR_CODES.BULK_EMPTY_SELECTION,
          message: CATALOG_ERROR_MESSAGES.BULK_EMPTY_SELECTION,
          statusCode: 400,
        });
      }
      return { ids: ordered };
    }

    const excluded = new Set(excludedIds);
    let where: Prisma.ProductWhereInput | Prisma.SkuWhereInput;
    if (entity === 'PRODUCT') {
      where = await this.productsService.buildListWhere(
        company.companyId,
        (dto.selection.query ?? {}) as BulkProductQueryFilters,
      );
      if (excluded.size > 0) {
        where = { AND: [where, { id: { notIn: [...excluded] } }] };
      }
      const count = await this.database.client.product.count({ where });
      if (count > BULK_QUERY_RESOLVE_MAX) {
        throw new AppError({
          code: ERROR_CODES.BULK_QUERY_LIMIT_EXCEEDED,
          message: CATALOG_ERROR_MESSAGES.BULK_QUERY_LIMIT_EXCEEDED,
          statusCode: 400,
          details: { max: BULK_QUERY_RESOLVE_MAX, matched: count },
        });
      }
      if (count === 0) {
        throw new AppError({
          code: ERROR_CODES.BULK_EMPTY_SELECTION,
          message: CATALOG_ERROR_MESSAGES.BULK_EMPTY_SELECTION,
          statusCode: 400,
        });
      }
      const rows = await this.database.client.product.findMany({
        where,
        select: { id: true },
        orderBy: { id: 'asc' },
        take: BULK_QUERY_RESOLVE_MAX,
      });
      return { ids: rows.map((r) => r.id) };
    }

    where = this.skusService.buildListWhere(
      company.companyId,
      (dto.selection.query ?? {}) as BulkSkuQueryFilters,
    );
    if (excluded.size > 0) {
      where = { AND: [where, { id: { notIn: [...excluded] } }] };
    }
    const count = await this.database.client.sku.count({ where });
    if (count > BULK_QUERY_RESOLVE_MAX) {
      throw new AppError({
        code: ERROR_CODES.BULK_QUERY_LIMIT_EXCEEDED,
        message: CATALOG_ERROR_MESSAGES.BULK_QUERY_LIMIT_EXCEEDED,
        statusCode: 400,
        details: { max: BULK_QUERY_RESOLVE_MAX, matched: count },
      });
    }
    if (count === 0) {
      throw new AppError({
        code: ERROR_CODES.BULK_EMPTY_SELECTION,
        message: CATALOG_ERROR_MESSAGES.BULK_EMPTY_SELECTION,
        statusCode: 400,
      });
    }
    const rows = await this.database.client.sku.findMany({
      where,
      select: { id: true },
      orderBy: { id: 'asc' },
      take: BULK_QUERY_RESOLVE_MAX,
    });
    return { ids: rows.map((r) => r.id) };
  }

  private async classifyEligibility(
    company: CompanyContext,
    operation: BulkOperationType,
    ids: string[],
    dto: BulkCommandDto,
  ) {
    const warnings: string[] = [];
    const eligible: string[] = [];
    const ineligible: Array<{ id: string; reason: string }> = [];
    const sample: Array<{ id: string; label: string; eligible: boolean; reason?: string }> = [];

    if (isProductBulkOperation(operation)) {
      const products = await this.database.client.product.findMany({
        where: { companyId: company.companyId, id: { in: ids } },
        select: { id: true, name: true, code: true, status: true },
      });
      const byId = new Map(products.map((p) => [p.id, p]));
      for (const id of ids) {
        const product = byId.get(id);
        if (!product) continue;
        const label = product.code ? `${product.name} (${product.code})` : product.name;
        let reason: string | undefined;
        if (
          (operation === BULK_OPERATIONS.PRODUCT_CHANGE_BRAND ||
            operation === BULK_OPERATIONS.PRODUCT_CHANGE_CATEGORY ||
            operation === BULK_OPERATIONS.PRODUCT_ATTRIBUTE_SET ||
            operation === BULK_OPERATIONS.PRODUCT_ATTRIBUTE_REMOVE) &&
          product.status === CatalogLifecycleStatus.ARCHIVED
        ) {
          reason = 'PRODUCT_ALREADY_ARCHIVED';
        }
        if (operation === BULK_OPERATIONS.PRODUCT_DEACTIVATE) {
          if (product.status === CatalogLifecycleStatus.ARCHIVED) reason = 'PRODUCT_ALREADY_ARCHIVED';
          else if (product.status === CatalogLifecycleStatus.INACTIVE) reason = 'ALREADY_INACTIVE';
        }
        if (operation === BULK_OPERATIONS.PRODUCT_ACTIVATE) {
          if (product.status === CatalogLifecycleStatus.ACTIVE) reason = 'ALREADY_ACTIVE';
        }
        if (operation === BULK_OPERATIONS.PRODUCT_ARCHIVE) {
          if (product.status === CatalogLifecycleStatus.ARCHIVED) reason = 'ALREADY_ARCHIVED';
        }

        const mutateBlocked = reason === 'PRODUCT_ALREADY_ARCHIVED';
        if (mutateBlocked) {
          ineligible.push({ id, reason: reason ?? 'INELIGIBLE' });
        } else {
          eligible.push(id);
        }
        if (sample.length < BULK_PREVIEW_SAMPLE_MAX) {
          sample.push({
            id,
            label,
            eligible: !mutateBlocked,
            reason,
          });
        }
      }
      if (ineligible.length > 0) {
        warnings.push(`${ineligible.length} product(s) cannot be updated in their current state.`);
      }
      void dto;
      return { eligible, ineligible, warnings, sample };
    }

    const skus = await this.database.client.sku.findMany({
      where: { companyId: company.companyId, id: { in: ids } },
      select: { id: true, code: true, name: true, status: true },
    });
    const byId = new Map(skus.map((s) => [s.id, s]));
    for (const id of ids) {
      const sku = byId.get(id);
      if (!sku) continue;
      const label = sku.name ? `${sku.code} — ${sku.name}` : sku.code;
      let reason: string | undefined;
      if (
        (operation === BULK_OPERATIONS.SKU_ATTRIBUTE_SET ||
          operation === BULK_OPERATIONS.SKU_ATTRIBUTE_REMOVE) &&
        sku.status === CatalogLifecycleStatus.ARCHIVED
      ) {
        // Attributes may still be mutable on archived? Entity attrs require product/sku exist —
        // keep archived attr edits allowed unless domain blocks. Domain put doesn't block archived.
        reason = undefined;
      }
      if (operation === BULK_OPERATIONS.SKU_DEACTIVATE) {
        if (sku.status === CatalogLifecycleStatus.ARCHIVED) reason = 'SKU_ALREADY_ARCHIVED';
        else if (sku.status === CatalogLifecycleStatus.INACTIVE) reason = 'ALREADY_INACTIVE';
      }
      if (operation === BULK_OPERATIONS.SKU_ACTIVATE) {
        if (sku.status === CatalogLifecycleStatus.ACTIVE) reason = 'ALREADY_ACTIVE';
      }
      if (operation === BULK_OPERATIONS.SKU_ARCHIVE) {
        if (sku.status === CatalogLifecycleStatus.ARCHIVED) reason = 'ALREADY_ARCHIVED';
      }
      const mutateBlocked = reason === 'SKU_ALREADY_ARCHIVED';
      if (mutateBlocked) ineligible.push({ id, reason: reason ?? 'INELIGIBLE' });
      else eligible.push(id);
      if (sample.length < BULK_PREVIEW_SAMPLE_MAX) {
        sample.push({ id, label, eligible: !mutateBlocked, reason });
      }
    }
    if (ineligible.length > 0) {
      warnings.push(`${ineligible.length} SKU(s) cannot be updated in their current state.`);
    }
    return { eligible, ineligible, warnings, sample };
  }

  private async applyOne(
    company: CompanyContext,
    dto: BulkCommandDto,
    id: string,
  ): Promise<EntityOutcome> {
    const op = dto.operation;
    const payload = dto.payload ?? {};

    if (op === BULK_OPERATIONS.PRODUCT_CHANGE_BRAND) {
      const before = await this.productsService.get(company, id);
      if (before.brandId === (payload.brandId as string | null)) return 'skipped';
      await this.productsService.update(company, id, {
        brandId: payload.brandId as string | null,
      });
      return 'succeeded';
    }
    if (op === BULK_OPERATIONS.PRODUCT_CHANGE_CATEGORY) {
      const before = await this.productsService.get(company, id);
      if (before.categoryId === (payload.categoryId as string | null)) return 'skipped';
      await this.productsService.update(company, id, {
        categoryId: payload.categoryId as string | null,
      });
      return 'succeeded';
    }
    if (op === BULK_OPERATIONS.PRODUCT_ACTIVATE) {
      const before = await this.productsService.get(company, id);
      if (before.status === CatalogLifecycleStatus.ACTIVE) return 'skipped';
      await this.productsService.activate(company, id);
      return 'succeeded';
    }
    if (op === BULK_OPERATIONS.PRODUCT_DEACTIVATE) {
      const before = await this.productsService.get(company, id);
      if (before.status === CatalogLifecycleStatus.INACTIVE) return 'skipped';
      await this.productsService.deactivate(company, id);
      return 'succeeded';
    }
    if (op === BULK_OPERATIONS.PRODUCT_ARCHIVE) {
      const before = await this.productsService.get(company, id);
      if (before.status === CatalogLifecycleStatus.ARCHIVED) return 'skipped';
      await this.productsService.archive(company, id);
      return 'succeeded';
    }
    if (op === BULK_OPERATIONS.SKU_ACTIVATE) {
      const before = await this.skusService.get(company, id);
      if (before.status === CatalogLifecycleStatus.ACTIVE) return 'skipped';
      await this.skusService.activate(company, id);
      return 'succeeded';
    }
    if (op === BULK_OPERATIONS.SKU_DEACTIVATE) {
      const before = await this.skusService.get(company, id);
      if (before.status === CatalogLifecycleStatus.INACTIVE) return 'skipped';
      await this.skusService.deactivate(company, id);
      return 'succeeded';
    }
    if (op === BULK_OPERATIONS.SKU_ARCHIVE) {
      const before = await this.skusService.get(company, id);
      if (before.status === CatalogLifecycleStatus.ARCHIVED) return 'skipped';
      await this.skusService.archive(company, id);
      return 'succeeded';
    }
    if (op === BULK_OPERATIONS.PRODUCT_ATTRIBUTE_SET) {
      const item = payload as unknown as PutEntityAttributeItemDto;
      const result = await this.entityAttributesService.setOneAttribute(
        company,
        'PRODUCT',
        id,
        item,
      );
      return result.changed ? 'succeeded' : 'skipped';
    }
    if (op === BULK_OPERATIONS.SKU_ATTRIBUTE_SET) {
      const item = payload as unknown as PutEntityAttributeItemDto;
      const result = await this.entityAttributesService.setOneAttribute(
        company,
        'SKU',
        id,
        item,
      );
      return result.changed ? 'succeeded' : 'skipped';
    }
    if (op === BULK_OPERATIONS.PRODUCT_ATTRIBUTE_REMOVE) {
      const result = await this.entityAttributesService.removeOneAttribute(
        company,
        'PRODUCT',
        id,
        payload.attributeId as string,
      );
      return result.changed ? 'succeeded' : 'skipped';
    }
    if (op === BULK_OPERATIONS.SKU_ATTRIBUTE_REMOVE) {
      const result = await this.entityAttributesService.removeOneAttribute(
        company,
        'SKU',
        id,
        payload.attributeId as string,
      );
      return result.changed ? 'succeeded' : 'skipped';
    }

    throw new AppError({
      code: ERROR_CODES.BULK_INVALID_OPERATION,
      message: CATALOG_ERROR_MESSAGES.BULK_INVALID_OPERATION,
      statusCode: 400,
    });
  }

  private toFailure(id: string, error: unknown): BulkFailure {
    if (error instanceof AppError) {
      return { id, code: error.code, message: error.message };
    }
    return {
      id,
      code: ERROR_CODES.INTERNAL_SERVER_ERROR,
      message: error instanceof Error ? error.message : 'Unexpected error',
    };
  }
}
