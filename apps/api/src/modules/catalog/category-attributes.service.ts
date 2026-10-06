import { Injectable } from '@nestjs/common';
import { Prisma } from '@hector/database';
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
import { CATALOG_ERROR_MESSAGES } from './catalog.constants';
import { mapCatalogUniqueViolation } from './catalog-unique.error';
import type { PutCategoryAttributesDto } from './dto/put-category-attributes.dto';
import type {
  AttributeDefinitionView,
  CategoryAttributeAssignmentView,
  CategoryAttributeSuggestionView,
} from './types/catalog.types';

type CategoryNode = { id: string; parentId: string | null };

@Injectable()
export class CategoryAttributesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async listAssigned(
    company: CompanyContext,
    categoryId: string,
  ): Promise<CategoryAttributeAssignmentView[]> {
    await this.requireCategory(company.companyId, categoryId);
    const rows = await this.database.client.categoryAttribute.findMany({
      where: { companyId: company.companyId, categoryId },
      include: { attributeDefinition: true },
      orderBy: [{ position: 'asc' }, { attributeDefinitionId: 'asc' }],
    });
    return rows.map((row) => this.toAssignmentView(row.attributeDefinition, row));
  }

  async listSuggested(
    company: CompanyContext,
    categoryId: string,
  ): Promise<CategoryAttributeSuggestionView[]> {
    await this.requireCategory(company.companyId, categoryId);
    const allCategories = await this.database.client.category.findMany({
      where: { companyId: company.companyId },
      select: { id: true, parentId: true },
    });
    const chain = this.ancestorChainRootToLeaf(allCategories, categoryId);

    const assignments = await this.database.client.categoryAttribute.findMany({
      where: { companyId: company.companyId, categoryId: { in: chain } },
      include: { attributeDefinition: true },
      orderBy: [{ position: 'asc' }, { attributeDefinitionId: 'asc' }],
    });

    const byCategory = new Map<string, typeof assignments>();
    for (const row of assignments) {
      const list = byCategory.get(row.categoryId) ?? [];
      list.push(row);
      byCategory.set(row.categoryId, list);
    }

    const merged = new Map<
      string,
      {
        attribute: Prisma.AttributeDefinitionGetPayload<object>;
        position: number;
        isVisible: boolean;
        sourceCategoryId: string;
      }
    >();

    for (const catId of chain) {
      const rows = byCategory.get(catId) ?? [];
      for (const row of rows) {
        merged.set(row.attributeDefinitionId, {
          attribute: row.attributeDefinition,
          position: row.position,
          isVisible: row.isVisible,
          sourceCategoryId: catId,
        });
      }
    }

    return [...merged.values()]
      .filter((entry) => entry.isVisible)
      .sort((a, b) => a.position - b.position || a.attribute.name.localeCompare(b.attribute.name))
      .map((entry) => ({
        attributeId: entry.attribute.id,
        attribute: this.toDefinitionView(entry.attribute),
        position: entry.position,
        isVisible: entry.isVisible,
        sourceCategoryId: entry.sourceCategoryId,
      }));
  }

  async replaceAssigned(
    company: CompanyContext,
    categoryId: string,
    dto: PutCategoryAttributesDto,
  ): Promise<CategoryAttributeAssignmentView[]> {
    await this.requireCategory(company.companyId, categoryId);
    this.assertUniqueAttributeIds(dto);

    const attributeIds = dto.attributes.map((a) => a.attributeId);
    if (attributeIds.length > 0) {
      const found = await this.database.client.attributeDefinition.findMany({
        where: { companyId: company.companyId, id: { in: attributeIds } },
        select: { id: true },
      });
      if (found.length !== attributeIds.length) {
        throw new AppError({
          code: ERROR_CODES.ATTRIBUTE_NOT_FOUND,
          message: CATALOG_ERROR_MESSAGES.ATTRIBUTE_NOT_FOUND,
          statusCode: 404,
        });
      }
    }

    const beforeRows = await this.database.client.categoryAttribute.findMany({
      where: { companyId: company.companyId, categoryId },
      orderBy: [{ position: 'asc' }, { attributeDefinitionId: 'asc' }],
    });
    const beforeSnapshot = beforeRows.map((r) => ({
      attributeId: r.attributeDefinitionId,
      position: r.position,
      isVisible: r.isVisible,
    }));

    const afterSnapshot = dto.attributes.map((item, index) => ({
      attributeId: item.attributeId,
      position: item.position ?? index,
      isVisible: item.isVisible ?? true,
    }));

    const unchanged =
      beforeSnapshot.length === afterSnapshot.length &&
      beforeSnapshot.every(
        (b, i) =>
          b.attributeId === afterSnapshot[i]!.attributeId &&
          b.position === afterSnapshot[i]!.position &&
          b.isVisible === afterSnapshot[i]!.isVisible,
      );

    if (unchanged) {
      return this.listAssigned(company, categoryId);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        await this.database.client.$transaction(async (tx) => {
          await tx.categoryAttribute.deleteMany({
            where: { companyId: company.companyId, categoryId },
          });

          for (let index = 0; index < dto.attributes.length; index++) {
            const item = dto.attributes[index]!;
            await tx.categoryAttribute.create({
              data: {
                companyId: company.companyId,
                categoryId,
                attributeDefinitionId: item.attributeId,
                position: item.position ?? index,
                isVisible: item.isVisible ?? true,
              },
            });
          }

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.CATEGORY_ATTRIBUTES_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.CATEGORY_ATTRIBUTES,
            entityId: categoryId,
            before: { attributes: beforeSnapshot },
            after: { attributes: afterSnapshot },
          });
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.CATALOG_CATEGORY_ATTRIBUTES_UPDATED,
            payload: { companyId: company.companyId, categoryId },
          }),
        );

        return this.listAssigned(company, categoryId);
      } catch (error) {
        mapCatalogUniqueViolation(error, 'category_attribute');
      }
    });
  }

  private ancestorChainRootToLeaf(all: CategoryNode[], categoryId: string): string[] {
    const byId = new Map(all.map((c) => [c.id, c]));
    const chain: string[] = [];
    let current: string | null = categoryId;
    while (current) {
      chain.push(current);
      current = byId.get(current)?.parentId ?? null;
    }
    return chain.reverse();
  }

  private assertUniqueAttributeIds(dto: PutCategoryAttributesDto): void {
    const seen = new Set<string>();
    for (const item of dto.attributes) {
      if (seen.has(item.attributeId)) {
        throw AppError.validation('Duplicate attributeId in request.');
      }
      seen.add(item.attributeId);
    }
  }

  private async requireCategory(companyId: string, categoryId: string): Promise<void> {
    const row = await this.database.client.category.findFirst({
      where: { id: categoryId, companyId },
      select: { id: true },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.CATEGORY_NOT_FOUND,
        message: CATALOG_ERROR_MESSAGES.CATEGORY_NOT_FOUND,
        statusCode: 404,
      });
    }
  }

  private toAssignmentView(
    attribute: Prisma.AttributeDefinitionGetPayload<object>,
    row: { position: number; isVisible: boolean },
  ): CategoryAttributeAssignmentView {
    return {
      attributeId: attribute.id,
      attribute: this.toDefinitionView(attribute),
      position: row.position,
      isVisible: row.isVisible,
    };
  }

  private toDefinitionView(
    row: Prisma.AttributeDefinitionGetPayload<object>,
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
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
    };
  }
}
