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
  assertBrandName,
  assertInternalCode,
  normalizeSearchQuery,
} from './catalog.normalization';
import type { CreateBrandDto } from './dto/create-brand.dto';
import type { ListBrandsQueryDto } from './dto/list-brands.query.dto';
import type { UpdateBrandDto } from './dto/update-brand.dto';
import type { BrandView, CatalogOptionView } from './types/catalog.types';

@Injectable()
export class BrandsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    query: ListBrandsQueryDto,
  ): Promise<{ data: (BrandView | CatalogOptionView)[]; meta: PaginationMeta }> {
    const optionsView = query.view === 'options';
    const search = normalizeSearchQuery(query.search, CATALOG_SEARCH_MAX_LENGTH);
    const where: Prisma.BrandWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
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
    const orderBy: Prisma.BrandOrderByWithRelationInput = {
      [query.sortBy]: query.sortOrder,
    };

    const [total, rows] = await this.database.client.$transaction([
      this.database.client.brand.count({ where }),
      this.database.client.brand.findMany({
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
        : rows.map((row) => this.toView(row as Parameters<BrandsService['toView']>[0])),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, brandId: string): Promise<BrandView> {
    return this.toView(await this.requireBrand(company.companyId, brandId));
  }

  async create(company: CompanyContext, dto: CreateBrandDto): Promise<BrandView> {
    const { name, normalizedName } = assertBrandName(dto.name);
    const code = dto.code !== undefined ? assertInternalCode(dto.code, 'brand') : null;

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const created = await this.database.client.$transaction(async (tx) => {
          const brand = await tx.brand.create({
            data: {
              companyId: company.companyId,
              name,
              normalizedName,
              code,
              status: CatalogLifecycleStatus.ACTIVE,
            },
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.BRAND_CREATED,
            entityType: AUDIT_ENTITY_TYPES.BRAND,
            entityId: brand.id,
            before: null,
            after: this.snapshot(brand),
          });

          return brand;
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.CATALOG_BRAND_CREATED,
            payload: { companyId: company.companyId, brandId: created.id },
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
    brandId: string,
    dto: UpdateBrandDto,
  ): Promise<BrandView> {
    const current = await this.requireBrand(company.companyId, brandId);
    if (dto.name === undefined && dto.code === undefined) {
      throw AppError.validation('At least one field is required to update the brand.');
    }

    const nextName =
      dto.name !== undefined ? assertBrandName(dto.name) : { name: current.name, normalizedName: current.normalizedName };
    const nextCode =
      dto.code === undefined
        ? current.code
        : dto.code === null
          ? null
          : assertInternalCode(dto.code, 'brand');

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          const brand = await tx.brand.update({
            where: { id: current.id },
            data: {
              name: nextName.name,
              normalizedName: nextName.normalizedName,
              code: nextCode,
            },
          });

          const before = this.snapshot(current);
          const after = this.snapshot(brand);
          const audited = await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.BRAND_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.BRAND,
            entityId: brand.id,
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
                type: DOMAIN_EVENTS.CATALOG_BRAND_UPDATED,
                payload: {
                  companyId: company.companyId,
                  brandId: brand.id,
                  changedFields,
                },
              }),
            );
          }

          return brand;
        });

        return this.toView(updated);
      } catch (error) {
        this.mapCreateUnique(error);
      }
    });
  }

  async archive(company: CompanyContext, brandId: string): Promise<BrandView> {
    const current = await this.requireBrand(company.companyId, brandId);
    if (current.status === CatalogLifecycleStatus.ARCHIVED) {
      return this.toView(current);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const archived = await this.database.client.$transaction(async (tx) => {
        const brand = await tx.brand.update({
          where: { id: current.id },
          data: {
            status: CatalogLifecycleStatus.ARCHIVED,
            archivedAt: new Date(),
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.BRAND_ARCHIVED,
          entityType: AUDIT_ENTITY_TYPES.BRAND,
          entityId: brand.id,
          before: this.snapshot(current),
          after: this.snapshot(brand),
        });

        return brand;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.CATALOG_BRAND_ARCHIVED,
          payload: { companyId: company.companyId, brandId: archived.id },
        }),
      );

      return this.toView(archived);
    });
  }

  async activate(company: CompanyContext, brandId: string): Promise<BrandView> {
    const current = await this.requireBrand(company.companyId, brandId);
    if (current.status === CatalogLifecycleStatus.ACTIVE) {
      return this.toView(current);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const activated = await this.database.client.$transaction(async (tx) => {
        const brand = await tx.brand.update({
          where: { id: current.id },
          data: {
            status: CatalogLifecycleStatus.ACTIVE,
            archivedAt: null,
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.BRAND_ACTIVATED,
          entityType: AUDIT_ENTITY_TYPES.BRAND,
          entityId: brand.id,
          before: this.snapshot(current),
          after: this.snapshot(brand),
        });

        return brand;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.CATALOG_BRAND_ACTIVATED,
          payload: { companyId: company.companyId, brandId: activated.id },
        }),
      );

      return this.toView(activated);
    });
  }

  private mapCreateUnique(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = error.meta?.target;
      const joined = Array.isArray(target)
        ? target.join(',').toLowerCase()
        : String(target ?? '').toLowerCase();
      if (joined.includes('normalized_name')) {
        mapCatalogUniqueViolation(error, 'brand_name');
      }
      if (joined.includes('code')) {
        mapCatalogUniqueViolation(error, 'brand_code');
      }
    }
    mapCatalogUniqueViolation(error, 'brand_name');
  }

  private async requireBrand(companyId: string, brandId: string) {
    const row = await this.database.client.brand.findFirst({
      where: { id: brandId, companyId },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.BRAND_NOT_FOUND,
        message: CATALOG_ERROR_MESSAGES.BRAND_NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private snapshot(brand: {
    id: string;
    name: string;
    code: string | null;
    status: CatalogLifecycleStatus;
    archivedAt: Date | null;
  }) {
    return {
      id: brand.id,
      name: brand.name,
      code: brand.code,
      status: brand.status,
      archivedAt: brand.archivedAt?.toISOString() ?? null,
    };
  }

  private toView(row: {
    id: string;
    companyId: string;
    name: string;
    code: string | null;
    status: CatalogLifecycleStatus;
    createdAt: Date;
    updatedAt: Date;
    archivedAt: Date | null;
  }): BrandView {
    return {
      id: row.id,
      companyId: row.companyId,
      name: row.name,
      code: row.code,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
    };
  }
}
