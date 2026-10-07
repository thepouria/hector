import { Injectable } from '@nestjs/common';
import {
  InventoryReservationSourceType,
  InventoryReservationStatus,
  Prisma,
  StockClassification,
  WarehouseStatus,
} from '@hector/database';
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
import {
  AVAILABILITY_BULK_MAX,
  RESERVATION_ERROR_MESSAGES,
} from './inventory-reservations.constants';

type Tx = Prisma.TransactionClient;

export type AvailabilityView = {
  warehouseId: string;
  skuId: string;
  classification: 'SELLABLE';
  onHand: number;
  reserved: number;
  available: number;
};

/**
 * Inventory reservations (Phase 3.15).
 * Never posts InventoryMovement. Never changes physical On Hand.
 * Available = SELLABLE On Hand − ACTIVE reserved remaining.
 */
@Injectable()
export class InventoryReservationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async create(
    company: CompanyContext,
    input: {
      warehouseId: string;
      skuId: string;
      quantity: number;
      sourceType: InventoryReservationSourceType;
      sourceId: string;
      sourceLineId?: string;
      requestId: string;
      expiresAt?: string | null;
    },
  ) {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_RESERVATION_INVALID_QUANTITY,
        message: RESERVATION_ERROR_MESSAGES.INVALID_QUANTITY,
        statusCode: 400,
      });
    }
    const actorUserId = getRequestContext()?.userId;
    if (!actorUserId) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Authenticated actor is required.',
        statusCode: 401,
      });
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const reservation = await this.database.client.$transaction(async (tx) => {
        return this.createInTx(tx, company.companyId, actorUserId, input, events);
      });

      return this.toView(reservation);
    });
  }

  /**
   * Create reservation inside an outer transaction (Sales order reserve, etc.).
   * Idempotent on requestId and source identity. Emits events into `events` when provided.
   */
  async createInTx(
    tx: Tx,
    companyId: string,
    actorUserId: string,
    input: {
      warehouseId: string;
      skuId: string;
      quantity: number;
      sourceType: InventoryReservationSourceType;
      sourceId: string;
      sourceLineId?: string;
      requestId: string;
      expiresAt?: string | Date | null;
    },
    events?: Array<ReturnType<DomainEventFactory['create']>>,
  ) {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_RESERVATION_INVALID_QUANTITY,
        message: RESERVATION_ERROR_MESSAGES.INVALID_QUANTITY,
        statusCode: 400,
      });
    }
    const sourceLineId = input.sourceLineId ?? input.sourceId;

    const byRequest = await tx.inventoryReservation.findUnique({
      where: {
        companyId_requestId: {
          companyId,
          requestId: input.requestId,
        },
      },
      include: this.detailInclude(),
    });
    if (byRequest) return byRequest;

    const bySource = await tx.inventoryReservation.findUnique({
      where: {
        companyId_sourceType_sourceId_sourceLineId: {
          companyId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceLineId,
        },
      },
      include: this.detailInclude(),
    });
    // Idempotent replay for ACTIVE (or already fully committed) source identity.
    if (bySource?.status === InventoryReservationStatus.ACTIVE) {
      return bySource;
    }
    if (bySource?.status === InventoryReservationStatus.CONSUMED) {
      return bySource;
    }

    await this.assertWarehouseSku(tx, companyId, input.warehouseId, input.skuId);
    await this.lockAvailabilityScope(tx, companyId, input.warehouseId, input.skuId);

    const availability = await this.computeAvailabilityInTx(
      tx,
      companyId,
      input.warehouseId,
      input.skuId,
    );
    if (availability.available < input.quantity) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_RESERVATION_INSUFFICIENT_AVAILABLE,
        message: RESERVATION_ERROR_MESSAGES.INSUFFICIENT_AVAILABLE,
        statusCode: 409,
        details: availability,
      });
    }

    const expiresAt =
      input.expiresAt == null
        ? null
        : input.expiresAt instanceof Date
          ? input.expiresAt
          : new Date(input.expiresAt);

    // Source identity is unique — re-activate RELEASED/EXPIRED/CANCELLED rows instead of insert.
    if (bySource) {
      const reactivated = await tx.inventoryReservation.update({
        where: { id: bySource.id },
        data: {
          warehouseId: input.warehouseId,
          skuId: input.skuId,
          requestId: input.requestId,
          quantity: input.quantity,
          remainingQuantity: input.quantity,
          status: InventoryReservationStatus.ACTIVE,
          expiresAt,
          releasedAt: null,
          expiredAt: null,
          cancelledAt: null,
          consumedAt: null,
          version: { increment: 1 },
        },
        include: this.detailInclude(),
      });

      await this.auditService.record(tx, {
        action: AUDIT_ACTIONS.INVENTORY_RESERVED,
        entityType: AUDIT_ENTITY_TYPES.INVENTORY_RESERVATION,
        entityId: reactivated.id,
        before: {
          status: bySource.status,
          remainingQuantity: bySource.remainingQuantity,
        },
        after: {
          warehouseId: reactivated.warehouseId,
          skuId: reactivated.skuId,
          quantity: reactivated.quantity,
          status: reactivated.status,
          sourceType: reactivated.sourceType,
          sourceId: reactivated.sourceId,
        },
        metadata: {
          reservationId: reactivated.id,
          requestId: reactivated.requestId,
          reactivated: true,
          availableAfter: availability.available - reactivated.quantity,
        },
      });

      if (events) {
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_INVENTORY_RESERVED,
            payload: {
              companyId,
              reservationId: reactivated.id,
              warehouseId: reactivated.warehouseId,
              skuId: reactivated.skuId,
              quantity: reactivated.quantity,
              sourceType: reactivated.sourceType,
              sourceId: reactivated.sourceId,
              sourceLineId: reactivated.sourceLineId,
            },
          }),
        );
      }

      return reactivated;
    }

    const created = await tx.inventoryReservation.create({
      data: {
        companyId,
        warehouseId: input.warehouseId,
        skuId: input.skuId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceLineId,
        requestId: input.requestId,
        quantity: input.quantity,
        remainingQuantity: input.quantity,
        status: InventoryReservationStatus.ACTIVE,
        expiresAt,
        createdById: actorUserId,
      },
      include: this.detailInclude(),
    });

    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.INVENTORY_RESERVED,
      entityType: AUDIT_ENTITY_TYPES.INVENTORY_RESERVATION,
      entityId: created.id,
      before: null,
      after: {
        warehouseId: created.warehouseId,
        skuId: created.skuId,
        quantity: created.quantity,
        status: created.status,
        sourceType: created.sourceType,
        sourceId: created.sourceId,
      },
      metadata: {
        reservationId: created.id,
        requestId: created.requestId,
        availableAfter: availability.available - created.quantity,
      },
    });

    if (events) {
      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.WAREHOUSE_INVENTORY_RESERVED,
          payload: {
            companyId,
            reservationId: created.id,
            warehouseId: created.warehouseId,
            skuId: created.skuId,
            quantity: created.quantity,
            sourceType: created.sourceType,
            sourceId: created.sourceId,
            sourceLineId: created.sourceLineId,
          },
        }),
      );
    }

    return created;
  }

  async get(company: CompanyContext, id: string) {
    const row = await this.database.client.inventoryReservation.findFirst({
      where: { id, companyId: company.companyId },
      include: this.detailInclude(),
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_RESERVATION_NOT_FOUND,
        message: RESERVATION_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return this.toView(row);
  }

  async list(
    company: CompanyContext,
    query: {
      page?: number;
      pageSize?: number;
      warehouseId?: string;
      skuId?: string;
      status?: InventoryReservationStatus;
      sourceType?: InventoryReservationSourceType;
    },
  ): Promise<{ data: ReturnType<InventoryReservationsService['toView']>[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.InventoryReservationWhereInput = {
      companyId: company.companyId,
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.skuId ? { skuId: query.skuId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
    };
    const [rows, total] = await Promise.all([
      this.database.client.inventoryReservation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: this.detailInclude(),
      }),
      this.database.client.inventoryReservation.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.toView(r)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async release(company: CompanyContext, id: string, quantity?: number) {
    return commitThenPublish(this.eventBus, async (events) => {
      const reservation = await this.database.client.$transaction(async (tx) => {
        return this.releaseInTx(
          tx,
          company.companyId,
          { reservationId: id, quantity },
          events,
        );
      });

      return this.toView(reservation);
    });
  }

  /**
   * Release (full or partial) inside an outer transaction.
   * Idempotent when already non-ACTIVE. Emits events into `events` when provided.
   */
  async releaseInTx(
    tx: Tx,
    companyId: string,
    input: { reservationId: string; quantity?: number },
    events?: Array<ReturnType<DomainEventFactory['create']>>,
  ) {
    const locked = await tx.inventoryReservation.findFirst({
      where: { id: input.reservationId, companyId },
    });
    if (!locked) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_RESERVATION_NOT_FOUND,
        message: RESERVATION_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }

    await tx.$queryRaw`
      SELECT id FROM inventory_reservations
      WHERE id = ${input.reservationId}::uuid AND company_id = ${companyId}::uuid
      FOR UPDATE
    `;

    const current = await tx.inventoryReservation.findUniqueOrThrow({
      where: { id: input.reservationId },
      include: this.detailInclude(),
    });

    if (current.status !== InventoryReservationStatus.ACTIVE) {
      return current;
    }

    await this.lockAvailabilityScope(tx, companyId, current.warehouseId, current.skuId);

    const releaseQty =
      input.quantity == null ? current.remainingQuantity : input.quantity;
    if (!Number.isInteger(releaseQty) || releaseQty <= 0) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_RESERVATION_INVALID_QUANTITY,
        message: RESERVATION_ERROR_MESSAGES.INVALID_QUANTITY,
        statusCode: 400,
      });
    }
    if (releaseQty > current.remainingQuantity) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_RESERVATION_INVALID_QUANTITY,
        message: RESERVATION_ERROR_MESSAGES.OVER_DECREASE,
        statusCode: 409,
      });
    }

    const nextRemaining = current.remainingQuantity - releaseQty;
    const updated = await tx.inventoryReservation.update({
      where: { id: input.reservationId },
      data: {
        remainingQuantity: nextRemaining,
        status:
          nextRemaining === 0
            ? InventoryReservationStatus.RELEASED
            : InventoryReservationStatus.ACTIVE,
        releasedAt: nextRemaining === 0 ? new Date() : current.releasedAt,
        version: { increment: 1 },
      },
      include: this.detailInclude(),
    });

    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.INVENTORY_RESERVATION_RELEASED,
      entityType: AUDIT_ENTITY_TYPES.INVENTORY_RESERVATION,
      entityId: input.reservationId,
      before: {
        status: current.status,
        remainingQuantity: current.remainingQuantity,
      },
      after: {
        status: updated.status,
        remainingQuantity: updated.remainingQuantity,
        releasedQuantity: releaseQty,
      },
    });

    if (events) {
      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.WAREHOUSE_INVENTORY_RESERVATION_RELEASED,
          payload: {
            companyId,
            reservationId: input.reservationId,
            releasedQuantity: releaseQty,
            remainingQuantity: updated.remainingQuantity,
            status: updated.status,
          },
        }),
      );
    }

    return updated;
  }

  async increase(
    company: CompanyContext,
    id: string,
    quantity: number,
  ) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_RESERVATION_INVALID_QUANTITY,
        message: RESERVATION_ERROR_MESSAGES.INVALID_QUANTITY,
        statusCode: 400,
      });
    }

    const reservation = await this.database.client.$transaction(async (tx) => {
      const current = await tx.inventoryReservation.findFirst({
        where: { id, companyId: company.companyId },
      });
      if (!current) {
        throw new AppError({
          code: ERROR_CODES.INVENTORY_RESERVATION_NOT_FOUND,
          message: RESERVATION_ERROR_MESSAGES.NOT_FOUND,
          statusCode: 404,
        });
      }
      if (current.status !== InventoryReservationStatus.ACTIVE) {
        throw new AppError({
          code: ERROR_CODES.INVENTORY_RESERVATION_NOT_ACTIVE,
          message: RESERVATION_ERROR_MESSAGES.NOT_ACTIVE,
          statusCode: 409,
        });
      }

      await this.lockAvailabilityScope(
        tx,
        company.companyId,
        current.warehouseId,
        current.skuId,
      );
      const availability = await this.computeAvailabilityInTx(
        tx,
        company.companyId,
        current.warehouseId,
        current.skuId,
      );
      if (availability.available < quantity) {
        throw new AppError({
          code: ERROR_CODES.INVENTORY_RESERVATION_INSUFFICIENT_AVAILABLE,
          message: RESERVATION_ERROR_MESSAGES.INSUFFICIENT_AVAILABLE,
          statusCode: 409,
          details: availability,
        });
      }

      return tx.inventoryReservation.update({
        where: { id },
        data: {
          quantity: current.quantity + quantity,
          remainingQuantity: current.remainingQuantity + quantity,
          version: { increment: 1 },
        },
        include: this.detailInclude(),
      });
    });

    return this.toView(reservation);
  }

  /**
   * Foundation for Phase 5: partially consume reservation after physical outbound.
   * Does not post movements — caller posts ISSUE then calls this in the same TX.
   * When `events` is provided, emits InventoryReservationConsumed after successful update.
   */
  async consumeInTx(
    tx: Tx,
    companyId: string,
    input: { reservationId: string; quantity: number },
    events?: Array<ReturnType<DomainEventFactory['create']>>,
  ) {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_RESERVATION_INVALID_QUANTITY,
        message: RESERVATION_ERROR_MESSAGES.INVALID_QUANTITY,
        statusCode: 400,
      });
    }

    await tx.$queryRaw`
      SELECT id FROM inventory_reservations
      WHERE id = ${input.reservationId}::uuid AND company_id = ${companyId}::uuid
      FOR UPDATE
    `;
    const current = await tx.inventoryReservation.findFirst({
      where: { id: input.reservationId, companyId },
    });
    if (!current) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_RESERVATION_NOT_FOUND,
        message: RESERVATION_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    if (current.status !== InventoryReservationStatus.ACTIVE) {
      if (
        current.status === InventoryReservationStatus.CONSUMED &&
        current.remainingQuantity === 0
      ) {
        return current;
      }
      throw new AppError({
        code: ERROR_CODES.INVENTORY_RESERVATION_NOT_ACTIVE,
        message: RESERVATION_ERROR_MESSAGES.NOT_ACTIVE,
        statusCode: 409,
      });
    }
    if (input.quantity > current.remainingQuantity) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_RESERVATION_INVALID_QUANTITY,
        message: RESERVATION_ERROR_MESSAGES.OVER_DECREASE,
        statusCode: 409,
      });
    }

    const next = current.remainingQuantity - input.quantity;
    const updated = await tx.inventoryReservation.update({
      where: { id: current.id },
      data: {
        remainingQuantity: next,
        status:
          next === 0
            ? InventoryReservationStatus.CONSUMED
            : InventoryReservationStatus.ACTIVE,
        consumedAt: next === 0 ? new Date() : current.consumedAt,
        version: { increment: 1 },
      },
    });

    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.INVENTORY_RESERVATION_CONSUMED,
      entityType: AUDIT_ENTITY_TYPES.INVENTORY_RESERVATION,
      entityId: current.id,
      before: {
        remainingQuantity: current.remainingQuantity,
        status: current.status,
      },
      after: {
        remainingQuantity: updated.remainingQuantity,
        status: updated.status,
        consumedQuantity: input.quantity,
      },
    });

    if (events) {
      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.WAREHOUSE_INVENTORY_RESERVATION_CONSUMED,
          payload: {
            companyId,
            reservationId: current.id,
            warehouseId: current.warehouseId,
            skuId: current.skuId,
            consumedQuantity: input.quantity,
            remainingQuantity: updated.remainingQuantity,
            status: updated.status,
          },
        }),
      );
    }

    return updated;
  }

  /**
   * Public consume for Phase 5 / tests. Same TX semantics as consumeInTx + commitThenPublish.
   */
  async consume(company: CompanyContext, id: string, quantity: number) {
    return commitThenPublish(this.eventBus, async (events) => {
      return this.database.client.$transaction(async (tx) => {
        return this.consumeInTx(
          tx,
          company.companyId,
          { reservationId: id, quantity },
          events,
        );
      });
    });
  }

  async expire(company: CompanyContext, id: string) {
    return commitThenPublish(this.eventBus, async (events) => {
      const reservation = await this.database.client.$transaction(async (tx) => {
        const current = await tx.inventoryReservation.findFirst({
          where: { id, companyId: company.companyId },
          include: this.detailInclude(),
        });
        if (!current) {
          throw new AppError({
            code: ERROR_CODES.INVENTORY_RESERVATION_NOT_FOUND,
            message: RESERVATION_ERROR_MESSAGES.NOT_FOUND,
            statusCode: 404,
          });
        }
        if (
          current.status === InventoryReservationStatus.EXPIRED ||
          current.status === InventoryReservationStatus.RELEASED ||
          current.status === InventoryReservationStatus.CONSUMED ||
          current.status === InventoryReservationStatus.CANCELLED
        ) {
          return current;
        }

        const updated = await tx.inventoryReservation.update({
          where: { id },
          data: {
            status: InventoryReservationStatus.EXPIRED,
            remainingQuantity: 0,
            expiredAt: new Date(),
            version: { increment: 1 },
          },
          include: this.detailInclude(),
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.INVENTORY_RESERVATION_EXPIRED,
          entityType: AUDIT_ENTITY_TYPES.INVENTORY_RESERVATION,
          entityId: id,
          before: { status: current.status, remainingQuantity: current.remainingQuantity },
          after: { status: updated.status, remainingQuantity: 0 },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_INVENTORY_RESERVATION_EXPIRED,
            payload: {
              companyId: company.companyId,
              reservationId: id,
            },
          }),
        );

        return updated;
      });

      return this.toView(reservation);
    });
  }

  async getAvailability(
    company: CompanyContext,
    warehouseId: string,
    skuId: string,
  ): Promise<AvailabilityView> {
    return this.database.client.$transaction(async (tx) => {
      await this.assertWarehouseSku(tx, company.companyId, warehouseId, skuId);
      return this.computeAvailabilityInTx(tx, company.companyId, warehouseId, skuId);
    });
  }

  async bulkAvailability(
    company: CompanyContext,
    items: Array<{ warehouseId: string; skuId: string }>,
  ): Promise<{ data: AvailabilityView[] }> {
    if (items.length === 0) return { data: [] };
    if (items.length > AVAILABILITY_BULK_MAX) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Bulk availability supports at most ${AVAILABILITY_BULK_MAX} items`,
        statusCode: 400,
      });
    }

    const data: AvailabilityView[] = [];
    await this.database.client.$transaction(async (tx) => {
      for (const item of items) {
        data.push(
          await this.computeAvailabilityInTx(
            tx,
            company.companyId,
            item.warehouseId,
            item.skuId,
          ),
        );
      }
    });
    return { data };
  }

  /**
   * Guard for unreserved SELLABLE outbound (e.g. Stock Issue).
   * Ensures requested qty ≤ Available (does not steal reserved stock).
   */
  async assertUnreservedSellableOutboundInTx(
    tx: Tx,
    companyId: string,
    warehouseId: string,
    requirements: Array<{ skuId: string; quantity: number }>,
  ): Promise<void> {
    const bySku = new Map<string, number>();
    for (const r of requirements) {
      bySku.set(r.skuId, (bySku.get(r.skuId) ?? 0) + r.quantity);
    }
    for (const [skuId, qty] of bySku) {
      await this.lockAvailabilityScope(tx, companyId, warehouseId, skuId);
      const availability = await this.computeAvailabilityInTx(
        tx,
        companyId,
        warehouseId,
        skuId,
      );
      if (availability.available < qty) {
        throw new AppError({
          code: ERROR_CODES.INVENTORY_RESERVED_STOCK_PROTECTED,
          message:
            'Unreserved outbound exceeds SELLABLE available (stock is reserved)',
          statusCode: 409,
          details: { ...availability, requested: qty },
        });
      }
    }
  }

  async computeAvailabilityInTx(
    tx: Tx,
    companyId: string,
    warehouseId: string,
    skuId: string,
  ): Promise<AvailabilityView> {
    const onHandAgg = await tx.inventoryBalance.aggregate({
      where: {
        companyId,
        warehouseId,
        skuId,
        classification: StockClassification.SELLABLE,
      },
      _sum: { onHandQuantity: true },
    });
    const onHand = onHandAgg._sum.onHandQuantity ?? 0;

    const reservedAgg = await tx.inventoryReservation.aggregate({
      where: {
        companyId,
        warehouseId,
        skuId,
        status: InventoryReservationStatus.ACTIVE,
      },
      _sum: { remainingQuantity: true },
    });
    const reserved = reservedAgg._sum.remainingQuantity ?? 0;
    const available = Math.max(0, onHand - reserved);

    return {
      warehouseId,
      skuId,
      classification: 'SELLABLE',
      onHand,
      reserved,
      available,
    };
  }

  /** Public for Sales orchestration to lock before computing Available. */
  async lockAvailabilityScope(
    tx: Tx,
    companyId: string,
    warehouseId: string,
    skuId: string,
  ): Promise<void> {
    await tx.inventoryAvailabilityLock.upsert({
      where: {
        companyId_warehouseId_skuId: { companyId, warehouseId, skuId },
      },
      create: { companyId, warehouseId, skuId },
      update: {},
    });
    await tx.$queryRaw`
      SELECT company_id FROM inventory_availability_locks
      WHERE company_id = ${companyId}::uuid
        AND warehouse_id = ${warehouseId}::uuid
        AND sku_id = ${skuId}::uuid
      FOR UPDATE
    `;
  }

  private async assertWarehouseSku(
    tx: Tx,
    companyId: string,
    warehouseId: string,
    skuId: string,
  ): Promise<void> {
    const warehouse = await tx.warehouse.findFirst({
      where: { id: warehouseId, companyId },
    });
    if (!warehouse || warehouse.status !== WarehouseStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_RESERVATION_WAREHOUSE_INACTIVE,
        message: RESERVATION_ERROR_MESSAGES.WAREHOUSE_INACTIVE,
        statusCode: 409,
      });
    }
    if (warehouse.isSystem) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_RESERVATION_SYSTEM_WAREHOUSE,
        message: RESERVATION_ERROR_MESSAGES.SYSTEM_WAREHOUSE,
        statusCode: 409,
      });
    }
    const sku = await tx.sku.findFirst({ where: { id: skuId, companyId } });
    if (!sku) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_RESERVATION_SKU_NOT_FOUND,
        message: RESERVATION_ERROR_MESSAGES.SKU_NOT_FOUND,
        statusCode: 404,
      });
    }
  }

  private detailInclude() {
    return {
      warehouse: { select: { id: true, code: true, name: true } },
      sku: {
        select: {
          id: true,
          code: true,
          name: true,
          product: { select: { name: true } },
        },
      },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    } as const;
  }

  private toView(
    row: {
      id: string;
      companyId: string;
      warehouseId: string;
      skuId: string;
      sourceType: InventoryReservationSourceType;
      sourceId: string;
      sourceLineId: string;
      requestId: string;
      quantity: number;
      remainingQuantity: number;
      status: InventoryReservationStatus;
      expiresAt: Date | null;
      releasedAt: Date | null;
      consumedAt: Date | null;
      expiredAt: Date | null;
      cancelledAt: Date | null;
      createdById: string;
      version: number;
      createdAt: Date;
      updatedAt: Date;
      warehouse?: { id: string; code: string; name: string };
      sku?: {
        id: string;
        code: string;
        name: string | null;
        product?: { name: string };
      };
      createdBy?: { id: string; firstName: string; lastName: string };
    },
  ) {
    return {
      id: row.id,
      companyId: row.companyId,
      warehouseId: row.warehouseId,
      skuId: row.skuId,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      sourceLineId: row.sourceLineId,
      requestId: row.requestId,
      quantity: row.quantity,
      remainingQuantity: row.remainingQuantity,
      status: row.status,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      releasedAt: row.releasedAt?.toISOString() ?? null,
      consumedAt: row.consumedAt?.toISOString() ?? null,
      expiredAt: row.expiredAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      createdById: row.createdById,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      warehouse: row.warehouse,
      sku: row.sku,
      createdBy: row.createdBy,
    };
  }
}
