import { Injectable } from '@nestjs/common';
import {
  Prisma,
  SYSTEM_TRANSIT_WAREHOUSE_CODE,
  WarehouseLocationType,
  WarehouseStatus,
} from '@hector/database';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '../../common/constants';
import { getRequestContext } from '../../common/context/request-context';
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
import { InventoryLedgerService } from './inventory-ledger.service';
import {
  STOCK_CLASSIFICATION_ERROR_MESSAGES,
} from './stock-classification.constants';
import type {
  ChangeStockClassificationDto,
  ListStockClassificationChangesQueryDto,
} from './dto/stock-classification.dto';
import type { StockClassificationChangeView } from './types/stock-classification.types';

const listInclude = {
  warehouse: { select: { id: true, code: true, name: true } },
  location: {
    select: { id: true, code: true, name: true, barcode: true },
  },
  sku: {
    select: {
      id: true,
      code: true,
      name: true,
      product: { select: { name: true } },
    },
  },
  batch: { select: { id: true, batchNumber: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.StockClassificationChangeInclude;

type ChangeRow = Prisma.StockClassificationChangeGetPayload<{ include: typeof listInclude }>;
type Tx = Prisma.TransactionClient;

@Injectable()
export class StockClassificationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
    private readonly inventoryLedger: InventoryLedgerService,
  ) {}

  async list(
    company: CompanyContext,
    query: ListStockClassificationChangesQueryDto,
  ): Promise<{ data: StockClassificationChangeView[]; meta: PaginationMeta }> {
    const where: Prisma.StockClassificationChangeWhereInput = {
      companyId: company.companyId,
      ...(query.skuId ? { skuId: query.skuId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.stockClassificationChange.count({ where }),
      this.database.client.stockClassificationChange.findMany({
        where,
        include: listInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.pageSize,
      }),
    ]);
    return {
      data: rows.map((row) => this.toView(row)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async change(
    company: CompanyContext,
    dto: ChangeStockClassificationDto,
  ): Promise<StockClassificationChangeView> {
    const actorUserId = this.requireActorUserId();

    if (dto.fromClassification === dto.toClassification) {
      throw new AppError({
        code: ERROR_CODES.STOCK_CLASSIFICATION_SAME,
        message: 'Source and destination classifications must differ.',
        statusCode: 400,
      });
    }
    if (!Number.isInteger(dto.quantity) || dto.quantity <= 0) {
      throw new AppError({
        code: ERROR_CODES.STOCK_CLASSIFICATION_INVALID_QUANTITY,
        message: STOCK_CLASSIFICATION_ERROR_MESSAGES.INVALID_QUANTITY,
        statusCode: 400,
      });
    }

    if (dto.requestId) {
      const existing = await this.database.client.stockClassificationChange.findFirst({
        where: { id: dto.requestId, companyId: company.companyId },
        include: listInclude,
      });
      if (existing) {
        return this.toView(existing);
      }
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const row = await this.database.client.$transaction(async (tx) => {
        await this.validatePosition(tx, company.companyId, dto);

        const changeId = dto.requestId ?? randomUUID();
        const operationId = randomUUID();
        const occurredAt = new Date();

        const created = await tx.stockClassificationChange.create({
          data: {
            id: changeId,
            companyId: company.companyId,
            warehouseId: dto.warehouseId,
            locationId: dto.locationId,
            skuId: dto.skuId,
            batchId: dto.batchId,
            fromClassification: dto.fromClassification,
            toClassification: dto.toClassification,
            quantity: dto.quantity,
            reason: dto.reason ?? null,
            notes: dto.notes ?? null,
            operationId,
            createdById: actorUserId,
          },
        });

        await this.inventoryLedger.postReclassification(
          company.companyId,
          {
            warehouseId: dto.warehouseId,
            locationId: dto.locationId,
            skuId: dto.skuId,
            batchId: dto.batchId,
            fromClassification: dto.fromClassification,
            toClassification: dto.toClassification,
            quantity: dto.quantity,
            actorUserId,
            sourceId: created.id,
            sourceLineId: created.id,
            operationId,
            occurredAt,
            reasonCode: dto.reason ?? null,
            notes: dto.notes ?? null,
          },
          { tx, recordAudit: true },
        );

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.STOCK_CLASSIFICATION_CHANGED,
          entityType: AUDIT_ENTITY_TYPES.STOCK_CLASSIFICATION_CHANGE,
          entityId: created.id,
          before: null,
          after: {
            fromClassification: dto.fromClassification,
            toClassification: dto.toClassification,
            quantity: dto.quantity,
          },
          metadata: {
            changeId: created.id,
            operationId,
            warehouseId: dto.warehouseId,
            locationId: dto.locationId,
            skuId: dto.skuId,
            batchId: dto.batchId,
            fromClassification: dto.fromClassification,
            toClassification: dto.toClassification,
            quantity: dto.quantity,
            reason: dto.reason ?? null,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_CLASSIFICATION_CHANGED,
            payload: {
              companyId: company.companyId,
              changeId: created.id,
              operationId,
              warehouseId: dto.warehouseId,
              locationId: dto.locationId,
              skuId: dto.skuId,
              batchId: dto.batchId,
              fromClassification: dto.fromClassification,
              toClassification: dto.toClassification,
              quantity: dto.quantity,
              reason: dto.reason ?? null,
            },
          }),
        );

        return tx.stockClassificationChange.findFirstOrThrow({
          where: { id: created.id, companyId: company.companyId },
          include: listInclude,
        });
      });
      return this.toView(row);
    });
  }

  private async validatePosition(
    tx: Tx,
    companyId: string,
    dto: ChangeStockClassificationDto,
  ): Promise<void> {
    const [warehouse, location, sku, batch] = await Promise.all([
      tx.warehouse.findFirst({
        where: { id: dto.warehouseId, companyId },
      }),
      tx.warehouseLocation.findFirst({
        where: { id: dto.locationId, companyId },
      }),
      tx.sku.findFirst({ where: { id: dto.skuId, companyId } }),
      tx.batch.findFirst({ where: { id: dto.batchId, companyId } }),
    ]);

    if (!warehouse) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_NOT_FOUND,
        message: STOCK_CLASSIFICATION_ERROR_MESSAGES.WAREHOUSE_NOT_FOUND,
        statusCode: 404,
      });
    }
    if (warehouse.isSystem || warehouse.code === SYSTEM_TRANSIT_WAREHOUSE_CODE) {
      throw new AppError({
        code: ERROR_CODES.STOCK_CLASSIFICATION_TRANSIT_FORBIDDEN,
        message: STOCK_CLASSIFICATION_ERROR_MESSAGES.SYSTEM_WAREHOUSE,
        statusCode: 409,
      });
    }
    if (warehouse.status !== WarehouseStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.STOCK_CLASSIFICATION_LOCATION_INACTIVE,
        message: STOCK_CLASSIFICATION_ERROR_MESSAGES.WAREHOUSE_INACTIVE,
        statusCode: 409,
      });
    }
    if (!location) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_LOCATION_NOT_FOUND,
        message: 'Warehouse location was not found.',
        statusCode: 404,
      });
    }
    if (location.warehouseId !== dto.warehouseId) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: STOCK_CLASSIFICATION_ERROR_MESSAGES.LOCATION_WAREHOUSE_MISMATCH,
        statusCode: 409,
      });
    }
    if (location.type === WarehouseLocationType.TRANSIT) {
      throw new AppError({
        code: ERROR_CODES.STOCK_CLASSIFICATION_TRANSIT_FORBIDDEN,
        message: STOCK_CLASSIFICATION_ERROR_MESSAGES.TRANSIT_FORBIDDEN,
        statusCode: 409,
      });
    }
    if (location.status !== WarehouseStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.STOCK_CLASSIFICATION_LOCATION_INACTIVE,
        message: STOCK_CLASSIFICATION_ERROR_MESSAGES.LOCATION_INACTIVE,
        statusCode: 409,
      });
    }
    if (!sku) {
      throw new AppError({
        code: ERROR_CODES.SKU_NOT_FOUND,
        message: 'SKU was not found.',
        statusCode: 404,
      });
    }
    if (!batch) {
      throw new AppError({
        code: ERROR_CODES.BATCH_NOT_FOUND,
        message: 'Batch was not found.',
        statusCode: 404,
      });
    }
    if (batch.skuId !== dto.skuId) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: STOCK_CLASSIFICATION_ERROR_MESSAGES.BATCH_SKU_MISMATCH,
        statusCode: 409,
      });
    }
  }

  private toView(row: ChangeRow): StockClassificationChangeView {
    return {
      id: row.id,
      warehouseId: row.warehouseId,
      warehouseCode: row.warehouse.code,
      warehouseName: row.warehouse.name,
      locationId: row.locationId,
      locationCode: row.location.code,
      locationName: row.location.name,
      locationBarcode: row.location.barcode,
      skuId: row.skuId,
      skuCode: row.sku.code,
      skuName: row.sku.name,
      productName: row.sku.product?.name ?? null,
      batchId: row.batchId,
      batchNumber: row.batch.batchNumber,
      fromClassification: row.fromClassification,
      toClassification: row.toClassification,
      quantity: row.quantity,
      reason: row.reason,
      notes: row.notes,
      operationId: row.operationId,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private requireActorUserId(): string {
    const userId = getRequestContext()?.userId;
    if (!userId) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Authenticated actor is required.',
        statusCode: 401,
      });
    }
    return userId;
  }
}
