import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  GoodsReceiptStatus,
  Prisma,
  PurchaseCommercialType,
  SupplierCreditStatus,
  SupplierLiabilityMovementDirection,
  SupplierLiabilityMovementType,
  SupplierPayablePurchaseType,
  SupplierPayableStatus,
  SupplierPaymentAllocationStatus,
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
import { assertOptionalText, normalizeSearchQuery } from './finance-accounts.normalization';
import {
  SUPPLIER_PAYABLE_ERROR_MESSAGES,
  SUPPLIER_PAYABLE_LIABILITY_SOURCE_TYPES,
  SUPPLIER_PAYABLE_NOTES_MAX_LENGTH,
  SUPPLIER_PAYABLE_REFERENCE_MAX_LENGTH,
} from './finance-supplier-payables.constants';
import { parseMoneyAmount } from './money/money';
import {
  allocateSupplierCreditSequence,
  allocateSupplierPayableSequence,
  formatSupplierCreditNumber,
  formatSupplierPayableNumber,
} from './supplier-payable-numbering';
import {
  derivePayableStatus,
  derivePayableTotals,
  PAYABLE_AGING_BUCKETS,
  type PayableAgingBucket,
} from './supplier-payable-outstanding';
import type {
  AllocateSupplierPaymentDto,
  CreateOpeningSupplierPayableDto,
  ListSupplierPayablesQueryDto,
} from './dto/supplier-payable.dto';
import type {
  SupplierLiabilityMovementView,
  SupplierPayableAgingRow,
  SupplierPayableLineView,
  SupplierPayableSummaryCurrencyRow,
  SupplierPayableView,
  SupplierStatementEntryView,
} from './types/finance-supplier-payable.types';
import {
  attachDerivedPayableFields,
  moneyString,
} from './types/finance-supplier-payable.types';

type Tx = Prisma.TransactionClient;

const supplierSelect = { id: true, name: true, code: true } as const;
const poSelect = { id: true, number: true } as const;

