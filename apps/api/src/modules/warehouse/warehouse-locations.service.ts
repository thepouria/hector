import { Injectable } from '@nestjs/common';
import { Prisma, WarehouseLocationType, WarehouseStatus } from '@hector/database';
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
import type { CreateWarehouseLocationDto } from './dto/create-warehouse-location.dto';
import type { ListWarehouseLocationsQueryDto } from './dto/list-warehouse-locations.query.dto';
import type { UpdateWarehouseLocationDto } from './dto/update-warehouse-location.dto';
import {
  generateLocationBarcode,
  normalizeLocationBarcodeInput,
} from './location-barcode.util';
import {
  buildBreadcrumb,
  buildLocationTree,
  collectDescendantIds,
  wouldCreateCycle,
} from './warehouse-location.hierarchy';
import { LOCATION_ERROR_MESSAGES } from './warehouse-location.constants';
import {
  assertLocationCode,
  assertLocationType,
  assertOptionalLocationName,
  assertOptionalLocationNotes,
  assertTypeHierarchy,
  mapLocationUniqueViolation,
  normalizeSearchQuery,
} from './warehouse-location.normalization';
import type {
  WarehouseLocationTreeNode,
  WarehouseLocationView,
} from './types/warehouse-location.types';

type LocationRow = {
  id: string;
  companyId: string;
  warehouseId: string;
  parentId: string | null;
  type: WarehouseLocationType;
  code: string;
  name: string | null;
  barcode: string;
  status: WarehouseStatus;
  sortOrder: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class WarehouseLocationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    warehouseId: string,
    query: ListWarehouseLocationsQueryDto,
  ): Promise<{ data: WarehouseLocationView[] | WarehouseLocationTreeNode[]; meta: PaginationMeta }> {
    await this.requireWarehouse(company.companyId, warehouseId);
    const search = normalizeSearchQuery(query.search);
    const where: Prisma.WarehouseLocationWhereInput = {
      companyId: company.companyId,
      warehouseId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.parentId !== undefined ? { parentId: query.parentId } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
              { barcode: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    if (query.view === 'tree') {
      // Load all matching rows for the warehouse filter (no N+1); tree is built in memory.
      const rows = await this.database.client.warehouseLocation.findMany({
        where: {
          companyId: company.companyId,
          warehouseId,
          ...(query.status ? { status: query.status } : {}),
          ...(query.type ? { type: query.type } : {}),
          ...(search
            ? {
                OR: [
                  { code: { contains: search, mode: 'insensitive' } },
                  { name: { contains: search, mode: 'insensitive' } },
                  { barcode: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      });
      const tree = buildLocationTree(rows.map((row) => this.toView(row)));
      return {
        data: tree,
        meta: buildPaginationMeta(1, Math.max(rows.length, 1), rows.length),
      };
    }

    const skip = (query.page - 1) * query.pageSize;
    const orderBy: Prisma.WarehouseLocationOrderByWithRelationInput = {
      [query.sortBy]: query.sortOrder,
    };
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.warehouseLocation.count({ where }),
      this.database.client.warehouseLocation.findMany({
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

  async get(
    company: CompanyContext,
    warehouseId: string,
    locationId: string,
  ): Promise<WarehouseLocationView> {
    const location = await this.requireLocation(company.companyId, warehouseId, locationId);
    const all = await this.database.client.warehouseLocation.findMany({
      where: { companyId: company.companyId, warehouseId },
      select: { id: true, parentId: true, code: true, name: true },
    });
    const byId = new Map(all.map((row) => [row.id, row]));
    return {
      ...this.toView(location),
      breadcrumb: buildBreadcrumb(byId, location.id),
    };
  }

  async create(
    company: CompanyContext,
    warehouseId: string,
    dto: CreateWarehouseLocationDto,
  ): Promise<WarehouseLocationView> {
    const warehouse = await this.requireWarehouse(company.companyId, warehouseId);
    if (warehouse.status !== WarehouseStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_LOCATION_WAREHOUSE_INACTIVE,
        message: LOCATION_ERROR_MESSAGES.WAREHOUSE_INACTIVE,
        statusCode: 409,
      });
    }

    const code = assertLocationCode(dto.code);
    const type = assertLocationType(dto.type);
    const name = assertOptionalLocationName(dto.name);
    const notes = assertOptionalLocationNotes(dto.notes);
    const sortOrder = dto.sortOrder ?? 0;
    const parentId = dto.parentId === undefined ? null : dto.parentId;

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const created = await this.database.client.$transaction(async (tx) => {
          const parent = await this.resolveParent(tx, company.companyId, warehouseId, parentId);
          assertTypeHierarchy(type, parent?.type ?? null);

          let barcode = generateLocationBarcode();
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              const location = await tx.warehouseLocation.create({
                data: {
                  companyId: company.companyId,
                  warehouseId,
                  parentId,
                  type,
                  code,
                  name,
                  notes,
                  sortOrder,
                  barcode,
                  status: WarehouseStatus.ACTIVE,
                },
              });

              await this.auditService.record(tx, {
                action: AUDIT_ACTIONS.WAREHOUSE_LOCATION_CREATED,
                entityType: AUDIT_ENTITY_TYPES.WAREHOUSE_LOCATION,
                entityId: location.id,
                before: null,
                after: this.snapshot(location),
              });

              return location;
            } catch (error) {
              if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002'
              ) {
                const target = Array.isArray(error.meta?.target)
                  ? (error.meta.target as string[]).join(',')
                  : String(error.meta?.target ?? '');
                if (target.includes('barcode') && attempt < 4) {
                  barcode = generateLocationBarcode();
                  continue;
                }
              }
              throw error;
            }
          }
          throw new AppError({
            code: ERROR_CODES.WAREHOUSE_LOCATION_BARCODE_CONFLICT,
            message: LOCATION_ERROR_MESSAGES.BARCODE_CONFLICT,
            statusCode: 409,
          });
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_LOCATION_CREATED,
            payload: {
              companyId: company.companyId,
              warehouseId,
              locationId: created.id,
              type: created.type,
              code: created.code,
            },
          }),
        );

        return this.toView(created);
      } catch (error) {
        if (error instanceof AppError) throw error;
        mapLocationUniqueViolation(error);
      }
    });
  }

  async update(
    company: CompanyContext,
    warehouseId: string,
    locationId: string,
    dto: UpdateWarehouseLocationDto,
  ): Promise<WarehouseLocationView> {
    const current = await this.requireLocation(company.companyId, warehouseId, locationId);
    if (
      dto.code === undefined &&
      dto.name === undefined &&
      dto.notes === undefined &&
      dto.parentId === undefined &&
      dto.type === undefined &&
      dto.sortOrder === undefined
    ) {
      throw AppError.validation('At least one field is required to update the location.');
    }

    const nextCode = dto.code !== undefined ? assertLocationCode(dto.code) : current.code;
    const nextType = dto.type !== undefined ? assertLocationType(dto.type) : current.type;
    const nextName =
      dto.name === undefined ? current.name : assertOptionalLocationName(dto.name);
    const nextNotes =
      dto.notes === undefined ? current.notes : assertOptionalLocationNotes(dto.notes);
    const nextSortOrder = dto.sortOrder !== undefined ? dto.sortOrder : current.sortOrder;
    const nextParentId = dto.parentId !== undefined ? dto.parentId : current.parentId;
    const parentChanged = nextParentId !== current.parentId;

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const result = await this.database.client.$transaction(async (tx) => {
          // Serialize hierarchy mutations for this warehouse (cycle safety under concurrency).
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(
              hashtext(${`wh-loc:${company.companyId}:${warehouseId}`})::bigint
            )`;

          const locked = await tx.warehouseLocation.findFirst({
            where: { id: locationId, companyId: company.companyId, warehouseId },
          });
          if (!locked) {
            throw new AppError({
              code: ERROR_CODES.WAREHOUSE_LOCATION_NOT_FOUND,
              message: LOCATION_ERROR_MESSAGES.NOT_FOUND,
              statusCode: 404,
            });
          }

          if (parentChanged) {
            if (nextParentId === locked.id) {
              throw new AppError({
                code: ERROR_CODES.WAREHOUSE_LOCATION_CYCLE,
                message: LOCATION_ERROR_MESSAGES.SELF_PARENT,
                statusCode: 409,
              });
            }
            const all = await tx.warehouseLocation.findMany({
              where: { companyId: company.companyId, warehouseId },
              select: { id: true, parentId: true, type: true },
            });
            const byId = new Map(all.map((row) => [row.id, row]));
            if (nextParentId) {
              const parent = byId.get(nextParentId);
              if (!parent) {
                throw new AppError({
                  code: ERROR_CODES.WAREHOUSE_LOCATION_INVALID_PARENT,
                  message: LOCATION_ERROR_MESSAGES.INVALID_PARENT,
                  statusCode: 409,
                });
              }
              if (wouldCreateCycle(byId, locked.id, nextParentId)) {
                throw new AppError({
                  code: ERROR_CODES.WAREHOUSE_LOCATION_CYCLE,
                  message: LOCATION_ERROR_MESSAGES.CYCLE,
                  statusCode: 409,
                });
              }
              assertTypeHierarchy(nextType, parent.type);
            } else {
              assertTypeHierarchy(nextType, null);
            }
          } else if (dto.type !== undefined && locked.parentId) {
            const parent = await tx.warehouseLocation.findFirst({
              where: {
                id: locked.parentId,
                companyId: company.companyId,
                warehouseId,
              },
              select: { type: true },
            });
            assertTypeHierarchy(nextType, parent?.type ?? null);
          }

          const location = await tx.warehouseLocation.update({
            where: { id: locked.id },
            data: {
              code: nextCode,
              type: nextType,
              name: nextName,
              notes: nextNotes,
              sortOrder: nextSortOrder,
              parentId: nextParentId,
            },
          });

          const before = this.snapshot(locked);
          const after = this.snapshot(location);

          if (parentChanged) {
            await this.auditService.record(tx, {
              action: AUDIT_ACTIONS.WAREHOUSE_LOCATION_MOVED,
              entityType: AUDIT_ENTITY_TYPES.WAREHOUSE_LOCATION,
              entityId: location.id,
              before: { previousParentId: locked.parentId },
              after: { newParentId: location.parentId },
            });
          }

          const audited = await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.WAREHOUSE_LOCATION_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.WAREHOUSE_LOCATION,
            entityId: location.id,
            before,
            after,
          });

          return {
            location,
            audited,
            before,
            after,
            previousParentId: locked.parentId,
            parentChanged,
          };
        });

        if (result.parentChanged) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.WAREHOUSE_LOCATION_MOVED,
              payload: {
                companyId: company.companyId,
                warehouseId,
                locationId: result.location.id,
                previousParentId: result.previousParentId,
                newParentId: result.location.parentId,
              },
            }),
          );
        }

        if (result.audited) {
          const changedFields = Object.keys(result.before).filter(
            (key) =>
              !auditSnapshotsEqual(
                (result.before as Record<string, unknown>)[key],
                (result.after as Record<string, unknown>)[key],
              ),
          );
          if (changedFields.length > 0) {
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.WAREHOUSE_LOCATION_UPDATED,
                payload: {
                  companyId: company.companyId,
                  warehouseId,
                  locationId: result.location.id,
                  changedFields,
                },
              }),
            );
          }
        }

        return this.toView(result.location);
      } catch (error) {
        if (error instanceof AppError) throw error;
        mapLocationUniqueViolation(error);
      }
    });
  }

  async activate(
    company: CompanyContext,
    warehouseId: string,
    locationId: string,
  ): Promise<WarehouseLocationView> {
    const warehouse = await this.requireWarehouse(company.companyId, warehouseId);
    if (warehouse.status !== WarehouseStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_LOCATION_WAREHOUSE_INACTIVE,
        message: LOCATION_ERROR_MESSAGES.WAREHOUSE_INACTIVE,
        statusCode: 409,
      });
    }
    const current = await this.requireLocation(company.companyId, warehouseId, locationId);
    if (current.status === WarehouseStatus.ACTIVE) {
      return this.toView(current);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const location = await tx.warehouseLocation.update({
          where: { id: current.id },
          data: { status: WarehouseStatus.ACTIVE },
        });
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.WAREHOUSE_LOCATION_ACTIVATED,
          entityType: AUDIT_ENTITY_TYPES.WAREHOUSE_LOCATION,
          entityId: location.id,
          before: { status: current.status },
          after: { status: location.status },
        });
        return location;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.WAREHOUSE_LOCATION_ACTIVATED,
          payload: {
            companyId: company.companyId,
            warehouseId,
            locationId: updated.id,
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
    locationId: string,
  ): Promise<WarehouseLocationView> {
    const current = await this.requireLocation(company.companyId, warehouseId, locationId);
    if (current.status === WarehouseStatus.INACTIVE) {
      return this.toView(current);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        // Serialize with other hierarchy mutations; check ACTIVE descendants (any depth).
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${`wh-loc:${company.companyId}:${warehouseId}`})::bigint
          )`;

        const all = await tx.warehouseLocation.findMany({
          where: { companyId: company.companyId, warehouseId },
          select: { id: true, parentId: true, status: true },
        });
        const byId = new Map(all.map((row) => [row.id, row]));
        const descendantIds = collectDescendantIds(byId, current.id);
        const hasActiveDescendant = all.some(
          (row) =>
            descendantIds.has(row.id) && row.status === WarehouseStatus.ACTIVE,
        );
        if (hasActiveDescendant) {
          throw new AppError({
            code: ERROR_CODES.WAREHOUSE_LOCATION_ACTIVE_DESCENDANTS,
            message: LOCATION_ERROR_MESSAGES.ACTIVE_DESCENDANTS,
            statusCode: 409,
          });
        }

        const location = await tx.warehouseLocation.update({
          where: { id: current.id },
          data: { status: WarehouseStatus.INACTIVE },
        });
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.WAREHOUSE_LOCATION_DEACTIVATED,
          entityType: AUDIT_ENTITY_TYPES.WAREHOUSE_LOCATION,
          entityId: location.id,
          before: { status: current.status },
          after: { status: location.status },
        });
        return location;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.WAREHOUSE_LOCATION_DEACTIVATED,
          payload: {
            companyId: company.companyId,
            warehouseId,
            locationId: updated.id,
            previousStatus: current.status,
            newStatus: updated.status,
          },
        }),
      );

      return this.toView(updated);
    });
  }

  async resolveBarcode(
    company: CompanyContext,
    rawBarcode: string,
  ): Promise<WarehouseLocationView> {
    const barcode = normalizeLocationBarcodeInput(rawBarcode);
    if (!barcode) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_LOCATION_BARCODE_NOT_FOUND,
        message: LOCATION_ERROR_MESSAGES.BARCODE_NOT_FOUND,
        statusCode: 404,
      });
    }

    const location = await this.database.client.warehouseLocation.findFirst({
      where: { companyId: company.companyId, barcode },
    });
    if (!location) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_LOCATION_BARCODE_NOT_FOUND,
        message: LOCATION_ERROR_MESSAGES.BARCODE_NOT_FOUND,
        statusCode: 404,
      });
    }
    return this.toView(location);
  }

  private async requireWarehouse(companyId: string, warehouseId: string) {
    const warehouse = await this.database.client.warehouse.findFirst({
      where: { id: warehouseId, companyId },
    });
    if (!warehouse) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_NOT_FOUND,
        message: 'Warehouse not found.',
        statusCode: 404,
      });
    }
    return warehouse;
  }

  private async requireLocation(
    companyId: string,
    warehouseId: string,
    locationId: string,
  ): Promise<LocationRow> {
    const row = await this.database.client.warehouseLocation.findFirst({
      where: { id: locationId, companyId, warehouseId },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_LOCATION_NOT_FOUND,
        message: LOCATION_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async resolveParent(
    tx: Prisma.TransactionClient,
    companyId: string,
    warehouseId: string,
    parentId: string | null,
  ): Promise<{ id: string; type: WarehouseLocationType } | null> {
    if (!parentId) {
      return null;
    }
    const parent = await tx.warehouseLocation.findFirst({
      where: { id: parentId, companyId, warehouseId },
      select: { id: true, type: true },
    });
    if (!parent) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_LOCATION_INVALID_PARENT,
        message: LOCATION_ERROR_MESSAGES.INVALID_PARENT,
        statusCode: 409,
      });
    }
    return parent;
  }

  private toView(row: LocationRow): WarehouseLocationView {
    return {
      id: row.id,
      companyId: row.companyId,
      warehouseId: row.warehouseId,
      parentId: row.parentId,
      type: row.type,
      code: row.code,
      name: row.name,
      barcode: row.barcode,
      status: row.status,
      sortOrder: row.sortOrder,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private snapshot(row: LocationRow) {
    return {
      parentId: row.parentId,
      type: row.type,
      code: row.code,
      name: row.name,
      barcode: row.barcode,
      status: row.status,
      sortOrder: row.sortOrder,
      notes: row.notes,
    };
  }
}
