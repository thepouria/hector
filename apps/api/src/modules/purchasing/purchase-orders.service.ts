import { Injectable } from '@nestjs/common';
import {
  CatalogLifecycleStatus,
  CurrencyCode,
  PERMISSIONS,
  PaymentTermType,
  Prisma,
  PurchaseCommercialType,
  PurchaseOrderStatus,
  PurchaseTermBasis,
  PurchasingLifecycleStatus,
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
import { auditSnapshotsEqual } from '../audit/serializers/audit-sanitizer';
import { CatalogQueryService } from '../catalog/catalog-query.service';
import type { CompanyContext } from '../companies/types/company.types';
import { AuthorizationService } from '../rbac/authorization.service';
import type { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import type { ListPurchaseOrdersQueryDto } from './dto/list-purchase-orders.query.dto';
import type {
  AddPurchaseOrderItemDto,
  PurchaseOrderItemInputDto,
  UpdatePurchaseOrderItemDto,
} from './dto/purchase-order-item.dto';
import type {
  CancelPurchaseOrderDto,
  OrderPurchaseOrderDto,
  PurchaseOrderTransitionDto,
} from './dto/purchase-order-transition.dto';
import type { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import {
  assertPurchaseOrderQuantity,
  computeLineSubtotal,
  computePurchaseOrderTotals,
  parsePurchaseOrderUnitPrice,
} from './purchase-order-money';
import {
  allocatePurchaseOrderSequence,
  formatPurchaseOrderNumber,
} from './purchase-order-numbering';
import {
  assertCommerciallyEditable,
  assertPurchaseOrderTransition,
  deriveAvailableActions,
  isPurchaseOrderMetadataEditable,
  requiresCancellationReason,
  type PurchaseOrderLifecycleAction,
} from './purchase-order-status';
import {
  deriveDueStatus,
  dueStatusToDateFilter,
  parseUtcBusinessDate,
} from './purchase-order-due';
import {
  clearedTermsForType,
  computeReferenceValuation,
  resolvePurchaseTerms,
  syncFxObligationFromTotal,
  type PurchaseTermsFields,
} from './purchase-order-terms';
import {
  FX_PURCHASE_SETTLEMENT_BASIS,
  PURCHASE_ORDER_CANCELLATION_REASON_MAX_LENGTH,
  PURCHASE_ORDER_ERROR_MESSAGES,
  PURCHASE_ORDER_ITEM_NOTES_MAX_LENGTH,
  PURCHASE_ORDER_MAX_ITEMS,
  PURCHASE_ORDER_NOTES_MAX_LENGTH,
  PURCHASE_ORDER_PAYMENT_TERMS_NOTE_MAX_LENGTH,
  PURCHASE_ORDER_SEARCH_MAX_LENGTH,
  PURCHASE_ORDER_SUPPLIER_ORDER_REFERENCE_MAX_LENGTH,
  type FxPurchaseSettlementBasis,
  type PurchaseDueStatus,
} from './purchasing.constants';
import { PurchaseReceivingContract } from './contracts/purchase-receiving.contract';
import { normalizeSearchQuery } from './purchasing.normalization';
import { SuppliersService } from './suppliers.service';

function purchaseOrderActivitySummary(action: string, actorName: string): string {
  const map: Record<string, string> = {
    PURCHASE_ORDER_CREATED: `${actorName} سفارش خرید را ایجاد کرد.`,
    PURCHASE_ORDER_UPDATED: `${actorName} پیش‌نویس خرید را ویرایش کرد.`,
    PURCHASE_ORDER_ITEM_ADDED: `${actorName} قلم کالا را به خرید افزود.`,
    PURCHASE_ORDER_ITEM_UPDATED: `${actorName} قلم کالا را ویرایش کرد.`,
    PURCHASE_ORDER_ITEM_REMOVED: `${actorName} قلم کالا را از خرید حذف کرد.`,
    PURCHASE_ORDER_APPROVED: `${actorName} خرید را تأیید کرد.`,
    PURCHASE_ORDER_ORDERED: `${actorName} سفارش را نزد تأمین‌کننده ثبت کرد.`,
    PURCHASE_ORDER_CANCELLED: `${actorName} خرید را لغو کرد.`,
    PURCHASE_COST_CREATED: `${actorName} هزینه خرید را ثبت کرد.`,
    PURCHASE_COST_UPDATED: `${actorName} هزینه خرید را ویرایش کرد.`,
    PURCHASE_COST_VOIDED: `${actorName} هزینه خرید را باطل کرد.`,
    PURCHASE_COST_REMOVED: `${actorName} هزینه خرید را حذف کرد.`,
    PURCHASE_ORDER_CORRECTED: `${actorName} خرید را اصلاح کرد.`,
    PURCHASE_DUE_DATE_CHANGED: `${actorName} سررسید خرید را تغییر داد.`,
    PURCHASE_FX_TERMS_CHANGED: `${actorName} شرایط ارزی خرید را اصلاح کرد.`,
    PURCHASE_DISCREPANCY_RECORDED: `${actorName} مغایرت خرید را ثبت کرد.`,
    PURCHASE_ORDER_SHORT_CLOSED: `${actorName} کسری/بستن جزئی خرید را ثبت کرد.`,
    PURCHASE_RETURN_CREATED: `${actorName} برگشت خرید را ایجاد کرد.`,
    PURCHASE_RETURN_UPDATED: `${actorName} برگشت خرید را ویرایش کرد.`,
    PURCHASE_RETURN_APPROVED: `${actorName} برگشت خرید را تأیید کرد.`,
    PURCHASE_RETURN_CANCELLED: `${actorName} برگشت خرید را لغو کرد.`,
  };
  return map[action] ?? `${actorName}: ${action}`;
}

const TX_OPTIONS = { maxWait: 5_000, timeout: 20_000 } as const;

const userSelect = { select: { id: true, firstName: true, lastName: true } } as const;

const listInclude = {
  supplier: { select: { id: true, name: true, code: true, status: true } },
  createdBy: userSelect,
  _count: { select: { items: true } },
} satisfies Prisma.PurchaseOrderInclude;

const detailInclude = {
  supplier: { select: { id: true, name: true, code: true, status: true } },
  supplierContact: { select: { id: true, name: true, role: true } },
  createdBy: userSelect,
  approvedBy: userSelect,
  orderedBy: userSelect,
  cancelledBy: userSelect,
  items: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      sku: {
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          product: { select: { id: true, name: true, code: true, status: true } },
        },
      },
      supplierOffer: {
        select: {
          id: true,
          unitPrice: true,
          currency: true,
          quotedAt: true,
          archivedAt: true,
        },
      },
    },
  },
} satisfies Prisma.PurchaseOrderInclude;

type PurchaseOrderDetailRow = Prisma.PurchaseOrderGetPayload<{ include: typeof detailInclude }>;
type PurchaseOrderListRow = Prisma.PurchaseOrderGetPayload<{ include: typeof listInclude }>;
type PurchaseOrderItemRow = PurchaseOrderDetailRow['items'][number];

type UserRef = { id: string; firstName: string; lastName: string };
type UserView = { id: string; displayName: string };

export type PurchaseOrderItemView = {
  id: string;
  purchaseOrderId: string;
  skuId: string;
  quantity: number;
  /** Purchasing short-close projection — not received / not returned. */
  closedUnfulfilledQuantity: number;
  unitPrice: string;
  lineSubtotal: string;
  supplierOfferId: string | null;
  notes: string | null;
  skuCodeSnapshot: string | null;
  productNameSnapshot: string | null;
  variantLabelSnapshot: string | null;
  productIdSnapshot: string | null;
  createdAt: Date;
  updatedAt: Date;
  sku: {
    id: string;
    code: string;
    name: string | null;
    status: CatalogLifecycleStatus;
    product: { id: string; name: string; code: string | null };
  };
  supplierOffer: {
    id: string;
    unitPrice: string;
    currency: CurrencyCode;
    quotedAt: Date;
    archivedAt: Date | null;
  } | null;
};

