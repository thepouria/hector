import { Injectable } from '@nestjs/common';
import {
  InventoryMovementType,
  InventorySourceType,
  Prisma,
  StockClassification,
  WarehouseStatus,
} from '@hector/database';
import { randomUUID } from 'node:crypto';
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
} from '../../infrastructure/events';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import type { CompanyContext } from '../companies/types/company.types';
import {
  INVENTORY_ERROR_MESSAGES,
  INVENTORY_SEARCH_MAX_LENGTH,
  NEGATIVE_MOVEMENT_TYPES,
  POSITIVE_MOVEMENT_TYPES,
} from './inventory-ledger.constants';
import type { ListInventoryMovementsQueryDto } from './dto/inventory.dto';
import { InventoryCostLayersService } from './inventory-cost-layers.service';
import type {
  InventoryMovementView,
  PointInTimeStockResult,
} from './types/inventory.types';

type PostedMovement = {
  movement: InventoryMovementView;
  resultingOnHand: number;
  created: boolean;
};

export type PostMovementInput = {
  warehouseId: string;
  locationId: string;
  skuId: string;
  batchId: string;
  /** Position classification (Phase 3.12). Defaults to SELLABLE for receive/legacy paths. */
  classification?: StockClassification;
  movementType: InventoryMovementType;
  quantityDelta: number;
  sourceType: InventorySourceType;
  sourceId: string;
  sourceLineId: string;
  operationId?: string | null;
  occurredAt?: Date;
  actorUserId: string;
  reasonCode?: string | null;
  notes?: string | null;
  reversalOfMovementId?: string | null;
};

type Tx = Prisma.TransactionClient;

/**
 * Canonical inventory posting service (Phase 3.9).
 * All stock-changing domains must use this — never prisma.inventoryMovement.create alone.
 *
 * Concurrency: lock InventoryBalance row (FOR UPDATE) per position; upsert on first receive.
 * Ledger is canonical; balance is a rebuildable projection updated in the same transaction.
 */
