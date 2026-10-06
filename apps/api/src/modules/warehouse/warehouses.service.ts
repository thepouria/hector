import { Injectable } from '@nestjs/common';
import { Prisma, WarehouseStatus } from '@hector/database';
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
import type { CreateWarehouseDto } from './dto/create-warehouse.dto';
import type { DeactivateWarehouseDto } from './dto/deactivate-warehouse.dto';
import type { ListWarehousesQueryDto } from './dto/list-warehouses.query.dto';
import type { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { WAREHOUSE_ERROR_MESSAGES } from './warehouse.constants';
import {
  assertOptionalAddress,
  assertOptionalNotes,
  assertWarehouseCode,
  assertWarehouseName,
  mapWarehouseUniqueViolation,
  normalizeSearchQuery,
} from './warehouse.normalization';
import type { WarehouseOptionView, WarehouseView } from './types/warehouse.types';

type WarehouseRow = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  status: WarehouseStatus;
  isDefault: boolean;
  address: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class WarehousesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    query: ListWarehousesQueryDto,
  ): Promise<{ data: (WarehouseView | WarehouseOptionView)[]; meta: PaginationMeta }> {
    const search = normalizeSearchQuery(query.search);
    const where: Prisma.WarehouseWhereInput = {
      companyId: company.companyId,
      // System transit warehouse is not an operational user warehouse.
      isSystem: false,
      ...(query.status ? { status: query.status } : {}),
      ...(query.isDefault !== undefined ? { isDefault: query.isDefault } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
              { address: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const orderBy: Prisma.WarehouseOrderByWithRelationInput = {
      [query.sortBy]: query.sortOrder,
    };

    if (query.view === 'options') {
      const [total, rows] = await this.database.client.$transaction([
        this.database.client.warehouse.count({ where }),
        this.database.client.warehouse.findMany({
          where,
          orderBy,
          skip,
          take: query.pageSize,
          select: { id: true, code: true, name: true, status: true, isDefault: true },
        }),
      ]);
      return {
        data: rows,
        meta: buildPaginationMeta(query.page, query.pageSize, total),
      };
    }

    const [total, rows] = await this.database.client.$transaction([
      this.database.client.warehouse.count({ where }),
      this.database.client.warehouse.findMany({
        where,
        orderBy,
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      data: rows.map((row) => this.toView(row)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, warehouseId: string): Promise<WarehouseView> {
    return this.toView(await this.requireWarehouse(company.companyId, warehouseId));
  }

  async create(company: CompanyContext, dto: CreateWarehouseDto): Promise<WarehouseView> {
    const code = assertWarehouseCode(dto.code);
    const name = assertWarehouseName(dto.name);
    const address = assertOptionalAddress(dto.address);
    const notes = assertOptionalNotes(dto.notes);
    const requestDefault = dto.isDefault === true;

    return commitThenPublish(this.eventBus, async (events) => {
      // Concurrent first-warehouse races may lose the default unique slot; retry once
      // as non-default so a valid sibling warehouse can still be created.
      for (let attempt = 0; attempt < 2; attempt++) {
        const forceNonDefault = attempt > 0;
        try {
          const created = await this.database.client.$transaction(async (tx) => {
            const activeCount = await tx.warehouse.count({
              where: { companyId: company.companyId, status: WarehouseStatus.ACTIVE },
            });
            const makeDefault =
              !forceNonDefault && (activeCount === 0 || requestDefault);

            const previousDefault = makeDefault
              ? await tx.warehouse.findFirst({
                  where: { companyId: company.companyId, isDefault: true },
                  select: { id: true },
                })
              : null;

            if (makeDefault) {
              await tx.warehouse.updateMany({
                where: { companyId: company.companyId, isDefault: true },
                data: { isDefault: false },
              });
            }

            const warehouse = await tx.warehouse.create({
              data: {
                companyId: company.companyId,
                code,
                name,
                address,
                notes,
                status: WarehouseStatus.ACTIVE,
                isDefault: makeDefault,
              },
            });

            await this.auditService.record(tx, {
              action: AUDIT_ACTIONS.WAREHOUSE_CREATED,
              entityType: AUDIT_ENTITY_TYPES.WAREHOUSE,
              entityId: warehouse.id,
              before: null,
              after: this.snapshot(warehouse),
            });

            if (makeDefault) {
              await this.auditService.record(tx, {
                action: AUDIT_ACTIONS.WAREHOUSE_DEFAULT_CHANGED,
                entityType: AUDIT_ENTITY_TYPES.WAREHOUSE,
                entityId: warehouse.id,
                before: { previousWarehouseId: previousDefault?.id ?? null },
                after: { newWarehouseId: warehouse.id, isDefault: true },
                metadata: { companyId: company.companyId },
              });
            }

            return { warehouse, previousDefaultId: previousDefault?.id ?? null, makeDefault };
          });

          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.WAREHOUSE_CREATED,
              payload: {
                companyId: company.companyId,
                warehouseId: created.warehouse.id,
                code: created.warehouse.code,
              },
            }),
          );

          if (created.makeDefault) {
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.WAREHOUSE_DEFAULT_CHANGED,
                payload: {
                  companyId: company.companyId,
                  previousWarehouseId: created.previousDefaultId,
                  newWarehouseId: created.warehouse.id,
                },
              }),
            );
          }

          return this.toView(created.warehouse);
        } catch (error) {
          if (
            forceNonDefault ||
            !this.isDefaultUniqueViolation(error) ||
            requestDefault
          ) {
            mapWarehouseUniqueViolation(error);
          }
          // else: retry as non-default
        }
      }
      throw new Error('Warehouse create retry exhausted');
    });
  }

  private isDefaultUniqueViolation(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }
    const target = Array.isArray(error.meta?.target)
      ? (error.meta.target as string[]).join(',')
      : String(error.meta?.target ?? '');
    // Code uniqueness must not be retried as a default race.
    if (target.includes('code') || target.includes('warehouses_company_id_code')) {
      return false;
    }
    // Partial unique index on company_id WHERE is_default often reports target as company_id only.
    return (
      target.includes('one_default') ||
      target.includes('is_default') ||
      target.includes('default') ||
      target.includes('company_id') ||
      target.includes('companyId') ||
      target.length === 0
    );
  }

  async update(
    company: CompanyContext,
    warehouseId: string,
    dto: UpdateWarehouseDto,
  ): Promise<WarehouseView> {
    const current = await this.requireWarehouse(company.companyId, warehouseId);
    if (
      dto.code === undefined &&
      dto.name === undefined &&
      dto.address === undefined &&
      dto.notes === undefined
    ) {
      throw AppError.validation('At least one field is required to update the warehouse.');
    }

    const nextCode = dto.code !== undefined ? assertWarehouseCode(dto.code) : current.code;
    const nextName = dto.name !== undefined ? assertWarehouseName(dto.name) : current.name;
    const nextAddress =
      dto.address === undefined ? current.address : assertOptionalAddress(dto.address);
    const nextNotes = dto.notes === undefined ? current.notes : assertOptionalNotes(dto.notes);

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          const warehouse = await tx.warehouse.update({
            where: { id: current.id },
            data: {
              code: nextCode,
              name: nextName,
              address: nextAddress,
              notes: nextNotes,
            },
          });

          const before = this.snapshot(current);
          const after = this.snapshot(warehouse);
          const audited = await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.WAREHOUSE_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.WAREHOUSE,
            entityId: warehouse.id,
            before,
            after,
          });

          return { warehouse, audited, before, after };
        });

        if (updated.audited) {
          const changedFields = Object.keys(updated.before).filter(
            (key) =>
              !auditSnapshotsEqual(
                (updated.before as Record<string, unknown>)[key],
                (updated.after as Record<string, unknown>)[key],
              ),
          );
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.WAREHOUSE_UPDATED,
              payload: {
                companyId: company.companyId,
                warehouseId: updated.warehouse.id,
                changedFields,
              },
            }),
          );
        }

        return this.toView(updated.warehouse);
      } catch (error) {
        mapWarehouseUniqueViolation(error);
      }
    });
  }

  async activate(company: CompanyContext, warehouseId: string): Promise<WarehouseView> {
    const current = await this.requireWarehouse(company.companyId, warehouseId);
    if (current.status === WarehouseStatus.ACTIVE) {
      return this.toView(current);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const warehouse = await tx.warehouse.update({
          where: { id: current.id },
          data: { status: WarehouseStatus.ACTIVE },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.WAREHOUSE_ACTIVATED,
          entityType: AUDIT_ENTITY_TYPES.WAREHOUSE,
          entityId: warehouse.id,
          before: { status: current.status },
          after: { status: warehouse.status },
        });

        return warehouse;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.WAREHOUSE_ACTIVATED,
          payload: {
            companyId: company.companyId,
            warehouseId: updated.id,
            previousStatus: current.status,
            newStatus: updated.status,
          },
        }),
      );

      return this.toView(updated);
    });
  }

  async deactivate(
    company: CompanyContext,
    warehouseId: string,
    dto: DeactivateWarehouseDto = {},
  ): Promise<WarehouseView> {
    const current = await this.requireWarehouse(company.companyId, warehouseId);
    if (current.status === WarehouseStatus.INACTIVE) {
      return this.toView(current);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const result = await this.database.client.$transaction(async (tx) => {
          const activeLocation = await tx.warehouseLocation.findFirst({
            where: {
              companyId: company.companyId,
              warehouseId: current.id,
              status: WarehouseStatus.ACTIVE,
            },
            select: { id: true },
          });
          if (activeLocation) {
            throw new AppError({
              code: ERROR_CODES.WAREHOUSE_HAS_ACTIVE_LOCATIONS,
              message: WAREHOUSE_ERROR_MESSAGES.HAS_ACTIVE_LOCATIONS,
              statusCode: 409,
            });
          }

          let previousDefaultId: string | null = null;
          let newDefaultId: string | null = null;

          if (current.isDefault) {
            const otherActive = await tx.warehouse.findMany({
              where: {
                companyId: company.companyId,
                status: WarehouseStatus.ACTIVE,
                id: { not: current.id },
              },
              select: { id: true },
              orderBy: { createdAt: 'asc' },
            });

            if (otherActive.length > 0) {
              const replacementId = dto.replacementWarehouseId;
              if (!replacementId) {
                throw new AppError({
                  code: ERROR_CODES.WAREHOUSE_DEFAULT_REPLACEMENT_REQUIRED,
                  message: WAREHOUSE_ERROR_MESSAGES.DEFAULT_REPLACEMENT_REQUIRED,
                  statusCode: 409,
                });
              }
              const replacement = otherActive.find((w) => w.id === replacementId);
              if (!replacement) {
                throw new AppError({
                  code: ERROR_CODES.WAREHOUSE_DEFAULT_REPLACEMENT_INVALID,
                  message: WAREHOUSE_ERROR_MESSAGES.DEFAULT_REPLACEMENT_INVALID,
                  statusCode: 409,
                });
              }

              previousDefaultId = current.id;
              await tx.warehouse.updateMany({
                where: { companyId: company.companyId, isDefault: true },
                data: { isDefault: false },
              });
              await tx.warehouse.update({
                where: { id: replacement.id },
                data: { isDefault: true },
              });
              newDefaultId = replacement.id;

              await this.auditService.record(tx, {
                action: AUDIT_ACTIONS.WAREHOUSE_DEFAULT_CHANGED,
                entityType: AUDIT_ENTITY_TYPES.WAREHOUSE,
                entityId: replacement.id,
                before: { previousWarehouseId: previousDefaultId },
                after: { newWarehouseId: newDefaultId, isDefault: true },
                metadata: { companyId: company.companyId, reason: 'default_deactivated' },
              });
            }
          }

          const warehouse = await tx.warehouse.update({
            where: { id: current.id },
            data: {
              status: WarehouseStatus.INACTIVE,
              isDefault: false,
            },
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.WAREHOUSE_DEACTIVATED,
            entityType: AUDIT_ENTITY_TYPES.WAREHOUSE,
            entityId: warehouse.id,
            before: { status: current.status, isDefault: current.isDefault },
            after: { status: warehouse.status, isDefault: warehouse.isDefault },
          });

          return { warehouse, previousDefaultId, newDefaultId };
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_DEACTIVATED,
            payload: {
              companyId: company.companyId,
              warehouseId: result.warehouse.id,
              previousStatus: current.status,
              newStatus: result.warehouse.status,
            },
          }),
        );

        if (result.newDefaultId) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.WAREHOUSE_DEFAULT_CHANGED,
              payload: {
                companyId: company.companyId,
                previousWarehouseId: result.previousDefaultId,
                newWarehouseId: result.newDefaultId,
              },
            }),
          );
        }

        return this.toView(result.warehouse);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        mapWarehouseUniqueViolation(error);
      }
    });
  }

  async setDefault(company: CompanyContext, warehouseId: string): Promise<WarehouseView> {
    const current = await this.requireWarehouse(company.companyId, warehouseId);
    if (current.status !== WarehouseStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_DEFAULT_REQUIRES_ACTIVE,
        message: WAREHOUSE_ERROR_MESSAGES.DEFAULT_REQUIRES_ACTIVE,
        statusCode: 409,
      });
    }
    if (current.isDefault) {
      return this.toView(current);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const result = await this.database.client.$transaction(async (tx) => {
          const previous = await tx.warehouse.findFirst({
            where: { companyId: company.companyId, isDefault: true },
            select: { id: true },
          });

          await tx.warehouse.updateMany({
            where: { companyId: company.companyId, isDefault: true },
            data: { isDefault: false },
          });

          const warehouse = await tx.warehouse.update({
            where: { id: current.id },
            data: { isDefault: true },
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.WAREHOUSE_DEFAULT_CHANGED,
            entityType: AUDIT_ENTITY_TYPES.WAREHOUSE,
            entityId: warehouse.id,
            before: { previousWarehouseId: previous?.id ?? null },
            after: { newWarehouseId: warehouse.id, isDefault: true },
            metadata: { companyId: company.companyId },
          });

          return { warehouse, previousWarehouseId: previous?.id ?? null };
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_DEFAULT_CHANGED,
            payload: {
              companyId: company.companyId,
              previousWarehouseId: result.previousWarehouseId,
              newWarehouseId: result.warehouse.id,
            },
          }),
        );

        return this.toView(result.warehouse);
      } catch (error) {
        mapWarehouseUniqueViolation(error);
      }
    });
  }

  private async requireWarehouse(companyId: string, warehouseId: string): Promise<WarehouseRow> {
    const row = await this.database.client.warehouse.findFirst({
      where: { id: warehouseId, companyId },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_NOT_FOUND,
        message: WAREHOUSE_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private toView(row: WarehouseRow): WarehouseView {
    return {
      id: row.id,
      companyId: row.companyId,
      code: row.code,
      name: row.name,
      status: row.status,
      isDefault: row.isDefault,
      address: row.address,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private snapshot(row: WarehouseRow) {
    return {
      code: row.code,
      name: row.name,
      status: row.status,
      isDefault: row.isDefault,
      address: row.address,
      notes: row.notes,
    };
  }
}