type PurchaseOrderCommonView = {
  id: string;
  companyId: string;
  number: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  supplierContactId: string | null;
  currency: CurrencyCode;
  purchaseType: PurchaseCommercialType | null;
  paymentTermType: PaymentTermType | null;
  netDays: number | null;
  termBasis: PurchaseTermBasis | null;
  dueDate: Date | null;
  /** Derived contractual due status — not payment / unpaid state. */
  dueStatus: PurchaseDueStatus;
  paymentTermsNote: string | null;
  obligationAmount: string | null;
  obligationCurrency: CurrencyCode | null;
  referenceFxRate: string | null;
  referenceFxBaseCurrency: CurrencyCode | null;
  referenceFxQuoteCurrency: CurrencyCode | null;
  referenceFxRateAt: Date | null;
  /**
   * Derived analysis only (obligation × reference rate). Not a local-currency liability.
   * Server-computed; never client-authored.
   */
  referenceLocalValuation: string | null;
  referenceLocalValuationCurrency: CurrencyCode | null;
  /** FX_CREDIT: future Finance must settle remaining foreign obligation. */
  settlementBasis: FxPurchaseSettlementBasis | null;
  orderDate: Date;
  expectedAt: Date | null;
  supplierOrderReference: string | null;
  notes: string | null;
  cancellationReason: string | null;
  /** Server-derived next actions for the current actor permissions. */
  availableActions: PurchaseOrderLifecycleAction[];
  subtotal: string;
  total: string;
  supplierNameSnapshot: string | null;
  supplierCodeSnapshot: string | null;
  createdAt: Date;
  updatedAt: Date;
  approvedAt: Date | null;
  orderedAt: Date | null;
  cancelledAt: Date | null;
  version: number;
  supplier: { id: string; name: string; code: string | null; status: PurchasingLifecycleStatus };
  createdBy: UserView;
};

export type PurchaseOrderListItemView = PurchaseOrderCommonView & { itemCount: number };

