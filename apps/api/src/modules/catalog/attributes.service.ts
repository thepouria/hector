import { Injectable } from '@nestjs/common';
import {
  AttributeType,
  CatalogLifecycleStatus,
  Prisma,
} from '@hector/database';
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
import type { CompanyContext } from '../companies/types/company.types';
import { normalizeOptionValue } from './attribute-value.util';
import {
  CATALOG_ERROR_MESSAGES,
  CATALOG_SEARCH_MAX_LENGTH,
} from './catalog.constants';
import { mapCatalogUniqueViolation } from './catalog-unique.error';
import {
  assertAttributeCode,
  assertAttributeName,
  normalizeDisplayName,
  normalizeSearchQuery,
} from './catalog.normalization';
import type { CreateAttributeDto } from './dto/create-attribute.dto';
import type { CreateAttributeOptionDto } from './dto/create-attribute-option.dto';
import type { ListAttributesQueryDto } from './dto/list-attributes.query.dto';
import type { UpdateAttributeDto } from './dto/update-attribute.dto';
import type { UpdateAttributeOptionDto } from './dto/update-attribute-option.dto';
import type {
  AttributeDefinitionView,
  AttributeOptionView,
  CatalogOptionView,
} from './types/catalog.types';

const optionOrderBy = [
  { position: 'asc' as const },
  { value: 'asc' as const },
  { id: 'asc' as const },
];