@Injectable()
export class InventoryLedgerService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
    private readonly costLayers: InventoryCostLayersService,
  ) {}

  /**
   * Post one or more movements atomically (same company).
   * Returns created rows; idempotent replays return existing rows for matching unique keys.
   */
  async postMovements(
    companyId: string,
    inputs: PostMovementInput[],
    options?: { emitEvents?: boolean; recordAudit?: boolean },
  ): Promise<InventoryMovementView[]> {
    if (inputs.length === 0) return [];

    const emitEvents = options?.emitEvents !== false;
    const recordAudit = options?.recordAudit !== false;

    const { movements, events } = await this.database.client.$transaction(async (tx) => {
      const posted = await this.postMovementsInTx(tx, companyId, inputs, { recordAudit });
      return {
        movements: posted.map((p) => p.movement),
        events: emitEvents
          ? posted.map((p) =>
              this.eventFactory.create({
                type: DOMAIN_EVENTS.WAREHOUSE_INVENTORY_MOVEMENT_POSTED,
                payload: {
                  companyId,
                  movementId: p.movement.id,
                  movementType: p.movement.movementType,
                  skuId: p.movement.skuId,
                  batchId: p.movement.batchId,
                  warehouseId: p.movement.warehouseId,
                  locationId: p.movement.locationId,
                  classification: p.movement.classification,
                  quantityDelta: p.movement.quantityDelta,
                  resultingOnHand: p.resultingOnHand,
                  sourceType: p.movement.sourceType,
                  sourceId: p.movement.sourceId,
                  occurredAt: p.movement.occurredAt,
                },
              }),
            )
          : [],
      };
    });

    for (const event of events) {
      await this.eventBus.publish(event);
    }

    return movements;
  }

  /** Used inside Putaway complete (and other outer transactions). */
  async postMovementsInTx(
    tx: Tx,
    companyId: string,
    inputs: PostMovementInput[],
    options?: { recordAudit?: boolean },
  ): Promise<PostedMovement[]> {
    const recordAudit = options?.recordAudit !== false;
    const results: PostedMovement[] = [];

    // Deterministic lock order by position key to reduce deadlocks.
    const sorted = [...inputs].sort((a, b) =>
      positionKey(a).localeCompare(positionKey(b)),
    );

    for (const input of sorted) {
      this.assertQuantityAndSign(input.movementType, input.quantityDelta);

      const existing = await tx.inventoryMovement.findUnique({
        where: {
          companyId_sourceType_sourceLineId_movementType: {
            companyId,
            sourceType: input.sourceType,
            sourceLineId: input.sourceLineId,
            movementType: input.movementType,
          },
        },
        include: movementInclude,
      });
      const classification = input.classification ?? StockClassification.SELLABLE;

      if (existing) {
        const bal = await tx.inventoryBalance.findUnique({
          where: {
            companyId_warehouseId_locationId_skuId_batchId_classification: {
              companyId,
              warehouseId: existing.warehouseId,
              locationId: existing.locationId,
              skuId: existing.skuId,
              batchId: existing.batchId,
              classification: existing.classification,
            },
          },
        });
        results.push({
          movement: toMovementView(existing),
          resultingOnHand: bal?.onHandQuantity ?? 0,
          created: false,
        });
        continue;
      }

      await this.assertDimensions(tx, companyId, { ...input, classification });

      const locked = await this.lockOrCreateBalance(tx, companyId, {
        ...input,
        classification,
      });
      const nextQty = locked.onHandQuantity + input.quantityDelta;
      if (nextQty < 0) {
        throw new AppError({
          code: ERROR_CODES.INVENTORY_INSUFFICIENT_STOCK,
          message: INVENTORY_ERROR_MESSAGES.INSUFFICIENT_STOCK,
          statusCode: 409,
          details: {
            warehouseId: input.warehouseId,
            locationId: input.locationId,
            skuId: input.skuId,
            batchId: input.batchId,
            classification,
            onHand: locked.onHandQuantity,
            attempted: input.quantityDelta,
          },
        });
      }

      const occurredAt = input.occurredAt ?? new Date();
      const created = await tx.inventoryMovement.create({
        data: {
          companyId,
          warehouseId: input.warehouseId,
          locationId: input.locationId,
          skuId: input.skuId,
          batchId: input.batchId,
          classification,
          movementType: input.movementType,
          quantityDelta: input.quantityDelta,
          occurredAt,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceLineId: input.sourceLineId,
          operationId: input.operationId ?? null,
          reasonCode: input.reasonCode ?? null,
          notes: input.notes ?? null,
          reversalOfMovementId: input.reversalOfMovementId ?? null,
          createdById: input.actorUserId,
        },
        include: movementInclude,
      });

      await tx.inventoryBalance.update({
        where: { id: locked.id },
        data: { onHandQuantity: nextQty },
      });

      if (recordAudit) {
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.INVENTORY_MOVEMENT_POSTED,
          entityType: AUDIT_ENTITY_TYPES.INVENTORY_MOVEMENT,
          entityId: created.id,
          before: null,
          after: {
            movementType: created.movementType,
            quantityDelta: created.quantityDelta,
            skuId: created.skuId,
            batchId: created.batchId,
            warehouseId: created.warehouseId,
            locationId: created.locationId,
            classification: created.classification,
            sourceType: created.sourceType,
            sourceId: created.sourceId,
            resultingOnHand: nextQty,
          },
          metadata: {
            movementId: created.id,
            movementType: created.movementType,
            skuId: created.skuId,
            batchId: created.batchId,
            warehouseId: created.warehouseId,
            locationId: created.locationId,
            classification: created.classification,
            quantityDelta: created.quantityDelta,
            resultingOnHand: nextQty,
            sourceType: created.sourceType,
            sourceId: created.sourceId,
          },
          // Explicit context: internal helpers / concurrent posts may run outside HTTP ALS.
          context: {
            companyId,
            actorUserId: input.actorUserId,
          },
        });
      }

      results.push({
        movement: toMovementView(created),
        resultingOnHand: nextQty,
        created: true,
      });
    }

    // FIFO / valuation: same transaction as physical posting (WH-FIFO-014).
    await this.costLayers.syncForPostedMovementsInTx(tx, companyId, results);

    return results;
  }

  /**
   * Post RECEIVE movements for each PutawayItem (idempotent by putawayItemId).
   * Called inside Putaway complete transaction.
   */
  async postReceivesForCompletedPutaway(
    tx: Tx,
    input: {
      companyId: string;
      putawayId: string;
      warehouseId: string;
      actorUserId: string;
      occurredAt: Date;
      items: Array<{
        id: string;
        quantity: number;
        warehouseLocationId: string;
        skuId: string;
        batchId: string;
      }>;
    },
  ): Promise<InventoryMovementView[]> {
    const posts: PostMovementInput[] = input.items.map((item) => ({
      warehouseId: input.warehouseId,
      locationId: item.warehouseLocationId,
      skuId: item.skuId,
      batchId: item.batchId,
      classification: StockClassification.SELLABLE,
      movementType: InventoryMovementType.RECEIVE,
      quantityDelta: item.quantity,
      sourceType: InventorySourceType.PUTAWAY,
      sourceId: input.putawayId,
      sourceLineId: item.id,
      operationId: input.putawayId,
      occurredAt: input.occurredAt,
      actorUserId: input.actorUserId,
    }));
    const posted = await this.postMovementsInTx(tx, input.companyId, posts, {
      recordAudit: true,
    });
    return posted.map((p) => p.movement);
  }

  /** Internal helper for tests/seed: ISSUE. */
  async postIssue(
    companyId: string,
    input: Omit<PostMovementInput, 'movementType' | 'quantityDelta'> & {
      quantity: number;
    },
  ): Promise<InventoryMovementView> {
    const [row] = await this.postMovements(companyId, [
      {
        ...input,
        movementType: InventoryMovementType.ISSUE,
        quantityDelta: -Math.abs(input.quantity),
      },
    ]);
    return row;
  }

  /** Internal helper: ADJUSTMENT_IN / ADJUSTMENT_OUT from signed delta. */
  async postAdjustment(
    companyId: string,
    input: Omit<PostMovementInput, 'movementType' | 'quantityDelta' | 'sourceType'> & {
      quantityDelta: number;
      sourceLineId?: string;
      sourceId?: string;
    },
  ): Promise<InventoryMovementView> {
    const delta = input.quantityDelta;
    if (!Number.isInteger(delta) || delta === 0) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_INVALID_QUANTITY,
        message: INVENTORY_ERROR_MESSAGES.INVALID_QUANTITY,
        statusCode: 400,
      });
    }
    const [row] = await this.postMovements(companyId, [
      {
        ...input,
        movementType:
          delta > 0
            ? InventoryMovementType.ADJUSTMENT_IN
            : InventoryMovementType.ADJUSTMENT_OUT,
        quantityDelta: delta,
        sourceType: InventorySourceType.MANUAL_ADJUSTMENT,
        sourceId: input.sourceId ?? randomUUID(),
        sourceLineId: input.sourceLineId ?? randomUUID(),
      },
    ]);
    return row;
  }

  /**
   * Internal transfer: TRANSFER_OUT + TRANSFER_IN sharing operationId.
   * Atomic — neither leg commits if stock insufficient.
   */
  async postTransfer(
    companyId: string,
    input: {
      fromLocationId: string;
      toLocationId: string;
      warehouseId: string;
      toWarehouseId?: string;
      skuId: string;
      batchId: string;
      classification?: StockClassification;
      quantity: number;
      actorUserId: string;
      operationId?: string;
      sourceLineId?: string;
      occurredAt?: Date;
      notes?: string | null;
    },
  ): Promise<{ operationId: string; out: InventoryMovementView; in: InventoryMovementView }> {
    const qty = input.quantity;
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_INVALID_QUANTITY,
        message: INVENTORY_ERROR_MESSAGES.INVALID_QUANTITY,
        statusCode: 400,
      });
    }
    const operationId = input.operationId ?? randomUUID();
    const sourceLineId = input.sourceLineId ?? randomUUID();
    const toWarehouseId = input.toWarehouseId ?? input.warehouseId;
    const classification = input.classification ?? StockClassification.SELLABLE;

    const rows = await this.postMovements(companyId, [
      {
        warehouseId: input.warehouseId,
        locationId: input.fromLocationId,
        skuId: input.skuId,
        batchId: input.batchId,
        classification,
        movementType: InventoryMovementType.TRANSFER_OUT,
        quantityDelta: -qty,
        sourceType: InventorySourceType.TRANSFER,
        sourceId: operationId,
        sourceLineId,
        operationId,
        occurredAt: input.occurredAt,
        actorUserId: input.actorUserId,
        notes: input.notes ?? null,
      },
      {
        warehouseId: toWarehouseId,
        locationId: input.toLocationId,
        skuId: input.skuId,
        batchId: input.batchId,
        classification,
        movementType: InventoryMovementType.TRANSFER_IN,
        quantityDelta: qty,
        sourceType: InventorySourceType.TRANSFER,
        sourceId: operationId,
        sourceLineId,
        operationId,
        occurredAt: input.occurredAt,
        actorUserId: input.actorUserId,
        notes: input.notes ?? null,
      },
    ]);

    const out = rows.find((r) => r.movementType === InventoryMovementType.TRANSFER_OUT)!;
    const inn = rows.find((r) => r.movementType === InventoryMovementType.TRANSFER_IN)!;
    return { operationId, out, in: inn };
  }

  /**
   * Atomic reclassification: RECLASSIFY_OUT + RECLASSIFY_IN (company total conserved).
   * Same warehouse/location/sku/batch; only classification changes.
   */
  async postReclassification(
    companyId: string,
    input: {
      warehouseId: string;
      locationId: string;
      skuId: string;
      batchId: string;
      fromClassification: StockClassification;
      toClassification: StockClassification;
      quantity: number;
      actorUserId: string;
      sourceId: string;
      sourceLineId: string;
      operationId?: string;
      occurredAt?: Date;
      reasonCode?: string | null;
      notes?: string | null;
    },
    options?: { tx?: Tx; recordAudit?: boolean },
  ): Promise<{
    operationId: string;
    out: InventoryMovementView;
    in: InventoryMovementView;
  }> {
    const qty = input.quantity;
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_INVALID_QUANTITY,
        message: INVENTORY_ERROR_MESSAGES.INVALID_QUANTITY,
        statusCode: 400,
      });
    }
    if (input.fromClassification === input.toClassification) {
      throw new AppError({
        code: ERROR_CODES.STOCK_CLASSIFICATION_SAME,
        message: 'Source and destination classifications must differ.',
        statusCode: 400,
      });
    }
    const operationId = input.operationId ?? randomUUID();
    const posts: PostMovementInput[] = [
      {
        warehouseId: input.warehouseId,
        locationId: input.locationId,
        skuId: input.skuId,
        batchId: input.batchId,
        classification: input.fromClassification,
        movementType: InventoryMovementType.RECLASSIFY_OUT,
        quantityDelta: -qty,
        sourceType: InventorySourceType.CLASSIFICATION_CHANGE,
        sourceId: input.sourceId,
        sourceLineId: input.sourceLineId,
        operationId,
        occurredAt: input.occurredAt,
        actorUserId: input.actorUserId,
        reasonCode: input.reasonCode ?? null,
        notes: input.notes ?? null,
      },
      {
        warehouseId: input.warehouseId,
        locationId: input.locationId,
        skuId: input.skuId,
        batchId: input.batchId,
        classification: input.toClassification,
        movementType: InventoryMovementType.RECLASSIFY_IN,
        quantityDelta: qty,
        sourceType: InventorySourceType.CLASSIFICATION_CHANGE,
        sourceId: input.sourceId,
        sourceLineId: input.sourceLineId,
        operationId,
        occurredAt: input.occurredAt,
        actorUserId: input.actorUserId,
        reasonCode: input.reasonCode ?? null,
        notes: input.notes ?? null,
      },
    ];

    let rows: InventoryMovementView[];
    if (options?.tx) {
      const posted = await this.postMovementsInTx(options.tx, companyId, posts, {
        recordAudit: options.recordAudit,
      });
      rows = posted.map((p) => p.movement);
    } else {
      rows = await this.postMovements(companyId, posts, {
        recordAudit: options?.recordAudit,
      });
    }

    const out = rows.find((r) => r.movementType === InventoryMovementType.RECLASSIFY_OUT)!;
    const inn = rows.find((r) => r.movementType === InventoryMovementType.RECLASSIFY_IN)!;
    return { operationId, out, in: inn };
  }

  async listMovements(
    company: CompanyContext,
    query: ListInventoryMovementsQueryDto,
  ): Promise<{ data: InventoryMovementView[]; meta: PaginationMeta }> {
    const search = normalizeSearch(query.q);
    const where: Prisma.InventoryMovementWhereInput = {
      companyId: company.companyId,
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.skuId ? { skuId: query.skuId } : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
      ...(query.classification ? { classification: query.classification } : {}),
      ...(query.movementType ? { movementType: query.movementType } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
      ...(query.sourceId ? { sourceId: query.sourceId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            occurredAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { sku: { code: { contains: search, mode: 'insensitive' } } },
              { batch: { batchNumber: { contains: search, mode: 'insensitive' } } },
              { warehouse: { code: { contains: search, mode: 'insensitive' } } },
              { location: { code: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.database.client.inventoryMovement.count({ where }),
      this.database.client.inventoryMovement.findMany({
        where,
        include: movementInclude,
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      data: rows.map(toMovementView),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async getMovement(
    company: CompanyContext,
    movementId: string,
  ): Promise<InventoryMovementView> {
    const row = await this.database.client.inventoryMovement.findFirst({
      where: { id: movementId, companyId: company.companyId },
      include: movementInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_MOVEMENT_NOT_FOUND,
        message: INVENTORY_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return toMovementView(row);
  }

  /** Point-in-time On Hand from ledger (canonical). */
  async onHandAsOf(
    companyId: string,
    position: {
      warehouseId: string;
      locationId: string;
      skuId: string;
      batchId: string;
      classification?: StockClassification;
    },
    asOf: Date,
  ): Promise<PointInTimeStockResult> {
    const classification = position.classification ?? StockClassification.SELLABLE;
    const agg = await this.database.client.inventoryMovement.aggregate({
      where: {
        companyId,
        warehouseId: position.warehouseId,
        locationId: position.locationId,
        skuId: position.skuId,
        batchId: position.batchId,
        classification,
        occurredAt: { lte: asOf },
      },
      _sum: { quantityDelta: true },
    });
    return {
      warehouseId: position.warehouseId,
      locationId: position.locationId,
      skuId: position.skuId,
      batchId: position.batchId,
      classification,
      asOf: asOf.toISOString(),
      onHand: agg._sum.quantityDelta ?? 0,
    };
  }

  private assertQuantityAndSign(type: InventoryMovementType, delta: number): void {
    if (!Number.isInteger(delta) || delta === 0) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_INVALID_QUANTITY,
        message: INVENTORY_ERROR_MESSAGES.INVALID_QUANTITY,
        statusCode: 400,
      });
    }
    if (POSITIVE_MOVEMENT_TYPES.has(type) && delta <= 0) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_INVALID_MOVEMENT_SIGN,
        message: INVENTORY_ERROR_MESSAGES.INVALID_SIGN,
        statusCode: 400,
      });
    }
    if (NEGATIVE_MOVEMENT_TYPES.has(type) && delta >= 0) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_INVALID_MOVEMENT_SIGN,
        message: INVENTORY_ERROR_MESSAGES.INVALID_SIGN,
        statusCode: 400,
      });
    }
  }

  private async assertDimensions(
    tx: Tx,
    companyId: string,
    input: PostMovementInput,
  ): Promise<void> {
    const [location, batch, sku] = await Promise.all([
      tx.warehouseLocation.findFirst({
        where: { id: input.locationId, companyId },
      }),
      tx.batch.findFirst({ where: { id: input.batchId, companyId } }),
      tx.sku.findFirst({ where: { id: input.skuId, companyId } }),
    ]);

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
    if (batch.skuId !== input.skuId) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_BATCH_SKU_MISMATCH,
        message: INVENTORY_ERROR_MESSAGES.BATCH_SKU_MISMATCH,
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
    if (location.warehouseId !== input.warehouseId) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_LOCATION_WAREHOUSE_MISMATCH,
        message: INVENTORY_ERROR_MESSAGES.LOCATION_WAREHOUSE_MISMATCH,
        statusCode: 409,
      });
    }
    if (location.status !== WarehouseStatus.ACTIVE && input.quantityDelta > 0) {
      // Allow outbound from inactive for corrections; block inbound to inactive.
      throw new AppError({
        code: ERROR_CODES.LOCATION_NOT_AVAILABLE,
        message: 'Location is not available for inbound inventory.',
        statusCode: 409,
      });
    }

    const warehouse = await tx.warehouse.findFirst({
      where: { id: input.warehouseId, companyId },
    });
    if (!warehouse) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_NOT_FOUND,
        message: 'Warehouse was not found.',
        statusCode: 404,
      });
    }
  }

  private async lockOrCreateBalance(
    tx: Tx,
    companyId: string,
    input: PostMovementInput & { classification: StockClassification },
  ): Promise<{ id: string; onHandQuantity: number }> {
    const classification = input.classification;
    const locked = await tx.$queryRaw<Array<{ id: string; on_hand_quantity: number }>>(
      Prisma.sql`
        SELECT id, on_hand_quantity
        FROM inventory_balances
        WHERE company_id = ${companyId}::uuid
          AND warehouse_id = ${input.warehouseId}::uuid
          AND location_id = ${input.locationId}::uuid
          AND sku_id = ${input.skuId}::uuid
          AND batch_id = ${input.batchId}::uuid
          AND classification = ${classification}::stock_classification
        FOR UPDATE
      `,
    );
    if (locked[0]) {
      return { id: locked[0].id, onHandQuantity: locked[0].on_hand_quantity };
    }

    try {
      const created = await tx.inventoryBalance.create({
        data: {
          companyId,
          warehouseId: input.warehouseId,
          locationId: input.locationId,
          skuId: input.skuId,
          batchId: input.batchId,
          classification,
          onHandQuantity: 0,
        },
      });
      // Re-lock for consistent concurrency with concurrent creators.
      const relocked = await tx.$queryRaw<
        Array<{ id: string; on_hand_quantity: number }>
      >(Prisma.sql`
        SELECT id, on_hand_quantity
        FROM inventory_balances
        WHERE id = ${created.id}::uuid
        FOR UPDATE
      `);
      return {
        id: relocked[0]!.id,
        onHandQuantity: relocked[0]!.on_hand_quantity,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const again = await tx.$queryRaw<
          Array<{ id: string; on_hand_quantity: number }>
        >(Prisma.sql`
          SELECT id, on_hand_quantity
          FROM inventory_balances
          WHERE company_id = ${companyId}::uuid
            AND warehouse_id = ${input.warehouseId}::uuid
            AND location_id = ${input.locationId}::uuid
            AND sku_id = ${input.skuId}::uuid
            AND batch_id = ${input.batchId}::uuid
            AND classification = ${classification}::stock_classification
          FOR UPDATE
        `);
        if (again[0]) {
          return { id: again[0].id, onHandQuantity: again[0].on_hand_quantity };
        }
      }
      throw error;
    }
  }
}

