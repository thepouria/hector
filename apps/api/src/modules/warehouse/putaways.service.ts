import { Injectable } from '@nestjs/common';
import {
  GoodsReceiptStatus,
  Prisma,
  PutawayStatus,
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
import { normalizeLocationBarcodeInput } from './location-barcode.util';
import {
  allocatePutawaySequence,
  formatPutawayNumber,
} from './putaway-numbering';
import { PUTAWAY_ERROR_MESSAGES, PUTAWAY_SEARCH_MAX_LENGTH } from './putaway.constants';
import { InventoryLedgerService } from './inventory-ledger.service';
import type {
  CreatePutawayDto,
  ListPendingPutawayQueryDto,
  ListPutawaysQueryDto,
  ResolvePutawayLocationDto,
  ScanApplyPutawayDto,
  UpdatePutawayItemDto,
  UpsertPutawayItemDto,
} from './dto/putaway.dto';
import type {
  PendingPutawayLineView,
  PutawayDetailView,
  PutawayItemView,
  PutawayListItemView,
  PutawayLocationRef,
  PutawayScanApplyResultView,
  PutawaySourceLineView,
  ReceiptPutawayProgress,
} from './types/putaway.types';

const detailInclude = {
  warehouse: { select: { id: true, code: true, name: true, status: true } },
  goodsReceipt: {
    select: {
      id: true,
      number: true,
      status: true,
      warehouseId: true,
      receivedAt: true,
      postedAt: true,
    },
  },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  completedBy: { select: { id: true, firstName: true, lastName: true } },
  items: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    include: {
      warehouseLocation: true,
      goodsReceiptItemBatch: {
        include: {
          batch: {
            select: {
              id: true,
              batchNumber: true,
              supplierBatchNumber: true,
              expiresAt: true,
              skuId: true,
            },
          },
          goodsReceiptItem: {
            select: {
              id: true,
              skuId: true,
              goodsReceiptId: true,
              sku: {
                select: {
                  code: true,
                  name: true,
                  product: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.PutawayInclude;

type DetailRow = Prisma.PutawayGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class PutawaysService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
    private readonly inventoryLedger: InventoryLedgerService,
  ) {}

  async list(
    company: CompanyContext,
    query: ListPutawaysQueryDto,
  ): Promise<{ data: PutawayListItemView[]; meta: PaginationMeta }> {
    const search = normalizeSearch(query.q);
    const where: Prisma.PutawayWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.goodsReceiptId ? { goodsReceiptId: query.goodsReceiptId } : {}),
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
              ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { goodsReceipt: { number: { contains: search, mode: 'insensitive' } } },
              { warehouse: { code: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.putaway.count({ where }),
      this.database.client.putaway.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.pageSize,
        include: {
          warehouse: { select: { code: true, name: true } },
          goodsReceipt: { select: { number: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          completedBy: { select: { id: true, firstName: true, lastName: true } },
          items: { select: { quantity: true } },
        },
      }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        warehouseId: row.warehouseId,
        warehouseCode: row.warehouse.code,
        warehouseName: row.warehouse.name,
        goodsReceiptId: row.goodsReceiptId,
        goodsReceiptNumber: row.goodsReceipt.number,
        itemCount: row.items.length,
        totalQuantity: row.items.reduce((sum, i) => sum + i.quantity, 0),
        createdAt: row.createdAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null,
        createdBy: toUserRef(row.createdBy),
        completedBy: toUserRef(row.completedBy),
      })),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async listPending(
    company: CompanyContext,
    query: ListPendingPutawayQueryDto,
  ): Promise<{ data: PendingPutawayLineView[]; meta: PaginationMeta }> {
    const search = normalizeSearch(query.q);
    const skip = (query.page - 1) * query.pageSize;

    const rows = await this.database.client.$queryRaw<
      Array<{
        receipt_batch_allocation_id: string;
        goods_receipt_id: string;
        goods_receipt_number: string;
        warehouse_id: string;
        warehouse_code: string;
        warehouse_name: string;
        sku_id: string;
        sku_code: string | null;
        product_name: string | null;
        batch_id: string;
        batch_number: string;
        supplier_batch_number: string | null;
        expires_at: Date | null;
        received_quantity: number;
        already_put_away: number;
        remaining: number;
        posted_at: Date | null;
        received_at: Date | null;
        total_count: number;
      }>
    >(Prisma.sql`
      WITH completed AS (
        SELECT
          pi.goods_receipt_item_batch_id AS allocation_id,
          SUM(pi.quantity)::int AS qty
        FROM putaway_items pi
        INNER JOIN putaways p
          ON p.id = pi.putaway_id AND p.company_id = pi.company_id
        WHERE pi.company_id = ${company.companyId}::uuid
          AND p.status = 'COMPLETED'::"putaway_status"
        GROUP BY pi.goods_receipt_item_batch_id
      ),
      base AS (
        SELECT
          a.id AS receipt_batch_allocation_id,
          g.id AS goods_receipt_id,
          g.number AS goods_receipt_number,
          w.id AS warehouse_id,
          w.code AS warehouse_code,
          w.name AS warehouse_name,
          a.sku_id,
          s.code AS sku_code,
          COALESCE(pr.name, s.name) AS product_name,
          b.id AS batch_id,
          b.batch_number,
          b.supplier_batch_number,
          b.expires_at,
          a.quantity AS received_quantity,
          COALESCE(c.qty, 0)::int AS already_put_away,
          (a.quantity - COALESCE(c.qty, 0))::int AS remaining,
          g.posted_at,
          g.received_at
        FROM goods_receipt_item_batches a
        INNER JOIN goods_receipt_items i
          ON i.id = a.goods_receipt_item_id AND i.company_id = a.company_id
        INNER JOIN goods_receipts g
          ON g.id = i.goods_receipt_id AND g.company_id = a.company_id
        INNER JOIN warehouses w
          ON w.id = g.warehouse_id AND w.company_id = g.company_id
        INNER JOIN batches b
          ON b.id = a.batch_id AND b.company_id = a.company_id
        INNER JOIN skus s
          ON s.id = a.sku_id AND s.company_id = a.company_id
        LEFT JOIN products pr ON pr.id = s.product_id
        LEFT JOIN completed c ON c.allocation_id = a.id
        WHERE a.company_id = ${company.companyId}::uuid
          AND g.status = 'POSTED'::"goods_receipt_status"
          AND (a.quantity - COALESCE(c.qty, 0)) > 0
          ${query.warehouseId ? Prisma.sql`AND g.warehouse_id = ${query.warehouseId}::uuid` : Prisma.empty}
          ${query.goodsReceiptId ? Prisma.sql`AND g.id = ${query.goodsReceiptId}::uuid` : Prisma.empty}
          ${
            search
              ? Prisma.sql`AND (
                  g.number ILIKE ${'%' + search + '%'}
                  OR s.code ILIKE ${'%' + search + '%'}
                  OR COALESCE(pr.name, s.name) ILIKE ${'%' + search + '%'}
                  OR b.batch_number ILIKE ${'%' + search + '%'}
                  OR COALESCE(b.supplier_batch_number, '') ILIKE ${'%' + search + '%'}
                )`
              : Prisma.empty
          }
      )
      SELECT *, COUNT(*) OVER()::int AS total_count
      FROM base
      ORDER BY posted_at DESC NULLS LAST, goods_receipt_number DESC, sku_code ASC, batch_number ASC
      OFFSET ${skip}
      LIMIT ${query.pageSize}
    `);

    const total = rows[0]?.total_count ?? 0;
    return {
      data: rows.map((row) => ({
        receiptBatchAllocationId: row.receipt_batch_allocation_id,
        goodsReceiptId: row.goods_receipt_id,
        goodsReceiptNumber: row.goods_receipt_number,
        warehouseId: row.warehouse_id,
        warehouseCode: row.warehouse_code,
        warehouseName: row.warehouse_name,
        skuId: row.sku_id,
        skuCode: row.sku_code,
        productName: row.product_name,
        batchId: row.batch_id,
        batchNumber: row.batch_number,
        supplierBatchNumber: row.supplier_batch_number,
        expiresAt: row.expires_at ? row.expires_at.toISOString().slice(0, 10) : null,
        receivedQuantity: row.received_quantity,
        alreadyPutAway: row.already_put_away,
        remainingToPutAway: row.remaining,
        receiptPutawayProgress: deriveProgress(row.received_quantity, row.already_put_away),
        postedAt: row.posted_at?.toISOString() ?? null,
        receivedAt: row.received_at?.toISOString() ?? null,
      })),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, putawayId: string): Promise<PutawayDetailView> {
    const row = await this.requireDetail(company.companyId, putawayId);
    return this.toDetailView(company.companyId, row);
  }

  async create(company: CompanyContext, dto: CreatePutawayDto): Promise<PutawayDetailView> {
    const actorUserId = this.requireActorUserId();

    return commitThenPublish(this.eventBus, async (events) => {
      const created = await this.database.client.$transaction(async (tx) => {
        const receipt = await tx.goodsReceipt.findFirst({
          where: { id: dto.goodsReceiptId, companyId: company.companyId },
          include: { warehouse: true },
        });
        if (!receipt) {
          throw new AppError({
            code: ERROR_CODES.GOODS_RECEIPT_NOT_FOUND,
            message: 'Goods receipt was not found.',
            statusCode: 404,
          });
        }
        if (receipt.status !== GoodsReceiptStatus.POSTED) {
          throw new AppError({
            code: ERROR_CODES.GRN_NOT_POSTED,
            message: PUTAWAY_ERROR_MESSAGES.GRN_NOT_POSTED,
            statusCode: 409,
          });
        }

        const sequence = await allocatePutawaySequence(tx, company.companyId);
        const number = formatPutawayNumber(sequence);
        const putaway = await tx.putaway.create({
          data: {
            companyId: company.companyId,
            number,
            warehouseId: receipt.warehouseId,
            goodsReceiptId: receipt.id,
            status: PutawayStatus.DRAFT,
            createdById: actorUserId,
          },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PUTAWAY_CREATED,
          entityType: AUDIT_ENTITY_TYPES.PUTAWAY,
          entityId: putaway.id,
          before: null,
          after: {
            number: putaway.number,
            goodsReceiptId: putaway.goodsReceiptId,
            warehouseId: putaway.warehouseId,
            status: putaway.status,
          },
          metadata: {
            putawayId: putaway.id,
            goodsReceiptId: putaway.goodsReceiptId,
            warehouseId: putaway.warehouseId,
          },
        });

        return putaway;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.WAREHOUSE_PUTAWAY_CREATED,
          payload: {
            companyId: company.companyId,
            putawayId: created.id,
            goodsReceiptId: created.goodsReceiptId,
            warehouseId: created.warehouseId,
            number: created.number,
          },
        }),
      );

      return this.toDetailView(company.companyId, created);
    });
  }

  async upsertItem(
    company: CompanyContext,
    putawayId: string,
    dto: UpsertPutawayItemDto,
  ): Promise<PutawayDetailView> {
    this.assertPositiveQuantity(dto.quantity);

    return commitThenPublish(this.eventBus, async () => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const current = await this.lockEditable(tx, company.companyId, putawayId);
        const allocation = await this.requirePostedAllocation(
          tx,
          company.companyId,
          current.goodsReceiptId,
          dto.receiptBatchAllocationId,
        );
        const location = await this.requirePutawayLocation(
          tx,
          company.companyId,
          current.warehouseId,
          dto.warehouseLocationId,
        );

        const existing = await tx.putawayItem.findUnique({
          where: {
            putawayId_goodsReceiptItemBatchId_warehouseLocationId: {
              putawayId: current.id,
              goodsReceiptItemBatchId: allocation.id,
              warehouseLocationId: location.id,
            },
          },
        });

        await this.assertCapacity(
          tx,
          company.companyId,
          allocation.id,
          allocation.quantity,
          current.id,
          dto.quantity,
          existing?.id ?? null,
        );

        let item;
        if (existing) {
          item = await tx.putawayItem.update({
            where: { id: existing.id },
            data: { quantity: dto.quantity },
          });
        } else {
          item = await tx.putawayItem.create({
            data: {
              companyId: company.companyId,
              putawayId: current.id,
              goodsReceiptItemBatchId: allocation.id,
              warehouseLocationId: location.id,
              quantity: dto.quantity,
            },
          });
        }

        const nextStatus =
          current.status === PutawayStatus.DRAFT
            ? PutawayStatus.IN_PROGRESS
            : current.status;

        await tx.putaway.update({
          where: { id: current.id },
          data: {
            status: nextStatus,
            startedAt: current.startedAt ?? new Date(),
            version: { increment: 1 },
          },
        });

        const detail = await tx.putaway.findFirstOrThrow({
          where: { id: current.id, companyId: company.companyId },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PUTAWAY_ITEM_UPSERTED,
          entityType: AUDIT_ENTITY_TYPES.PUTAWAY,
          entityId: detail.id,
          before: existing
            ? { itemId: existing.id, quantity: existing.quantity }
            : null,
          after: {
            itemId: item.id,
            receiptBatchAllocationId: allocation.id,
            warehouseLocationId: location.id,
            quantity: dto.quantity,
          },
          metadata: {
            putawayId: detail.id,
            goodsReceiptId: detail.goodsReceiptId,
            warehouseId: detail.warehouseId,
          },
        });

        return detail;
      });

      return this.toDetailView(company.companyId, updated);
    });
  }

  async updateItem(
    company: CompanyContext,
    putawayId: string,
    itemId: string,
    dto: UpdatePutawayItemDto,
  ): Promise<PutawayDetailView> {
    return commitThenPublish(this.eventBus, async () => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const current = await this.lockEditable(tx, company.companyId, putawayId);
        const existing = current.items.find((i) => i.id === itemId);
        if (!existing) {
          throw new AppError({
            code: ERROR_CODES.PUTAWAY_ITEM_NOT_FOUND,
            message: PUTAWAY_ERROR_MESSAGES.ITEM_NOT_FOUND,
            statusCode: 404,
          });
        }

        const quantity = dto.quantity ?? existing.quantity;
        this.assertPositiveQuantity(quantity);
        const locationId = dto.warehouseLocationId ?? existing.warehouseLocationId;
        await this.requirePutawayLocation(tx, company.companyId, current.warehouseId, locationId);

        await this.assertCapacity(
          tx,
          company.companyId,
          existing.goodsReceiptItemBatchId,
          existing.goodsReceiptItemBatch.quantity,
          current.id,
          quantity,
          existing.id,
        );

        if (
          locationId !== existing.warehouseLocationId &&
          dto.warehouseLocationId
        ) {
          const conflict = await tx.putawayItem.findUnique({
            where: {
              putawayId_goodsReceiptItemBatchId_warehouseLocationId: {
                putawayId: current.id,
                goodsReceiptItemBatchId: existing.goodsReceiptItemBatchId,
                warehouseLocationId: locationId,
              },
            },
          });
          if (conflict && conflict.id !== existing.id) {
            await tx.putawayItem.update({
              where: { id: conflict.id },
              data: { quantity: conflict.quantity + quantity },
            });
            await tx.putawayItem.delete({ where: { id: existing.id } });
          } else {
            await tx.putawayItem.update({
              where: { id: existing.id },
              data: { quantity, warehouseLocationId: locationId },
            });
          }
        } else {
          await tx.putawayItem.update({
            where: { id: existing.id },
            data: { quantity },
          });
        }

        await tx.putaway.update({
          where: { id: current.id },
          data: { version: { increment: 1 } },
        });

        return tx.putaway.findFirstOrThrow({
          where: { id: current.id, companyId: company.companyId },
          include: detailInclude,
        });
      });

      return this.toDetailView(company.companyId, updated);
    });
  }

  async removeItem(
    company: CompanyContext,
    putawayId: string,
    itemId: string,
  ): Promise<PutawayDetailView> {
    return commitThenPublish(this.eventBus, async () => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const current = await this.lockEditable(tx, company.companyId, putawayId);
        const existing = current.items.find((i) => i.id === itemId);
        if (!existing) {
          throw new AppError({
            code: ERROR_CODES.PUTAWAY_ITEM_NOT_FOUND,
            message: PUTAWAY_ERROR_MESSAGES.ITEM_NOT_FOUND,
            statusCode: 404,
          });
        }

        await tx.putawayItem.delete({ where: { id: existing.id } });
        const remaining = await tx.putawayItem.count({ where: { putawayId: current.id } });
        await tx.putaway.update({
          where: { id: current.id },
          data: {
            status: remaining === 0 ? PutawayStatus.DRAFT : PutawayStatus.IN_PROGRESS,
            version: { increment: 1 },
          },
        });

        const detail = await tx.putaway.findFirstOrThrow({
          where: { id: current.id, companyId: company.companyId },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PUTAWAY_ITEM_REMOVED,
          entityType: AUDIT_ENTITY_TYPES.PUTAWAY,
          entityId: detail.id,
          before: {
            itemId: existing.id,
            quantity: existing.quantity,
            warehouseLocationId: existing.warehouseLocationId,
          },
          after: null,
        });

        return detail;
      });

      return this.toDetailView(company.companyId, updated);
    });
  }

  async resolveLocation(
    company: CompanyContext,
    putawayId: string,
    dto: ResolvePutawayLocationDto,
  ): Promise<{ data: PutawayLocationRef }> {
    const putaway = await this.database.client.putaway.findFirst({
      where: { id: putawayId, companyId: company.companyId },
    });
    if (!putaway) {
      throw new AppError({
        code: ERROR_CODES.PUTAWAY_NOT_FOUND,
        message: PUTAWAY_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }

    const location = await this.resolveLocationBarcodeInWarehouse(
      company.companyId,
      putaway.warehouseId,
      dto.barcode,
    );
    const path = await this.buildLocationPath(company.companyId, location.id);
    return {
      data: {
        id: location.id,
        code: location.code,
        name: location.name,
        barcode: location.barcode,
        type: location.type,
        status: location.status,
        path,
      },
    };
  }

  async scanApply(
    company: CompanyContext,
    putawayId: string,
    dto: ScanApplyPutawayDto,
  ): Promise<PutawayScanApplyResultView> {
    this.assertPositiveQuantity(dto.quantity);

    return commitThenPublish(this.eventBus, async () => {
      const applied = await this.database.client.$transaction(async (tx) => {
        const current = await this.lockEditable(tx, company.companyId, putawayId);

        if (dto.requestId) {
          const existing = await tx.putawayScanRequest.findUnique({
            where: {
              companyId_putawayId_requestId: {
                companyId: company.companyId,
                putawayId: current.id,
                requestId: dto.requestId,
              },
            },
          });
          if (existing) {
            return {
              kind: 'replay' as const,
              response: existing.responseJson as unknown as PutawayScanApplyResultView,
            };
          }
        }

        const location = await this.resolveLocationBarcodeInWarehouseTx(
          tx,
          company.companyId,
          current.warehouseId,
          dto.locationBarcode,
        );

        const detail = await this.upsertItemInTx(tx, company, current, {
          receiptBatchAllocationId: dto.receiptBatchAllocationId,
          warehouseLocationId: location.id,
          quantity: dto.quantity,
          increment: true,
        });

        const path = await this.buildLocationPathTx(tx, company.companyId, location.id);
        const locationRef: PutawayLocationRef = {
          id: location.id,
          code: location.code,
          name: location.name,
          barcode: location.barcode,
          type: location.type,
          status: location.status,
          path,
        };

        const putawayView = await this.toDetailView(company.companyId, detail, tx);
        const response: PutawayScanApplyResultView = {
          status: 'APPLIED',
          quantity: dto.quantity,
          receiptBatchAllocationId: dto.receiptBatchAllocationId,
          warehouseLocationId: location.id,
          location: locationRef,
          replayed: false,
          putaway: putawayView,
        };

        if (dto.requestId) {
          try {
            await tx.putawayScanRequest.create({
              data: {
                companyId: company.companyId,
                putawayId: current.id,
                requestId: dto.requestId,
                responseJson: response as unknown as Prisma.InputJsonValue,
              },
            });
          } catch (error) {
            if (
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === 'P2002'
            ) {
              const raced = await tx.putawayScanRequest.findUniqueOrThrow({
                where: {
                  companyId_putawayId_requestId: {
                    companyId: company.companyId,
                    putawayId: current.id,
                    requestId: dto.requestId,
                  },
                },
              });
              return {
                kind: 'replay' as const,
                response: raced.responseJson as unknown as PutawayScanApplyResultView,
              };
            }
            throw error;
          }
        }

        return { kind: 'applied' as const, response };
      });

      if (applied.kind === 'replay') {
        return { ...applied.response, replayed: true };
      }
      return applied.response;
    });
  }

  async complete(company: CompanyContext, putawayId: string): Promise<PutawayDetailView> {
    const actorUserId = this.requireActorUserId();

    return commitThenPublish(this.eventBus, async (events) => {
      const completed = await this.database.client.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<
          Array<{ id: string; status: PutawayStatus; version: number; goods_receipt_id: string }>
        >(Prisma.sql`
          SELECT id, status, version, goods_receipt_id
          FROM putaways
          WHERE id = ${putawayId}::uuid
            AND company_id = ${company.companyId}::uuid
          FOR UPDATE
        `);
        const row = locked[0];
        if (!row) {
          throw new AppError({
            code: ERROR_CODES.PUTAWAY_NOT_FOUND,
            message: PUTAWAY_ERROR_MESSAGES.NOT_FOUND,
            statusCode: 404,
          });
        }
        if (row.status === PutawayStatus.COMPLETED) {
          throw new AppError({
            code: ERROR_CODES.PUTAWAY_ALREADY_COMPLETED,
            message: PUTAWAY_ERROR_MESSAGES.ALREADY_COMPLETED,
            statusCode: 409,
          });
        }
        if (row.status === PutawayStatus.CANCELLED) {
          throw new AppError({
            code: ERROR_CODES.PUTAWAY_NOT_COMPLETABLE,
            message: PUTAWAY_ERROR_MESSAGES.NOT_COMPLETABLE,
            statusCode: 409,
          });
        }

        // Lock POSTED GRN to serialize concurrent putaway completion for same receipt.
        await tx.$queryRaw`
          SELECT id FROM goods_receipts
          WHERE id = ${row.goods_receipt_id}::uuid
            AND company_id = ${company.companyId}::uuid
          FOR UPDATE
        `;

        const detail = await tx.putaway.findFirstOrThrow({
          where: { id: putawayId, companyId: company.companyId },
          include: detailInclude,
        });

        if (detail.items.length === 0) {
          throw new AppError({
            code: ERROR_CODES.PUTAWAY_EMPTY,
            message: PUTAWAY_ERROR_MESSAGES.EMPTY,
            statusCode: 409,
          });
        }

        for (const item of detail.items) {
          this.assertPositiveQuantity(item.quantity);
          if (item.warehouseLocation.warehouseId !== detail.warehouseId) {
            throw new AppError({
              code: ERROR_CODES.LOCATION_NOT_IN_PUTAWAY_WAREHOUSE,
              message: PUTAWAY_ERROR_MESSAGES.LOCATION_NOT_IN_PUTAWAY_WAREHOUSE,
              statusCode: 409,
            });
          }
          if (item.warehouseLocation.status !== WarehouseStatus.ACTIVE) {
            throw new AppError({
              code: ERROR_CODES.LOCATION_NOT_AVAILABLE,
              message: PUTAWAY_ERROR_MESSAGES.LOCATION_NOT_AVAILABLE,
              statusCode: 409,
            });
          }
          if (
            item.goodsReceiptItemBatch.goodsReceiptItem.goodsReceiptId !==
            detail.goodsReceiptId
          ) {
            throw new AppError({
              code: ERROR_CODES.RECEIPT_BATCH_ALLOCATION_NOT_FOUND,
              message: PUTAWAY_ERROR_MESSAGES.RECEIPT_BATCH_ALLOCATION_NOT_FOUND,
              statusCode: 409,
            });
          }
        }

        // Aggregate this putaway + already completed elsewhere per allocation.
        const byAllocation = new Map<string, number>();
        for (const item of detail.items) {
          byAllocation.set(
            item.goodsReceiptItemBatchId,
            (byAllocation.get(item.goodsReceiptItemBatchId) ?? 0) + item.quantity,
          );
        }

        for (const [allocationId, thisQty] of byAllocation) {
          const allocation = detail.items.find(
            (i) => i.goodsReceiptItemBatchId === allocationId,
          )!.goodsReceiptItemBatch;

          const completedElsewhere = await tx.putawayItem.aggregate({
            where: {
              companyId: company.companyId,
              goodsReceiptItemBatchId: allocationId,
              putaway: {
                companyId: company.companyId,
                status: PutawayStatus.COMPLETED,
                id: { not: detail.id },
              },
            },
            _sum: { quantity: true },
          });
          const elsewhere = completedElsewhere._sum.quantity ?? 0;
          if (elsewhere + thisQty > allocation.quantity) {
            throw new AppError({
              code: ERROR_CODES.PUTAWAY_QUANTITY_EXCEEDED,
              message: PUTAWAY_ERROR_MESSAGES.QUANTITY_EXCEEDED,
              statusCode: 409,
              details: {
                receiptBatchAllocationId: allocationId,
                received: allocation.quantity,
                alreadyPutAway: elsewhere,
                attempted: thisQty,
              },
            });
          }
        }

        const completedAt = new Date();
        const updated = await tx.putaway.update({
          where: { id: detail.id },
          data: {
            status: PutawayStatus.COMPLETED,
            completedAt,
            completedById: actorUserId,
            startedAt: detail.startedAt ?? completedAt,
            version: { increment: 1 },
          },
          include: detailInclude,
        });

        // Phase 3.9: RECEIVE ledger entries — exactly once per PutawayItem (idempotent).
        const receives = await this.inventoryLedger.postReceivesForCompletedPutaway(tx, {
          companyId: company.companyId,
          putawayId: updated.id,
          warehouseId: updated.warehouseId,
          actorUserId,
          occurredAt: completedAt,
          items: updated.items.map((item) => ({
            id: item.id,
            quantity: item.quantity,
            warehouseLocationId: item.warehouseLocationId,
            skuId: item.goodsReceiptItemBatch.skuId,
            batchId: item.goodsReceiptItemBatch.batchId,
          })),
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PUTAWAY_COMPLETED,
          entityType: AUDIT_ENTITY_TYPES.PUTAWAY,
          entityId: updated.id,
          before: { status: detail.status, version: detail.version },
          after: {
            status: PutawayStatus.COMPLETED,
            completedAt: completedAt.toISOString(),
            itemCount: updated.items.length,
            totalQuantity: updated.items.reduce((s, i) => s + i.quantity, 0),
            receiveMovementCount: receives.length,
          },
          metadata: {
            putawayId: updated.id,
            goodsReceiptId: updated.goodsReceiptId,
            warehouseId: updated.warehouseId,
            totalQuantity: updated.items.reduce((s, i) => s + i.quantity, 0),
            itemCount: updated.items.length,
            completedBy: actorUserId,
            receiveMovementIds: receives.map((m) => m.id),
          },
        });

        return { updated, receives };
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.WAREHOUSE_PUTAWAY_COMPLETED,
          payload: {
            companyId: company.companyId,
            putawayId: completed.updated.id,
            goodsReceiptId: completed.updated.goodsReceiptId,
            warehouseId: completed.updated.warehouseId,
            completedAt: completed.updated.completedAt!.toISOString(),
          },
        }),
      );
      for (const movement of completed.receives) {
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_INVENTORY_MOVEMENT_POSTED,
            payload: {
              companyId: company.companyId,
              movementId: movement.id,
              movementType: movement.movementType,
              skuId: movement.skuId,
              batchId: movement.batchId,
              warehouseId: movement.warehouseId,
              locationId: movement.locationId,
              quantityDelta: movement.quantityDelta,
              sourceType: movement.sourceType,
              sourceId: movement.sourceId,
              occurredAt: movement.occurredAt,
            },
          }),
        );
      }

      return this.toDetailView(company.companyId, completed.updated);
    });
  }

  async cancel(company: CompanyContext, putawayId: string): Promise<PutawayDetailView> {
    return commitThenPublish(this.eventBus, async (events) => {
      const cancelled = await this.database.client.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string; status: PutawayStatus }>>(
          Prisma.sql`
            SELECT id, status FROM putaways
            WHERE id = ${putawayId}::uuid
              AND company_id = ${company.companyId}::uuid
            FOR UPDATE
          `,
        );
        const row = locked[0];
        if (!row) {
          throw new AppError({
            code: ERROR_CODES.PUTAWAY_NOT_FOUND,
            message: PUTAWAY_ERROR_MESSAGES.NOT_FOUND,
            statusCode: 404,
          });
        }
        if (row.status === PutawayStatus.COMPLETED) {
          throw new AppError({
            code: ERROR_CODES.PUTAWAY_CANCEL_NOT_ALLOWED,
            message: PUTAWAY_ERROR_MESSAGES.CANCEL_NOT_ALLOWED,
            statusCode: 409,
          });
        }
        if (row.status === PutawayStatus.CANCELLED) {
          throw new AppError({
            code: ERROR_CODES.PUTAWAY_NOT_EDITABLE,
            message: PUTAWAY_ERROR_MESSAGES.NOT_EDITABLE,
            statusCode: 409,
          });
        }

        const cancelledAt = new Date();
        const updated = await tx.putaway.update({
          where: { id: putawayId },
          data: {
            status: PutawayStatus.CANCELLED,
            cancelledAt,
            version: { increment: 1 },
          },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PUTAWAY_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.PUTAWAY,
          entityId: updated.id,
          before: { status: row.status },
          after: { status: PutawayStatus.CANCELLED, cancelledAt: cancelledAt.toISOString() },
          metadata: {
            putawayId: updated.id,
            goodsReceiptId: updated.goodsReceiptId,
            warehouseId: updated.warehouseId,
          },
        });

        return updated;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.WAREHOUSE_PUTAWAY_CANCELLED,
          payload: {
            companyId: company.companyId,
            putawayId: cancelled.id,
            goodsReceiptId: cancelled.goodsReceiptId,
            warehouseId: cancelled.warehouseId,
          },
        }),
      );

      return this.toDetailView(company.companyId, cancelled);
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async upsertItemInTx(
    tx: Prisma.TransactionClient,
    company: CompanyContext,
    current: DetailRow,
    input: {
      receiptBatchAllocationId: string;
      warehouseLocationId: string;
      quantity: number;
      increment: boolean;
    },
  ): Promise<DetailRow> {
    const allocation = await this.requirePostedAllocation(
      tx,
      company.companyId,
      current.goodsReceiptId,
      input.receiptBatchAllocationId,
    );
    await this.requirePutawayLocation(
      tx,
      company.companyId,
      current.warehouseId,
      input.warehouseLocationId,
    );

    const existing = await tx.putawayItem.findUnique({
      where: {
        putawayId_goodsReceiptItemBatchId_warehouseLocationId: {
          putawayId: current.id,
          goodsReceiptItemBatchId: allocation.id,
          warehouseLocationId: input.warehouseLocationId,
        },
      },
    });

    const nextQty = existing && input.increment
      ? existing.quantity + input.quantity
      : input.quantity;

    await this.assertCapacity(
      tx,
      company.companyId,
      allocation.id,
      allocation.quantity,
      current.id,
      nextQty,
      existing?.id ?? null,
    );

    if (existing) {
      await tx.putawayItem.update({
        where: { id: existing.id },
        data: { quantity: nextQty },
      });
    } else {
      await tx.putawayItem.create({
        data: {
          companyId: company.companyId,
          putawayId: current.id,
          goodsReceiptItemBatchId: allocation.id,
          warehouseLocationId: input.warehouseLocationId,
          quantity: nextQty,
        },
      });
    }

    await tx.putaway.update({
      where: { id: current.id },
      data: {
        status:
          current.status === PutawayStatus.DRAFT
            ? PutawayStatus.IN_PROGRESS
            : current.status,
        startedAt: current.startedAt ?? new Date(),
        version: { increment: 1 },
      },
    });

    return tx.putaway.findFirstOrThrow({
      where: { id: current.id, companyId: company.companyId },
      include: detailInclude,
    });
  }

  private async assertCapacity(
    tx: Prisma.TransactionClient,
    companyId: string,
    allocationId: string,
    receivedQuantity: number,
    putawayId: string,
    thisItemQuantity: number,
    excludeItemId: string | null,
  ): Promise<void> {
    const completedElsewhere = await tx.putawayItem.aggregate({
      where: {
        companyId,
        goodsReceiptItemBatchId: allocationId,
        putaway: { companyId, status: PutawayStatus.COMPLETED },
      },
      _sum: { quantity: true },
    });
    const elsewhereCompleted = completedElsewhere._sum.quantity ?? 0;

    const draftOther = await tx.putawayItem.aggregate({
      where: {
        companyId,
        goodsReceiptItemBatchId: allocationId,
        putawayId,
        ...(excludeItemId ? { id: { not: excludeItemId } } : {}),
      },
      _sum: { quantity: true },
    });
    const otherOnThis = draftOther._sum.quantity ?? 0;

    if (elsewhereCompleted + otherOnThis + thisItemQuantity > receivedQuantity) {
      throw new AppError({
        code: ERROR_CODES.PUTAWAY_QUANTITY_EXCEEDED,
        message: PUTAWAY_ERROR_MESSAGES.QUANTITY_EXCEEDED,
        statusCode: 409,
        details: {
          received: receivedQuantity,
          alreadyPutAway: elsewhereCompleted,
          draftOnThisPutaway: otherOnThis,
          attempted: thisItemQuantity,
        },
      });
    }
  }

  private async requirePostedAllocation(
    tx: Prisma.TransactionClient,
    companyId: string,
    goodsReceiptId: string,
    allocationId: string,
  ) {
    const allocation = await tx.goodsReceiptItemBatch.findFirst({
      where: {
        id: allocationId,
        companyId,
        goodsReceiptItem: {
          companyId,
          goodsReceiptId,
          goodsReceipt: { companyId, status: GoodsReceiptStatus.POSTED },
        },
      },
    });
    if (!allocation) {
      throw new AppError({
        code: ERROR_CODES.RECEIPT_BATCH_ALLOCATION_NOT_FOUND,
        message: PUTAWAY_ERROR_MESSAGES.RECEIPT_BATCH_ALLOCATION_NOT_FOUND,
        statusCode: 404,
      });
    }
    return allocation;
  }

  private async requirePutawayLocation(
    tx: Prisma.TransactionClient,
    companyId: string,
    warehouseId: string,
    locationId: string,
  ) {
    const location = await tx.warehouseLocation.findFirst({
      where: { id: locationId, companyId },
    });
    if (!location) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_LOCATION_NOT_FOUND,
        message: 'Warehouse location was not found.',
        statusCode: 404,
      });
    }
    if (location.warehouseId !== warehouseId) {
      throw new AppError({
        code: ERROR_CODES.LOCATION_NOT_IN_PUTAWAY_WAREHOUSE,
        message: PUTAWAY_ERROR_MESSAGES.LOCATION_NOT_IN_PUTAWAY_WAREHOUSE,
        statusCode: 409,
      });
    }
    if (location.status !== WarehouseStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.LOCATION_NOT_AVAILABLE,
        message: PUTAWAY_ERROR_MESSAGES.LOCATION_NOT_AVAILABLE,
        statusCode: 409,
      });
    }
    return location;
  }

  private async resolveLocationBarcodeInWarehouse(
    companyId: string,
    warehouseId: string,
    rawBarcode: string,
  ) {
    return this.resolveLocationBarcodeInWarehouseTx(
      this.database.client,
      companyId,
      warehouseId,
      rawBarcode,
    );
  }

  private async resolveLocationBarcodeInWarehouseTx(
    tx: Prisma.TransactionClient | DatabaseService['client'],
    companyId: string,
    warehouseId: string,
    rawBarcode: string,
  ) {
    const barcode = normalizeLocationBarcodeInput(rawBarcode);
    if (!barcode) {
      throw new AppError({
        code: ERROR_CODES.UNKNOWN_LOCATION_BARCODE,
        message: PUTAWAY_ERROR_MESSAGES.UNKNOWN_LOCATION_BARCODE,
        statusCode: 404,
      });
    }
    const location = await tx.warehouseLocation.findFirst({
      where: { companyId, barcode },
    });
    if (!location) {
      throw new AppError({
        code: ERROR_CODES.UNKNOWN_LOCATION_BARCODE,
        message: PUTAWAY_ERROR_MESSAGES.UNKNOWN_LOCATION_BARCODE,
        statusCode: 404,
        details: { barcode },
      });
    }
    if (location.warehouseId !== warehouseId) {
      throw new AppError({
        code: ERROR_CODES.LOCATION_NOT_IN_PUTAWAY_WAREHOUSE,
        message: PUTAWAY_ERROR_MESSAGES.LOCATION_NOT_IN_PUTAWAY_WAREHOUSE,
        statusCode: 409,
        details: { barcode, warehouseId },
      });
    }
    if (location.status !== WarehouseStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.LOCATION_NOT_AVAILABLE,
        message: PUTAWAY_ERROR_MESSAGES.LOCATION_NOT_AVAILABLE,
        statusCode: 409,
      });
    }
    return location;
  }

  private async lockEditable(
    tx: Prisma.TransactionClient,
    companyId: string,
    putawayId: string,
  ): Promise<DetailRow> {
    const locked = await tx.$queryRaw<Array<{ id: string; status: PutawayStatus }>>(Prisma.sql`
      SELECT id, status FROM putaways
      WHERE id = ${putawayId}::uuid AND company_id = ${companyId}::uuid
      FOR UPDATE
    `);
    const row = locked[0];
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.PUTAWAY_NOT_FOUND,
        message: PUTAWAY_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    if (row.status === PutawayStatus.COMPLETED) {
      throw new AppError({
        code: ERROR_CODES.PUTAWAY_ALREADY_COMPLETED,
        message: PUTAWAY_ERROR_MESSAGES.ALREADY_COMPLETED,
        statusCode: 409,
      });
    }
    if (row.status === PutawayStatus.CANCELLED) {
      throw new AppError({
        code: ERROR_CODES.PUTAWAY_NOT_EDITABLE,
        message: PUTAWAY_ERROR_MESSAGES.NOT_EDITABLE,
        statusCode: 409,
      });
    }
    return tx.putaway.findFirstOrThrow({
      where: { id: putawayId, companyId },
      include: detailInclude,
    });
  }

  private async requireDetail(companyId: string, putawayId: string): Promise<DetailRow> {
    const row = await this.database.client.putaway.findFirst({
      where: { id: putawayId, companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.PUTAWAY_NOT_FOUND,
        message: PUTAWAY_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async toDetailView(
    companyId: string,
    row: DetailRow,
    tx?: Prisma.TransactionClient,
  ): Promise<PutawayDetailView> {
    const client = tx ?? this.database.client;
    const pathCache = new Map<string, string[]>();
    const items: PutawayItemView[] = [];
    for (const item of row.items) {
      let path = pathCache.get(item.warehouseLocationId);
      if (!path) {
        path = await this.buildLocationPathTx(client, companyId, item.warehouseLocationId);
        pathCache.set(item.warehouseLocationId, path);
      }
      const alloc = item.goodsReceiptItemBatch;
      items.push({
        id: item.id,
        receiptBatchAllocationId: item.goodsReceiptItemBatchId,
        goodsReceiptItemId: alloc.goodsReceiptItemId,
        skuId: alloc.skuId,
        skuCode: alloc.goodsReceiptItem.sku.code,
        productName:
          alloc.goodsReceiptItem.sku.product.name ?? alloc.goodsReceiptItem.sku.name,
        batchId: alloc.batchId,
        batchNumber: alloc.batch.batchNumber,
        supplierBatchNumber: alloc.batch.supplierBatchNumber,
        expiresAt: alloc.batch.expiresAt
          ? alloc.batch.expiresAt.toISOString().slice(0, 10)
          : null,
        warehouseLocationId: item.warehouseLocationId,
        location: {
          id: item.warehouseLocation.id,
          code: item.warehouseLocation.code,
          name: item.warehouseLocation.name,
          barcode: item.warehouseLocation.barcode,
          type: item.warehouseLocation.type,
          status: item.warehouseLocation.status,
          path,
        },
        quantity: item.quantity,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      });
    }

    const sources = await this.loadSources(client, companyId, row.goodsReceiptId, row.id);

    return {
      id: row.id,
      number: row.number,
      status: row.status,
      warehouseId: row.warehouseId,
      warehouseCode: row.warehouse.code,
      warehouseName: row.warehouse.name,
      goodsReceiptId: row.goodsReceiptId,
      goodsReceiptNumber: row.goodsReceipt.number,
      goodsReceiptStatus: row.goodsReceipt.status,
      version: row.version,
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: toUserRef(row.createdBy),
      completedBy: toUserRef(row.completedBy),
      items,
      sources,
      totals: {
        itemCount: items.length,
        totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
      },
    };
  }

  private async loadSources(
    tx: Prisma.TransactionClient | DatabaseService['client'],
    companyId: string,
    goodsReceiptId: string,
    putawayId: string,
  ): Promise<PutawaySourceLineView[]> {
    const allocations = await tx.goodsReceiptItemBatch.findMany({
      where: {
        companyId,
        goodsReceiptItem: {
          companyId,
          goodsReceiptId,
          goodsReceipt: { companyId, status: GoodsReceiptStatus.POSTED },
        },
      },
      include: {
        batch: {
          select: {
            id: true,
            batchNumber: true,
            supplierBatchNumber: true,
            expiresAt: true,
          },
        },
        goodsReceiptItem: {
          select: {
            id: true,
            sku: {
              select: { code: true, name: true, product: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const completed = await tx.putawayItem.groupBy({
      by: ['goodsReceiptItemBatchId'],
      where: {
        companyId,
        goodsReceiptItemBatchId: { in: allocations.map((a) => a.id) },
        putaway: { companyId, status: PutawayStatus.COMPLETED },
      },
      _sum: { quantity: true },
    });
    const completedMap = new Map(
      completed.map((c) => [c.goodsReceiptItemBatchId, c._sum.quantity ?? 0]),
    );

    const draft = await tx.putawayItem.groupBy({
      by: ['goodsReceiptItemBatchId'],
      where: {
        companyId,
        putawayId,
        goodsReceiptItemBatchId: { in: allocations.map((a) => a.id) },
      },
      _sum: { quantity: true },
    });
    const draftMap = new Map(draft.map((d) => [d.goodsReceiptItemBatchId, d._sum.quantity ?? 0]));

    return allocations.map((a) => {
      const already = completedMap.get(a.id) ?? 0;
      const draftAllocated = draftMap.get(a.id) ?? 0;
      const remainingToPutAway = Math.max(0, a.quantity - already);
      const availableToAllocate = Math.max(0, a.quantity - already - draftAllocated);
      return {
        receiptBatchAllocationId: a.id,
        goodsReceiptItemId: a.goodsReceiptItemId,
        skuId: a.skuId,
        skuCode: a.goodsReceiptItem.sku.code,
        productName:
          a.goodsReceiptItem.sku.product.name ?? a.goodsReceiptItem.sku.name,
        batchId: a.batchId,
        batchNumber: a.batch.batchNumber,
        supplierBatchNumber: a.batch.supplierBatchNumber,
        expiresAt: a.batch.expiresAt ? a.batch.expiresAt.toISOString().slice(0, 10) : null,
        receivedQuantity: a.quantity,
        alreadyPutAway: already,
        draftAllocated,
        availableToAllocate,
        remainingToPutAway,
      };
    });
  }

  private async buildLocationPath(companyId: string, locationId: string): Promise<string[]> {
    return this.buildLocationPathTx(this.database.client, companyId, locationId);
  }

  private async buildLocationPathTx(
    tx: Prisma.TransactionClient | DatabaseService['client'],
    companyId: string,
    locationId: string,
  ): Promise<string[]> {
    const codes: string[] = [];
    let currentId: string | null = locationId;
    let guard = 0;
    while (currentId && guard < 64) {
      const row: { id: string; code: string; parentId: string | null } | null =
        await tx.warehouseLocation.findFirst({
          where: { id: currentId, companyId },
          select: { id: true, code: true, parentId: true },
        });
      if (!row) break;
      codes.unshift(row.code);
      currentId = row.parentId;
      guard += 1;
    }
    return codes;
  }

  private assertPositiveQuantity(quantity: number): void {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new AppError({
        code: ERROR_CODES.PUTAWAY_INVALID_QUANTITY,
        message: PUTAWAY_ERROR_MESSAGES.INVALID_QUANTITY,
        statusCode: 400,
      });
    }
  }

  private requireActorUserId(): string {
    const userId = getRequestContext()?.userId;
    if (!userId) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: 'Authenticated user is required.',
        statusCode: 401,
      });
    }
    return userId;
  }
}

function deriveProgress(received: number, putAway: number): ReceiptPutawayProgress {
  if (putAway <= 0) return 'NOT_PUT_AWAY';
  if (putAway >= received) return 'FULLY_PUT_AWAY';
  return 'PARTIALLY_PUT_AWAY';
}

function toUserRef(
  user: { id: string; firstName: string; lastName: string } | null | undefined,
): { id: string; displayName: string } | null {
  if (!user) return null;
  return {
    id: user.id,
    displayName: `${user.firstName} ${user.lastName}`.trim(),
  };
}

function normalizeSearch(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().slice(0, PUTAWAY_SEARCH_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : undefined;
}
