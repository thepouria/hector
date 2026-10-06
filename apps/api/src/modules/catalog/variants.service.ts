import { Injectable } from '@nestjs/common';
import { CatalogLifecycleStatus, Prisma } from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
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
import { CATALOG_ERROR_MESSAGES } from './catalog.constants';
import { mapCatalogUniqueViolation } from './catalog-unique.error';
import { assertVariantOptionName, assertVariantOptionValue } from './catalog.normalization';
import type { CreateVariantOptionDto } from './dto/create-variant-option.dto';
import type { CreateVariantValuesDto } from './dto/create-variant-values.dto';
import type { UpdateVariantOptionDto } from './dto/update-variant-option.dto';
import type { UpdateVariantValueDto } from './dto/update-variant-value.dto';
import { lockProductRow } from './product-lock.util';
import type { VariantOptionValueView, VariantOptionView } from './types/catalog.types';

type Tx = Prisma.TransactionClient;

const optionInclude = {
  values: {
    orderBy: [{ position: 'asc' }, { value: 'asc' }, { id: 'asc' }],
    include: { _count: { select: { skuLinks: true } } },
  },
} satisfies Prisma.VariantOptionInclude;

type OptionRow = Prisma.VariantOptionGetPayload<{ include: typeof optionInclude }>;
type ValueRow = OptionRow['values'][number];

/**
 * Product-scoped variant structure (Phase 1.4).
 * - Options cannot be added once the product has any SKU (every SKU would become incomplete).
 * - Values may be added later; deactivating a value keeps existing SKU links readable.
 * - There is no option/value delete: referenced structure is permanent (FK RESTRICT).
 */
@Injectable()
export class VariantsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async listOptions(company: CompanyContext, productId: string): Promise<VariantOptionView[]> {
    const product = await this.database.client.product.findFirst({
      where: { id: productId, companyId: company.companyId },
      select: { id: true },
    });
    if (!product) throw this.productNotFound();

