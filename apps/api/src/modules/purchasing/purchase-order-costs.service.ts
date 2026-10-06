import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  Prisma,
  PurchaseCostAllocationMethod,
  PurchaseCostStatus,
  PurchaseCostType,
  PurchasingLifecycleStatus,
} from '@hector/database';
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
import type { CreatePurchaseOrderCostDto } from './dto/create-purchase-order-cost.dto';
import type { ListPurchaseOrderCostsQueryDto } from './dto/list-purchase-order-costs.query.dto';
import type { UpdatePurchaseOrderCostDto } from './dto/update-purchase-order-cost.dto';
import type { VoidPurchaseOrderCostDto } from './dto/void-purchase-order-cost.dto';
import {
  aggregateActiveCostsByCurrency,
  assertPoAcceptsCostMutation,
  assertPurchaseCostDescription,
  defaultAllocationMethod,
  deriveReferenceAcquisitionTotal,
  isPurchaseCostDraftEditable,
  normalizeOptionalCostText,
  parseCostDate,
  parsePurchaseCostAmount,
  type PurchaseCostTotalsByCurrency,
} from './purchase-order-costs';
import { parseUtcBusinessDate } from './purchase-order-due';
import {
  PURCHASE_COST_ERROR_MESSAGES,
  PURCHASE_COST_NOTES_MAX_LENGTH,
  PURCHASE_COST_PAYEE_NAME_MAX_LENGTH,
  PURCHASE_COST_REFERENCE_MAX_LENGTH,
  PURCHASE_COST_VOID_REASON_MAX_LENGTH,
  PURCHASE_ORDER_MAX_COSTS,
} from './purchasing.constants';
import { assertOptionalDisplay } from './purchasing.normalization';
import { SuppliersService } from './suppliers.service';

const TX_OPTIONS = { maxWait: 5_000, timeout: 20_000 } as const;

const costInclude = {
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  voidedBy: { select: { id: true, firstName: true, lastName: true } },
  supplier: { select: { id: true, name: true, code: true } },
} satisfies Prisma.PurchaseOrderCostInclude;

type CostRow = Prisma.PurchaseOrderCostGetPayload<{ include: typeof costInclude }>;

