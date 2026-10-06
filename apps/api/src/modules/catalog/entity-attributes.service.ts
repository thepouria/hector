import { Injectable } from '@nestjs/common';
import {
  AttributeType,
  CatalogLifecycleStatus,
  Prisma,
} from '@hector/database';
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
import type { CompanyContext } from '../companies/types/company.types';
import {
  assertAttributeScopeAllows,
  normalizeAttributeValueInput,
  type AttributeOptionRef,
  type NormalizedAttributeValue,
} from './attribute-value.util';
import { CATALOG_ERROR_MESSAGES } from './catalog.constants';
import type { PutEntityAttributesDto, PutEntityAttributeItemDto } from './dto/put-entity-attributes.dto';
import type { EntityAttributeValueView } from './types/catalog.types';

type EntityTarget = 'PRODUCT' | 'SKU';

const valueInclude = {
  attributeDefinition: true,
  selections: {
    include: { attributeOption: true },
    orderBy: [{ attributeOption: { position: 'asc' } }, { attributeOptionId: 'asc' }],
  },
} satisfies Prisma.ProductAttributeValueInclude;

type ProductValueRow = Prisma.ProductAttributeValueGetPayload<{ include: typeof valueInclude }>;
type SkuValueRow = Prisma.SkuAttributeValueGetPayload<{
  include: {
    attributeDefinition: true;
    selections: {
      include: { attributeOption: true };
      orderBy: [{ attributeOption: { position: 'asc' } }, { attributeOptionId: 'asc' }];
    };
  };
}>;