    const rows = await this.database.client.variantOption.findMany({
      where: { companyId: company.companyId, productId },
      include: optionInclude,
      orderBy: [{ position: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.toOptionView(row));
  }

  async createOption(
    company: CompanyContext,
    productId: string,
    dto: CreateVariantOptionDto,
  ): Promise<VariantOptionView> {
    const { name, normalizedName } = assertVariantOptionName(dto.name);

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const created = await this.database.client.$transaction(async (tx) => {
          await lockProductRow(tx, productId, company.companyId);
          const product = await tx.product.findFirst({
            where: { id: productId, companyId: company.companyId },
            select: { id: true, status: true },
          });
          if (!product) throw this.productNotFound();
          if (product.status === CatalogLifecycleStatus.ARCHIVED) {
            throw new AppError({
              code: ERROR_CODES.PRODUCT_ALREADY_ARCHIVED,
              message: CATALOG_ERROR_MESSAGES.PRODUCT_ALREADY_ARCHIVED,
              statusCode: 409,
            });
          }

          const skuCount = await tx.sku.count({
            where: { productId, companyId: company.companyId },
          });
          if (skuCount > 0) {
            throw new AppError({
              code: ERROR_CODES.VARIANT_OPTION_ADD_BLOCKED,
              message: CATALOG_ERROR_MESSAGES.VARIANT_OPTION_ADD_BLOCKED,
              statusCode: 409,
            });
          }

          const clash = await tx.variantOption.findFirst({
            where: { productId, companyId: company.companyId, normalizedName },
            select: { id: true },
          });
          if (clash) throw this.optionNameExists();

          let position = dto.position;
          if (position === undefined) {
            const last = await tx.variantOption.aggregate({
              where: { productId, companyId: company.companyId },
              _max: { position: true },
            });
            position = (last._max.position ?? -1) + 1;
          }

          const option = await tx.variantOption.create({
            data: { companyId: company.companyId, productId, name, normalizedName, position },
            include: optionInclude,
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.VARIANT_OPTION_CREATED,
            entityType: AUDIT_ENTITY_TYPES.VARIANT_OPTION,
            entityId: option.id,
            before: null,
            after: this.optionSnapshot(option),
            metadata: { productId },
          });

          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.CATALOG_VARIANT_OPTION_CREATED,
              payload: { companyId: company.companyId, productId, optionId: option.id },
            }),
          );
          return option;
        });
        return this.toOptionView(created);
      } catch (error) {
        mapCatalogUniqueViolation(error, 'variant_option_name');
      }
    });
  }

  async updateOption(
    company: CompanyContext,
    optionId: string,
    dto: UpdateVariantOptionDto,
  ): Promise<VariantOptionView> {
    if (dto.name === undefined && dto.position === undefined) {
      throw AppError.validation('At least one field is required to update the option.');
    }
    const nextName = dto.name !== undefined ? assertVariantOptionName(dto.name) : null;

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          const current = await this.loadOptionLocked(tx, company.companyId, optionId);

          if (nextName && nextName.normalizedName !== current.normalizedName) {
            const clash = await tx.variantOption.findFirst({
              where: {
                productId: current.productId,
                companyId: company.companyId,
                normalizedName: nextName.normalizedName,
                id: { not: current.id },
              },
              select: { id: true },
            });
            if (clash) throw this.optionNameExists();
          }

          const option = await tx.variantOption.update({
            where: { id: current.id },
            data: {
              ...(nextName ? { name: nextName.name, normalizedName: nextName.normalizedName } : {}),
              ...(dto.position !== undefined ? { position: dto.position } : {}),
            },
            include: optionInclude,
          });

          const before = this.optionSnapshot(current);
          const after = this.optionSnapshot(option);
          const audited = await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.VARIANT_OPTION_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.VARIANT_OPTION,
            entityId: option.id,
            before,
            after,
            metadata: { productId: option.productId },
          });
          if (audited) {
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.CATALOG_VARIANT_OPTION_UPDATED,
                payload: {
                  companyId: company.companyId,
                  productId: option.productId,
                  optionId: option.id,
                  changedFields: this.diffKeys(before, after),
                },
              }),
            );
          }
          return option;
        });
        return this.toOptionView(updated);
      } catch (error) {
        mapCatalogUniqueViolation(error, 'variant_option_name');
      }
    });
  }

  async createValues(
    company: CompanyContext,
    optionId: string,
    dto: CreateVariantValuesDto,
  ): Promise<VariantOptionView> {
    // Normalise + dedupe (first occurrence wins; order preserved).
    const seen = new Set<string>();
    const normalized: Array<{ value: string; normalizedValue: string }> = [];
    for (const raw of dto.values) {
      const item = assertVariantOptionValue(raw);
      if (seen.has(item.normalizedValue)) continue;
      seen.add(item.normalizedValue);
      normalized.push(item);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const result = await this.database.client.$transaction(async (tx) => {
          const option = await this.loadOptionLocked(tx, company.companyId, optionId);

          const existing = await tx.variantOptionValue.findFirst({
            where: {
              optionId: option.id,
              companyId: company.companyId,
              normalizedValue: { in: [...seen] },
            },
            select: { value: true },
          });
          if (existing) {
            throw new AppError({
              code: ERROR_CODES.VARIANT_VALUE_EXISTS,
              message: CATALOG_ERROR_MESSAGES.VARIANT_VALUE_EXISTS,
              statusCode: 409,
              details: { value: existing.value },
            });
          }

          const last = await tx.variantOptionValue.aggregate({
            where: { optionId: option.id, companyId: company.companyId },
            _max: { position: true },
          });
          let position = (last._max.position ?? -1) + 1;

          for (const item of normalized) {
            const created = await tx.variantOptionValue.create({
              data: {
                companyId: company.companyId,
                optionId: option.id,
                value: item.value,
                normalizedValue: item.normalizedValue,
                position: position++,
                isActive: true,
              },
            });
            await this.auditService.record(tx, {
              action: AUDIT_ACTIONS.VARIANT_VALUE_CREATED,
              entityType: AUDIT_ENTITY_TYPES.VARIANT_OPTION_VALUE,
              entityId: created.id,
              before: null,
              after: this.valueSnapshot(created),
              metadata: { productId: option.productId, optionId: option.id },
            });
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.CATALOG_VARIANT_VALUE_CREATED,
                payload: {
                  companyId: company.companyId,
                  productId: option.productId,
                  optionId: option.id,
                  valueId: created.id,
                },
              }),
            );
          }

          return tx.variantOption.findFirstOrThrow({
            where: { id: option.id, companyId: company.companyId },
            include: optionInclude,
          });
        });
        return this.toOptionView(result);
      } catch (error) {
        mapCatalogUniqueViolation(error, 'variant_value');
      }
    });
  }

  async updateValue(
    company: CompanyContext,
    valueId: string,
    dto: UpdateVariantValueDto,
  ): Promise<VariantOptionValueView> {
    if (dto.value === undefined && dto.position === undefined) {
      throw AppError.validation('At least one field is required to update the value.');
    }
    const next = dto.value !== undefined ? assertVariantOptionValue(dto.value) : null;

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          const { value: current, productId } = await this.loadValueLocked(
            tx,
            company.companyId,
            valueId,
          );

          if (next && next.normalizedValue !== current.normalizedValue) {
            const clash = await tx.variantOptionValue.findFirst({
              where: {
                optionId: current.optionId,
                companyId: company.companyId,
                normalizedValue: next.normalizedValue,
                id: { not: current.id },
              },
              select: { id: true },
            });
            if (clash) throw this.valueExists();
          }

          const row = await tx.variantOptionValue.update({
            where: { id: current.id },
            data: {
              ...(next ? { value: next.value, normalizedValue: next.normalizedValue } : {}),
              ...(dto.position !== undefined ? { position: dto.position } : {}),
            },
            include: { _count: { select: { skuLinks: true } } },
          });

          const before = this.valueSnapshot(current);
          const after = this.valueSnapshot(row);
          const audited = await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.VARIANT_VALUE_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.VARIANT_OPTION_VALUE,
            entityId: row.id,
            before,
            after,
            metadata: { productId, optionId: row.optionId },
          });
          if (audited) {
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.CATALOG_VARIANT_VALUE_UPDATED,
                payload: {
                  companyId: company.companyId,
                  productId,
                  optionId: row.optionId,
                  valueId: row.id,
                  changedFields: this.diffKeys(before, after),
                },
              }),
            );
          }
          return row;
        });
        return this.toValueView(updated);
      } catch (error) {
        mapCatalogUniqueViolation(error, 'variant_value');
      }
    });
  }

  async deactivateValue(company: CompanyContext, valueId: string): Promise<VariantOptionValueView> {
    return this.setValueActive(company, valueId, false);
  }

  async activateValue(company: CompanyContext, valueId: string): Promise<VariantOptionValueView> {
    return this.setValueActive(company, valueId, true);
  }

  // ---------------------------------------------------------------------------

  private async setValueActive(
    company: CompanyContext,
    valueId: string,
    isActive: boolean,
  ): Promise<VariantOptionValueView> {
    return commitThenPublish(this.eventBus, async (events) => {
      const result = await this.database.client.$transaction(async (tx) => {
        const { value: current, productId } = await this.loadValueLocked(
          tx,
          company.companyId,
          valueId,
        );
        if (current.isActive === isActive) return current;

        // Existing SKU links are untouched: deactivation only blocks NEW assignments.
        const row = await tx.variantOptionValue.update({
          where: { id: current.id },
          data: { isActive },
          include: { _count: { select: { skuLinks: true } } },
        });

        await this.auditService.record(tx, {
          action: isActive
            ? AUDIT_ACTIONS.VARIANT_VALUE_ACTIVATED
            : AUDIT_ACTIONS.VARIANT_VALUE_DEACTIVATED,
          entityType: AUDIT_ENTITY_TYPES.VARIANT_OPTION_VALUE,
          entityId: row.id,
          before: this.valueSnapshot(current),
          after: this.valueSnapshot(row),
          metadata: { productId, optionId: row.optionId },
        });
        events.push(
          this.eventFactory.create({
            type: isActive
              ? DOMAIN_EVENTS.CATALOG_VARIANT_VALUE_ACTIVATED
              : DOMAIN_EVENTS.CATALOG_VARIANT_VALUE_DEACTIVATED,
            payload: {
              companyId: company.companyId,
              productId,
              optionId: row.optionId,
              valueId: row.id,
            },
          }),
        );
        return row;
      });
      return this.toValueView(result);
    });
  }

  private async loadOptionLocked(
    tx: Tx,
    companyId: string,
    optionId: string,
  ): Promise<OptionRow> {
    const head = await tx.variantOption.findFirst({
      where: { id: optionId, companyId },
      select: { productId: true },
    });
    if (!head) throw this.optionNotFound();
    await lockProductRow(tx, head.productId, companyId);
    const row = await tx.variantOption.findFirst({
      where: { id: optionId, companyId },
      include: optionInclude,
    });
    if (!row) throw this.optionNotFound();
    return row;
  }

  private async loadValueLocked(
    tx: Tx,
    companyId: string,
    valueId: string,
  ): Promise<{ value: ValueRow; productId: string }> {
    const head = await tx.variantOptionValue.findFirst({
      where: { id: valueId, companyId },
      select: { option: { select: { productId: true } } },
    });
    if (!head) throw this.valueNotFound();
    await lockProductRow(tx, head.option.productId, companyId);
    const value = await tx.variantOptionValue.findFirst({
      where: { id: valueId, companyId },
      include: { _count: { select: { skuLinks: true } } },
    });
    if (!value) throw this.valueNotFound();
    return { value, productId: head.option.productId };
  }

  private productNotFound(): AppError {
    return new AppError({
      code: ERROR_CODES.PRODUCT_NOT_FOUND,
      message: CATALOG_ERROR_MESSAGES.PRODUCT_NOT_FOUND,
      statusCode: 404,
    });
  }

  private optionNotFound(): AppError {
    return new AppError({
      code: ERROR_CODES.VARIANT_OPTION_NOT_FOUND,
      message: CATALOG_ERROR_MESSAGES.VARIANT_OPTION_NOT_FOUND,
      statusCode: 404,
    });
  }

  private valueNotFound(): AppError {
    return new AppError({
      code: ERROR_CODES.VARIANT_VALUE_NOT_FOUND,
      message: CATALOG_ERROR_MESSAGES.VARIANT_VALUE_NOT_FOUND,
      statusCode: 404,
    });
  }

  private optionNameExists(): AppError {
    return new AppError({
      code: ERROR_CODES.VARIANT_OPTION_NAME_EXISTS,
      message: CATALOG_ERROR_MESSAGES.VARIANT_OPTION_NAME_EXISTS,
      statusCode: 409,
    });
  }

  private valueExists(): AppError {
    return new AppError({
      code: ERROR_CODES.VARIANT_VALUE_EXISTS,
      message: CATALOG_ERROR_MESSAGES.VARIANT_VALUE_EXISTS,
      statusCode: 409,
    });
  }

  private optionSnapshot(option: { id: string; productId: string; name: string; position: number }) {
    return {
      id: option.id,
      productId: option.productId,
      name: option.name,
      position: option.position,
    };
  }

  private valueSnapshot(value: {
    id: string;
    optionId: string;
    value: string;
    position: number;
    isActive: boolean;
  }) {
    return {
      id: value.id,
      optionId: value.optionId,
      value: value.value,
      position: value.position,
      isActive: value.isActive,
    };
  }

  private diffKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
    return Object.keys(before).filter((key) => !auditSnapshotsEqual(before[key], after[key]));
  }

  private toValueView(row: ValueRow): VariantOptionValueView {
    return {
      id: row.id,
      companyId: row.companyId,
      optionId: row.optionId,
      value: row.value,
      position: row.position,
      isActive: row.isActive,
      skuCount: row._count.skuLinks,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toOptionView(row: OptionRow): VariantOptionView {
    return {
      id: row.id,
      companyId: row.companyId,
      productId: row.productId,
      name: row.name,
      position: row.position,
      values: row.values.map((value) => this.toValueView(value)),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