export type PurchaseOrderView = PurchaseOrderCommonView & {
  itemCount: number;
  supplierContact: { id: string; name: string; role: string | null } | null;
  approvedBy: UserView | null;
  orderedBy: UserView | null;
  cancelledBy: UserView | null;
  items: PurchaseOrderItemView[];
};

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
    private readonly suppliersService: SuppliersService,
    private readonly catalogQuery: CatalogQueryService,
    private readonly authorization: AuthorizationService,
    private readonly purchaseReceiving: PurchaseReceivingContract,
  ) {}

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async list(
    company: CompanyContext,
    query: ListPurchaseOrdersQueryDto,
  ): Promise<{ data: PurchaseOrderListItemView[]; meta: PaginationMeta }> {
    const search = normalizeSearchQuery(query.search, PURCHASE_ORDER_SEARCH_MAX_LENGTH);
    const now = new Date();
    const dueDateFilter: Prisma.DateTimeNullableFilter = {
      ...(query.dueFrom ? { gte: parseUtcBusinessDate(query.dueFrom) } : {}),
      ...(query.dueTo
        ? {
            lte: new Date(
              Date.UTC(
                parseUtcBusinessDate(query.dueTo).getUTCFullYear(),
                parseUtcBusinessDate(query.dueTo).getUTCMonth(),
                parseUtcBusinessDate(query.dueTo).getUTCDate(),
                23,
                59,
                59,
                999,
              ),
            ),
          }
        : {}),
      ...(query.dueStatus && query.dueStatus !== 'NO_DUE_DATE'
        ? dueStatusToDateFilter(query.dueStatus, now)
        : {}),
    };
    const hasDueDateFilter = Object.keys(dueDateFilter).length > 0;

    const where: Prisma.PurchaseOrderWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.purchaseType ? { purchaseType: query.purchaseType } : {}),
      ...(query.paymentTermType ? { paymentTermType: query.paymentTermType } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
      ...(query.skuId
        ? { items: { some: { skuId: query.skuId, companyId: company.companyId } } }
        : {}),
      ...(query.orderFrom || query.orderTo
        ? {
            orderDate: {
              ...(query.orderFrom ? { gte: new Date(query.orderFrom) } : {}),
              ...(query.orderTo ? { lte: new Date(query.orderTo) } : {}),
            },
          }
        : {}),
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
              ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
            },
          }
        : {}),
      ...(query.dueStatus === 'NO_DUE_DATE'
        ? { dueDate: null }
        : hasDueDateFilter
          ? { dueDate: dueDateFilter }
          : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { notes: { contains: search, mode: 'insensitive' } },
              { paymentTermsNote: { contains: search, mode: 'insensitive' } },
              { supplier: { name: { contains: search, mode: 'insensitive' } } },
              { supplier: { code: { contains: search, mode: 'insensitive' } } },
              { supplierNameSnapshot: { contains: search, mode: 'insensitive' } },
              {
                items: {
                  some: {
                    OR: [
                      { sku: { code: { contains: search, mode: 'insensitive' } } },
                      { sku: { name: { contains: search, mode: 'insensitive' } } },
                      { sku: { product: { name: { contains: search, mode: 'insensitive' } } } },
                      { skuCodeSnapshot: { contains: search, mode: 'insensitive' } },
                      { productNameSnapshot: { contains: search, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const orderBy: Prisma.PurchaseOrderOrderByWithRelationInput[] = [
      { [query.sortBy]: query.sortOrder },
      { createdAt: 'desc' },
      { id: 'desc' },
    ];

    const [total, rows] = await this.database.client.$transaction([
      this.database.client.purchaseOrder.count({ where }),
      this.database.client.purchaseOrder.findMany({
        where,
        orderBy,
        skip,
        take: query.pageSize,
        include: listInclude,
      }),
    ]);
    const lifecyclePermissions = await this.actorLifecyclePermissions();

    return {
      data: rows.map((row) => this.toListView(row, lifecyclePermissions)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, purchaseOrderId: string): Promise<PurchaseOrderView> {
    const row = await this.requirePurchaseOrder(this.database.client, company.companyId, purchaseOrderId);
    return await this.toView(row);
  }

  /**
   * Business activity timeline for a PO (Phase 2.15).
   * Projects company-scoped Audit rows for the PO and related child entities.
   * Does not expose IP / user-agent (raw audit remains on GET /audit-logs).
   */
  async listActivity(
    company: CompanyContext,
    purchaseOrderId: string,
    query: { page?: number; pageSize?: number },
  ) {
    await this.requirePurchaseOrder(this.database.client, company.companyId, purchaseOrderId);

    const [items, costs, corrections, discrepancies, returns] = await Promise.all([
      this.database.client.purchaseOrderItem.findMany({
        where: { companyId: company.companyId, purchaseOrderId },
        select: { id: true },
      }),
      this.database.client.purchaseOrderCost.findMany({
        where: { companyId: company.companyId, purchaseOrderId },
        select: { id: true },
      }),
      this.database.client.purchaseOrderCorrection.findMany({
        where: { companyId: company.companyId, purchaseOrderId },
        select: { id: true },
      }),
      this.database.client.purchaseDiscrepancy.findMany({
        where: { companyId: company.companyId, purchaseOrderId },
        select: { id: true },
      }),
      this.database.client.purchaseReturn.findMany({
        where: { companyId: company.companyId, purchaseOrderId },
        select: { id: true },
      }),
    ]);

    const relatedIds = [
      ...items.map((r) => r.id),
      ...costs.map((r) => r.id),
      ...corrections.map((r) => r.id),
      ...discrepancies.map((r) => r.id),
      ...returns.map((r) => r.id),
    ];

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.AuditLogWhereInput = {
      companyId: company.companyId,
      OR: [
        {
          entityType: AUDIT_ENTITY_TYPES.PURCHASE_ORDER,
          entityId: purchaseOrderId,
        },
        ...(relatedIds.length
          ? [
              {
                entityId: { in: relatedIds },
                entityType: {
                  in: [
                    AUDIT_ENTITY_TYPES.PURCHASE_ORDER_ITEM,
                    AUDIT_ENTITY_TYPES.PURCHASE_ORDER_COST,
                    AUDIT_ENTITY_TYPES.PURCHASE_ORDER_CORRECTION,
                    AUDIT_ENTITY_TYPES.PURCHASE_DISCREPANCY,
                    AUDIT_ENTITY_TYPES.PURCHASE_RETURN,
                  ],
                },
              },
            ]
          : []),
        {
          metadata: {
            path: ['purchaseOrderId'],
            equals: purchaseOrderId,
          },
        },
      ],
    };

    const [total, rows] = await this.database.client.$transaction([
      this.database.client.auditLog.count({ where }),
      this.database.client.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          before: true,
          after: true,
          metadata: true,
          actor: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      }),
    ]);

    return {
      data: rows.map((row) => this.toActivityItem(row)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  // ---------------------------------------------------------------------------
  // Draft commands
  // ---------------------------------------------------------------------------

  async create(company: CompanyContext, dto: CreatePurchaseOrderDto): Promise<PurchaseOrderView> {
    const actorUserId = this.suppliersService.requireActorUserId();

    const supplier = await this.suppliersService.requireSupplier(company.companyId, dto.supplierId);
    this.assertSupplierAssignable(supplier.status);
    await this.assertContact(this.database.client, company.companyId, dto.supplierId, dto.supplierContactId);

    const orderDate = dto.orderDate ? new Date(dto.orderDate) : new Date();
    const expectedAt = dto.expectedAt ? new Date(dto.expectedAt) : null;
    this.assertDates(orderDate, expectedAt);
    const notes = this.normalizeNotes(dto.notes, PURCHASE_ORDER_NOTES_MAX_LENGTH) ?? null;
    const paymentTermsNote =
      this.normalizeNotes(dto.paymentTermsNote, PURCHASE_ORDER_PAYMENT_TERMS_NOTE_MAX_LENGTH) ??
      null;

    if (dto.items.length > PURCHASE_ORDER_MAX_ITEMS) {
      throw AppError.validation(`A purchase order can have at most ${PURCHASE_ORDER_MAX_ITEMS} items.`);
    }
    const seen = new Set<string>();
    const lines: Array<{
      skuId: string;
      quantity: number;
      unitPrice: Prisma.Decimal;
      lineSubtotal: Prisma.Decimal;
      supplierOfferId: string | null;
      notes: string | null;
    }> = [];
    for (const item of dto.items) {
      if (seen.has(item.skuId)) {
        throw this.duplicateSku();
      }
      seen.add(item.skuId);
      await this.assertSkuAssignable(company.companyId, item.skuId);
      const parsed = await this.prepareLine(
        this.database.client,
        company.companyId,
        dto.supplierId,
        dto.currency,
        item,
      );
      lines.push(parsed);
    }
    const totals = computePurchaseOrderTotals(lines);
    const terms = resolvePurchaseTerms({
      purchaseType: dto.purchaseType ?? null,
      paymentTermType: dto.paymentTermType ?? null,
      netDays: dto.netDays ?? null,
      dueDate: dto.dueDate ?? null,
      obligationAmount: dto.obligationAmount ?? null,
      obligationCurrency: dto.obligationCurrency ?? null,
      referenceFxRate: dto.referenceFxRate ?? null,
      referenceFxBaseCurrency: dto.referenceFxBaseCurrency ?? null,
      referenceFxQuoteCurrency: dto.referenceFxQuoteCurrency ?? null,
      referenceFxRateAt: dto.referenceFxRateAt ? new Date(dto.referenceFxRateAt) : null,
      currency: dto.currency,
      orderDate,
      total: totals.total,
      complete: false,
    });

    return commitThenPublish(this.eventBus, async (events) => {
      const created = await this.database.client.$transaction(async (tx) => {
        const sequence = await allocatePurchaseOrderSequence(tx, company.companyId);
        const number = formatPurchaseOrderNumber(orderDate, sequence);

        const order = await tx.purchaseOrder.create({
          data: {
            companyId: company.companyId,
            number,
            supplierId: dto.supplierId,
            supplierContactId: dto.supplierContactId ?? null,
            status: PurchaseOrderStatus.DRAFT,
            currency: dto.currency,
            ...this.termsToPrisma(terms),
            orderDate,
            expectedAt,
            notes,
            paymentTermsNote,
            subtotal: totals.subtotal,
            total: totals.total,
            createdById: actorUserId,
          },
          select: { id: true },
        });
        // Explicit, strictly increasing createdAt preserves the payload line order (items sort by createdAt).
        const linesBase = Date.now();
        await tx.purchaseOrderItem.createMany({
          data: lines.map((line, index) => ({
            createdAt: new Date(linesBase + index),
            companyId: company.companyId,
            purchaseOrderId: order.id,
            skuId: line.skuId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineSubtotal: line.lineSubtotal,
            supplierOfferId: line.supplierOfferId,
            notes: line.notes,
          })),
        });
        const row = await this.requirePurchaseOrder(tx, company.companyId, order.id);

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PURCHASE_ORDER_CREATED,
          entityType: AUDIT_ENTITY_TYPES.PURCHASE_ORDER,
          entityId: row.id,
          before: null,
          after: { ...this.headerSnapshot(row), items: row.items.map((i) => this.itemSnapshot(i)) },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_CREATED,
            payload: {
              ...this.basePayload(row),
              total: row.total.toString(),
              itemCount: row.items.length,
            },
          }),
        );
        return row;
      }, TX_OPTIONS);

      return await this.toView(created);
    });
  }

  async update(
    company: CompanyContext,
    purchaseOrderId: string,
    dto: UpdatePurchaseOrderDto,
  ): Promise<PurchaseOrderView> {
    if (
      dto.supplierId === undefined &&
      dto.supplierContactId === undefined &&
      dto.currency === undefined &&
      dto.purchaseType === undefined &&
      dto.paymentTermType === undefined &&
      dto.netDays === undefined &&
      dto.dueDate === undefined &&
      dto.paymentTermsNote === undefined &&
      dto.obligationAmount === undefined &&
      dto.obligationCurrency === undefined &&
      dto.referenceFxRate === undefined &&
      dto.referenceFxBaseCurrency === undefined &&
      dto.referenceFxQuoteCurrency === undefined &&
      dto.referenceFxRateAt === undefined &&
      dto.orderDate === undefined &&
      dto.expectedAt === undefined &&
      dto.notes === undefined
    ) {
      throw AppError.validation('At least one field is required to update the purchase order.');
    }

    return commitThenPublish(this.eventBus, (events) =>
      this.runLocked(company.companyId, purchaseOrderId, async (tx, current) => {
        this.assertExpectedVersion(current.version, dto.expectedVersion);

        if (!isPurchaseOrderMetadataEditable(current.status)) {
          throw this.notEditable();
        }
        const termsTouched =
          dto.purchaseType !== undefined ||
          dto.paymentTermType !== undefined ||
          dto.netDays !== undefined ||
          dto.dueDate !== undefined ||
          dto.paymentTermsNote !== undefined ||
          dto.obligationAmount !== undefined ||
          dto.obligationCurrency !== undefined ||
          dto.referenceFxRate !== undefined ||
          dto.referenceFxBaseCurrency !== undefined ||
          dto.referenceFxQuoteCurrency !== undefined ||
          dto.referenceFxRateAt !== undefined;
        const commercialTouched =
          dto.supplierId !== undefined ||
          dto.supplierContactId !== undefined ||
          dto.currency !== undefined ||
          dto.orderDate !== undefined ||
          termsTouched;
        if (commercialTouched) {
          assertCommerciallyEditable(current.status);
        }

        const supplierChanged =
          dto.supplierId !== undefined && dto.supplierId !== current.supplierId;
        const currencyChanged = dto.currency !== undefined && dto.currency !== current.currency;
        if ((supplierChanged || currencyChanged) && current.items.length > 0) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_ORDER_PARTY_LOCKED,
            message: PURCHASE_ORDER_ERROR_MESSAGES.PARTY_LOCKED,
            statusCode: 409,
          });
        }

        const supplierId = supplierChanged ? dto.supplierId! : current.supplierId;
        if (supplierChanged) {
          const supplier = await tx.supplier.findFirst({
            where: { id: supplierId, companyId: company.companyId },
            select: { status: true },
          });
          if (!supplier) {
            throw new AppError({
              code: ERROR_CODES.SUPPLIER_NOT_FOUND,
              message: 'Supplier was not found.',
              statusCode: 404,
            });
          }
          this.assertSupplierAssignable(supplier.status);
        }

        let supplierContactId = current.supplierContactId;
        if (dto.supplierContactId !== undefined) {
          supplierContactId = dto.supplierContactId;
        } else if (supplierChanged) {
          supplierContactId = null;
        }
        if (supplierContactId !== current.supplierContactId || supplierChanged) {
          await this.assertContact(tx, company.companyId, supplierId, supplierContactId ?? undefined);
        }

        const orderDate = dto.orderDate !== undefined ? new Date(dto.orderDate) : current.orderDate;
        const expectedAt =
          dto.expectedAt !== undefined
            ? dto.expectedAt === null
              ? null
              : new Date(dto.expectedAt)
            : current.expectedAt;
        this.assertDates(orderDate, expectedAt);
        const notes =
          dto.notes !== undefined
            ? (this.normalizeNotes(dto.notes, PURCHASE_ORDER_NOTES_MAX_LENGTH) ?? null)
            : current.notes;
        const paymentTermsNote =
          dto.paymentTermsNote !== undefined
            ? (this.normalizeNotes(
                dto.paymentTermsNote,
                PURCHASE_ORDER_PAYMENT_TERMS_NOTE_MAX_LENGTH,
              ) ?? null)
            : current.paymentTermsNote;
        const currency = dto.currency ?? current.currency;

        const purchaseType =
          dto.purchaseType !== undefined ? dto.purchaseType : current.purchaseType;
        const typeChanged =
          dto.purchaseType !== undefined && dto.purchaseType !== current.purchaseType;
        const cleared = typeChanged ? clearedTermsForType(purchaseType) : null;

        const paymentTermType = typeChanged
          ? dto.paymentTermType !== undefined
            ? dto.paymentTermType
            : (cleared?.paymentTermType ?? null)
          : dto.paymentTermType !== undefined
            ? dto.paymentTermType
            : current.paymentTermType;
        const termTypeChanged =
          paymentTermType !== current.paymentTermType || typeChanged;

        const netDays =
          paymentTermType === PaymentTermType.FIXED_DATE ||
          paymentTermType === PaymentTermType.IMMEDIATE
            ? dto.netDays !== undefined
              ? dto.netDays
              : null
            : typeChanged
              ? dto.netDays !== undefined
                ? dto.netDays
                : null
              : dto.netDays !== undefined
                ? dto.netDays
                : current.netDays;

        const dueDateInput =
          paymentTermType === PaymentTermType.FIXED_DATE
            ? dto.dueDate !== undefined
              ? dto.dueDate
              : termTypeChanged
                ? null
                : (current.dueDate?.toISOString() ?? null)
            : dto.dueDate !== undefined
              ? dto.dueDate
              : null;

        const terms = resolvePurchaseTerms({
          purchaseType,
          paymentTermType,
          netDays,
          dueDate: dueDateInput,
          obligationAmount: typeChanged
            ? (dto.obligationAmount !== undefined ? dto.obligationAmount : null)
            : dto.obligationAmount !== undefined
              ? dto.obligationAmount
              : (current.obligationAmount?.toString() ?? null),
          obligationCurrency: typeChanged
            ? (dto.obligationCurrency !== undefined ? dto.obligationCurrency : null)
            : dto.obligationCurrency !== undefined
              ? dto.obligationCurrency
              : current.obligationCurrency,
          referenceFxRate: typeChanged
            ? (dto.referenceFxRate !== undefined ? dto.referenceFxRate : null)
            : dto.referenceFxRate !== undefined
              ? dto.referenceFxRate
              : (current.referenceFxRate?.toString() ?? null),
          referenceFxBaseCurrency: typeChanged
            ? (dto.referenceFxBaseCurrency !== undefined
                ? dto.referenceFxBaseCurrency
                : null)
            : dto.referenceFxBaseCurrency !== undefined
              ? dto.referenceFxBaseCurrency
              : current.referenceFxBaseCurrency,
          referenceFxQuoteCurrency: typeChanged
            ? (dto.referenceFxQuoteCurrency !== undefined
                ? dto.referenceFxQuoteCurrency
                : null)
            : dto.referenceFxQuoteCurrency !== undefined
              ? dto.referenceFxQuoteCurrency
              : current.referenceFxQuoteCurrency,
          referenceFxRateAt: typeChanged
            ? dto.referenceFxRateAt !== undefined
              ? dto.referenceFxRateAt === null
                ? null
                : new Date(dto.referenceFxRateAt)
              : null
            : dto.referenceFxRateAt !== undefined
              ? dto.referenceFxRateAt === null
                ? null
                : new Date(dto.referenceFxRateAt)
              : current.referenceFxRateAt,
          currency,
          orderDate,
          total: current.total,
          complete: false,
        });

        const next = {
          supplierId,
          supplierContactId,
          currency,
          orderDate,
          expectedAt,
          notes,
          paymentTermsNote,
          ...this.termsToPrisma(terms),
        };
        const before = this.headerSnapshot(current);
        const unchanged =
          next.supplierId === current.supplierId &&
          next.supplierContactId === current.supplierContactId &&
          next.currency === current.currency &&
          next.orderDate.getTime() === current.orderDate.getTime() &&
          (next.expectedAt?.getTime() ?? null) === (current.expectedAt?.getTime() ?? null) &&
          next.notes === current.notes &&
          next.paymentTermsNote === current.paymentTermsNote &&
          next.purchaseType === current.purchaseType &&
          next.paymentTermType === current.paymentTermType &&
          next.netDays === current.netDays &&
          next.termBasis === current.termBasis &&
          (next.dueDate?.getTime() ?? null) === (current.dueDate?.getTime() ?? null) &&
          (next.obligationAmount?.toString() ?? null) ===
            (current.obligationAmount?.toString() ?? null) &&
          next.obligationCurrency === current.obligationCurrency &&
          (next.referenceFxRate?.toString() ?? null) ===
            (current.referenceFxRate?.toString() ?? null) &&
          next.referenceFxBaseCurrency === current.referenceFxBaseCurrency &&
          next.referenceFxQuoteCurrency === current.referenceFxQuoteCurrency &&
          (next.referenceFxRateAt?.getTime() ?? null) ===
            (current.referenceFxRateAt?.getTime() ?? null);
        if (unchanged) {
          return await this.toView(current);
        }

        await tx.purchaseOrder.update({
          where: { id: current.id },
          data: { ...next, version: { increment: 1 } },
        });
        const updated = await this.requirePurchaseOrder(tx, company.companyId, current.id);
        const after = this.headerSnapshot(updated);

        const audited = await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PURCHASE_ORDER_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.PURCHASE_ORDER,
          entityId: updated.id,
          before,
          after,
        });
        if (audited) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_UPDATED,
              payload: {
                ...this.basePayload(updated),
                changedFields: this.changedFields(before, after),
              },
            }),
          );
        }
        return await this.toView(updated);
      }),
    );
  }

  async addItem(
    company: CompanyContext,
    purchaseOrderId: string,
    dto: AddPurchaseOrderItemDto,
  ): Promise<PurchaseOrderView> {
    await this.assertSkuAssignable(company.companyId, dto.skuId);
    return commitThenPublish(this.eventBus, (events) =>
      this.runLocked(company.companyId, purchaseOrderId, async (tx, current) => {
        assertCommerciallyEditable(current.status);
        if (current.items.length >= PURCHASE_ORDER_MAX_ITEMS) {
          throw AppError.validation(
            `A purchase order can have at most ${PURCHASE_ORDER_MAX_ITEMS} items.`,
          );
        }
        if (current.items.some((item) => item.skuId === dto.skuId)) {
          throw this.duplicateSku();
        }
        const line = await this.prepareLine(
          tx,
          company.companyId,
          current.supplierId,
          current.currency,
          dto,
        );

        let created;
        try {
          created = await tx.purchaseOrderItem.create({
            data: {
              companyId: company.companyId,
              purchaseOrderId: current.id,
              skuId: line.skuId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineSubtotal: line.lineSubtotal,
              supplierOfferId: line.supplierOfferId,
              notes: line.notes,
            },
          });
        } catch (error) {
          this.mapItemUniqueViolation(error);
        }

        const updated = await this.recomputeTotals(tx, company.companyId, current.id);
        const item = updated.items.find((candidate) => candidate.id === created.id)!;

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PURCHASE_ORDER_ITEM_ADDED,
          entityType: AUDIT_ENTITY_TYPES.PURCHASE_ORDER_ITEM,
          entityId: item.id,
          before: null,
          after: this.itemSnapshot(item),
          metadata: { purchaseOrderId: updated.id, number: updated.number },
        });
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ITEM_ADDED,
            payload: this.itemPayload(updated, item),
          }),
        );
        return await this.toView(updated);
      }),
    );
  }

  async updateItem(
    company: CompanyContext,
    purchaseOrderId: string,
    itemId: string,
    dto: UpdatePurchaseOrderItemDto,
  ): Promise<PurchaseOrderView> {
    if (
      dto.quantity === undefined &&
      dto.unitPrice === undefined &&
      dto.supplierOfferId === undefined &&
      dto.notes === undefined
    ) {
      throw AppError.validation('At least one field is required to update the item.');
    }

    return commitThenPublish(this.eventBus, (events) =>
      this.runLocked(company.companyId, purchaseOrderId, async (tx, current) => {
        assertCommerciallyEditable(current.status);
        const existing = current.items.find((candidate) => candidate.id === itemId);
        if (!existing) {
          throw this.itemNotFound();
        }

        const quantity =
          dto.quantity !== undefined ? assertPurchaseOrderQuantity(dto.quantity) : existing.quantity;
        const unitPrice =
          dto.unitPrice !== undefined
            ? parsePurchaseOrderUnitPrice(dto.unitPrice, current.currency)
            : existing.unitPrice;
        const supplierOfferId =
          dto.supplierOfferId !== undefined ? dto.supplierOfferId : existing.supplierOfferId;
        if (supplierOfferId && supplierOfferId !== existing.supplierOfferId) {
          await this.assertOfferLink(
            tx,
            company.companyId,
            supplierOfferId,
            current.supplierId,
            existing.skuId,
            current.currency,
          );
        }
        const notes =
          dto.notes !== undefined
            ? (this.normalizeNotes(dto.notes, PURCHASE_ORDER_ITEM_NOTES_MAX_LENGTH) ?? null)
            : existing.notes;
        const lineSubtotal = computeLineSubtotal(quantity, unitPrice);

        await tx.purchaseOrderItem.update({
          where: { id: existing.id },
          data: { quantity, unitPrice, lineSubtotal, supplierOfferId, notes },
        });

        const updated = await this.recomputeTotals(tx, company.companyId, current.id);
        const item = updated.items.find((candidate) => candidate.id === existing.id)!;

        const audited = await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PURCHASE_ORDER_ITEM_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.PURCHASE_ORDER_ITEM,
          entityId: item.id,
          before: this.itemSnapshot(existing),
          after: this.itemSnapshot(item),
          metadata: { purchaseOrderId: updated.id, number: updated.number },
        });
        if (audited) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ITEM_UPDATED,
              payload: this.itemPayload(updated, item),
            }),
          );
        }
        return await this.toView(updated);
      }),
    );
  }

  async removeItem(
    company: CompanyContext,
    purchaseOrderId: string,
    itemId: string,
  ): Promise<PurchaseOrderView> {
    return commitThenPublish(this.eventBus, (events) =>
      this.runLocked(company.companyId, purchaseOrderId, async (tx, current) => {
        assertCommerciallyEditable(current.status);
        const existing = current.items.find((candidate) => candidate.id === itemId);
        if (!existing) {
          throw this.itemNotFound();
        }

        await tx.purchaseOrderItem.delete({ where: { id: existing.id } });
        const updated = await this.recomputeTotals(tx, company.companyId, current.id);

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PURCHASE_ORDER_ITEM_REMOVED,
          entityType: AUDIT_ENTITY_TYPES.PURCHASE_ORDER_ITEM,
          entityId: existing.id,
          before: this.itemSnapshot(existing),
          after: null,
          metadata: { purchaseOrderId: updated.id, number: updated.number },
        });
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ITEM_REMOVED,
            payload: this.itemPayload(updated, existing),
          }),
        );
        return await this.toView(updated);
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Lifecycle commands
  // ---------------------------------------------------------------------------

  /** DRAFT -> APPROVED */
  async approve(
    company: CompanyContext,
    purchaseOrderId: string,
    dto: PurchaseOrderTransitionDto = {},
  ): Promise<PurchaseOrderView> {
    const actorUserId = this.suppliersService.requireActorUserId();
    return this.transition(company, purchaseOrderId, {
      to: PurchaseOrderStatus.APPROVED,
      expectedVersion: dto.expectedVersion,
      auditAction: AUDIT_ACTIONS.PURCHASE_ORDER_APPROVED,
      eventType: DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_APPROVED,
      requireItems: true,
      apply: async (tx, current) => {
        await this.assertPartiesAssignable(tx, current);
        const terms = this.requireCompleteTerms(current);
        await tx.purchaseOrder.update({
          where: { id: current.id },
          data: {
            status: PurchaseOrderStatus.APPROVED,
            ...this.termsToPrisma(terms),
            approvedById: actorUserId,
            approvedAt: new Date(),
            version: { increment: 1 },
          },
        });
      },
    });
  }

  /**
   * APPROVED -> ORDERED. Freezes supplier / SKU / product snapshots.
   * Alias of `order` kept for Phase 2.4 route compatibility (`/mark-ordered`).
   */
  async markOrdered(
    company: CompanyContext,
    purchaseOrderId: string,
    dto: OrderPurchaseOrderDto = {},
  ): Promise<PurchaseOrderView> {
    return this.order(company, purchaseOrderId, dto);
  }

  /** APPROVED -> ORDERED (Phase 2.9 canonical command name). */
  async order(
    company: CompanyContext,
    purchaseOrderId: string,
    dto: OrderPurchaseOrderDto = {},
  ): Promise<PurchaseOrderView> {
    const actorUserId = this.suppliersService.requireActorUserId();
    const supplierOrderReference =
      this.normalizeNotes(
        dto.supplierOrderReference,
        PURCHASE_ORDER_SUPPLIER_ORDER_REFERENCE_MAX_LENGTH,
      ) ?? null;
    return this.transition(company, purchaseOrderId, {
      to: PurchaseOrderStatus.ORDERED,
      expectedVersion: dto.expectedVersion,
      auditAction: AUDIT_ACTIONS.PURCHASE_ORDER_ORDERED,
      eventType: DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ORDERED,
      requireItems: true,
      apply: async (tx, current) => {
        await this.assertPartiesAssignable(tx, current);
        const orderDate = dto.orderDate ? new Date(dto.orderDate) : current.orderDate;
        this.assertDates(orderDate, current.expectedAt);
        const terms = this.requireCompleteTerms({ ...current, orderDate });
        for (const item of current.items) {
          await tx.purchaseOrderItem.update({
            where: { id: item.id },
            data: {
              skuCodeSnapshot: item.sku.code,
              productNameSnapshot: item.sku.product.name,
              variantLabelSnapshot: item.sku.name,
              productIdSnapshot: item.sku.product.id,
            },
          });
        }
        await tx.purchaseOrder.update({
          where: { id: current.id },
          data: {
            status: PurchaseOrderStatus.ORDERED,
            orderDate,
            ...this.termsToPrisma(terms),
            ...(supplierOrderReference !== null
              ? { supplierOrderReference }
              : dto.supplierOrderReference === undefined
                ? {}
                : { supplierOrderReference: null }),
            orderedById: actorUserId,
            orderedAt: new Date(),
            supplierNameSnapshot: current.supplier.name,
            supplierCodeSnapshot: current.supplier.code,
            version: { increment: 1 },
          },
        });
      },
    });
  }

  /** DRAFT | APPROVED | ORDERED -> CANCELLED (reason required after DRAFT). */
  async cancel(
    company: CompanyContext,
    purchaseOrderId: string,
    dto: CancelPurchaseOrderDto = {},
  ): Promise<PurchaseOrderView> {
    const actorUserId = this.suppliersService.requireActorUserId();
    const reason = this.normalizeNotes(dto.reason, PURCHASE_ORDER_CANCELLATION_REASON_MAX_LENGTH) ?? null;
    return this.transition(company, purchaseOrderId, {
      to: PurchaseOrderStatus.CANCELLED,
      expectedVersion: dto.expectedVersion,
      auditAction: AUDIT_ACTIONS.PURCHASE_ORDER_CANCELLED,
      eventType: DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_CANCELLED,
      requireItems: false,
      apply: async (tx, current) => {
        if (requiresCancellationReason(current.status) && !reason) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_ORDER_CANCELLATION_REASON_REQUIRED,
            message: PURCHASE_ORDER_ERROR_MESSAGES.CANCELLATION_REASON_REQUIRED,
            statusCode: 400,
          });
        }
        // Phase 3.4: posted GRN evidence forbids ORDERED → CANCELLED.
        const hasPosted = await this.purchaseReceiving.hasPostedReceivingEvidence(
          company.companyId,
          current.id,
          tx,
        );
        if (hasPosted) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_ORDER_HAS_POSTED_RECEIPTS,
            message: PURCHASE_ORDER_ERROR_MESSAGES.HAS_POSTED_RECEIPTS,
            statusCode: 409,
          });
        }
        await tx.purchaseOrder.update({
          where: { id: current.id },
          data: {
            status: PurchaseOrderStatus.CANCELLED,
            cancelledById: actorUserId,
            cancelledAt: new Date(),
            cancellationReason: reason,
            version: { increment: 1 },
          },
        });
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async transition(
    company: CompanyContext,
    purchaseOrderId: string,
    options: {
      to: PurchaseOrderStatus;
      expectedVersion: number | undefined;
      auditAction: string;
      eventType:
        | typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_APPROVED
        | typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ORDERED
        | typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_CANCELLED;
      requireItems: boolean;
      apply: (tx: Prisma.TransactionClient, current: PurchaseOrderDetailRow) => Promise<void>;
    },
  ): Promise<PurchaseOrderView> {
    return commitThenPublish(this.eventBus, (events) =>
      this.runLocked(company.companyId, purchaseOrderId, async (tx, current) => {
        // Row is locked FOR UPDATE: concurrent commands serialize and the loser observes the new status.
        assertPurchaseOrderTransition(current.status, options.to);
        this.assertExpectedVersion(current.version, options.expectedVersion);
        if (options.requireItems && current.items.length === 0) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_ORDER_EMPTY,
            message: PURCHASE_ORDER_ERROR_MESSAGES.EMPTY,
            statusCode: 409,
          });
        }

        await options.apply(tx, current);
        const updated = await this.requirePurchaseOrder(tx, company.companyId, current.id);

        await this.auditService.record(tx, {
          action: options.auditAction,
          entityType: AUDIT_ENTITY_TYPES.PURCHASE_ORDER,
          entityId: updated.id,
          before: this.headerSnapshot(current),
          after: this.headerSnapshot(updated),
        });
        events.push(
          this.eventFactory.create({
            type: options.eventType,
            payload: {
              ...this.basePayload(updated),
              previousStatus: current.status,
              purchaseType: updated.purchaseType,
              total: updated.total.toString(),
              itemCount: updated.items.length,
              version: updated.version,
              approvedAt: updated.approvedAt?.toISOString() ?? null,
              orderedAt: updated.orderedAt?.toISOString() ?? null,
              cancelledAt: updated.cancelledAt?.toISOString() ?? null,
              reason: updated.cancellationReason ?? null,
            },
          }),
        );
        return await this.toView(updated);
      }),
    );
  }

  /** Runs `work` in a transaction holding a row lock on the purchase order. */
  private async runLocked<T>(
    companyId: string,
    purchaseOrderId: string,
    work: (tx: Prisma.TransactionClient, current: PurchaseOrderDetailRow) => Promise<T>,
  ): Promise<T> {
    return this.database.client.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "purchase_orders"
        WHERE "id" = ${purchaseOrderId}::uuid AND "company_id" = ${companyId}::uuid
        FOR UPDATE
      `);
      if (locked.length === 0) {
        throw this.notFound();
      }
      const current = await this.requirePurchaseOrder(tx, companyId, purchaseOrderId);
      return work(tx, current);
    }, TX_OPTIONS);
  }

  private async requirePurchaseOrder(
    client: Prisma.TransactionClient | DatabaseService['client'],
    companyId: string,
    purchaseOrderId: string,
  ): Promise<PurchaseOrderDetailRow> {
    const row = await client.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, companyId },
      include: detailInclude,
    });
    if (!row) {
      throw this.notFound();
    }
    return row;
  }

  private async recomputeTotals(
    tx: Prisma.TransactionClient,
    companyId: string,
    purchaseOrderId: string,
  ): Promise<PurchaseOrderDetailRow> {
    const header = await tx.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, companyId },
      select: { purchaseType: true, currency: true },
    });
    const items = await tx.purchaseOrderItem.findMany({
      where: { purchaseOrderId, companyId },
      select: { quantity: true, unitPrice: true },
    });
    const totals = computePurchaseOrderTotals(items);
    const fxSync =
      header &&
      syncFxObligationFromTotal(header.purchaseType, header.currency, totals.total);
    await tx.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data: {
        subtotal: totals.subtotal,
        total: totals.total,
        ...(fxSync
          ? {
              obligationAmount: fxSync.obligationAmount,
              obligationCurrency: fxSync.obligationCurrency,
            }
          : {}),
        version: { increment: 1 },
      },
    });
    return this.requirePurchaseOrder(tx, companyId, purchaseOrderId);
  }

  private requireCompleteTerms(current: PurchaseOrderDetailRow): PurchaseTermsFields {
    return resolvePurchaseTerms({
      purchaseType: current.purchaseType,
      paymentTermType: current.paymentTermType,
      netDays: current.netDays,
      dueDate:
        current.paymentTermType === PaymentTermType.FIXED_DATE
          ? (current.dueDate?.toISOString() ?? null)
          : null,
      obligationAmount: current.obligationAmount?.toString() ?? null,
      obligationCurrency: current.obligationCurrency,
      referenceFxRate: current.referenceFxRate?.toString() ?? null,
      referenceFxBaseCurrency: current.referenceFxBaseCurrency,
      referenceFxQuoteCurrency: current.referenceFxQuoteCurrency,
      referenceFxRateAt: current.referenceFxRateAt,
      currency: current.currency,
      orderDate: current.orderDate,
      total: current.total,
      complete: true,
    });
  }

  private termsToPrisma(terms: PurchaseTermsFields) {
    return {
      purchaseType: terms.purchaseType,
      paymentTermType: terms.paymentTermType,
      netDays: terms.netDays,
      termBasis: terms.termBasis,
      dueDate: terms.dueDate,
      obligationAmount: terms.obligationAmount,
      obligationCurrency: terms.obligationCurrency,
      referenceFxRate: terms.referenceFxRate,
      referenceFxBaseCurrency: terms.referenceFxBaseCurrency,
      referenceFxQuoteCurrency: terms.referenceFxQuoteCurrency,
      referenceFxRateAt: terms.referenceFxRateAt,
    };
  }

  /** Same-company SKU lookup (404 otherwise) and archived guard. Runs before any row lock is taken. */
  private async assertSkuAssignable(companyId: string, skuId: string): Promise<void> {
    const sku = await this.catalogQuery.getSkuIdentity(companyId, skuId);
    if (
      sku.skuStatus === CatalogLifecycleStatus.ARCHIVED ||
      sku.productStatus === CatalogLifecycleStatus.ARCHIVED
    ) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_ORDER_SKU_NOT_ASSIGNABLE,
        message: PURCHASE_ORDER_ERROR_MESSAGES.SKU_NOT_ASSIGNABLE,
        statusCode: 409,
      });
    }
  }

  private async prepareLine(
    client: Prisma.TransactionClient | DatabaseService['client'],
    companyId: string,
    supplierId: string,
    currency: CurrencyCode,
    item: PurchaseOrderItemInputDto,
  ) {
    const quantity = assertPurchaseOrderQuantity(item.quantity);
    const unitPrice = parsePurchaseOrderUnitPrice(item.unitPrice, currency);

    if (item.supplierOfferId) {
      await this.assertOfferLink(client, companyId, item.supplierOfferId, supplierId, item.skuId, currency);
    }

    return {
      skuId: item.skuId,
      quantity,
      unitPrice,
      lineSubtotal: computeLineSubtotal(quantity, unitPrice),
      supplierOfferId: item.supplierOfferId ?? null,
      notes: this.normalizeNotes(item.notes, PURCHASE_ORDER_ITEM_NOTES_MAX_LENGTH) ?? null,
    };
  }

  /**
   * Offer reference is optional. It must belong to this company, supplier and SKU, be non-archived,
   * and share the PO currency. The PO price is allowed to differ from the quoted price.
   */
  private async assertOfferLink(
    client: Prisma.TransactionClient | DatabaseService['client'],
    companyId: string,
    offerId: string,
    supplierId: string,
    skuId: string,
    currency: CurrencyCode,
  ): Promise<void> {
    const offer = await client.supplierOffer.findFirst({
      where: { id: offerId, companyId },
      select: { supplierId: true, skuId: true, currency: true, archivedAt: true },
    });
    if (!offer) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_OFFER_NOT_FOUND,
        message: 'Supplier offer was not found.',
        statusCode: 404,
      });
    }
    if (
      offer.supplierId !== supplierId ||
      offer.skuId !== skuId ||
      offer.currency !== currency ||
      offer.archivedAt !== null
    ) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_ORDER_OFFER_INVALID,
        message: PURCHASE_ORDER_ERROR_MESSAGES.OFFER_INVALID,
        statusCode: 400,
      });
    }
  }

  private async assertContact(
    client: Prisma.TransactionClient | DatabaseService['client'],
    companyId: string,
    supplierId: string,
    contactId: string | undefined,
  ): Promise<void> {
    if (!contactId) return;
    const contact = await client.supplierContact.findFirst({
      where: { id: contactId, companyId, supplierId, archivedAt: null },
      select: { id: true },
    });
    if (!contact) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_ORDER_CONTACT_INVALID,
        message: PURCHASE_ORDER_ERROR_MESSAGES.CONTACT_INVALID,
        statusCode: 400,
      });
    }
  }

  /** Archived supplier / SKU / product may not progress a PO to a new commitment stage. */
  private async assertPartiesAssignable(
    tx: Prisma.TransactionClient,
    current: PurchaseOrderDetailRow,
  ): Promise<void> {
    const supplier = await tx.supplier.findFirst({
      where: { id: current.supplierId, companyId: current.companyId },
      select: { status: true },
    });
    if (!supplier) {
      throw this.notFound();
    }
    this.assertSupplierAssignable(supplier.status);
    for (const item of current.items) {
      if (
        item.sku.status === CatalogLifecycleStatus.ARCHIVED ||
        item.sku.product.status === CatalogLifecycleStatus.ARCHIVED
      ) {
        throw new AppError({
          code: ERROR_CODES.PURCHASE_ORDER_SKU_NOT_ASSIGNABLE,
          message: PURCHASE_ORDER_ERROR_MESSAGES.SKU_NOT_ASSIGNABLE,
          statusCode: 409,
        });
      }
    }
  }

  private assertSupplierAssignable(status: PurchasingLifecycleStatus): void {
    if (status === PurchasingLifecycleStatus.ARCHIVED) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_ORDER_SUPPLIER_NOT_ASSIGNABLE,
        message: PURCHASE_ORDER_ERROR_MESSAGES.SUPPLIER_NOT_ASSIGNABLE,
        statusCode: 409,
      });
    }
  }

  private assertDates(orderDate: Date, expectedAt: Date | null): void {
    if (Number.isNaN(orderDate.getTime()) || (expectedAt && Number.isNaN(expectedAt.getTime()))) {
      throw AppError.validation('Invalid date value.');
    }
    if (expectedAt && expectedAt.getTime() < orderDate.getTime()) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_ORDER_INVALID_DATES,
        message: PURCHASE_ORDER_ERROR_MESSAGES.INVALID_DATES,
        statusCode: 400,
      });
    }
  }

  private assertExpectedVersion(actual: number, expected: number | undefined): void {
    if (expected !== undefined && expected !== actual) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_ORDER_VERSION_CONFLICT,
        message: PURCHASE_ORDER_ERROR_MESSAGES.VERSION_CONFLICT,
        statusCode: 409,
        details: { expectedVersion: expected, currentVersion: actual },
      });
    }
  }

  private normalizeNotes(
    value: string | null | undefined,
    max: number,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length > max) {
      throw AppError.validation(`Value exceeds maximum length of ${max}.`);
    }
    return trimmed;
  }

  private mapItemUniqueViolation(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw this.duplicateSku();
    }
    throw error;
  }

  private duplicateSku(): AppError {
    return new AppError({
      code: ERROR_CODES.PURCHASE_ORDER_DUPLICATE_SKU,
      message: PURCHASE_ORDER_ERROR_MESSAGES.DUPLICATE_SKU,
      statusCode: 409,
    });
  }

  private notEditable(): AppError {
    return new AppError({
      code: ERROR_CODES.PURCHASE_ORDER_NOT_EDITABLE,
      message: PURCHASE_ORDER_ERROR_MESSAGES.NOT_EDITABLE,
      statusCode: 409,
    });
  }

  private notFound(): AppError {
    return new AppError({
      code: ERROR_CODES.PURCHASE_ORDER_NOT_FOUND,
      message: PURCHASE_ORDER_ERROR_MESSAGES.NOT_FOUND,
      statusCode: 404,
    });
  }

  private itemNotFound(): AppError {
    return new AppError({
      code: ERROR_CODES.PURCHASE_ORDER_ITEM_NOT_FOUND,
      message: PURCHASE_ORDER_ERROR_MESSAGES.ITEM_NOT_FOUND,
      statusCode: 404,
    });
  }

  // ---------------------------------------------------------------------------
  // Mapping / snapshots
  // ---------------------------------------------------------------------------

  private basePayload(order: {
    companyId: string;
    id: string;
    number: string;
    supplierId: string;
    status: PurchaseOrderStatus;
    currency: CurrencyCode;
    purchaseType: PurchaseCommercialType | null;
    paymentTermType?: PaymentTermType | null;
    obligationAmount?: Prisma.Decimal | null;
    obligationCurrency?: CurrencyCode | null;
    referenceFxRate?: Prisma.Decimal | null;
    referenceFxBaseCurrency?: CurrencyCode | null;
    referenceFxQuoteCurrency?: CurrencyCode | null;
    dueDate?: Date | null;
    netDays?: number | null;
  }) {
    return {
      companyId: order.companyId,
      purchaseOrderId: order.id,
      number: order.number,
      supplierId: order.supplierId,
      status: order.status,
      currency: order.currency,
      purchaseType: order.purchaseType,
      ...(order.obligationAmount != null
        ? { obligationAmount: order.obligationAmount.toString() }
        : {}),
      ...(order.obligationCurrency != null
        ? { obligationCurrency: order.obligationCurrency }
        : {}),
      ...(order.referenceFxRate != null
        ? { referenceFxRate: order.referenceFxRate.toString() }
        : {}),
      ...(order.referenceFxBaseCurrency != null
        ? { referenceFxBaseCurrency: order.referenceFxBaseCurrency }
        : {}),
      ...(order.referenceFxQuoteCurrency != null
        ? { referenceFxQuoteCurrency: order.referenceFxQuoteCurrency }
        : {}),
      ...(order.paymentTermType != null ? { paymentTermType: order.paymentTermType } : {}),
      ...(order.dueDate != null ? { dueDate: order.dueDate.toISOString() } : {}),
      ...(order.netDays != null ? { netDays: order.netDays } : {}),
    };
  }

  private itemPayload(order: PurchaseOrderDetailRow, item: PurchaseOrderItemRow) {
    return {
      ...this.basePayload(order),
      purchaseOrderItemId: item.id,
      skuId: item.skuId,
      quantity: item.quantity,
      total: order.total.toString(),
    };
  }

  private changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
    return Object.keys(before).filter((key) => !auditSnapshotsEqual(before[key], after[key]));
  }

  private headerSnapshot(order: {
    id: string;
    number: string;
    status: PurchaseOrderStatus;
    supplierId: string;
    supplierContactId: string | null;
    currency: CurrencyCode;
    purchaseType: PurchaseCommercialType | null;
    paymentTermType: PaymentTermType | null;
    netDays: number | null;
    termBasis: PurchaseTermBasis | null;
    dueDate: Date | null;
    paymentTermsNote: string | null;
    obligationAmount: Prisma.Decimal | null;
    obligationCurrency: CurrencyCode | null;
    referenceFxRate: Prisma.Decimal | null;
    referenceFxBaseCurrency: CurrencyCode | null;
    referenceFxQuoteCurrency: CurrencyCode | null;
    referenceFxRateAt: Date | null;
    orderDate: Date;
    expectedAt: Date | null;
    supplierOrderReference: string | null;
    notes: string | null;
    cancellationReason: string | null;
    subtotal: Prisma.Decimal;
    total: Prisma.Decimal;
    supplierNameSnapshot: string | null;
    supplierCodeSnapshot: string | null;
    approvedById: string | null;
    orderedById: string | null;
    cancelledById: string | null;
    approvedAt: Date | null;
    orderedAt: Date | null;
    cancelledAt: Date | null;
  }) {
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      supplierId: order.supplierId,
      supplierContactId: order.supplierContactId,
      currency: order.currency,
      purchaseType: order.purchaseType,
      paymentTermType: order.paymentTermType,
      netDays: order.netDays,
      termBasis: order.termBasis,
      dueDate: order.dueDate?.toISOString() ?? null,
      paymentTermsNote: order.paymentTermsNote,
      obligationAmount: order.obligationAmount?.toString() ?? null,
      obligationCurrency: order.obligationCurrency,
      referenceFxRate: order.referenceFxRate?.toString() ?? null,
      referenceFxBaseCurrency: order.referenceFxBaseCurrency,
      referenceFxQuoteCurrency: order.referenceFxQuoteCurrency,
      referenceFxRateAt: order.referenceFxRateAt?.toISOString() ?? null,
      orderDate: order.orderDate.toISOString(),
      expectedAt: order.expectedAt?.toISOString() ?? null,
      supplierOrderReference: order.supplierOrderReference,
      notes: order.notes,
      cancellationReason: order.cancellationReason,
      subtotal: order.subtotal.toString(),
      total: order.total.toString(),
      supplierNameSnapshot: order.supplierNameSnapshot,
      supplierCodeSnapshot: order.supplierCodeSnapshot,
      approvedById: order.approvedById,
      orderedById: order.orderedById,
      cancelledById: order.cancelledById,
      approvedAt: order.approvedAt?.toISOString() ?? null,
      orderedAt: order.orderedAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
    };
  }

  private itemSnapshot(item: {
    id: string;
    purchaseOrderId: string;
    skuId: string;
    quantity: number;
    unitPrice: Prisma.Decimal;
    lineSubtotal: Prisma.Decimal;
    supplierOfferId: string | null;
    notes: string | null;
    skuCodeSnapshot: string | null;
    productNameSnapshot: string | null;
    variantLabelSnapshot: string | null;
    productIdSnapshot: string | null;
  }) {
    return {
      id: item.id,
      purchaseOrderId: item.purchaseOrderId,
      skuId: item.skuId,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toString(),
      lineSubtotal: item.lineSubtotal.toString(),
      supplierOfferId: item.supplierOfferId,
      notes: item.notes,
      skuCodeSnapshot: item.skuCodeSnapshot,
      productNameSnapshot: item.productNameSnapshot,
      variantLabelSnapshot: item.variantLabelSnapshot,
      productIdSnapshot: item.productIdSnapshot,
    };
  }

  private userView(user: UserRef): UserView {
    return { id: user.id, displayName: `${user.firstName} ${user.lastName}`.trim() };
  }

  private async actorLifecyclePermissions(): Promise<{
    canManage: boolean;
    canApprove: boolean;
    canCancel: boolean;
  }> {
    const memberId = getRequestContext()?.companyMemberId;
    if (!memberId) {
      return { canManage: false, canApprove: false, canCancel: false };
    }
    const keys = await this.authorization.getEffectivePermissions(memberId);
    const set = new Set(keys);
    return {
      canManage: set.has(PERMISSIONS.PURCHASING_MANAGE),
      canApprove: set.has(PERMISSIONS.PURCHASING_APPROVE),
      canCancel: set.has(PERMISSIONS.PURCHASING_CANCEL),
    };
  }

  private toActivityItem(row: {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    createdAt: Date;
    before: Prisma.JsonValue;
    after: Prisma.JsonValue;
    metadata: Prisma.JsonValue;
    actor: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string;
    } | null;
  }) {
    const before =
      row.before && typeof row.before === 'object' && !Array.isArray(row.before)
        ? (row.before as Record<string, unknown>)
        : null;
    const after =
      row.after && typeof row.after === 'object' && !Array.isArray(row.after)
        ? (row.after as Record<string, unknown>)
        : null;
    const changes: Array<{ field: string; before: string | null; after: string | null }> = [];
    if (before || after) {
      const keys = new Set([
        ...Object.keys(before ?? {}),
        ...Object.keys(after ?? {}),
      ]);
      for (const key of keys) {
        if (
          key === 'id' ||
          key === 'updatedAt' ||
          key === 'createdAt' ||
          key === 'version' ||
          key === 'correctionId' ||
          key === 'purchaseOrderId' ||
          key === 'type' ||
          key === 'reason'
        ) {
          continue;
        }
        const from = before?.[key];
        const to = after?.[key];
        if (JSON.stringify(from) === JSON.stringify(to)) continue;
        changes.push({
          field: key,
          before: from === undefined || from === null ? null : String(from),
          after: to === undefined || to === null ? null : String(to),
        });
      }
    }

    let reason: string | null = null;
    if (typeof after?.reason === 'string' && after.reason) reason = after.reason;
    else if (
      typeof after?.cancellationReason === 'string' &&
      after.cancellationReason &&
      after.cancellationReason !== before?.cancellationReason
    ) {
      reason = after.cancellationReason;
    }

    const actorName = row.actor
      ? `${row.actor.firstName ?? ''} ${row.actor.lastName ?? ''}`.trim() ||
        row.actor.email
      : 'سیستم';

    return {
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      createdAt: row.createdAt.toISOString(),
      actor: row.actor
        ? { id: row.actor.id, displayName: actorName }
        : { id: null, displayName: 'سیستم' },
      summary: purchaseOrderActivitySummary(row.action, actorName),
      reason,
      changes: changes.slice(0, 12),
    };
  }

  private commonView(
    row: PurchaseOrderListRow | PurchaseOrderDetailRow,
    lifecyclePermissions: {
      canManage: boolean;
      canApprove: boolean;
      canCancel: boolean;
    },
  ): PurchaseOrderCommonView {
    const isFx = row.purchaseType === PurchaseCommercialType.FX_CREDIT;
    const referenceLocalValuation =
      isFx &&
      row.obligationAmount &&
      row.referenceFxRate &&
      row.referenceFxQuoteCurrency
        ? computeReferenceValuation(
            row.obligationAmount,
            row.referenceFxRate,
            row.referenceFxQuoteCurrency,
          ).toString()
        : null;

    return {
      id: row.id,
      companyId: row.companyId,
      number: row.number,
      status: row.status,
      supplierId: row.supplierId,
      supplierContactId: row.supplierContactId,
      currency: row.currency,
      purchaseType: row.purchaseType,
      paymentTermType: row.paymentTermType,
      netDays: row.netDays,
      termBasis: row.termBasis,
      dueDate: row.dueDate,
      dueStatus: deriveDueStatus(row.dueDate),
      paymentTermsNote: row.paymentTermsNote,
      obligationAmount: row.obligationAmount?.toString() ?? null,
      obligationCurrency: row.obligationCurrency,
      referenceFxRate: row.referenceFxRate?.toString() ?? null,
      referenceFxBaseCurrency: row.referenceFxBaseCurrency,
      referenceFxQuoteCurrency: row.referenceFxQuoteCurrency,
      referenceFxRateAt: row.referenceFxRateAt,
      referenceLocalValuation,
      referenceLocalValuationCurrency: referenceLocalValuation
        ? row.referenceFxQuoteCurrency
        : null,
      settlementBasis: isFx ? FX_PURCHASE_SETTLEMENT_BASIS : null,
      orderDate: row.orderDate,
      expectedAt: row.expectedAt,
      supplierOrderReference: row.supplierOrderReference,
      notes: row.notes,
      cancellationReason: row.cancellationReason,
      availableActions: deriveAvailableActions(row.status, lifecyclePermissions),
      subtotal: row.subtotal.toString(),
      total: row.total.toString(),
      supplierNameSnapshot: row.supplierNameSnapshot,
      supplierCodeSnapshot: row.supplierCodeSnapshot,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      approvedAt: row.approvedAt,
      orderedAt: row.orderedAt,
      cancelledAt: row.cancelledAt,
      version: row.version,
      supplier: row.supplier,
      createdBy: this.userView(row.createdBy),
    };
  }

  private toListView(
    row: PurchaseOrderListRow,
    lifecyclePermissions: {
      canManage: boolean;
      canApprove: boolean;
      canCancel: boolean;
    },
  ): PurchaseOrderListItemView {
    return { ...this.commonView(row, lifecyclePermissions), itemCount: row._count.items };
  }

  private toItemView(item: PurchaseOrderItemRow): PurchaseOrderItemView {
    return {
      id: item.id,
      purchaseOrderId: item.purchaseOrderId,
      skuId: item.skuId,
      quantity: item.quantity,
      closedUnfulfilledQuantity: item.closedUnfulfilledQuantity,
      unitPrice: item.unitPrice.toString(),
      lineSubtotal: item.lineSubtotal.toString(),
      supplierOfferId: item.supplierOfferId,
      notes: item.notes,
      skuCodeSnapshot: item.skuCodeSnapshot,
      productNameSnapshot: item.productNameSnapshot,
      variantLabelSnapshot: item.variantLabelSnapshot,
      productIdSnapshot: item.productIdSnapshot,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      sku: {
        id: item.sku.id,
        code: item.sku.code,
        name: item.sku.name,
        status: item.sku.status,
        product: {
          id: item.sku.product.id,
          name: item.sku.product.name,
          code: item.sku.product.code,
        },
      },
      supplierOffer: item.supplierOffer
        ? {
            id: item.supplierOffer.id,
            unitPrice: item.supplierOffer.unitPrice.toString(),
            currency: item.supplierOffer.currency,
            quotedAt: item.supplierOffer.quotedAt,
            archivedAt: item.supplierOffer.archivedAt,
          }
        : null,
    };
  }

  private async toView(row: PurchaseOrderDetailRow): Promise<PurchaseOrderView> {
    const lifecyclePermissions = await this.actorLifecyclePermissions();
    return {
      ...this.commonView(row, lifecyclePermissions),
      itemCount: row.items.length,
      supplierContact: row.supplierContact,
      approvedBy: row.approvedBy ? this.userView(row.approvedBy) : null,
      orderedBy: row.orderedBy ? this.userView(row.orderedBy) : null,
      cancelledBy: row.cancelledBy ? this.userView(row.cancelledBy) : null,
      items: row.items.map((item) => this.toItemView(item)),
    };
  }
}