const movementInclude = {
  warehouse: { select: { id: true, code: true, name: true } },
  location: { select: { id: true, code: true, name: true, barcode: true } },
  sku: {
    select: {
      id: true,
      code: true,
      name: true,
      product: { select: { name: true } },
    },
  },
  batch: {
    select: {
      id: true,
      batchNumber: true,
      supplierBatchNumber: true,
      expiresAt: true,
    },
  },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.InventoryMovementInclude;

type MovementRow = Prisma.InventoryMovementGetPayload<{ include: typeof movementInclude }>;

function toMovementView(row: MovementRow): InventoryMovementView {
  return {
    id: row.id,
    movementType: row.movementType,
    quantityDelta: row.quantityDelta,
    warehouseId: row.warehouseId,
    warehouseCode: row.warehouse.code,
    warehouseName: row.warehouse.name,
    locationId: row.locationId,
    locationCode: row.location.code,
    locationName: row.location.name,
    locationBarcode: row.location.barcode,
    skuId: row.skuId,
    skuCode: row.sku.code,
    productName: row.sku.product?.name ?? row.sku.name,
    batchId: row.batchId,
    batchNumber: row.batch.batchNumber,
    supplierBatchNumber: row.batch.supplierBatchNumber,
    expiresAt: row.batch.expiresAt
      ? row.batch.expiresAt.toISOString().slice(0, 10)
      : null,
    classification: row.classification,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    sourceLineId: row.sourceLineId,
    operationId: row.operationId,
    reasonCode: row.reasonCode,
    notes: row.notes,
    reversalOfMovementId: row.reversalOfMovementId,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy
      ? {
          id: row.createdBy.id,
          displayName: `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim(),
        }
      : null,
  };
}

function positionKey(input: PostMovementInput): string {
  return [
    input.warehouseId,
    input.locationId,
    input.skuId,
    input.batchId,
    input.classification ?? StockClassification.SELLABLE,
  ].join(':');
}

function normalizeSearch(q?: string): string | null {
  if (!q) return null;
  const trimmed = q.trim().slice(0, INVENTORY_SEARCH_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}
