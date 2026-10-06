import { Injectable } from '@nestjs/common';
import { GoodsReceiptStatus, Prisma } from '@hector/database';
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
import { allocateBatchSequence, formatBatchNumber } from './batch-numbering';
import {
  BATCH_ERROR_MESSAGES,
  BATCH_NOTES_MAX_LENGTH,
  BATCH_SEARCH_MAX_LENGTH,
  BATCH_SUPPLIER_NUMBER_MAX_LENGTH,
} from './batch.constants';
import type {
  CreateBatchDto,
  ListBatchesQueryDto,
  UpdateBatchDto,
} from './dto/batch.dto';
import type {
  BatchDetailView,
  BatchListItemView,
  BatchReceiptHistoryItemView,
} from './types/batch.types';

type BatchWithSku = Prisma.BatchGetPayload<{
  include: {
    sku: { select: { id: true; code: true; name: true; product: { select: { name: true } } } };
  };
}>;

export type CreateBatchInput = {
  skuId: string;
  supplierBatchNumber?: string | null;
  manufacturedAt?: string | null;
  expiresAt?: string | null;
  notes?: string | null;
};

@Injectable()
export class BatchesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    query: ListBatchesQueryDto,
  ): Promise<{ data: BatchListItemView[]; meta: PaginationMeta }> {
    const search = normalizeSearch(query.q);
    const noExpiry = query.noExpiry === 'true' || query.noExpiry === '1';

    const where: Prisma.BatchWhereInput = {
      companyId: company.companyId,
      ...(query.skuId ? { skuId: query.skuId } : {}),
      ...(noExpiry
        ? { expiresAt: null }
        : {
            ...(query.expiresBefore || query.expiresAfter
              ? {
                  expiresAt: {
                    ...(query.expiresAfter ? { gte: dateOnly(query.expiresAfter) } : {}),
                    ...(query.expiresBefore ? { lte: dateOnly(query.expiresBefore) } : {}),
                  },
                }
              : {}),
          }),
      ...(search
        ? {
            OR: [
              { batchNumber: { contains: search, mode: 'insensitive' } },
              { supplierBatchNumber: { contains: search, mode: 'insensitive' } },
              { sku: { code: { contains: search, mode: 'insensitive' } } },
              { sku: { product: { name: { contains: search, mode: 'insensitive' } } } },
              { sku: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.batch.count({ where }),
      this.database.client.batch.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { batchNumber: 'desc' }],
        skip,
        take: query.pageSize,
        include: {
          sku: {
            select: {
              id: true,
              code: true,
              name: true,
              product: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    const aggregates = await this.loadPostedAggregates(
      company.companyId,
      rows.map((r) => r.id),
    );

    return {
      data: rows.map((row) => this.toListItem(row, aggregates.get(row.id))),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, batchId: string): Promise<BatchDetailView> {
    const row = await this.requireBatch(company.companyId, batchId);
    const aggregates = await this.loadPostedAggregates(company.companyId, [row.id]);
    const receipts = await this.loadReceiptHistory(company.companyId, row.id);
    return {
      ...this.toListItem(row, aggregates.get(row.id)),
      notes: row.notes,
      receipts,
    };
  }

  async create(company: CompanyContext, dto: CreateBatchDto): Promise<BatchDetailView> {
    return commitThenPublish(this.eventBus, async (events) => {
      const created = await this.database.client.$transaction(async (tx) => {
        return this.createBatchInTx(tx, company.companyId, dto);
      });

      if (created.created) {
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_BATCH_CREATED,
            payload: {
              companyId: company.companyId,
              batchId: created.id,
              batchNumber: created.batchNumber,
              skuId: created.skuId,
              supplierBatchNumber: created.supplierBatchNumber,
              expiresAt: created.expiresAt?.toISOString().slice(0, 10) ?? null,
            },
          }),
        );
      }

      return this.get(company, created.id);
    });
  }

  async update(
    company: CompanyContext,
    batchId: string,
    dto: UpdateBatchDto,
  ): Promise<BatchDetailView> {
    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const current = await tx.batch.findFirst({
          where: { id: batchId, companyId: company.companyId },
        });
        if (!current) {
          throw new AppError({
            code: ERROR_CODES.BATCH_NOT_FOUND,
            message: BATCH_ERROR_MESSAGES.NOT_FOUND,
            statusCode: 404,
          });
        }

        const supplierBatchNumber =
          dto.supplierBatchNumber !== undefined
            ? normalizeSupplierBatchNumber(dto.supplierBatchNumber)
            : undefined;
        const manufacturedAt =
          dto.manufacturedAt !== undefined
            ? parseOptionalDate(dto.manufacturedAt)
            : undefined;
        const expiresAt =
          dto.expiresAt !== undefined ? parseOptionalDate(dto.expiresAt) : undefined;
        const notes =
          dto.notes !== undefined
            ? normalizeOptionalText(dto.notes, BATCH_NOTES_MAX_LENGTH)
            : undefined;

        const nextManufactured =
          manufacturedAt !== undefined ? manufacturedAt : current.manufacturedAt;
        const nextExpires = expiresAt !== undefined ? expiresAt : current.expiresAt;
        assertBatchDates(nextManufactured, nextExpires);

        try {
          const row = await tx.batch.update({
            where: { id: current.id },
            data: {
              ...(supplierBatchNumber !== undefined ? { supplierBatchNumber } : {}),
              ...(manufacturedAt !== undefined ? { manufacturedAt } : {}),
              ...(expiresAt !== undefined ? { expiresAt } : {}),
              ...(notes !== undefined ? { notes } : {}),
            },
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.BATCH_METADATA_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.BATCH,
            entityId: row.id,
            before: {
              batchNumber: current.batchNumber,
              skuId: current.skuId,
              supplierBatchNumber: current.supplierBatchNumber,
              manufacturedAt: formatDateOnly(current.manufacturedAt),
              expiresAt: formatDateOnly(current.expiresAt),
              notes: current.notes,
            },
            after: {
              batchNumber: row.batchNumber,
              skuId: row.skuId,
              supplierBatchNumber: row.supplierBatchNumber,
              manufacturedAt: formatDateOnly(row.manufacturedAt),
              expiresAt: formatDateOnly(row.expiresAt),
              notes: row.notes,
            },
            metadata: {
              batchId: row.id,
              batchNumber: row.batchNumber,
              skuId: row.skuId,
            },
          });

          return row;
        } catch (error) {
          mapBatchUniqueViolation(error);
          throw error;
        }
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.WAREHOUSE_BATCH_METADATA_UPDATED,
          payload: {
            companyId: company.companyId,
            batchId: updated.id,
            batchNumber: updated.batchNumber,
            skuId: updated.skuId,
            supplierBatchNumber: updated.supplierBatchNumber,
            expiresAt: formatDateOnly(updated.expiresAt),
          },
        }),
      );

      return this.get(company, updated.id);
    });
  }

  /**
   * Create or resolve Batch identity inside an existing transaction.
   * When supplierBatchNumber is non-null, reuses the unique (company, sku, supplier) identity.
   * Creating a Batch does NOT create inventory.
   */
  async createBatchInTx(
    tx: Prisma.TransactionClient,
    companyId: string,
    input: CreateBatchInput,
  ): Promise<{
    id: string;
    batchNumber: string;
    skuId: string;
    supplierBatchNumber: string | null;
    manufacturedAt: Date | null;
    expiresAt: Date | null;
    notes: string | null;
    created: boolean;
  }> {
    await this.assertSkuInCompany(tx, companyId, input.skuId);

    const supplierBatchNumber = normalizeSupplierBatchNumber(input.supplierBatchNumber);
    const manufacturedAt = parseOptionalDate(input.manufacturedAt);
    const expiresAt = parseOptionalDate(input.expiresAt);
    const notes = normalizeOptionalText(input.notes, BATCH_NOTES_MAX_LENGTH);
    assertBatchDates(manufacturedAt, expiresAt);

    if (supplierBatchNumber) {
      const existing = await tx.batch.findFirst({
        where: {
          companyId,
          skuId: input.skuId,
          supplierBatchNumber,
        },
      });
      if (existing) {
        return {
          id: existing.id,
          batchNumber: existing.batchNumber,
          skuId: existing.skuId,
          supplierBatchNumber: existing.supplierBatchNumber,
          manufacturedAt: existing.manufacturedAt,
          expiresAt: existing.expiresAt,
          notes: existing.notes,
          created: false,
        };
      }
    }

    const sequence = await allocateBatchSequence(tx, companyId);
    const batchNumber = formatBatchNumber(sequence);

    try {
      const row = await tx.batch.create({
        data: {
          companyId,
          skuId: input.skuId,
          batchNumber,
          supplierBatchNumber,
          manufacturedAt,
          expiresAt,
          notes,
        },
      });

      await this.auditService.record(tx, {
        action: AUDIT_ACTIONS.BATCH_CREATED,
        entityType: AUDIT_ENTITY_TYPES.BATCH,
        entityId: row.id,
        before: null,
        after: {
          batchNumber: row.batchNumber,
          skuId: row.skuId,
          supplierBatchNumber: row.supplierBatchNumber,
          manufacturedAt: formatDateOnly(row.manufacturedAt),
          expiresAt: formatDateOnly(row.expiresAt),
          notes: row.notes,
        },
        metadata: {
          batchId: row.id,
          batchNumber: row.batchNumber,
          skuId: row.skuId,
          supplierBatchNumber: row.supplierBatchNumber,
          expiresAt: formatDateOnly(row.expiresAt),
        },
      });

      return {
        id: row.id,
        batchNumber: row.batchNumber,
        skuId: row.skuId,
        supplierBatchNumber: row.supplierBatchNumber,
        manufacturedAt: row.manufacturedAt,
        expiresAt: row.expiresAt,
        notes: row.notes,
        created: true,
      };
    } catch (error) {
      if (
        supplierBatchNumber &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await tx.batch.findFirst({
          where: { companyId, skuId: input.skuId, supplierBatchNumber },
        });
        if (raced) {
          return {
            id: raced.id,
            batchNumber: raced.batchNumber,
            skuId: raced.skuId,
            supplierBatchNumber: raced.supplierBatchNumber,
            manufacturedAt: raced.manufacturedAt,
            expiresAt: raced.expiresAt,
            notes: raced.notes,
            created: false,
          };
        }
      }
      mapBatchUniqueViolation(error);
      throw error;
    }
  }

  async requireBatchInCompany(
    tx: Prisma.TransactionClient | DatabaseService['client'],
    companyId: string,
    batchId: string,
  ) {
    const batch = await tx.batch.findFirst({
      where: { id: batchId, companyId },
    });
    if (!batch) {
      throw new AppError({
        code: ERROR_CODES.BATCH_NOT_FOUND,
        message: BATCH_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return batch;
  }

  private async requireBatch(companyId: string, batchId: string): Promise<BatchWithSku> {
    const row = await this.database.client.batch.findFirst({
      where: { id: batchId, companyId },
      include: {
        sku: {
          select: {
            id: true,
            code: true,
            name: true,
            product: { select: { name: true } },
          },
        },
      },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.BATCH_NOT_FOUND,
        message: BATCH_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async assertSkuInCompany(
    tx: Prisma.TransactionClient,
    companyId: string,
    skuId: string,
  ): Promise<void> {
    const sku = await tx.sku.findFirst({
      where: { id: skuId, companyId },
      select: { id: true },
    });
    if (!sku) {
      throw new AppError({
        code: ERROR_CODES.SKU_NOT_FOUND,
        message: BATCH_ERROR_MESSAGES.SKU_NOT_FOUND,
        statusCode: 404,
        details: { skuId },
      });
    }
  }

  private async loadPostedAggregates(
    companyId: string,
    batchIds: string[],
  ): Promise<
    Map<
      string,
      { totalReceived: number; firstReceivedAt: Date | null; lastReceivedAt: Date | null }
    >
  > {
    const map = new Map<
      string,
      { totalReceived: number; firstReceivedAt: Date | null; lastReceivedAt: Date | null }
    >();
    for (const id of batchIds) {
      map.set(id, { totalReceived: 0, firstReceivedAt: null, lastReceivedAt: null });
    }
    if (batchIds.length === 0) return map;

    const rows = await this.database.client.$queryRaw<
      Array<{
        batch_id: string;
        total_received: number;
        first_received_at: Date | null;
        last_received_at: Date | null;
      }>
    >(Prisma.sql`
      SELECT
        a.batch_id,
        COALESCE(SUM(a.quantity), 0)::int AS total_received,
        MIN(COALESCE(g.received_at, g.posted_at)) AS first_received_at,
        MAX(COALESCE(g.received_at, g.posted_at)) AS last_received_at
      FROM goods_receipt_item_batches a
      INNER JOIN goods_receipt_items i
        ON i.id = a.goods_receipt_item_id AND i.company_id = a.company_id
      INNER JOIN goods_receipts g
        ON g.id = i.goods_receipt_id AND g.company_id = a.company_id
      WHERE a.company_id = ${companyId}::uuid
        AND a.batch_id IN (${Prisma.join(batchIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND g.status = ${GoodsReceiptStatus.POSTED}::"goods_receipt_status"
      GROUP BY a.batch_id
    `);

    for (const row of rows) {
      map.set(row.batch_id, {
        totalReceived: row.total_received,
        firstReceivedAt: row.first_received_at,
        lastReceivedAt: row.last_received_at,
      });
    }
    return map;
  }

  private async loadReceiptHistory(
    companyId: string,
    batchId: string,
  ): Promise<BatchReceiptHistoryItemView[]> {
    const rows = await this.database.client.goodsReceiptItemBatch.findMany({
      where: {
        companyId,
        batchId,
        goodsReceiptItem: {
          goodsReceipt: {
            companyId,
            status: GoodsReceiptStatus.POSTED,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        goodsReceiptItem: {
          include: {
            goodsReceipt: {
              select: {
                id: true,
                number: true,
                status: true,
                receivedAt: true,
                postedAt: true,
                purchaseOrderId: true,
                purchaseOrder: { select: { number: true } },
                supplierId: true,
                supplier: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    return rows.map((row) => {
      const grn = row.goodsReceiptItem.goodsReceipt;
      return {
        goodsReceiptId: grn.id,
        goodsReceiptNumber: grn.number,
        goodsReceiptStatus: grn.status,
        goodsReceiptItemId: row.goodsReceiptItemId,
        quantity: row.quantity,
        receivedAt: grn.receivedAt?.toISOString() ?? null,
        postedAt: grn.postedAt?.toISOString() ?? null,
        purchaseOrderId: grn.purchaseOrderId,
        purchaseOrderNumber: grn.purchaseOrder.number,
        supplierId: grn.supplierId,
        supplierName: grn.supplier.name,
      };
    });
  }

  private toListItem(
    row: BatchWithSku,
    aggregate:
      | { totalReceived: number; firstReceivedAt: Date | null; lastReceivedAt: Date | null }
      | undefined,
  ): BatchListItemView {
    const expiresAt = formatDateOnly(row.expiresAt);
    return {
      id: row.id,
      batchNumber: row.batchNumber,
      supplierBatchNumber: row.supplierBatchNumber,
      skuId: row.skuId,
      skuCode: row.sku.code,
      productName: row.sku.product.name ?? row.sku.name,
      manufacturedAt: formatDateOnly(row.manufacturedAt),
      expiresAt,
      expiryState: deriveExpiryState(row.expiresAt),
      totalReceived: aggregate?.totalReceived ?? 0,
      firstReceivedAt: aggregate?.firstReceivedAt?.toISOString() ?? null,
      lastReceivedAt: aggregate?.lastReceivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export function normalizeSupplierBatchNumber(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > BATCH_SUPPLIER_NUMBER_MAX_LENGTH) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: BATCH_ERROR_MESSAGES.INVALID_SUPPLIER_BATCH,
      statusCode: 400,
    });
  }
  return trimmed;
}

export function assertBatchDates(
  manufacturedAt: Date | null,
  expiresAt: Date | null,
): void {
  if (manufacturedAt && expiresAt && expiresAt < manufacturedAt) {
    throw new AppError({
      code: ERROR_CODES.BATCH_INVALID_DATES,
      message: BATCH_ERROR_MESSAGES.INVALID_DATES,
      statusCode: 400,
    });
  }
}

function parseOptionalDate(value: string | null | undefined): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const date = dateOnly(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Invalid date.',
      statusCode: 400,
    });
  }
  return date;
}

function dateOnly(value: string): Date {
  // Persist as DATE — use UTC noon-safe date-only parse of YYYY-MM-DD.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Date must be YYYY-MM-DD.',
      statusCode: 400,
    });
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatDateOnly(value: Date | null): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

function deriveExpiryState(expiresAt: Date | null): 'NO_EXPIRY' | 'VALID' | 'EXPIRED' {
  if (!expiresAt) return 'NO_EXPIRY';
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const expUtc = Date.UTC(
    expiresAt.getUTCFullYear(),
    expiresAt.getUTCMonth(),
    expiresAt.getUTCDate(),
  );
  return expUtc < todayUtc ? 'EXPIRED' : 'VALID';
}

function normalizeSearch(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().slice(0, BATCH_SEARCH_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalText(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: BATCH_ERROR_MESSAGES.INVALID_NOTES,
      statusCode: 400,
    });
  }
  return trimmed;
}

function mapBatchUniqueViolation(error: unknown): never | void {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return;
  }
  const target = String(error.meta?.target ?? '');
  if (target.includes('batch_number')) {
    throw new AppError({
      code: ERROR_CODES.BATCH_NUMBER_CONFLICT,
      message: BATCH_ERROR_MESSAGES.NUMBER_CONFLICT,
      statusCode: 409,
    });
  }
  if (target.includes('supplier_batch')) {
    throw new AppError({
      code: ERROR_CODES.BATCH_SUPPLIER_NUMBER_CONFLICT,
      message: BATCH_ERROR_MESSAGES.SUPPLIER_NUMBER_CONFLICT,
      statusCode: 409,
    });
  }
  throw new AppError({
    code: ERROR_CODES.BATCH_NUMBER_CONFLICT,
    message: BATCH_ERROR_MESSAGES.NUMBER_CONFLICT,
    statusCode: 409,
  });
}