@Injectable()
export class EntityAttributesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async getProductAttributes(
    company: CompanyContext,
    productId: string,
  ): Promise<EntityAttributeValueView[]> {
    await this.requireProduct(company.companyId, productId);
    const rows = await this.database.client.productAttributeValue.findMany({
      where: { companyId: company.companyId, productId },
      include: valueInclude,
      orderBy: [{ attributeDefinition: { name: 'asc' } }, { attributeDefinitionId: 'asc' }],
    });
    return rows.map((row) => this.toProductValueView(row));
  }

  async putProductAttributes(
    company: CompanyContext,
    productId: string,
    dto: PutEntityAttributesDto,
  ): Promise<EntityAttributeValueView[]> {
    await this.requireProduct(company.companyId, productId);
    return this.replaceValues(company, 'PRODUCT', productId, dto);
  }

  async getSkuAttributes(
    company: CompanyContext,
    skuId: string,
  ): Promise<EntityAttributeValueView[]> {
    await this.requireSku(company.companyId, skuId);
    const rows = await this.database.client.skuAttributeValue.findMany({
      where: { companyId: company.companyId, skuId },
      include: {
        attributeDefinition: true,
        selections: {
          include: { attributeOption: true },
          orderBy: [{ attributeOption: { position: 'asc' } }, { attributeOptionId: 'asc' }],
        },
      },
      orderBy: [{ attributeDefinition: { name: 'asc' } }, { attributeDefinitionId: 'asc' }],
    });
    return rows.map((row) => this.toSkuValueView(row));
  }

  async putSkuAttributes(
    company: CompanyContext,
    skuId: string,
    dto: PutEntityAttributesDto,
  ): Promise<EntityAttributeValueView[]> {
    await this.requireSku(company.companyId, skuId);
    return this.replaceValues(company, 'SKU', skuId, dto);
  }

  /**
   * Merge-set a single attribute without clearing other values (Phase 1.10 bulk).
   * Returns whether a write occurred (false = already equal / no-op).
   */
  async setOneAttribute(
    company: CompanyContext,
    target: EntityTarget,
    entityId: string,
    item: PutEntityAttributeItemDto,
  ): Promise<{ changed: boolean; values: EntityAttributeValueView[] }> {
    if (target === 'PRODUCT') {
      await this.requireProduct(company.companyId, entityId);
    } else {
      await this.requireSku(company.companyId, entityId);
    }

    const current =
      target === 'PRODUCT'
        ? await this.getProductAttributes(company, entityId)
        : await this.getSkuAttributes(company, entityId);

    const merged = this.viewsToPutItems(current);
    const idx = merged.findIndex((a) => a.attributeId === item.attributeId);
    if (idx >= 0) {
      merged[idx] = item;
    } else {
      merged.push(item);
    }

    const beforeKey = JSON.stringify(this.viewsToPutItems(current));
    const after = await this.replaceValues(company, target, entityId, { attributes: merged });
    const afterKey = JSON.stringify(this.viewsToPutItems(after));
    return { changed: beforeKey !== afterKey, values: after };
  }

  /**
   * Remove one attribute value (not provided). BOOLEAN remove ≠ false.
   */
  async removeOneAttribute(
    company: CompanyContext,
    target: EntityTarget,
    entityId: string,
    attributeId: string,
  ): Promise<{ changed: boolean; values: EntityAttributeValueView[] }> {
    if (target === 'PRODUCT') {
      await this.requireProduct(company.companyId, entityId);
    } else {
      await this.requireSku(company.companyId, entityId);
    }

    const current =
      target === 'PRODUCT'
        ? await this.getProductAttributes(company, entityId)
        : await this.getSkuAttributes(company, entityId);

    if (!current.some((v) => v.attributeId === attributeId)) {
      return { changed: false, values: current };
    }

    const merged = this.viewsToPutItems(current).filter((a) => a.attributeId !== attributeId);
    const after = await this.replaceValues(company, target, entityId, { attributes: merged });
    return { changed: true, values: after };
  }

  private viewsToPutItems(values: EntityAttributeValueView[]): PutEntityAttributeItemDto[] {
    return values.map((v) => ({
      attributeId: v.attributeId,
      textValue: v.textValue,
      numberValue: v.numberValue != null ? Number(v.numberValue) : null,
      booleanValue: v.booleanValue,
      optionIds: v.selectedOptions.map((o) => o.id),
    }));
  }

  private async replaceValues(
    company: CompanyContext,
    target: EntityTarget,
    entityId: string,
    dto: PutEntityAttributesDto,
  ): Promise<EntityAttributeValueView[]> {
    this.assertUniqueAttributeIds(dto);
    const { finalByAttrId, definitions, optionsById } = await this.prepareNormalized(
      company.companyId,
      target,
      dto,
    );

    const current =
      target === 'PRODUCT'
        ? await this.database.client.productAttributeValue.findMany({
            where: { companyId: company.companyId, productId: entityId },
            include: valueInclude,
          })
        : await this.database.client.skuAttributeValue.findMany({
            where: { companyId: company.companyId, skuId: entityId },
            include: {
              attributeDefinition: true,
              selections: { include: { attributeOption: true } },
            },
          });

    const currentByAttrId = new Map(
      current.map((row) => [row.attributeDefinitionId, row] as const),
    );

    for (const [attributeId, normalized] of finalByAttrId) {
      const def = definitions.get(attributeId)!;
      this.assertArchivedWriteAllowed(def, currentByAttrId.get(attributeId), normalized);
    }

    const planned = this.planChanges(currentByAttrId, finalByAttrId);
    if (!planned.hasChanges) {
      return target === 'PRODUCT'
        ? (current as ProductValueRow[]).map((row) => this.toProductValueView(row))
        : (current as SkuValueRow[]).map((row) => this.toSkuValueView(row));
    }

    return commitThenPublish(this.eventBus, async (events) => {
      await this.database.client.$transaction(async (tx) => {
        for (const attributeId of planned.toDelete) {
          if (target === 'PRODUCT') {
            await tx.productAttributeValue.deleteMany({
              where: {
                companyId: company.companyId,
                productId: entityId,
                attributeDefinitionId: attributeId,
              },
            });
          } else {
            await tx.skuAttributeValue.deleteMany({
              where: {
                companyId: company.companyId,
                skuId: entityId,
                attributeDefinitionId: attributeId,
              },
            });
          }
        }

        for (const [attributeId, normalized] of planned.toUpsert) {
          await this.upsertValue(
            tx,
            company.companyId,
            target,
            entityId,
            attributeId,
            normalized,
            optionsById,
          );
        }

        const beforeSnapshot = this.snapshotValues(current);
        const afterRows =
          target === 'PRODUCT'
            ? await tx.productAttributeValue.findMany({
                where: { companyId: company.companyId, productId: entityId },
                include: valueInclude,
              })
            : await tx.skuAttributeValue.findMany({
                where: { companyId: company.companyId, skuId: entityId },
                include: {
                  attributeDefinition: true,
                  selections: { include: { attributeOption: true } },
                },
              });
        const afterSnapshot = this.snapshotValues(afterRows);

        const auditAction =
          target === 'PRODUCT'
            ? AUDIT_ACTIONS.PRODUCT_ATTRIBUTES_UPDATED
            : AUDIT_ACTIONS.SKU_ATTRIBUTES_UPDATED;
        const entityType =
          target === 'PRODUCT'
            ? AUDIT_ENTITY_TYPES.PRODUCT_ATTRIBUTES
            : AUDIT_ENTITY_TYPES.SKU_ATTRIBUTES;

        await this.auditService.record(tx, {
          action: auditAction,
          entityType,
          entityId,
          before: { values: beforeSnapshot },
          after: { values: afterSnapshot },
        });
      });

      events.push(
        this.eventFactory.create({
          type:
            target === 'PRODUCT'
              ? DOMAIN_EVENTS.CATALOG_PRODUCT_ATTRIBUTES_UPDATED
              : DOMAIN_EVENTS.CATALOG_SKU_ATTRIBUTES_UPDATED,
          payload:
            target === 'PRODUCT'
              ? { companyId: company.companyId, productId: entityId }
              : { companyId: company.companyId, skuId: entityId },
        }),
      );

      return target === 'PRODUCT'
        ? (
            await this.database.client.productAttributeValue.findMany({
              where: { companyId: company.companyId, productId: entityId },
              include: valueInclude,
              orderBy: [{ attributeDefinition: { name: 'asc' } }, { attributeDefinitionId: 'asc' }],
            })
          ).map((row) => this.toProductValueView(row))
        : (
            await this.database.client.skuAttributeValue.findMany({
              where: { companyId: company.companyId, skuId: entityId },
              include: {
                attributeDefinition: true,
                selections: {
                  include: { attributeOption: true },
                  orderBy: [{ attributeOption: { position: 'asc' } }, { attributeOptionId: 'asc' }],
                },
              },
              orderBy: [{ attributeDefinition: { name: 'asc' } }, { attributeDefinitionId: 'asc' }],
            })
          ).map((row) => this.toSkuValueView(row));
    });
  }

  private async prepareNormalized(
    companyId: string,
    target: EntityTarget,
    dto: PutEntityAttributesDto,
  ) {
    const attributeIds = dto.attributes.map((a) => a.attributeId);
    const definitions = await this.database.client.attributeDefinition.findMany({
      where: { companyId, id: { in: attributeIds } },
    });
    const definitionsMap = new Map(definitions.map((d) => [d.id, d]));

    for (const id of attributeIds) {
      if (!definitionsMap.has(id)) {
        throw new AppError({
          code: ERROR_CODES.ATTRIBUTE_NOT_FOUND,
          message: CATALOG_ERROR_MESSAGES.ATTRIBUTE_NOT_FOUND,
          statusCode: 404,
        });
      }
    }

    const selectAttrIds = definitions
      .filter(
        (d) =>
          d.type === AttributeType.SINGLE_SELECT || d.type === AttributeType.MULTI_SELECT,
      )
      .map((d) => d.id);

    const options =
      selectAttrIds.length > 0
        ? await this.database.client.attributeOption.findMany({
            where: { companyId, attributeDefinitionId: { in: selectAttrIds } },
          })
        : [];

    const optionsById = new Map<string, AttributeOptionRef>(
      options.map((o) => [
        o.id,
        {
          id: o.id,
          attributeDefinitionId: o.attributeDefinitionId,
          isActive: o.isActive,
          value: o.value,
        },
      ]),
    );

    const finalByAttrId = new Map<string, NormalizedAttributeValue>();

    for (const item of dto.attributes) {
      const def = definitionsMap.get(item.attributeId)!;
      assertAttributeScopeAllows(def.scope, target);
      const normalized = normalizeAttributeValueInput(def.type, item.attributeId, item, optionsById);
      if (normalized.kind === 'clear') continue;
      if (finalByAttrId.has(item.attributeId)) {
        throw AppError.validation('Duplicate attributeId in request.');
      }
      finalByAttrId.set(item.attributeId, normalized);
    }

    return { finalByAttrId, definitions: definitionsMap, optionsById };
  }

  private assertUniqueAttributeIds(dto: PutEntityAttributesDto): void {
    const seen = new Set<string>();
    for (const item of dto.attributes) {
      if (seen.has(item.attributeId)) {
        throw AppError.validation('Duplicate attributeId in request.');
      }
      seen.add(item.attributeId);
    }
  }

  private assertArchivedWriteAllowed(
    def: { status: CatalogLifecycleStatus },
    existing: ProductValueRow | SkuValueRow | undefined,
    normalized: NormalizedAttributeValue,
  ): void {
    if (def.status !== CatalogLifecycleStatus.ARCHIVED) return;
    if (!existing) {
      throw new AppError({
        code: ERROR_CODES.ATTRIBUTE_NOT_ACTIVE,
        message: CATALOG_ERROR_MESSAGES.ATTRIBUTE_NOT_ACTIVE,
        statusCode: 400,
      });
    }
    if (!this.valueEqualsExisting(existing, normalized)) {
      throw new AppError({
        code: ERROR_CODES.ATTRIBUTE_NOT_ACTIVE,
        message: CATALOG_ERROR_MESSAGES.ATTRIBUTE_NOT_ACTIVE,
        statusCode: 400,
      });
    }
  }

  private valueEqualsExisting(
    existing: ProductValueRow | SkuValueRow,
    normalized: NormalizedAttributeValue,
  ): boolean {
    if (normalized.kind === 'text') {
      return existing.textValue === normalized.textValue;
    }
    if (normalized.kind === 'number') {
      return existing.numberValue?.equals(normalized.numberValue) ?? false;
    }
    if (normalized.kind === 'boolean') {
      return existing.booleanValue === normalized.booleanValue;
    }
    if (normalized.kind === 'select') {
      const currentIds = existing.selections.map((s) => s.attributeOptionId).sort();
      const nextIds = [...normalized.optionIds].sort();
      return (
        currentIds.length === nextIds.length &&
        currentIds.every((id, i) => id === nextIds[i])
      );
    }
    return false;
  }

  private planChanges(
    currentByAttrId: Map<string, ProductValueRow | SkuValueRow>,
    finalByAttrId: Map<string, NormalizedAttributeValue>,
  ) {
    const toDelete: string[] = [];
    for (const attributeId of currentByAttrId.keys()) {
      if (!finalByAttrId.has(attributeId)) {
        toDelete.push(attributeId);
      }
    }

    const toUpsert: Array<[string, NormalizedAttributeValue]> = [];
    let hasChanges = toDelete.length > 0;

    for (const [attributeId, normalized] of finalByAttrId) {
      const existing = currentByAttrId.get(attributeId);
      if (!existing || !this.valueEqualsExisting(existing, normalized)) {
        toUpsert.push([attributeId, normalized]);
        hasChanges = true;
      }
    }

    return { toDelete, toUpsert, hasChanges };
  }

  private async upsertValue(
    tx: Prisma.TransactionClient,
    companyId: string,
    target: EntityTarget,
    entityId: string,
    attributeId: string,
    normalized: NormalizedAttributeValue,
    _optionsById: Map<string, AttributeOptionRef>,
  ): Promise<void> {
    if (normalized.kind === 'clear') return;

    if (target === 'PRODUCT') {
      const valueRow = await tx.productAttributeValue.upsert({
        where: {
          productId_attributeDefinitionId: {
            productId: entityId,
            attributeDefinitionId: attributeId,
          },
        },
        create: {
          companyId,
          productId: entityId,
          attributeDefinitionId: attributeId,
          textValue: normalized.kind === 'text' ? normalized.textValue : null,
          numberValue: normalized.kind === 'number' ? normalized.numberValue : null,
          booleanValue: normalized.kind === 'boolean' ? normalized.booleanValue : null,
        },
        update: {
          textValue: normalized.kind === 'text' ? normalized.textValue : null,
          numberValue: normalized.kind === 'number' ? normalized.numberValue : null,
          booleanValue: normalized.kind === 'boolean' ? normalized.booleanValue : null,
        },
      });

      await tx.productAttributeSelection.deleteMany({
        where: { productAttributeValueId: valueRow.id },
      });

      if (normalized.kind === 'select') {
        for (const optionId of normalized.optionIds) {
          await tx.productAttributeSelection.create({
            data: {
              companyId,
              productAttributeValueId: valueRow.id,
              attributeOptionId: optionId,
            },
          });
        }
      }
      return;
    }

    const valueRow = await tx.skuAttributeValue.upsert({
      where: {
        skuId_attributeDefinitionId: {
          skuId: entityId,
          attributeDefinitionId: attributeId,
        },
      },
      create: {
        companyId,
        skuId: entityId,
        attributeDefinitionId: attributeId,
        textValue: normalized.kind === 'text' ? normalized.textValue : null,
        numberValue: normalized.kind === 'number' ? normalized.numberValue : null,
        booleanValue: normalized.kind === 'boolean' ? normalized.booleanValue : null,
      },
      update: {
        textValue: normalized.kind === 'text' ? normalized.textValue : null,
        numberValue: normalized.kind === 'number' ? normalized.numberValue : null,
        booleanValue: normalized.kind === 'boolean' ? normalized.booleanValue : null,
      },
    });

    await tx.skuAttributeSelection.deleteMany({
      where: { skuAttributeValueId: valueRow.id },
    });

    if (normalized.kind === 'select') {
      for (const optionId of normalized.optionIds) {
        await tx.skuAttributeSelection.create({
          data: {
            companyId,
            skuAttributeValueId: valueRow.id,
            attributeOptionId: optionId,
          },
        });
      }
    }
  }

  private snapshotValues(rows: ProductValueRow[] | SkuValueRow[]) {
    return rows.map((row) => ({
      attributeId: row.attributeDefinitionId,
      textValue: row.textValue,
      numberValue: row.numberValue?.toString() ?? null,
      booleanValue: row.booleanValue,
      optionIds: row.selections.map((s) => s.attributeOptionId).sort(),
    }));
  }

  private toProductValueView(row: ProductValueRow): EntityAttributeValueView {
    return this.toEntityView(row);
  }

  private toSkuValueView(row: SkuValueRow): EntityAttributeValueView {
    return this.toEntityView(row);
  }

  private toEntityView(row: ProductValueRow | SkuValueRow): EntityAttributeValueView {
    const def = row.attributeDefinition;
    return {
      attributeId: def.id,
      attribute: {
        id: def.id,
        name: def.name,
        code: def.code,
        type: def.type,
        scope: def.scope,
        unit: def.unit,
        status: def.status,
      },
      textValue: row.textValue,
      numberValue: row.numberValue?.toString() ?? null,
      booleanValue: row.booleanValue,
      selectedOptions: row.selections.map((s) => ({
        id: s.attributeOption.id,
        value: s.attributeOption.value,
        isActive: s.attributeOption.isActive,
      })),
    };
  }

  private async requireProduct(companyId: string, productId: string): Promise<void> {
    const row = await this.database.client.product.findFirst({
      where: { id: productId, companyId },
      select: { id: true },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.PRODUCT_NOT_FOUND,
        message: CATALOG_ERROR_MESSAGES.PRODUCT_NOT_FOUND,
        statusCode: 404,
      });
    }
  }

  private async requireSku(companyId: string, skuId: string): Promise<void> {
    const row = await this.database.client.sku.findFirst({
      where: { id: skuId, companyId },
      select: { id: true },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.SKU_NOT_FOUND,
        message: CATALOG_ERROR_MESSAGES.SKU_NOT_FOUND,
        statusCode: 404,
      });
    }
  }
}