const payableInclude = {
  supplier: { select: supplierSelect },
  purchaseOrder: { select: poSelect },
  lines: { orderBy: { recognizedAt: 'asc' as const } },
  movements: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.SupplierPayableInclude;

type PayableDetail = Prisma.SupplierPayableGetPayload<{ include: typeof payableInclude }>;

@Injectable()
export class SupplierPayablesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    query: ListSupplierPayablesQueryDto,
  ): Promise<{ data: SupplierPayableView[]; meta: PaginationMeta }> {
    const search = normalizeSearchQuery(query.q);
    const where: Prisma.SupplierPayableWhereInput = {
      companyId: company.companyId,
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
      ...(query.purchaseOrderId ? { purchaseOrderId: query.purchaseOrderId } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { notes: { contains: search, mode: 'insensitive' } },
              { reference: { contains: search, mode: 'insensitive' } },
              { supplier: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.supplierPayable.count({ where }),
      this.database.client.supplierPayable.findMany({
        where,
        include: {
          supplier: { select: supplierSelect },
          purchaseOrder: { select: poSelect },
          movements: { select: { direction: true, amount: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      data: rows.map((row) => this.toListView(row)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, payableId: string): Promise<SupplierPayableView> {
    const row = await this.database.client.supplierPayable.findFirst({
      where: { id: payableId, companyId: company.companyId },
      include: payableInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_PAYABLE_NOT_FOUND,
        message: SUPPLIER_PAYABLE_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return this.toDetailView(row);
  }

  async listForSupplier(
    company: CompanyContext,
    supplierId: string,
    query: ListSupplierPayablesQueryDto,
  ): Promise<{ data: SupplierPayableView[]; meta: PaginationMeta }> {
    return this.list(company, { ...query, supplierId });
  }

  async summary(
    company: CompanyContext,
  ): Promise<{ data: { byCurrency: SupplierPayableSummaryCurrencyRow[] } }> {
    const payables = await this.database.client.supplierPayable.findMany({
      where: {
        companyId: company.companyId,
        status: { not: SupplierPayableStatus.CANCELLED },
      },
      include: { movements: { select: { direction: true, amount: true } } },
    });
    const credits = await this.database.client.supplierCredit.findMany({
      where: {
        companyId: company.companyId,
        status: SupplierCreditStatus.OPEN,
      },
      select: { currency: true, originalAmount: true },
    });

    const byCurrency = new Map<
      string,
      { payableCount: number; outstanding: Prisma.Decimal; overdue: Prisma.Decimal; credits: Prisma.Decimal }
    >();

    for (const row of payables) {
      const totals = this.totalsFromMovements(row.movements);
      const derived = attachDerivedPayableFields({
        dueDate: row.dueDate,
        status: row.status,
        recognized: totals.recognized,
        outstanding: totals.outstanding,
      });
      const bucket = byCurrency.get(row.currency) ?? {
        payableCount: 0,
        outstanding: new Prisma.Decimal(0),
        overdue: new Prisma.Decimal(0),
        credits: new Prisma.Decimal(0),
      };
      if (totals.outstanding.gt(0)) {
        bucket.payableCount += 1;
        bucket.outstanding = bucket.outstanding.plus(totals.outstanding);
        if (derived.overdue) {
          bucket.overdue = bucket.overdue.plus(totals.outstanding);
        }
      }
      byCurrency.set(row.currency, bucket);
    }

    for (const credit of credits) {
      const bucket = byCurrency.get(credit.currency) ?? {
        payableCount: 0,
        outstanding: new Prisma.Decimal(0),
        overdue: new Prisma.Decimal(0),
        credits: new Prisma.Decimal(0),
      };
      bucket.credits = bucket.credits.plus(credit.originalAmount);
      byCurrency.set(credit.currency, bucket);
    }

    return {
      data: {
        byCurrency: [...byCurrency.entries()].map(([currency, row]) => ({
          currency,
          payableCount: row.payableCount,
          outstandingTotal: moneyString(row.outstanding),
          overdueTotal: moneyString(row.overdue),
          openCreditTotal: moneyString(row.credits),
        })),
      },
    };
  }

  async aging(
    company: CompanyContext,
  ): Promise<{ data: { rows: SupplierPayableAgingRow[] } }> {
    const payables = await this.database.client.supplierPayable.findMany({
      where: {
        companyId: company.companyId,
        status: { not: SupplierPayableStatus.CANCELLED },
      },
      include: { movements: { select: { direction: true, amount: true } } },
    });

    const map = new Map<string, { count: number; outstanding: Prisma.Decimal }>();
    for (const row of payables) {
      const totals = this.totalsFromMovements(row.movements);
      if (totals.outstanding.lte(0)) continue;
      const derived = attachDerivedPayableFields({
        dueDate: row.dueDate,
        status: row.status,
        recognized: totals.recognized,
        outstanding: totals.outstanding,
      });
      const key = `${row.currency}|${derived.agingBucket}`;
      const current = map.get(key) ?? { count: 0, outstanding: new Prisma.Decimal(0) };
      current.count += 1;
      current.outstanding = current.outstanding.plus(totals.outstanding);
      map.set(key, current);
    }

    const rows: SupplierPayableAgingRow[] = [];
    for (const [key, value] of map) {
      const [currency, bucket] = key.split('|') as [string, PayableAgingBucket];
      rows.push({
        currency,
        bucket,
        payableCount: value.count,
        outstandingTotal: moneyString(value.outstanding),
      });
    }
    rows.sort((a, b) => {
      if (a.currency !== b.currency) return a.currency.localeCompare(b.currency);
      return (
        PAYABLE_AGING_BUCKETS.indexOf(a.bucket) - PAYABLE_AGING_BUCKETS.indexOf(b.bucket)
      );
    });
    return { data: { rows } };
  }

  async supplierStatement(
    company: CompanyContext,
    supplierId: string,
  ): Promise<{ data: { supplierId: string; entries: SupplierStatementEntryView[] } }> {
    await this.requireSupplier(company.companyId, supplierId);

    const [movements, credits] = await Promise.all([
      this.database.client.supplierLiabilityMovement.findMany({
        where: { companyId: company.companyId, supplierId },
        include: { payable: { select: { id: true, number: true } } },
        orderBy: [{ effectiveAt: 'asc' }, { createdAt: 'asc' }],
      }),
      this.database.client.supplierCredit.findMany({
        where: { companyId: company.companyId, supplierId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const entries: SupplierStatementEntryView[] = [];
    for (const movement of movements) {
      entries.push({
        effectiveAt: movement.effectiveAt.toISOString(),
        kind:
          movement.direction === SupplierLiabilityMovementDirection.INCREASE
            ? 'PAYABLE_INCREASE'
            : 'PAYABLE_DECREASE',
        payableId: movement.payableId,
        payableNumber: movement.payable?.number ?? null,
        creditId: movement.supplierCreditId,
        creditNumber: null,
        type: movement.type,
        direction: movement.direction,
        amount: moneyString(movement.amount),
        currency: movement.currency,
        notes: movement.notes,
      });
    }
    for (const credit of credits) {
      entries.push({
        effectiveAt: credit.createdAt.toISOString(),
        kind: 'CREDIT',
        payableId: credit.payableId,
        payableNumber: null,
        creditId: credit.id,
        creditNumber: credit.number,
        type: 'SUPPLIER_CREDIT',
        direction: null,
        amount: moneyString(credit.originalAmount),
        currency: credit.currency,
        notes: credit.notes,
      });
    }
    entries.sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
    return { data: { supplierId, entries } };
  }

  async createOpening(
    company: CompanyContext,
    dto: CreateOpeningSupplierPayableDto,
    actorUserId: string,
  ): Promise<SupplierPayableView> {
    const notes = assertOptionalText(
      dto.notes,
      SUPPLIER_PAYABLE_NOTES_MAX_LENGTH,
      'Notes exceed maximum length.',
    );
    const reference = assertOptionalText(
      dto.reference,
      SUPPLIER_PAYABLE_REFERENCE_MAX_LENGTH,
      'Reference exceeds maximum length.',
    );
    let amount: Prisma.Decimal;
    try {
      amount = parseMoneyAmount(dto.amount, dto.currency);
    } catch {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_PAYABLE_AMOUNT_INVALID,
        message: SUPPLIER_PAYABLE_ERROR_MESSAGES.AMOUNT_INVALID,
        statusCode: 400,
      });
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const payableId = await this.database.client.$transaction(async (tx) => {
        if (dto.requestId) {
          const existing = await tx.supplierPayable.findFirst({
            where: { companyId: company.companyId, requestId: dto.requestId },
            include: payableInclude,
          });
          if (existing) return existing.id;
        }

        await this.requireSupplier(company.companyId, dto.supplierId, tx);
        const effectiveAt = dto.effectiveAt ? new Date(dto.effectiveAt) : new Date();
        const seq = await allocateSupplierPayableSequence(tx, company.companyId);
        const number = formatSupplierPayableNumber(seq);

        const payable = await tx.supplierPayable.create({
          data: {
            companyId: company.companyId,
            number,
            supplierId: dto.supplierId,
            purchaseOrderId: null,
            purchaseType: SupplierPayablePurchaseType.OPENING,
            currency: dto.currency,
            dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
            status: SupplierPayableStatus.OPEN,
            recognizedAt: effectiveAt,
            notes,
            reference,
            requestId: dto.requestId ?? null,
          },
        });

        await tx.supplierLiabilityMovement.create({
          data: {
            companyId: company.companyId,
            payableId: payable.id,
            supplierId: dto.supplierId,
            direction: SupplierLiabilityMovementDirection.INCREASE,
            type: SupplierLiabilityMovementType.OPENING_BALANCE,
            amount,
            currency: dto.currency,
            sourceType: SUPPLIER_PAYABLE_LIABILITY_SOURCE_TYPES.OPENING_BALANCE,
            sourceId: payable.id,
            effectiveAt,
            notes: notes ?? 'Opening supplier payable',
            requestId: dto.requestId ?? null,
            createdById: actorUserId,
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SUPPLIER_PAYABLE_OPENING_RECORDED,
          entityType: AUDIT_ENTITY_TYPES.SUPPLIER_PAYABLE,
          entityId: payable.id,
          after: {
            number: payable.number,
            supplierId: payable.supplierId,
            amount: moneyString(amount),
            currency: payable.currency,
            purchaseType: payable.purchaseType,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.SUPPLIER_PAYABLE_OPENING_RECORDED,
            payload: {
              companyId: company.companyId,
              payableId: payable.id,
              supplierId: payable.supplierId,
              amount: moneyString(amount),
              currency: payable.currency,
            },
          }),
        );

        return payable.id;
      });

      return this.get(company, payableId);
    });
  }

  /**
   * Foundation for Phase 4.6 — reduces liability only. No AccountMovement / cash.
   */
  async allocateSupplierPayment(
    company: CompanyContext,
    payableId: string,
    dto: AllocateSupplierPaymentDto,
    actorUserId: string,
  ): Promise<{
    allocationId: string;
    payable: SupplierPayableView;
  }> {
    return commitThenPublish(this.eventBus, async (events) => {
      const result = await this.database.client.$transaction(async (tx) => {
        if (dto.requestId) {
          const existing = await tx.supplierPaymentAllocation.findFirst({
            where: { companyId: company.companyId, requestId: dto.requestId },
          });
          if (existing) {
            return { allocationId: existing.id, payableId: existing.payableId };
          }
        }

        const allocation = await this.allocateSupplierPaymentInTx(tx, {
          companyId: company.companyId,
          payableId,
          amount: dto.amount,
          currency: dto.currency,
          paymentSourceType: dto.paymentSourceType ?? null,
          paymentSourceId: dto.paymentSourceId ?? null,
          requestId: dto.requestId ?? null,
          effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : new Date(),
          actorUserId,
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.SUPPLIER_PAYABLE_ALLOCATION_POSTED,
            payload: {
              companyId: company.companyId,
              payableId,
              allocationId: allocation.id,
              amount: moneyString(allocation.amount),
              currency: allocation.currency,
            },
          }),
        );
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.SUPPLIER_PAYABLE_ADJUSTED,
            payload: {
              companyId: company.companyId,
              payableId,
              reason: 'PAYMENT_ALLOCATION',
            },
          }),
        );

        return { allocationId: allocation.id, payableId };
      });

      const payable = await this.get(company, result.payableId);
      return { allocationId: result.allocationId, payable };
    });
  }

  /**
   * TX helper for tests + Phase 4.6 cash engine.
   * Locks payable FOR UPDATE; rejects over-allocation.
   */
  async allocateSupplierPaymentInTx(
    tx: Tx,
    input: {
      companyId: string;
      payableId: string;
      amount: string;
      currency: CurrencyCode;
      paymentSourceType?: string | null;
      paymentSourceId?: string | null;
      requestId?: string | null;
      effectiveAt: Date;
      actorUserId: string;
    },
  ): Promise<{ id: string; amount: Prisma.Decimal; currency: CurrencyCode }> {
    await this.lockPayable(tx, input.companyId, input.payableId);

    const payable = await tx.supplierPayable.findFirstOrThrow({
      where: { id: input.payableId, companyId: input.companyId },
      include: { movements: { select: { direction: true, amount: true } } },
    });

    if (payable.status === SupplierPayableStatus.CANCELLED) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_PAYABLE_CANCELLED,
        message: SUPPLIER_PAYABLE_ERROR_MESSAGES.CANCELLED,
        statusCode: 409,
      });
    }
    if (payable.currency !== input.currency) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_PAYABLE_CURRENCY_MISMATCH,
        message: SUPPLIER_PAYABLE_ERROR_MESSAGES.CURRENCY_MISMATCH,
        statusCode: 409,
      });
    }

    let amount: Prisma.Decimal;
    try {
      amount = parseMoneyAmount(input.amount, input.currency);
    } catch {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_PAYABLE_AMOUNT_INVALID,
        message: SUPPLIER_PAYABLE_ERROR_MESSAGES.AMOUNT_INVALID,
        statusCode: 400,
      });
    }

    const totals = this.totalsFromMovements(payable.movements);
    if (amount.gt(totals.outstanding)) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_PAYABLE_OVER_ALLOCATE,
        message: SUPPLIER_PAYABLE_ERROR_MESSAGES.OVER_ALLOCATE,
        statusCode: 409,
      });
    }

    const allocation = await tx.supplierPaymentAllocation.create({
      data: {
        companyId: input.companyId,
        payableId: input.payableId,
        amount,
        currency: input.currency,
        paymentSourceType: input.paymentSourceType ?? null,
        paymentSourceId: input.paymentSourceId ?? null,
        requestId: input.requestId ?? null,
        status: SupplierPaymentAllocationStatus.POSTED,
        effectiveAt: input.effectiveAt,
        createdById: input.actorUserId,
      },
    });

    await tx.supplierLiabilityMovement.create({
      data: {
        companyId: input.companyId,
        payableId: input.payableId,
        supplierId: payable.supplierId,
        direction: SupplierLiabilityMovementDirection.DECREASE,
        type: SupplierLiabilityMovementType.PAYMENT_ALLOCATION,
        amount,
        currency: input.currency,
        sourceType: SUPPLIER_PAYABLE_LIABILITY_SOURCE_TYPES.SUPPLIER_PAYMENT_ALLOCATION,
        sourceId: allocation.id,
        effectiveAt: input.effectiveAt,
        requestId: input.requestId ?? null,
        createdById: input.actorUserId,
      },
    });

    const nextOutstanding = totals.outstanding.minus(amount);
    const nextStatus = derivePayableStatus({
      recognized: totals.recognized,
      outstanding: nextOutstanding,
      currentStatus: payable.status,
    });
    await tx.supplierPayable.update({
      where: { id: payable.id },
      data: { status: nextStatus },
    });

    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.SUPPLIER_PAYABLE_ALLOCATION_POSTED,
      entityType: AUDIT_ENTITY_TYPES.SUPPLIER_PAYABLE,
      entityId: payable.id,
      after: {
        allocationId: allocation.id,
        amount: moneyString(amount),
        currency: input.currency,
        outstandingAfter: moneyString(nextOutstanding),
        status: nextStatus,
      },
      context: {
        companyId: input.companyId,
        actorUserId: input.actorUserId,
      },
    });

    return { id: allocation.id, amount, currency: input.currency };
  }

  /**
   * Recognize supplier liability from a POSTED goods receipt (same TX as GRN post).
   * Idempotent per goodsReceiptItemId. Does NOT move cash.
   */
  async recognizeFromPostedGoodsReceiptInTx(
    tx: Tx,
    companyId: string,
    goodsReceiptId: string,
    actorUserId: string,
  ): Promise<{ payableIds: string[]; createdLineCount: number }> {
    const grn = await tx.goodsReceipt.findFirst({
      where: { id: goodsReceiptId, companyId },
      include: {
        items: { orderBy: { id: 'asc' } },
      },
    });
    if (!grn || grn.status !== GoodsReceiptStatus.POSTED) {
      return { payableIds: [], createdLineCount: 0 };
    }

    const po = await tx.purchaseOrder.findFirstOrThrow({
      where: { id: grn.purchaseOrderId, companyId },
      select: {
        id: true,
        supplierId: true,
        currency: true,
        purchaseType: true,
        dueDate: true,
        obligationAmount: true,
        obligationCurrency: true,
        referenceFxRate: true,
        referenceFxBaseCurrency: true,
        referenceFxQuoteCurrency: true,
        items: {
          select: { id: true, skuId: true, unitPrice: true },
        },
      },
    });

    if (!po.purchaseType) {
      return { payableIds: [], createdLineCount: 0 };
    }

    const purchaseType = this.mapPurchaseType(po.purchaseType);
    const currency = this.obligationCurrency(po);
    const poItemsById = new Map(po.items.map((item) => [item.id, item]));
    const recognizedAt = grn.postedAt ?? new Date();
    const payableIds = new Set<string>();
    let createdLineCount = 0;

    for (const item of grn.items) {
      const existingLine = await tx.supplierPayableLine.findFirst({
        where: { companyId, goodsReceiptItemId: item.id },
      });
      if (existingLine) {
        payableIds.add(existingLine.payableId);
        continue;
      }

      const poItem = poItemsById.get(item.purchaseOrderItemId);
      if (!poItem) continue;

      const unitPrice = poItem.unitPrice;
      const lineAmount = unitPrice.mul(item.quantity);
      if (lineAmount.lte(0)) continue;

      const payable = await this.findOrCreatePayableForPoInTx(tx, {
        companyId,
        supplierId: po.supplierId,
        purchaseOrderId: po.id,
        purchaseType,
        currency,
        dueDate: po.dueDate,
        referenceFxRate: po.referenceFxRate,
        referenceFxBaseCurrency: po.referenceFxBaseCurrency,
        referenceFxQuoteCurrency: po.referenceFxQuoteCurrency,
        recognizedAt,
      });
      payableIds.add(payable.id);

      await tx.supplierPayableLine.create({
        data: {
          companyId,
          payableId: payable.id,
          goodsReceiptId: grn.id,
          goodsReceiptItemId: item.id,
          purchaseOrderItemId: item.purchaseOrderItemId,
          skuId: item.skuId,
          quantity: item.quantity,
          unitPrice,
          lineAmount,
          currency,
          recognizedAt,
        },
      });

      try {
        await tx.supplierLiabilityMovement.create({
          data: {
            companyId,
            payableId: payable.id,
            supplierId: po.supplierId,
            direction: SupplierLiabilityMovementDirection.INCREASE,
            type: SupplierLiabilityMovementType.PURCHASE_RECOGNITION,
            amount: lineAmount,
            currency,
            sourceType: SUPPLIER_PAYABLE_LIABILITY_SOURCE_TYPES.GOODS_RECEIPT_ITEM,
            sourceId: item.id,
            effectiveAt: recognizedAt,
            notes: `GRN ${grn.number} recognition`,
            createdById: actorUserId,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          // Concurrent duplicate recognition — treat as idempotent.
          continue;
        }
        throw error;
      }

      await this.refreshPayableStatusInTx(tx, companyId, payable.id);
      createdLineCount += 1;

      await this.auditService.record(tx, {
        action: AUDIT_ACTIONS.SUPPLIER_PAYABLE_RECOGNIZED,
        entityType: AUDIT_ENTITY_TYPES.SUPPLIER_PAYABLE,
        entityId: payable.id,
        after: {
          goodsReceiptId: grn.id,
          goodsReceiptItemId: item.id,
          lineAmount: moneyString(lineAmount),
          currency,
          quantity: item.quantity,
        },
        context: {
          companyId,
          actorUserId,
        },
      });
    }

    return { payableIds: [...payableIds], createdLineCount };
  }

  /**
   * Reduce payables after SRE dispatch (same TX). FIFO by dueDate then recognizedAt.
   * Excess after outstanding → SupplierCredit. No cash movement.
   */
  async reduceFromSupplierReturnInTx(
    tx: Tx,
    companyId: string,
    executionId: string,
    actorUserId: string,
  ): Promise<{ reducedTotal: string; creditId: string | null }> {
    const existingCredit = await tx.supplierCredit.findFirst({
      where: {
        companyId,
        sourceType: SUPPLIER_PAYABLE_LIABILITY_SOURCE_TYPES.SUPPLIER_RETURN_EXECUTION,
        sourceId: executionId,
      },
    });
    const existingMovements = await tx.supplierLiabilityMovement.findMany({
      where: {
        companyId,
        type: SupplierLiabilityMovementType.SUPPLIER_RETURN,
        notes: { contains: executionId },
      },
    });
    if (existingMovements.length > 0 || existingCredit) {
      const reduced = existingMovements.reduce(
        (sum, row) => sum.plus(row.amount),
        new Prisma.Decimal(0),
      );
      return {
        reducedTotal: moneyString(reduced),
        creditId: existingCredit?.id ?? null,
      };
    }

    const execution = await tx.supplierReturnExecution.findFirstOrThrow({
      where: { id: executionId, companyId },
      include: { items: true },
    });
    const purchaseReturn = await tx.purchaseReturn.findFirstOrThrow({
      where: { id: execution.purchaseReturnId, companyId },
      include: {
        items: {
          include: {
            purchaseOrderItem: { select: { id: true, unitPrice: true, purchaseOrderId: true } },
          },
        },
      },
    });

    const returnItemsById = new Map(purchaseReturn.items.map((item) => [item.id, item]));
    let returnAmount = new Prisma.Decimal(0);
    let currency: CurrencyCode | null = null;
    const relatedPoIds = new Set<string>();

    for (const item of execution.items) {
      const returnItem = returnItemsById.get(item.purchaseReturnItemId);
      if (!returnItem?.purchaseOrderItem) continue;
      const unitPrice = returnItem.purchaseOrderItem.unitPrice;
      returnAmount = returnAmount.plus(unitPrice.mul(item.quantity));
      relatedPoIds.add(returnItem.purchaseOrderItem.purchaseOrderId);
    }

    if (returnAmount.lte(0)) {
      return { reducedTotal: '0', creditId: null };
    }

    // Prefer related PO payables (FIN-AP-007). Excess / no related outstanding → SupplierCredit.
    // Do not silently absorb returns into unrelated opening/other-PO payables.
    const relatedPayables =
      relatedPoIds.size > 0
        ? await tx.supplierPayable.findMany({
            where: {
              companyId,
              supplierId: purchaseReturn.supplierId,
              purchaseOrderId: { in: [...relatedPoIds] },
              status: { not: SupplierPayableStatus.CANCELLED },
            },
            include: { movements: { select: { direction: true, amount: true } } },
            orderBy: [{ dueDate: 'asc' }, { recognizedAt: 'asc' }, { createdAt: 'asc' }],
          })
        : await tx.supplierPayable.findMany({
            where: {
              companyId,
              supplierId: purchaseReturn.supplierId,
              status: { not: SupplierPayableStatus.CANCELLED },
            },
            include: { movements: { select: { direction: true, amount: true } } },
            orderBy: [{ dueDate: 'asc' }, { recognizedAt: 'asc' }, { createdAt: 'asc' }],
          });

    if (relatedPayables.length === 0) {
      // No related open payables — entire return becomes credit.
      const anyPayable = await tx.supplierPayable.findFirst({
        where: { companyId, supplierId: purchaseReturn.supplierId },
        orderBy: { createdAt: 'asc' },
      });
      const creditCurrency: CurrencyCode = anyPayable?.currency ?? CurrencyCode.IRR;
      currency = creditCurrency;
      const credit = await this.createSupplierCreditInTx(tx, {
        companyId,
        supplierId: purchaseReturn.supplierId,
        currency: creditCurrency,
        amount: returnAmount,
        sourceType: SUPPLIER_PAYABLE_LIABILITY_SOURCE_TYPES.SUPPLIER_RETURN_EXECUTION,
        sourceId: executionId,
        payableId: null,
        notes: `Excess return credit from SRE ${execution.number}`,
        actorUserId,
        effectiveAt: execution.dispatchedAt ?? new Date(),
      });
      return { reducedTotal: '0', creditId: credit.id };
    }

    // Process by currency; prefer the currency of the first related payable.
    const byCurrency = new Map<CurrencyCode, typeof relatedPayables>();
    for (const payable of relatedPayables) {
      const list = byCurrency.get(payable.currency) ?? [];
      list.push(payable);
      byCurrency.set(payable.currency, list);
    }

    currency = [...byCurrency.keys()][0]!;
    let remaining = returnAmount;
    let reducedTotal = new Prisma.Decimal(0);
    const effectiveAt = execution.dispatchedAt ?? new Date();

    const ordered = [...(byCurrency.get(currency) ?? [])].sort((a, b) => {
      const aDue = a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bDue = b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (aDue !== bDue) return aDue - bDue;
      return a.recognizedAt.getTime() - b.recognizedAt.getTime();
    });

    for (const payable of ordered) {
      if (remaining.lte(0)) break;
      await this.lockPayable(tx, companyId, payable.id);
      const locked = await tx.supplierPayable.findFirstOrThrow({
        where: { id: payable.id, companyId },
        include: { movements: { select: { direction: true, amount: true } } },
      });
      const totals = this.totalsFromMovements(locked.movements);
      if (totals.outstanding.lte(0)) continue;

      const apply = Prisma.Decimal.min(remaining, totals.outstanding);
      const sliceId = randomUUID();
      await tx.supplierLiabilityMovement.create({
        data: {
          companyId,
          payableId: locked.id,
          supplierId: purchaseReturn.supplierId,
          direction: SupplierLiabilityMovementDirection.DECREASE,
          type: SupplierLiabilityMovementType.SUPPLIER_RETURN,
          amount: apply,
          currency: locked.currency,
          sourceType: SUPPLIER_PAYABLE_LIABILITY_SOURCE_TYPES.SUPPLIER_RETURN_EXECUTION_SLICE,
          sourceId: sliceId,
          effectiveAt,
          notes: `SRE ${execution.number} (${executionId}) return reduction`,
          createdById: actorUserId,
        },
      });
      await this.refreshPayableStatusInTx(tx, companyId, locked.id);
      remaining = remaining.minus(apply);
      reducedTotal = reducedTotal.plus(apply);

      await this.auditService.record(tx, {
        action: AUDIT_ACTIONS.SUPPLIER_PAYABLE_ADJUSTED,
        entityType: AUDIT_ENTITY_TYPES.SUPPLIER_PAYABLE,
        entityId: locked.id,
        after: {
          reason: 'SUPPLIER_RETURN',
          executionId,
          amount: moneyString(apply),
          currency: locked.currency,
        },
        context: {
          companyId,
          actorUserId,
        },
      });
    }

    let creditId: string | null = null;
    if (remaining.gt(0)) {
      const credit = await this.createSupplierCreditInTx(tx, {
        companyId,
        supplierId: purchaseReturn.supplierId,
        currency,
        amount: remaining,
        sourceType: SUPPLIER_PAYABLE_LIABILITY_SOURCE_TYPES.SUPPLIER_RETURN_EXECUTION,
        sourceId: executionId,
        payableId: ordered[0]?.id ?? null,
        notes: `Excess return credit from SRE ${execution.number}`,
        actorUserId,
        effectiveAt,
      });
      creditId = credit.id;
    }

    return { reducedTotal: moneyString(reducedTotal), creditId };
  }

  private async createSupplierCreditInTx(
    tx: Tx,
    input: {
      companyId: string;
      supplierId: string;
      currency: CurrencyCode;
      amount: Prisma.Decimal;
      sourceType: string;
      sourceId: string;
      payableId: string | null;
      notes: string;
      actorUserId: string;
      effectiveAt: Date;
    },
  ): Promise<{ id: string; number: string }> {
    const existing = await tx.supplierCredit.findFirst({
      where: {
        companyId: input.companyId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    });
    if (existing) return { id: existing.id, number: existing.number };

    const seq = await allocateSupplierCreditSequence(tx, input.companyId);
    const number = formatSupplierCreditNumber(seq);
    const credit = await tx.supplierCredit.create({
      data: {
        companyId: input.companyId,
        number,
        supplierId: input.supplierId,
        currency: input.currency,
        originalAmount: input.amount,
        status: SupplierCreditStatus.OPEN,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        payableId: input.payableId,
        notes: input.notes,
      },
    });

    // Credit issuance is supplier-level — do not attach DECREASE to a payable
    // (excess was already excluded from payable reductions).
    await tx.supplierLiabilityMovement.create({
      data: {
        companyId: input.companyId,
        payableId: null,
        supplierId: input.supplierId,
        direction: SupplierLiabilityMovementDirection.DECREASE,
        type: SupplierLiabilityMovementType.SUPPLIER_CREDIT,
        amount: input.amount,
        currency: input.currency,
        sourceType: SUPPLIER_PAYABLE_LIABILITY_SOURCE_TYPES.SUPPLIER_CREDIT,
        sourceId: credit.id,
        supplierCreditId: credit.id,
        effectiveAt: input.effectiveAt,
        notes: input.notes,
        createdById: input.actorUserId,
      },
    });

    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.SUPPLIER_CREDIT_CREATED,
      entityType: AUDIT_ENTITY_TYPES.SUPPLIER_CREDIT,
      entityId: credit.id,
      after: {
        number: credit.number,
        supplierId: credit.supplierId,
        amount: moneyString(input.amount),
        currency: input.currency,
        sourceId: input.sourceId,
      },
      context: {
        companyId: input.companyId,
        actorUserId: input.actorUserId,
      },
    });

    return { id: credit.id, number: credit.number };
  }

  private async findOrCreatePayableForPoInTx(
    tx: Tx,
    input: {
      companyId: string;
      supplierId: string;
      purchaseOrderId: string;
      purchaseType: SupplierPayablePurchaseType;
      currency: CurrencyCode;
      dueDate: Date | null;
      referenceFxRate: Prisma.Decimal | null;
      referenceFxBaseCurrency: CurrencyCode | null;
      referenceFxQuoteCurrency: CurrencyCode | null;
      recognizedAt: Date;
    },
  ): Promise<{ id: string }> {
    const existing = await tx.supplierPayable.findFirst({
      where: {
        companyId: input.companyId,
        purchaseOrderId: input.purchaseOrderId,
        currency: input.currency,
      },
    });
    if (existing) {
      if (!existing.dueDate && input.dueDate) {
        await tx.supplierPayable.update({
          where: { id: existing.id },
          data: { dueDate: input.dueDate },
        });
      }
      return existing;
    }

    const seq = await allocateSupplierPayableSequence(tx, input.companyId);
    const number = formatSupplierPayableNumber(seq);
    return tx.supplierPayable.create({
      data: {
        companyId: input.companyId,
        number,
        supplierId: input.supplierId,
        purchaseOrderId: input.purchaseOrderId,
        purchaseType: input.purchaseType,
        currency: input.currency,
        referenceFxRate: input.referenceFxRate,
        referenceFxBaseCurrency: input.referenceFxBaseCurrency,
        referenceFxQuoteCurrency: input.referenceFxQuoteCurrency,
        dueDate: input.dueDate,
        status: SupplierPayableStatus.OPEN,
        recognizedAt: input.recognizedAt,
      },
    });
  }

  private async refreshPayableStatusInTx(
    tx: Tx,
    companyId: string,
    payableId: string,
  ): Promise<void> {
    const payable = await tx.supplierPayable.findFirstOrThrow({
      where: { id: payableId, companyId },
      include: { movements: { select: { direction: true, amount: true } } },
    });
    const totals = this.totalsFromMovements(payable.movements);
    const status = derivePayableStatus({
      recognized: totals.recognized,
      outstanding: totals.outstanding,
      currentStatus: payable.status,
    });
    if (status !== payable.status) {
      await tx.supplierPayable.update({
        where: { id: payableId },
        data: { status },
      });
    }
  }

  private async lockPayable(tx: Tx, companyId: string, payableId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM supplier_payables
      WHERE id = ${payableId}::uuid
        AND company_id = ${companyId}::uuid
      FOR UPDATE
    `);
    if (!rows[0]) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_PAYABLE_NOT_FOUND,
        message: SUPPLIER_PAYABLE_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
  }

  private async requireSupplier(
    companyId: string,
    supplierId: string,
    tx?: Tx,
  ): Promise<void> {
    const client = tx ?? this.database.client;
    const supplier = await client.supplier.findFirst({
      where: { id: supplierId, companyId },
      select: { id: true },
    });
    if (!supplier) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_PAYABLE_SUPPLIER_NOT_FOUND,
        message: SUPPLIER_PAYABLE_ERROR_MESSAGES.SUPPLIER_NOT_FOUND,
        statusCode: 404,
      });
    }
  }

  private mapPurchaseType(
    purchaseType: PurchaseCommercialType,
  ): SupplierPayablePurchaseType {
    switch (purchaseType) {
      case PurchaseCommercialType.CASH:
        return SupplierPayablePurchaseType.CASH;
      case PurchaseCommercialType.TERM_CREDIT:
        return SupplierPayablePurchaseType.TERM_CREDIT;
      case PurchaseCommercialType.FX_CREDIT:
        return SupplierPayablePurchaseType.FX_CREDIT;
      default:
        return SupplierPayablePurchaseType.CASH;
    }
  }

  private obligationCurrency(po: {
    currency: CurrencyCode;
    purchaseType: PurchaseCommercialType | null;
    obligationCurrency: CurrencyCode | null;
  }): CurrencyCode {
    if (po.purchaseType === PurchaseCommercialType.FX_CREDIT) {
      return po.obligationCurrency ?? po.currency;
    }
    return po.currency;
  }

  private totalsFromMovements(
    movements: Array<{ direction: SupplierLiabilityMovementDirection; amount: Prisma.Decimal }>,
  ) {
    return derivePayableTotals({
      increases: movements
        .filter((m) => m.direction === SupplierLiabilityMovementDirection.INCREASE)
        .map((m) => m.amount),
      decreases: movements
        .filter((m) => m.direction === SupplierLiabilityMovementDirection.DECREASE)
        .map((m) => m.amount),
    });
  }

  private toListView(row: {
    id: string;
    number: string;
    supplierId: string;
    purchaseOrderId: string | null;
    purchaseType: SupplierPayablePurchaseType;
    currency: CurrencyCode;
    referenceFxRate: Prisma.Decimal | null;
    referenceFxBaseCurrency: CurrencyCode | null;
    referenceFxQuoteCurrency: CurrencyCode | null;
    dueDate: Date | null;
    status: SupplierPayableStatus;
    recognizedAt: Date;
    notes: string | null;
    reference: string | null;
    createdAt: Date;
    updatedAt: Date;
    supplier?: { id: string; name: string; code: string | null } | null;
    purchaseOrder?: { id: string; number: string } | null;
    movements: Array<{ direction: SupplierLiabilityMovementDirection; amount: Prisma.Decimal }>;
  }): SupplierPayableView {
    const totals = this.totalsFromMovements(row.movements);
    const derived = attachDerivedPayableFields({
      dueDate: row.dueDate,
      status: row.status,
      recognized: totals.recognized,
      outstanding: totals.outstanding,
    });
    return {
      id: row.id,
      number: row.number,
      supplierId: row.supplierId,
      supplierName: row.supplier?.name ?? null,
      purchaseOrderId: row.purchaseOrderId,
      purchaseOrderNumber: row.purchaseOrder?.number ?? null,
      purchaseType: row.purchaseType,
      currency: row.currency,
      referenceFxRate: row.referenceFxRate ? moneyString(row.referenceFxRate) : null,
      referenceFxBaseCurrency: row.referenceFxBaseCurrency,
      referenceFxQuoteCurrency: row.referenceFxQuoteCurrency,
      dueDate: row.dueDate?.toISOString() ?? null,
      status: derived.status,
      recognizedAt: row.recognizedAt.toISOString(),
      notes: row.notes,
      reference: row.reference,
      recognizedAmount: moneyString(totals.recognized),
      outstandingAmount: moneyString(totals.outstanding),
      overdue: derived.overdue,
      agingBucket: derived.agingBucket,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetailView(row: PayableDetail): SupplierPayableView {
    const base = this.toListView(row);
    return {
      ...base,
      lines: row.lines.map(
        (line): SupplierPayableLineView => ({
          id: line.id,
          goodsReceiptId: line.goodsReceiptId,
          goodsReceiptItemId: line.goodsReceiptItemId,
          purchaseOrderItemId: line.purchaseOrderItemId,
          skuId: line.skuId,
          quantity: line.quantity,
          unitPrice: moneyString(line.unitPrice),
          lineAmount: moneyString(line.lineAmount),
          currency: line.currency,
          recognizedAt: line.recognizedAt.toISOString(),
        }),
      ),
      movements: row.movements.map(
        (movement): SupplierLiabilityMovementView => ({
          id: movement.id,
          payableId: movement.payableId,
          supplierId: movement.supplierId,
          direction: movement.direction,
          type: movement.type,
          amount: moneyString(movement.amount),
          currency: movement.currency,
          sourceType: movement.sourceType,
          sourceId: movement.sourceId,
          supplierCreditId: movement.supplierCreditId,
          effectiveAt: movement.effectiveAt.toISOString(),
          notes: movement.notes,
          createdAt: movement.createdAt.toISOString(),
        }),
      ),
    };
  }
}