@Injectable()
export class AttributesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    query: ListAttributesQueryDto,
  ): Promise<{ data: (AttributeDefinitionView | CatalogOptionView)[]; meta: PaginationMeta }> {
    const optionsView = query.view === 'options';
    const search = normalizeSearchQuery(query.search, CATALOG_SEARCH_MAX_LENGTH);
    const where: Prisma.AttributeDefinitionWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.scope ? { scope: query.scope } : {}),
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
    const orderBy: Prisma.AttributeDefinitionOrderByWithRelationInput = {
      [query.sortBy]: query.sortOrder,
    };

    const [total, rows] = await this.database.client.$transaction([
      this.database.client.attributeDefinition.count({ where }),
      this.database.client.attributeDefinition.findMany({
        where,
        orderBy,
        skip,
        take: query.pageSize,
        ...(optionsView
          ? { select: { id: true, name: true, code: true, status: true } }
          : {}),
      }),
    ]);

    return {
      data: optionsView
        ? (rows as CatalogOptionView[])
        : rows.map((row) =>
            this.toDefinitionView(row as Parameters<AttributesService['toDefinitionView']>[0]),
          ),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, attributeId: string): Promise<AttributeDefinitionView> {
    const row = await this.requireDefinition(company.companyId, attributeId);
    const options = await this.database.client.attributeOption.findMany({
      where: { companyId: company.companyId, attributeDefinitionId: attributeId },
      orderBy: optionOrderBy,
    });
    return this.toDefinitionView(row, options.map((o) => this.toOptionView(o)));
  }

  async create(company: CompanyContext, dto: CreateAttributeDto): Promise<AttributeDefinitionView> {
    const { name, normalizedName } = assertAttributeName(dto.name);
    const { code, normalizedCode } = assertAttributeCode(dto.code);
    const unit = dto.unit !== undefined ? this.normalizeUnit(dto.unit) : null;
    const description =
      dto.description !== undefined ? this.normalizeDescription(dto.description) : null;

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const created = await this.database.client.$transaction(async (tx) => {
          const attribute = await tx.attributeDefinition.create({
            data: {
              companyId: company.companyId,
              name,
              normalizedName,
              code,
              normalizedCode,
              type: dto.type,
              scope: dto.scope,
              unit,
              description,
              status: CatalogLifecycleStatus.ACTIVE,
            },
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.ATTRIBUTE_CREATED,
            entityType: AUDIT_ENTITY_TYPES.ATTRIBUTE_DEFINITION,
            entityId: attribute.id,
            before: null,
            after: this.definitionSnapshot(attribute),
          });

          return attribute;
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.CATALOG_ATTRIBUTE_CREATED,
            payload: { companyId: company.companyId, attributeId: created.id },
          }),
        );

        return this.toDefinitionView(created);
      } catch (error) {
        this.mapDefinitionUnique(error);
      }
    });
  }

  async update(
    company: CompanyContext,
    attributeId: string,
    dto: UpdateAttributeDto,
  ): Promise<AttributeDefinitionView> {
    const current = await this.requireDefinition(company.companyId, attributeId);
    if (
      dto.name === undefined &&
      dto.unit === undefined &&
      dto.description === undefined &&
      dto.type === undefined
    ) {
      throw AppError.validation('At least one field is required to update the attribute.');
    }

    if (dto.type !== undefined && dto.type !== current.type) {
      await this.assertTypeChangeAllowed(company.companyId, current.id);
    }

    const nextName =
      dto.name !== undefined
        ? assertAttributeName(dto.name)
        : { name: current.name, normalizedName: current.normalizedName };
    const nextUnit =
      dto.unit === undefined ? current.unit : dto.unit === null ? null : this.normalizeUnit(dto.unit);
    const nextDescription =
      dto.description === undefined
        ? current.description
        : dto.description === null
          ? null
          : this.normalizeDescription(dto.description);

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          const attribute = await tx.attributeDefinition.update({
            where: { id: current.id },
            data: {
              name: nextName.name,
              normalizedName: nextName.normalizedName,
              unit: nextUnit,
              description: nextDescription,
              ...(dto.type !== undefined ? { type: dto.type } : {}),
            },
          });

          const before = this.definitionSnapshot(current);
          const after = this.definitionSnapshot(attribute);
          const audited = await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.ATTRIBUTE_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.ATTRIBUTE_DEFINITION,
            entityId: attribute.id,
            before,
            after,
          });

          if (audited) {
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.CATALOG_ATTRIBUTE_UPDATED,
                payload: { companyId: company.companyId, attributeId: attribute.id },
              }),
            );
          }

          return attribute;
        });

        return this.toDefinitionView(updated);
      } catch (error) {
        this.mapDefinitionUnique(error);
      }
    });
  }

  async archive(company: CompanyContext, attributeId: string): Promise<AttributeDefinitionView> {
    const current = await this.requireDefinition(company.companyId, attributeId);
    if (current.status === CatalogLifecycleStatus.ARCHIVED) {
      return this.toDefinitionView(current);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const archived = await this.database.client.$transaction(async (tx) => {
        const attribute = await tx.attributeDefinition.update({
          where: { id: current.id },
          data: {
            status: CatalogLifecycleStatus.ARCHIVED,
            archivedAt: new Date(),
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.ATTRIBUTE_ARCHIVED,
          entityType: AUDIT_ENTITY_TYPES.ATTRIBUTE_DEFINITION,
          entityId: attribute.id,
          before: this.definitionSnapshot(current),
          after: this.definitionSnapshot(attribute),
        });

        return attribute;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.CATALOG_ATTRIBUTE_ARCHIVED,
          payload: { companyId: company.companyId, attributeId: archived.id },
        }),
      );

      return this.toDefinitionView(archived);
    });
  }

  async createOption(
    company: CompanyContext,
    attributeId: string,
    dto: CreateAttributeOptionDto,
  ): Promise<AttributeOptionView> {
    const definition = await this.requireDefinition(company.companyId, attributeId);
    this.assertSelectType(definition.type);
    const { value, normalizedValue } = normalizeOptionValue(dto.value);

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const created = await this.database.client.$transaction(async (tx) => {
          let position = dto.position;
          if (position === undefined) {
            const last = await tx.attributeOption.aggregate({
              where: { attributeDefinitionId: attributeId, companyId: company.companyId },
              _max: { position: true },
            });
            position = (last._max.position ?? -1) + 1;
          }

          const option = await tx.attributeOption.create({
            data: {
              companyId: company.companyId,
              attributeDefinitionId: attributeId,
              value,
              normalizedValue,
              position,
              isActive: true,
            },
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.ATTRIBUTE_OPTION_CREATED,
            entityType: AUDIT_ENTITY_TYPES.ATTRIBUTE_OPTION,
            entityId: option.id,
            before: null,
            after: this.optionSnapshot(option),
            metadata: { attributeId },
          });

          return option;
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.CATALOG_ATTRIBUTE_OPTION_CREATED,
            payload: {
              companyId: company.companyId,
              attributeId,
              optionId: created.id,
            },
          }),
        );

        return this.toOptionView(created);
      } catch (error) {
        mapCatalogUniqueViolation(error, 'attribute_option');
      }
    });
  }

  async updateOption(
    company: CompanyContext,
    optionId: string,
    dto: UpdateAttributeOptionDto,
  ): Promise<AttributeOptionView> {
    if (dto.value === undefined && dto.position === undefined) {
      throw AppError.validation('At least one field is required to update the option.');
    }
    const next = dto.value !== undefined ? normalizeOptionValue(dto.value) : null;

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          const current = await this.requireOption(tx, company.companyId, optionId);

          if (next && next.normalizedValue !== current.normalizedValue) {
            const clash = await tx.attributeOption.findFirst({
              where: {
                attributeDefinitionId: current.attributeDefinitionId,
                companyId: company.companyId,
                normalizedValue: next.normalizedValue,
                id: { not: current.id },
              },
              select: { id: true },
            });
            if (clash) {
              throw new AppError({
                code: ERROR_CODES.ATTRIBUTE_OPTION_EXISTS,
                message: CATALOG_ERROR_MESSAGES.ATTRIBUTE_OPTION_EXISTS,
                statusCode: 409,
              });
            }
          }

          const option = await tx.attributeOption.update({
            where: { id: current.id },
            data: {
              ...(next ? { value: next.value, normalizedValue: next.normalizedValue } : {}),
              ...(dto.position !== undefined ? { position: dto.position } : {}),
            },
          });

          const before = this.optionSnapshot(current);
          const after = this.optionSnapshot(option);
          const audited = await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.ATTRIBUTE_OPTION_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.ATTRIBUTE_OPTION,
            entityId: option.id,
            before,
            after,
            metadata: { attributeId: option.attributeDefinitionId },
          });

          if (audited) {
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.CATALOG_ATTRIBUTE_OPTION_UPDATED,
                payload: {
                  companyId: company.companyId,
                  attributeId: option.attributeDefinitionId,
                  optionId: option.id,
                },
              }),
            );
          }

          return option;
        });

        return this.toOptionView(updated);
      } catch (error) {
        mapCatalogUniqueViolation(error, 'attribute_option');
      }
    });
  }

  async deactivateOption(company: CompanyContext, optionId: string): Promise<AttributeOptionView> {
    const current = await this.database.client.attributeOption.findFirst({
      where: { id: optionId, companyId: company.companyId },
    });
    if (!current) throw this.optionNotFound();
    if (!current.isActive) return this.toOptionView(current);

    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const option = await tx.attributeOption.update({
          where: { id: current.id },
          data: { isActive: false },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.ATTRIBUTE_OPTION_DEACTIVATED,
          entityType: AUDIT_ENTITY_TYPES.ATTRIBUTE_OPTION,
          entityId: option.id,
          before: this.optionSnapshot(current),
          after: this.optionSnapshot(option),
          metadata: { attributeId: option.attributeDefinitionId },
        });

        return option;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.CATALOG_ATTRIBUTE_OPTION_DEACTIVATED,
          payload: {
            companyId: company.companyId,
            attributeId: updated.attributeDefinitionId,
            optionId: updated.id,
          },
        }),
      );

      return this.toOptionView(updated);
    });
  }

  async activateOption(company: CompanyContext, optionId: string): Promise<AttributeOptionView> {
    const current = await this.database.client.attributeOption.findFirst({
      where: { id: optionId, companyId: company.companyId },
    });
    if (!current) throw this.optionNotFound();
    if (current.isActive) return this.toOptionView(current);

    const definition = await this.requireDefinition(
      company.companyId,
      current.attributeDefinitionId,
    );
    this.assertSelectType(definition.type);

    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const option = await tx.attributeOption.update({
          where: { id: current.id },
          data: { isActive: true },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.ATTRIBUTE_OPTION_ACTIVATED,
          entityType: AUDIT_ENTITY_TYPES.ATTRIBUTE_OPTION,
          entityId: option.id,
          before: this.optionSnapshot(current),
          after: this.optionSnapshot(option),
          metadata: { attributeId: option.attributeDefinitionId },
        });

        return option;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.CATALOG_ATTRIBUTE_OPTION_ACTIVATED,
          payload: {
            companyId: company.companyId,
            attributeId: updated.attributeDefinitionId,
            optionId: updated.id,
          },
        }),
      );

      return this.toOptionView(updated);
    });
  }

  private async assertTypeChangeAllowed(companyId: string, attributeId: string): Promise<void> {
    const [optionCount, productValueCount, skuValueCount] = await Promise.all([
      this.database.client.attributeOption.count({
        where: { companyId, attributeDefinitionId: attributeId },
      }),
      this.database.client.productAttributeValue.count({
        where: { companyId, attributeDefinitionId: attributeId },
      }),
      this.database.client.skuAttributeValue.count({
        where: { companyId, attributeDefinitionId: attributeId },
      }),
    ]);
    if (optionCount > 0 || productValueCount > 0 || skuValueCount > 0) {
      throw new AppError({
        code: ERROR_CODES.ATTRIBUTE_TYPE_CHANGE_BLOCKED,
        message: CATALOG_ERROR_MESSAGES.ATTRIBUTE_TYPE_CHANGE_BLOCKED,
        statusCode: 400,
      });
    }
  }

  private assertSelectType(type: AttributeType): void {
    if (type !== AttributeType.SINGLE_SELECT && type !== AttributeType.MULTI_SELECT) {
      throw new AppError({
        code: ERROR_CODES.ATTRIBUTE_SELECT_REQUIRED_TYPE,
        message: CATALOG_ERROR_MESSAGES.ATTRIBUTE_SELECT_REQUIRED_TYPE,
        statusCode: 400,
      });
    }
  }

  private normalizeUnit(value: string): string {
    const unit = normalizeDisplayName(value);
    if (!unit) {
      throw AppError.validation('Unit must not be empty when provided.');
    }
    return unit;
  }

  private normalizeDescription(value: string): string {
    return normalizeDisplayName(value);
  }

  private mapDefinitionUnique(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = error.meta?.target;
      const joined = Array.isArray(target)
        ? target.join(',').toLowerCase()
        : String(target ?? '').toLowerCase();
      if (joined.includes('normalized_code') || joined.includes('code')) {
        mapCatalogUniqueViolation(error, 'attribute_code');
      }
      if (joined.includes('normalized_name')) {
        mapCatalogUniqueViolation(error, 'attribute_code');
      }
    }
    mapCatalogUniqueViolation(error, 'attribute_code');
  }

  private async requireDefinition(companyId: string, attributeId: string) {
    const row = await this.database.client.attributeDefinition.findFirst({
      where: { id: attributeId, companyId },
    });
    if (!row) throw this.attributeNotFound();
    return row;
  }

  private async requireOption(
    tx: Prisma.TransactionClient,
    companyId: string,
    optionId: string,
  ) {
    const row = await tx.attributeOption.findFirst({
      where: { id: optionId, companyId },
    });
    if (!row) throw this.optionNotFound();
    return row;
  }

  private attributeNotFound(): AppError {
    return new AppError({
      code: ERROR_CODES.ATTRIBUTE_NOT_FOUND,
      message: CATALOG_ERROR_MESSAGES.ATTRIBUTE_NOT_FOUND,
      statusCode: 404,
    });
  }

  private optionNotFound(): AppError {
    return new AppError({
      code: ERROR_CODES.ATTRIBUTE_OPTION_NOT_FOUND,
      message: CATALOG_ERROR_MESSAGES.ATTRIBUTE_OPTION_NOT_FOUND,
      statusCode: 404,
    });
  }

  private definitionSnapshot(row: {
    id: string;
    name: string;
    code: string;
    type: AttributeType;
    scope: string;
    unit: string | null;
    description: string | null;
    status: CatalogLifecycleStatus;
    archivedAt: Date | null;
  }) {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      type: row.type,
      scope: row.scope,
      unit: row.unit,
      description: row.description,
      status: row.status,
      archivedAt: row.archivedAt?.toISOString() ?? null,
    };
  }

  private optionSnapshot(row: {
    id: string;
    attributeDefinitionId: string;
    value: string;
    position: number;
    isActive: boolean;
  }) {
    return {
      id: row.id,
      attributeDefinitionId: row.attributeDefinitionId,
      value: row.value,
      position: row.position,
      isActive: row.isActive,
    };
  }

  private toDefinitionView(
    row: {
      id: string;
      companyId: string;
      name: string;
      code: string;
      type: AttributeType;
      scope: import('@hector/database').AttributeScope;
      unit: string | null;
      description: string | null;
      status: CatalogLifecycleStatus;
      createdAt: Date;
      updatedAt: Date;
      archivedAt: Date | null;
    },
    options?: AttributeOptionView[],
  ): AttributeDefinitionView {
    return {
      id: row.id,
      companyId: row.companyId,
      name: row.name,
      code: row.code,
      type: row.type,
      scope: row.scope,
      unit: row.unit,
      description: row.description,
      status: row.status,
      ...(options !== undefined ? { options } : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
    };
  }

  private toOptionView(row: {
    id: string;
    attributeDefinitionId: string;
    value: string;
    position: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): AttributeOptionView {
    return {
      id: row.id,
      attributeDefinitionId: row.attributeDefinitionId,
      value: row.value,
      position: row.position,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