export type PurchaseOrderCostView = {
  id: string;
  companyId: string;
  purchaseOrderId: string;
  type: PurchaseCostType;
  status: PurchaseCostStatus;
  description: string | null;
  amount: string;
  currency: CurrencyCode;
  costDate: Date;
  payeeName: string | null;
  reference: string | null;
  notes: string | null;
  allocationMethod: PurchaseCostAllocationMethod;
  supplierId: string | null;
  supplier: { id: string; name: string; code: string | null } | null;
  createdBy: { id: string; displayName: string };
  voidedBy: { id: string; displayName: string } | null;
  voidReason: string | null;
  voidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PurchaseCostSummaryView = {
  purchaseCosts: PurchaseOrderCostView[];
  purchaseCostTotalsByCurrency: PurchaseCostTotalsByCurrency;
  /** Present only when merchandise + all ACTIVE costs share one currency. */
  referenceAcquisitionTotal: { amount: string; currency: CurrencyCode } | null;
};

@Injectable()
export class PurchaseOrderCostsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
    private readonly suppliersService: SuppliersService,
  ) {}

  async list(
    company: CompanyContext,
    purchaseOrderId: string,
    query: ListPurchaseOrderCostsQueryDto = {},
  ): Promise<{ data: PurchaseOrderCostView[]; summary: Omit<PurchaseCostSummaryView, 'purchaseCosts'> }> {
    const po = await this.requirePurchaseOrderHeader(company.companyId, purchaseOrderId);
    const where: Prisma.PurchaseOrderCostWhereInput = {
      companyId: company.companyId,
      purchaseOrderId,
      ...(query.costType ? { type: query.costType } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
      ...(query.costDateFrom || query.costDateTo
        ? {
            costDate: {
              ...(query.costDateFrom ? { gte: parseUtcBusinessDate(query.costDateFrom) } : {}),
              ...(query.costDateTo
                ? {
                    lte: new Date(
                      Date.UTC(
                        parseUtcBusinessDate(query.costDateTo).getUTCFullYear(),
                        parseUtcBusinessDate(query.costDateTo).getUTCMonth(),
                        parseUtcBusinessDate(query.costDateTo).getUTCDate(),
                        23,
                        59,
                        59,
                        999,
                      ),
                    ),
                  }
                : {}),
            },
          }
        : {}),
    };

    const rows = await this.database.client.purchaseOrderCost.findMany({
      where,
      include: costInclude,
      orderBy: [{ costDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    const allActive = await this.database.client.purchaseOrderCost.findMany({
      where: {
        companyId: company.companyId,
        purchaseOrderId,
        status: PurchaseCostStatus.ACTIVE,
      },
      select: { amount: true, currency: true, status: true },
    });
    const totals = aggregateActiveCostsByCurrency(allActive);
    return {
      data: rows.map((row) => this.toView(row)),
      summary: {
        purchaseCostTotalsByCurrency: totals,
        referenceAcquisitionTotal: deriveReferenceAcquisitionTotal({
          merchandiseTotal: po.total,
          merchandiseCurrency: po.currency,
          costTotalsByCurrency: totals,
        }),
      },
    };
  }

  async create(
    company: CompanyContext,
    purchaseOrderId: string,
    dto: CreatePurchaseOrderCostDto,
  ): Promise<PurchaseOrderCostView> {
    const actorUserId = this.suppliersService.requireActorUserId();
    const amount = parsePurchaseCostAmount(dto.amount, dto.currency);
    const description = assertPurchaseCostDescription(dto.type, dto.description);
    const payeeName =
      normalizeOptionalCostText(dto.payeeName, PURCHASE_COST_PAYEE_NAME_MAX_LENGTH) ?? null;
    const reference =
      normalizeOptionalCostText(dto.reference, PURCHASE_COST_REFERENCE_MAX_LENGTH) ?? null;
    const notes = normalizeOptionalCostText(dto.notes, PURCHASE_COST_NOTES_MAX_LENGTH) ?? null;
    const allocationMethod = defaultAllocationMethod(dto.allocationMethod);

    return commitThenPublish(this.eventBus, async (events) => {
      const created = await this.database.client.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.findFirst({
          where: { id: purchaseOrderId, companyId: company.companyId },
          select: {
            id: true,
            status: true,
            currency: true,
            total: true,
            orderDate: true,
            supplierId: true,
          },
        });
        if (!po) throw this.poNotFound();
        assertPoAcceptsCostMutation(po.status);

        const count = await tx.purchaseOrderCost.count({
          where: { companyId: company.companyId, purchaseOrderId },
        });
        if (count >= PURCHASE_ORDER_MAX_COSTS) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_COST_TOO_MANY,
            message: PURCHASE_COST_ERROR_MESSAGES.TOO_MANY,
            statusCode: 400,
          });
        }

        const supplierId = await this.resolveOptionalSupplierId(
          tx,
          company.companyId,
          dto.supplierId,
          po.supplierId,
        );
        const costDate = parseCostDate(dto.costDate, po.orderDate);

        const row = await tx.purchaseOrderCost.create({
          data: {
            companyId: company.companyId,
            purchaseOrderId,
            type: dto.type,
            status: PurchaseCostStatus.ACTIVE,
            description,
            amount,
            currency: dto.currency,
            costDate,
            payeeName,
            reference,
            notes,
            allocationMethod,
            supplierId,
            createdById: actorUserId,
          },
          include: costInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PURCHASE_COST_CREATED,
          entityType: AUDIT_ENTITY_TYPES.PURCHASE_ORDER_COST,
          entityId: row.id,
          before: null,
          after: this.costSnapshot(row),
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PURCHASING_PURCHASE_COST_ADDED,
            payload: this.eventPayload(row),
          }),
        );
        return row;
      }, TX_OPTIONS);

      return this.toView(created);
    });
  }

  async update(
    company: CompanyContext,
    purchaseOrderId: string,
    costId: string,
    dto: UpdatePurchaseOrderCostDto,
  ): Promise<PurchaseOrderCostView> {
    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.findFirst({
          where: { id: purchaseOrderId, companyId: company.companyId },
          select: { id: true, status: true, supplierId: true, orderDate: true },
        });
        if (!po) throw this.poNotFound();
        assertPoAcceptsCostMutation(po.status);
        if (!isPurchaseCostDraftEditable(po.status)) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_COST_NOT_EDITABLE,
            message: PURCHASE_COST_ERROR_MESSAGES.NOT_EDITABLE,
            statusCode: 409,
          });
        }

        const current = await this.requireCost(tx, company.companyId, purchaseOrderId, costId);
        if (current.status !== PurchaseCostStatus.ACTIVE) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_COST_NOT_EDITABLE,
            message: PURCHASE_COST_ERROR_MESSAGES.NOT_EDITABLE,
            statusCode: 409,
          });
        }

        const type = dto.type ?? current.type;
        const currency = dto.currency ?? current.currency;
        const amount =
          dto.amount !== undefined
            ? parsePurchaseCostAmount(dto.amount, currency)
            : current.amount;
        const description =
          dto.description !== undefined || dto.type !== undefined
            ? assertPurchaseCostDescription(
                type,
                dto.description !== undefined ? dto.description : current.description,
              )
            : current.description;
        const costDate =
          dto.costDate !== undefined ? parseCostDate(dto.costDate, po.orderDate) : current.costDate;
        const payeeName =
          dto.payeeName !== undefined
            ? (normalizeOptionalCostText(dto.payeeName, PURCHASE_COST_PAYEE_NAME_MAX_LENGTH) ??
              null)
            : current.payeeName;
        const reference =
          dto.reference !== undefined
            ? (normalizeOptionalCostText(dto.reference, PURCHASE_COST_REFERENCE_MAX_LENGTH) ?? null)
            : current.reference;
        const notes =
          dto.notes !== undefined
            ? (normalizeOptionalCostText(dto.notes, PURCHASE_COST_NOTES_MAX_LENGTH) ?? null)
            : current.notes;
        const allocationMethod =
          dto.allocationMethod !== undefined
            ? defaultAllocationMethod(dto.allocationMethod)
            : current.allocationMethod;
        const supplierId =
          dto.supplierId !== undefined
            ? await this.resolveOptionalSupplierId(
                tx,
                company.companyId,
                dto.supplierId ?? undefined,
                po.supplierId,
                dto.supplierId === null,
              )
            : current.supplierId;

        const before = this.costSnapshot(current);
        const row = await tx.purchaseOrderCost.update({
          where: { id: current.id },
          data: {
            type,
            amount,
            currency,
            description,
            costDate,
            payeeName,
            reference,
            notes,
            allocationMethod,
            supplierId,
          },
          include: costInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PURCHASE_COST_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.PURCHASE_ORDER_COST,
          entityId: row.id,
          before,
          after: this.costSnapshot(row),
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PURCHASING_PURCHASE_COST_UPDATED,
            payload: this.eventPayload(row),
          }),
        );
        return row;
      }, TX_OPTIONS);

      return this.toView(updated);
    });
  }

  async removeDraft(
    company: CompanyContext,
    purchaseOrderId: string,
    costId: string,
  ): Promise<{ deleted: true }> {
    return commitThenPublish(this.eventBus, async (events) => {
      await this.database.client.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.findFirst({
          where: { id: purchaseOrderId, companyId: company.companyId },
          select: { id: true, status: true },
        });
        if (!po) throw this.poNotFound();
        if (!isPurchaseCostDraftEditable(po.status)) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_COST_NOT_EDITABLE,
            message: PURCHASE_COST_ERROR_MESSAGES.NOT_EDITABLE,
            statusCode: 409,
          });
        }
        const current = await this.requireCost(tx, company.companyId, purchaseOrderId, costId);
        const before = this.costSnapshot(current);
        await tx.purchaseOrderCost.delete({ where: { id: current.id } });
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PURCHASE_COST_REMOVED,
          entityType: AUDIT_ENTITY_TYPES.PURCHASE_ORDER_COST,
          entityId: current.id,
          before,
          after: null,
        });
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PURCHASING_PURCHASE_COST_REMOVED,
            payload: {
              companyId: current.companyId,
              purchaseOrderId: current.purchaseOrderId,
              purchaseCostId: current.id,
              type: current.type,
              currency: current.currency,
              amount: current.amount.toString(),
              status: current.status,
            },
          }),
        );
      }, TX_OPTIONS);
      return { deleted: true as const };
    });
  }

  async void(
    company: CompanyContext,
    purchaseOrderId: string,
    costId: string,
    dto: VoidPurchaseOrderCostDto,
  ): Promise<PurchaseOrderCostView> {
    const actorUserId = this.suppliersService.requireActorUserId();
    const reason = assertOptionalDisplay(dto.reason, PURCHASE_COST_VOID_REASON_MAX_LENGTH);
    if (!reason) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_COST_VOID_REASON_REQUIRED,
        message: PURCHASE_COST_ERROR_MESSAGES.VOID_REASON_REQUIRED,
        statusCode: 400,
      });
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const voided = await this.database.client.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.findFirst({
          where: { id: purchaseOrderId, companyId: company.companyId },
          select: { id: true, status: true },
        });
        if (!po) throw this.poNotFound();
        assertPoAcceptsCostMutation(po.status);

        // Serialize concurrent voids on the same row.
        await tx.$executeRaw`SELECT id FROM purchase_order_costs WHERE id = ${costId}::uuid AND company_id = ${company.companyId}::uuid AND purchase_order_id = ${purchaseOrderId}::uuid FOR UPDATE`;
        const current = await this.requireCost(tx, company.companyId, purchaseOrderId, costId);
        if (current.status === PurchaseCostStatus.VOIDED) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_COST_NOT_VOIDABLE,
            message: PURCHASE_COST_ERROR_MESSAGES.NOT_VOIDABLE,
            statusCode: 409,
          });
        }

        const before = this.costSnapshot(current);
        const row = await tx.purchaseOrderCost.update({
          where: { id: current.id },
          data: {
            status: PurchaseCostStatus.VOIDED,
            voidReason: reason,
            voidedById: actorUserId,
            voidedAt: new Date(),
          },
          include: costInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PURCHASE_COST_VOIDED,
          entityType: AUDIT_ENTITY_TYPES.PURCHASE_ORDER_COST,
          entityId: row.id,
          before,
          after: this.costSnapshot(row),
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PURCHASING_PURCHASE_COST_VOIDED,
            payload: { ...this.eventPayload(row), voidReason: reason },
          }),
        );
        return row;
      }, TX_OPTIONS);

      return this.toView(voided);
    });
  }

  async summaryForPurchaseOrder(
    companyId: string,
    purchaseOrderId: string,
    merchandiseTotal: Prisma.Decimal,
    merchandiseCurrency: CurrencyCode,
  ): Promise<PurchaseCostSummaryView> {
    const rows = await this.database.client.purchaseOrderCost.findMany({
      where: { companyId, purchaseOrderId },
      include: costInclude,
      orderBy: [{ costDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    const totals = aggregateActiveCostsByCurrency(rows);
    return {
      purchaseCosts: rows.map((row) => this.toView(row)),
      purchaseCostTotalsByCurrency: totals,
      referenceAcquisitionTotal: deriveReferenceAcquisitionTotal({
        merchandiseTotal,
        merchandiseCurrency,
        costTotalsByCurrency: totals,
      }),
    };
  }

  private async requirePurchaseOrderHeader(companyId: string, purchaseOrderId: string) {
    const po = await this.database.client.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, companyId },
      select: { id: true, total: true, currency: true, status: true },
    });
    if (!po) throw this.poNotFound();
    return po;
  }

  private async requireCost(
    tx: Prisma.TransactionClient,
    companyId: string,
    purchaseOrderId: string,
    costId: string,
  ): Promise<CostRow> {
    const row = await tx.purchaseOrderCost.findFirst({
      where: { id: costId, companyId, purchaseOrderId },
      include: costInclude,
    });
    if (!row) throw this.notFound();
    return row;
  }

  private async resolveOptionalSupplierId(
    tx: Prisma.TransactionClient,
    companyId: string,
    supplierId: string | undefined,
    poSupplierId: string,
    clear = false,
  ): Promise<string | null> {
    if (clear) return null;
    if (supplierId === undefined) return null;
    const supplier = await tx.supplier.findFirst({
      where: { id: supplierId, companyId },
      select: { id: true, status: true },
    });
    if (!supplier || supplier.status === PurchasingLifecycleStatus.ARCHIVED) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_NOT_FOUND,
        message: 'Supplier was not found.',
        statusCode: 404,
      });
    }
    // Optional link — may equal PO supplier or another company supplier.
    void poSupplierId;
    return supplier.id;
  }

  private toView(row: CostRow): PurchaseOrderCostView {
    return {
      id: row.id,
      companyId: row.companyId,
      purchaseOrderId: row.purchaseOrderId,
      type: row.type,
      status: row.status,
      description: row.description,
      amount: row.amount.toString(),
      currency: row.currency,
      costDate: row.costDate,
      payeeName: row.payeeName,
      reference: row.reference,
      notes: row.notes,
      allocationMethod: row.allocationMethod,
      supplierId: row.supplierId,
      supplier: row.supplier,
      createdBy: {
        id: row.createdBy.id,
        displayName: `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim(),
      },
      voidedBy: row.voidedBy
        ? {
            id: row.voidedBy.id,
            displayName: `${row.voidedBy.firstName} ${row.voidedBy.lastName}`.trim(),
          }
        : null,
      voidReason: row.voidReason,
      voidedAt: row.voidedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private costSnapshot(row: {
    id: string;
    purchaseOrderId: string;
    type: PurchaseCostType;
    status: PurchaseCostStatus;
    description: string | null;
    amount: Prisma.Decimal;
    currency: CurrencyCode;
    costDate: Date;
    payeeName: string | null;
    reference: string | null;
    notes: string | null;
    allocationMethod: PurchaseCostAllocationMethod;
    supplierId: string | null;
    voidReason: string | null;
    voidedAt: Date | null;
  }) {
    return {
      id: row.id,
      purchaseOrderId: row.purchaseOrderId,
      type: row.type,
      status: row.status,
      description: row.description,
      amount: row.amount.toString(),
      currency: row.currency,
      costDate: row.costDate.toISOString(),
      payeeName: row.payeeName,
      reference: row.reference,
      notes: row.notes,
      allocationMethod: row.allocationMethod,
      supplierId: row.supplierId,
      voidReason: row.voidReason,
      voidedAt: row.voidedAt?.toISOString() ?? null,
    };
  }

  private eventPayload(row: {
    companyId: string;
    purchaseOrderId: string;
    id: string;
    type: PurchaseCostType;
    currency: CurrencyCode;
    amount: Prisma.Decimal;
    status: PurchaseCostStatus;
  }) {
    return {
      companyId: row.companyId,
      purchaseOrderId: row.purchaseOrderId,
      purchaseCostId: row.id,
      type: row.type,
      currency: row.currency,
      amount: row.amount.toString(),
      status: row.status,
    };
  }

  private notFound(): AppError {
    return new AppError({
      code: ERROR_CODES.PURCHASE_COST_NOT_FOUND,
      message: PURCHASE_COST_ERROR_MESSAGES.NOT_FOUND,
      statusCode: 404,
    });
  }

  private poNotFound(): AppError {
    return new AppError({
      code: ERROR_CODES.PURCHASE_ORDER_NOT_FOUND,
      message: 'Purchase order was not found.',
      statusCode: 404,
    });
  }
}
