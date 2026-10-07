import { Inject, Injectable, forwardRef } from '@nestjs/common';
import {
  CatalogLifecycleStatus,
  CurrencyCode,
  CustomerReceivableStatus,
  InventoryReservationSourceType,
  InventoryReservationStatus,
  Prisma,
  SalesChannelStatus,
  SalesOrderCancelReason,
  SalesOrderPaymentTermType,
  SalesOrderSource,
  SalesOrderStatus,
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
import { CatalogQueryService } from '../catalog/catalog-query.service';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import type { AuditSnapshot } from '../audit/types/audit.types';
import type { CompanyContext } from '../companies/types/company.types';
import type { CancelSalesOrderDto } from './dto/cancel-sales-order.dto';
import type { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import type { ListSalesOrdersQueryDto } from './dto/list-sales-orders.query.dto';
import type { CancelSalesOrderItemDto, SalesOrderItemInputDto } from './dto/sales-order-item.dto';
import type { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import {
  computeSalesOrderTotals,
  parseSalesOrderNonNegativeMoney,
  parseSalesOrderUnitPrice,
  remainingCancellableQuantity,
} from './sales-order-money';
import {
  allocateSalesOrderSequence,
  formatSalesOrderNumber,
} from './sales-order-numbering';
import {
  fulfillableQuantity,
} from './sales-order-quantities';
import {
  assertSalesOrderEditable,
  assertSalesOrderTransition,
} from './sales-order-status';
import { SalesReservationsService } from './sales-reservations.service';
import {
  SALES_ERROR_MESSAGES,
  SALES_ORDER_MAX_ITEMS,
  SALES_ORDER_NOTES_MAX_LENGTH,
} from './sales.constants';
import { normalizeSearchQuery } from './sales.normalization';

const TX_OPTIONS = { maxWait: 5_000, timeout: 20_000 } as const;

const detailInclude = {
  channel: { select: { id: true, code: true, name: true, type: true, status: true } },
  customer: {
    select: { id: true, code: true, displayName: true, status: true, mobile: true, phone: true },
  },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  items: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    include: {
      sku: {
        select: {
          id: true,
          code: true,
          name: true,
          product: { select: { id: true, name: true, code: true } },
        },
      },
    },
  },
} satisfies Prisma.SalesOrderInclude;

type DetailRow = Prisma.SalesOrderGetPayload<{ include: typeof detailInclude }>;

export type SalesOrderItemQuantities = {
  ordered: number;
  cancelled: number;
  reservedRemaining: number;
  fulfilled: number;
  returned: number;
  remainingToFulfill: number;
};

export type SalesOrderItemView = {
  id: string;
  salesOrderId: string;
  skuId: string;
  quantity: number;
  unitPrice: string;
  discountAmount: string;
  lineSubtotal: string;
  lineNetTotal: string;
  cancelledQuantity: number;
  fulfilledQuantity: number;
  returnedQuantity: number;
  skuCodeSnapshot: string | null;
  productNameSnapshot: string | null;
  variantNameSnapshot: string | null;
  notes: string | null;
  sku: {
    id: string;
    code: string;
    name: string | null;
    product: { id: string; name: string; code: string | null };
  };
};

export type SalesOrderItemDetailView = SalesOrderItemView & {
  quantities: SalesOrderItemQuantities;
};

export type SalesOrderReservationSummary = {
  activeCount: number;
  reservedRemainingTotal: number;
  lines: Array<{
    salesOrderItemId: string;
    reservationId: string;
    warehouseId: string;
    skuId: string;
    remainingQuantity: number;
    status: InventoryReservationStatus;
  }>;
};

export type SalesOrderFulfillmentSummary = {
  count: number;
  items: Array<{
    id: string;
    fulfillmentNumber: string;
    status: string;
    warehouseId: string;
    completedAt: Date | null;
    createdAt: Date;
  }>;
};

export type SalesOrderFinanceSummary = {
  source: 'CustomerReceivable';
  label: string;
  receivableCount: number;
  outstandingTotalByCurrency: Array<{ currency: string; amount: string }>;
  receivables: Array<{
    id: string;
    number: string;
    currency: string;
    amount: string;
    status: string;
    recognizedAt: Date;
    dueDate: Date | null;
    salesFulfillmentId: string | null;
    salesReturnId: string | null;
  }>;
};

export type SalesOrderDetailView = Omit<SalesOrderView, 'items'> & {
  items: SalesOrderItemDetailView[];
  reservationSummary: SalesOrderReservationSummary;
  fulfillmentSummary: SalesOrderFulfillmentSummary;
  financeSummary: SalesOrderFinanceSummary;
};

export type SalesOrderView = {
  id: string;
  companyId: string;
  orderNumber: string;
  channelId: string;
  customerId: string | null;
  status: SalesOrderStatus;
  currency: CurrencyCode;
  paymentTermType: SalesOrderPaymentTermType;
  dueDate: Date | null;
  expectedUpfrontAmount: string | null;
  source: SalesOrderSource;
  externalOrderId: string | null;
  externalReference: string | null;
  customerNameSnapshot: string | null;
  customerPhoneSnapshot: string | null;
  shippingAddressSnapshot: string | null;
  billingAddressSnapshot: string | null;
  subtotal: string;
  itemDiscountTotal: string;
  orderDiscountTotal: string;
  netItemsTotal: string;
  shippingAmount: string;
  otherCharges: string;
  grandTotal: string;
  notes: string | null;
  orderedAt: Date | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: SalesOrderCancelReason | null;
  cancelNotes: string | null;
  requestId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string;
  channel: {
    id: string;
    code: string;
    name: string;
    type: string;
    status: SalesChannelStatus;
  };
  customer: {
    id: string;
    code: string | null;
    displayName: string;
    status: string;
    mobile: string | null;
    phone: string | null;
  } | null;
  createdBy: { id: string; displayName: string };
  items: SalesOrderItemView[];
  inventoryEffect: 'NONE' | 'RESERVED' | 'FULFILLED';
  financeEffect: 'NONE' | 'AR_RECOGNIZED';
};

@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventBus: DomainEventBus,
    private readonly eventFactory: DomainEventFactory,
    private readonly catalogQuery: CatalogQueryService,
    @Inject(forwardRef(() => SalesReservationsService))
    private readonly reservations: SalesReservationsService,
  ) {}

  async list(
    company: CompanyContext,
    query: ListSalesOrdersQueryDto,
  ): Promise<{ data: SalesOrderView[]; meta: PaginationMeta }> {
    const where: Prisma.SalesOrderWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.channelId ? { channelId: query.channelId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.paymentTermType ? { paymentTermType: query.paymentTermType } : {}),
    };
    if (query.from || query.to) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (query.from) dateFilter.gte = new Date(query.from);
      if (query.to) dateFilter.lte = new Date(query.to);
      where.OR = [
        { orderedAt: dateFilter },
        { orderedAt: null, createdAt: dateFilter },
      ];
    }
    const search = normalizeSearchQuery(query.search);
    if (search) {
      const searchOr: Prisma.SalesOrderWhereInput[] = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { externalOrderId: { contains: search, mode: 'insensitive' } },
        { externalReference: { contains: search, mode: 'insensitive' } },
        { customerNameSnapshot: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: searchOr }];
        delete where.OR;
      } else {
        where.OR = searchOr;
      }
    }

    const [total, rows] = await this.database.client.$transaction([
      this.database.client.salesOrder.count({ where }),
      this.database.client.salesOrder.findMany({
        where,
        include: detailInclude,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      data: rows.map((row) => this.toView(row)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, orderId: string): Promise<SalesOrderDetailView> {
    const row = await this.requireOrder(company.companyId, orderId);
    return this.toDetailView(company.companyId, row);
  }

  async getFinance(
    company: CompanyContext,
    orderId: string,
  ): Promise<{
    salesOrderId: string;
    receivables: SalesOrderFinanceSummary['receivables'];
  }> {
    await this.requireOrder(company.companyId, orderId);
    const finance = await this.loadFinanceSummary(company.companyId, orderId);
    return { salesOrderId: orderId, receivables: finance.receivables };
  }

  async create(company: CompanyContext, dto: CreateSalesOrderDto): Promise<SalesOrderView> {
    const actorUserId = this.requireActorUserId();

    if (dto.requestId) {
      const existing = await this.database.client.salesOrder.findFirst({
        where: { companyId: company.companyId, requestId: dto.requestId },
        include: detailInclude,
      });
      if (existing) return this.toView(existing);
    }

    const prepared = await this.prepareOrderInput(company.companyId, dto);

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const created = await this.database.client.$transaction(async (tx) => {
          if (dto.requestId) {
            const raced = await tx.salesOrder.findFirst({
              where: { companyId: company.companyId, requestId: dto.requestId },
              include: detailInclude,
            });
            if (raced) return raced;
          }

          const sequence = await allocateSalesOrderSequence(tx, company.companyId);
          const orderNumber = formatSalesOrderNumber(sequence);

          const order = await tx.salesOrder.create({
            data: {
              companyId: company.companyId,
              orderNumber,
              channelId: prepared.channelId,
              customerId: prepared.customerId,
              status: SalesOrderStatus.DRAFT,
              currency: prepared.currency,
              paymentTermType: prepared.paymentTermType,
              dueDate: prepared.dueDate,
              expectedUpfrontAmount: prepared.expectedUpfrontAmount,
              source: prepared.source,
              externalOrderId: prepared.externalOrderId,
              externalReference: prepared.externalReference,
              customerNameSnapshot: prepared.customerNameSnapshot,
              customerPhoneSnapshot: prepared.customerPhoneSnapshot,
              shippingAddressSnapshot: prepared.shippingAddressSnapshot,
              billingAddressSnapshot: prepared.billingAddressSnapshot,
              subtotal: prepared.totals.subtotal,
              itemDiscountTotal: prepared.totals.itemDiscountTotal,
              orderDiscountTotal: prepared.totals.orderDiscountTotal,
              netItemsTotal: prepared.totals.netItemsTotal,
              shippingAmount: prepared.totals.shippingAmount,
              otherCharges: prepared.totals.otherCharges,
              grandTotal: prepared.totals.grandTotal,
              notes: prepared.notes,
              requestId: dto.requestId ?? null,
              createdById: actorUserId,
            },
            select: { id: true },
          });

          const linesBase = Date.now();
          await tx.salesOrderItem.createMany({
            data: prepared.lines.map((line, index) => ({
              createdAt: new Date(linesBase + index),
              companyId: company.companyId,
              salesOrderId: order.id,
              skuId: line.skuId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountAmount: line.discountAmount,
              lineSubtotal: line.lineSubtotal,
              lineNetTotal: line.lineNetTotal,
              skuCodeSnapshot: line.skuCodeSnapshot,
              productNameSnapshot: line.productNameSnapshot,
              variantNameSnapshot: line.variantNameSnapshot,
              notes: line.notes,
            })),
          });

          const row = await this.requireOrder(company.companyId, order.id, tx);
          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.SALES_ORDER_CREATED,
            entityType: AUDIT_ENTITY_TYPES.SALES_ORDER,
            entityId: row.id,
            before: null,
            after: this.snapshot(row),
          });
          return row;
        }, TX_OPTIONS);

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.SALES_ORDER_CREATED,
            payload: {
              companyId: company.companyId,
              salesOrderId: created.id,
              orderNumber: created.orderNumber,
              status: created.status,
              channelId: created.channelId,
              grandTotal: created.grandTotal.toString(),
            },
          }),
        );
        return this.toView(created);
      } catch (error) {
        this.mapUniqueViolation(error);
      }
    });
  }

  async update(
    company: CompanyContext,
    orderId: string,
    dto: UpdateSalesOrderDto,
  ): Promise<SalesOrderView> {
    const touched =
      dto.channelId !== undefined ||
      dto.customerId !== undefined ||
      dto.currency !== undefined ||
      dto.paymentTermType !== undefined ||
      dto.dueDate !== undefined ||
      dto.expectedUpfrontAmount !== undefined ||
      dto.source !== undefined ||
      dto.externalOrderId !== undefined ||
      dto.externalReference !== undefined ||
      dto.customerNameSnapshot !== undefined ||
      dto.customerPhoneSnapshot !== undefined ||
      dto.shippingAddressSnapshot !== undefined ||
      dto.billingAddressSnapshot !== undefined ||
      dto.orderDiscountTotal !== undefined ||
      dto.shippingAmount !== undefined ||
      dto.otherCharges !== undefined ||
      dto.notes !== undefined ||
      dto.items !== undefined;
    if (!touched) {
      throw AppError.validation('At least one field is required to update the sales order.');
    }

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          const current = await this.requireOrder(company.companyId, orderId, tx);
          assertSalesOrderEditable(current.status);

          const mergedDto: CreateSalesOrderDto = {
            channelId: dto.channelId ?? current.channelId,
            customerId:
              dto.customerId === undefined
                ? (current.customerId ?? undefined)
                : (dto.customerId ?? undefined),
            currency: dto.currency ?? current.currency,
            paymentTermType: dto.paymentTermType ?? current.paymentTermType,
            dueDate:
              dto.dueDate === undefined
                ? (current.dueDate?.toISOString() ?? undefined)
                : (dto.dueDate ?? undefined),
            expectedUpfrontAmount:
              dto.expectedUpfrontAmount === undefined
                ? (current.expectedUpfrontAmount?.toString() ?? undefined)
                : (dto.expectedUpfrontAmount ?? undefined),
            source: dto.source ?? current.source,
            externalOrderId:
              dto.externalOrderId === undefined
                ? (current.externalOrderId ?? undefined)
                : (dto.externalOrderId ?? undefined),
            externalReference:
              dto.externalReference === undefined
                ? (current.externalReference ?? undefined)
                : (dto.externalReference ?? undefined),
            customerNameSnapshot:
              dto.customerNameSnapshot === undefined
                ? (current.customerNameSnapshot ?? undefined)
                : (dto.customerNameSnapshot ?? undefined),
            customerPhoneSnapshot:
              dto.customerPhoneSnapshot === undefined
                ? (current.customerPhoneSnapshot ?? undefined)
                : (dto.customerPhoneSnapshot ?? undefined),
            shippingAddressSnapshot:
              dto.shippingAddressSnapshot === undefined
                ? (current.shippingAddressSnapshot ?? undefined)
                : (dto.shippingAddressSnapshot ?? undefined),
            billingAddressSnapshot:
              dto.billingAddressSnapshot === undefined
                ? (current.billingAddressSnapshot ?? undefined)
                : (dto.billingAddressSnapshot ?? undefined),
            orderDiscountTotal:
              dto.orderDiscountTotal ?? current.orderDiscountTotal.toString(),
            shippingAmount: dto.shippingAmount ?? current.shippingAmount.toString(),
            otherCharges: dto.otherCharges ?? current.otherCharges.toString(),
            notes:
              dto.notes === undefined ? (current.notes ?? undefined) : (dto.notes ?? undefined),
            items:
              dto.items ??
              current.items.map((item) => ({
                skuId: item.skuId,
                quantity: item.quantity,
                unitPrice: item.unitPrice.toString(),
                discountAmount: item.discountAmount.toString(),
                notes: item.notes ?? undefined,
              })),
          };

          const prepared = await this.prepareOrderInput(company.companyId, mergedDto, tx);

          await tx.salesOrder.update({
            where: { id: current.id },
            data: {
              channelId: prepared.channelId,
              customerId: prepared.customerId,
              currency: prepared.currency,
              paymentTermType: prepared.paymentTermType,
              dueDate: prepared.dueDate,
              expectedUpfrontAmount: prepared.expectedUpfrontAmount,
              source: prepared.source,
              externalOrderId: prepared.externalOrderId,
              externalReference: prepared.externalReference,
              customerNameSnapshot: prepared.customerNameSnapshot,
              customerPhoneSnapshot: prepared.customerPhoneSnapshot,
              shippingAddressSnapshot: prepared.shippingAddressSnapshot,
              billingAddressSnapshot: prepared.billingAddressSnapshot,
              subtotal: prepared.totals.subtotal,
              itemDiscountTotal: prepared.totals.itemDiscountTotal,
              orderDiscountTotal: prepared.totals.orderDiscountTotal,
              netItemsTotal: prepared.totals.netItemsTotal,
              shippingAmount: prepared.totals.shippingAmount,
              otherCharges: prepared.totals.otherCharges,
              grandTotal: prepared.totals.grandTotal,
              notes: prepared.notes,
            },
          });

          if (dto.items !== undefined) {
            await tx.salesOrderItem.deleteMany({
              where: { salesOrderId: current.id, companyId: company.companyId },
            });
            const linesBase = Date.now();
            await tx.salesOrderItem.createMany({
              data: prepared.lines.map((line, index) => ({
                createdAt: new Date(linesBase + index),
                companyId: company.companyId,
                salesOrderId: current.id,
                skuId: line.skuId,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                discountAmount: line.discountAmount,
                lineSubtotal: line.lineSubtotal,
                lineNetTotal: line.lineNetTotal,
                skuCodeSnapshot: line.skuCodeSnapshot,
                productNameSnapshot: line.productNameSnapshot,
                variantNameSnapshot: line.variantNameSnapshot,
                notes: line.notes,
              })),
            });
          } else {
            // Recompute existing line money if currency/header-only change without item replace
            for (let i = 0; i < current.items.length; i++) {
              const item = current.items[i]!;
              const line = prepared.lines[i]!;
              await tx.salesOrderItem.update({
                where: { id: item.id },
                data: {
                  unitPrice: line.unitPrice,
                  discountAmount: line.discountAmount,
                  lineSubtotal: line.lineSubtotal,
                  lineNetTotal: line.lineNetTotal,
                },
              });
            }
          }

          const row = await this.requireOrder(company.companyId, current.id, tx);
          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.SALES_ORDER_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.SALES_ORDER,
            entityId: row.id,
            before: this.snapshot(current),
            after: this.snapshot(row),
          });
          return row;
        }, TX_OPTIONS);

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.SALES_ORDER_UPDATED,
            payload: {
              companyId: company.companyId,
              salesOrderId: updated.id,
              orderNumber: updated.orderNumber,
              status: updated.status,
            },
          }),
        );
        return this.toView(updated);
      } catch (error) {
        this.mapUniqueViolation(error);
      }
    });
  }

  async confirm(company: CompanyContext, orderId: string): Promise<SalesOrderView> {
    const view = await commitThenPublish(this.eventBus, async (events) => {
      const confirmed = await this.database.client.$transaction(async (tx) => {
        const current = await this.requireOrder(company.companyId, orderId, tx);
        assertSalesOrderTransition(current.status, SalesOrderStatus.CONFIRMED);
        if (current.items.length === 0) {
          throw new AppError({
            code: ERROR_CODES.SALES_ORDER_EMPTY,
            message: SALES_ERROR_MESSAGES.SALES_ORDER_EMPTY,
            statusCode: 400,
          });
        }
        await this.assertChannelActive(company.companyId, current.channelId, tx);

        const now = new Date();
        await tx.salesOrder.update({
          where: { id: current.id },
          data: {
            status: SalesOrderStatus.CONFIRMED,
            confirmedAt: now,
            orderedAt: current.orderedAt ?? now,
          },
        });

        // Freeze catalog snapshots on confirm if missing
        for (const item of current.items) {
          if (!item.skuCodeSnapshot || !item.productNameSnapshot) {
            await tx.salesOrderItem.update({
              where: { id: item.id },
              data: {
                skuCodeSnapshot: item.skuCodeSnapshot ?? item.sku.code,
                productNameSnapshot: item.productNameSnapshot ?? item.sku.product.name,
                variantNameSnapshot: item.variantNameSnapshot ?? item.sku.name,
              },
            });
          }
        }

        const row = await this.requireOrder(company.companyId, current.id, tx);
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SALES_ORDER_CONFIRMED,
          entityType: AUDIT_ENTITY_TYPES.SALES_ORDER,
          entityId: row.id,
          before: this.snapshot(current),
          after: this.snapshot(row),
        });
        return row;
      }, TX_OPTIONS);

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.SALES_ORDER_CONFIRMED,
          payload: {
            companyId: company.companyId,
            salesOrderId: confirmed.id,
            orderNumber: confirmed.orderNumber,
            status: confirmed.status,
            grandTotal: confirmed.grandTotal.toString(),
          },
        }),
      );
      return this.toView(confirmed);
    });

    // Best-effort reserve after confirm commits (partial OK; never fail confirm).
    try {
      await this.reservations.reserveOrder(company, orderId);
      return this.get(company, orderId);
    } catch {
      return view;
    }
  }

  async cancel(
    company: CompanyContext,
    orderId: string,
    dto: CancelSalesOrderDto,
  ): Promise<SalesOrderView> {
    return commitThenPublish(this.eventBus, async (events) => {
      const cancelled = await this.database.client.$transaction(async (tx) => {
        const current = await this.requireOrder(company.companyId, orderId, tx);
        assertSalesOrderTransition(current.status, SalesOrderStatus.CANCELLED);

        for (const item of current.items) {
          const remaining = remainingCancellableQuantity({
            quantity: item.quantity,
            cancelledQuantity: item.cancelledQuantity,
          });
          if (remaining > 0) {
            await tx.salesOrderItem.update({
              where: { id: item.id },
              data: { cancelledQuantity: item.cancelledQuantity + remaining },
            });
          }
        }

        await tx.salesOrder.update({
          where: { id: current.id },
          data: {
            status: SalesOrderStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelReason: dto.reason,
            cancelNotes: this.normalizeNotes(dto.notes),
          },
        });

        await this.reservations.releaseAllInTx(tx, company.companyId, current.id, events);

        const row = await this.requireOrder(company.companyId, current.id, tx);
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SALES_ORDER_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.SALES_ORDER,
          entityId: row.id,
          before: this.snapshot(current),
          after: this.snapshot(row),
        });
        return row;
      }, TX_OPTIONS);

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.SALES_ORDER_CANCELLED,
          payload: {
            companyId: company.companyId,
            salesOrderId: cancelled.id,
            orderNumber: cancelled.orderNumber,
            status: cancelled.status,
            cancelReason: cancelled.cancelReason,
          },
        }),
      );
      return this.toView(cancelled);
    });
  }

  async cancelItem(
    company: CompanyContext,
    orderId: string,
    itemId: string,
    dto: CancelSalesOrderItemDto,
  ): Promise<SalesOrderView> {
    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const current = await this.requireOrder(company.companyId, orderId, tx);
        if (
          current.status === SalesOrderStatus.DRAFT ||
          current.status === SalesOrderStatus.CANCELLED ||
          current.status === SalesOrderStatus.FULFILLED
        ) {
          throw new AppError({
            code: ERROR_CODES.SALES_ORDER_INVALID_STATUS_TRANSITION,
            message: `Item cancel is not allowed for ${current.status} orders.`,
            statusCode: 409,
          });
        }

        const item = current.items.find((row) => row.id === itemId);
        if (!item) {
          throw new AppError({
            code: ERROR_CODES.SALES_ORDER_ITEM_NOT_FOUND,
            message: SALES_ERROR_MESSAGES.SALES_ORDER_ITEM_NOT_FOUND,
            statusCode: 404,
          });
        }

        const remaining = remainingCancellableQuantity({
          quantity: item.quantity,
          cancelledQuantity: item.cancelledQuantity,
        });
        if (dto.quantity > remaining) {
          throw new AppError({
            code: ERROR_CODES.SALES_ORDER_CANCEL_QUANTITY_INVALID,
            message: SALES_ERROR_MESSAGES.SALES_ORDER_CANCEL_QUANTITY_INVALID,
            statusCode: 400,
          });
        }

        await tx.salesOrderItem.update({
          where: { id: item.id },
          data: {
            cancelledQuantity: item.cancelledQuantity + dto.quantity,
            ...(dto.notes !== undefined
              ? { notes: this.normalizeNotes(dto.notes) ?? item.notes }
              : {}),
          },
        });

        await this.reservations.trimLineReservationsInTx(
          tx,
          company.companyId,
          current.id,
          item.id,
          Math.max(
            0,
            item.quantity - (item.cancelledQuantity + dto.quantity) - item.fulfilledQuantity,
          ),
          events,
        );

        const row = await this.requireOrder(company.companyId, current.id, tx);
        const allCancelled = row.items.every((line) => line.cancelledQuantity >= line.quantity);
        if (allCancelled && row.status !== SalesOrderStatus.CANCELLED) {
          assertSalesOrderTransition(row.status, SalesOrderStatus.CANCELLED);
          await tx.salesOrder.update({
            where: { id: row.id },
            data: {
              status: SalesOrderStatus.CANCELLED,
              cancelledAt: new Date(),
              cancelReason: SalesOrderCancelReason.MANUAL,
              cancelNotes: 'All items cancelled',
            },
          });
        }

        const finalRow = await this.requireOrder(company.companyId, current.id, tx);
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SALES_ORDER_ITEM_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.SALES_ORDER_ITEM,
          entityId: item.id,
          before: { cancelledQuantity: item.cancelledQuantity, quantity: item.quantity },
          after: {
            cancelledQuantity: item.cancelledQuantity + dto.quantity,
            quantity: item.quantity,
            cancelQuantity: dto.quantity,
          },
        });
        return finalRow;
      }, TX_OPTIONS);

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.SALES_ORDER_ITEM_CANCELLED,
          payload: {
            companyId: company.companyId,
            salesOrderId: updated.id,
            salesOrderItemId: itemId,
            cancelQuantity: dto.quantity,
            status: updated.status,
          },
        }),
      );
      return this.toView(updated);
    });
  }

  private async prepareOrderInput(
    companyId: string,
    dto: CreateSalesOrderDto,
    client: Prisma.TransactionClient | DatabaseService['client'] = this.database.client,
  ) {
    if (!dto.items?.length) {
      throw new AppError({
        code: ERROR_CODES.SALES_ORDER_EMPTY,
        message: SALES_ERROR_MESSAGES.SALES_ORDER_EMPTY,
        statusCode: 400,
      });
    }
    if (dto.items.length > SALES_ORDER_MAX_ITEMS) {
      throw AppError.validation(`A sales order can have at most ${SALES_ORDER_MAX_ITEMS} items.`);
    }

    await this.assertChannelActive(companyId, dto.channelId, client);

    let customerNameSnapshot = this.normalizeOptionalText(dto.customerNameSnapshot);
    let customerPhoneSnapshot = this.normalizeOptionalText(dto.customerPhoneSnapshot);
    const customerId: string | null = dto.customerId ?? null;

    if (customerId) {
      const customer = await client.customer.findFirst({
        where: { id: customerId, companyId },
      });
      if (!customer) {
        throw new AppError({
          code: ERROR_CODES.CUSTOMER_NOT_FOUND,
          message: SALES_ERROR_MESSAGES.CUSTOMER_NOT_FOUND,
          statusCode: 404,
        });
      }
      if (customer.status !== 'ACTIVE' && customer.status !== 'INACTIVE') {
        throw new AppError({
          code: ERROR_CODES.SALES_ORDER_CUSTOMER_NOT_ASSIGNABLE,
          message: SALES_ERROR_MESSAGES.SALES_ORDER_CUSTOMER_NOT_ASSIGNABLE,
          statusCode: 409,
        });
      }
      // Inactive customers remain valid for historical; new drafts prefer ACTIVE
      if (customer.status !== 'ACTIVE') {
        throw new AppError({
          code: ERROR_CODES.SALES_ORDER_CUSTOMER_NOT_ASSIGNABLE,
          message: SALES_ERROR_MESSAGES.SALES_ORDER_CUSTOMER_NOT_ASSIGNABLE,
          statusCode: 409,
        });
      }
      customerNameSnapshot = customerNameSnapshot ?? customer.displayName;
      customerPhoneSnapshot =
        customerPhoneSnapshot ?? customer.mobile ?? customer.phone ?? null;
    }

    if (
      dto.paymentTermType === SalesOrderPaymentTermType.PARTIAL &&
      (dto.expectedUpfrontAmount === undefined || dto.expectedUpfrontAmount === null)
    ) {
      throw new AppError({
        code: ERROR_CODES.SALES_ORDER_PARTIAL_REQUIRES_UPFRONT,
        message: SALES_ERROR_MESSAGES.SALES_ORDER_PARTIAL_REQUIRES_UPFRONT,
        statusCode: 400,
      });
    }

    const expectedUpfrontAmount =
      dto.expectedUpfrontAmount !== undefined && dto.expectedUpfrontAmount !== null
        ? parseSalesOrderNonNegativeMoney(dto.expectedUpfrontAmount, dto.currency)
        : null;
    if (
      dto.paymentTermType !== SalesOrderPaymentTermType.PARTIAL &&
      expectedUpfrontAmount !== null
    ) {
      throw AppError.validation('expectedUpfrontAmount is only valid for PARTIAL payment terms.');
    }

    const lineInputs: Array<Awaited<ReturnType<SalesOrdersService['prepareLine']>>> = [];
    for (const item of dto.items) {
      const prepared = await this.prepareLine(companyId, dto.currency, item);
      lineInputs.push(prepared);
    }

    const totals = computeSalesOrderTotals({
      lines: lineInputs,
      orderDiscountTotal: parseSalesOrderNonNegativeMoney(
        dto.orderDiscountTotal ?? '0',
        dto.currency,
      ),
      shippingAmount: parseSalesOrderNonNegativeMoney(dto.shippingAmount ?? '0', dto.currency),
      otherCharges: parseSalesOrderNonNegativeMoney(dto.otherCharges ?? '0', dto.currency),
    });

    return {
      channelId: dto.channelId,
      customerId,
      currency: dto.currency,
      paymentTermType: dto.paymentTermType,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      expectedUpfrontAmount,
      source: dto.source ?? SalesOrderSource.MANUAL,
      externalOrderId: this.normalizeOptionalText(dto.externalOrderId),
      externalReference: this.normalizeOptionalText(dto.externalReference),
      customerNameSnapshot,
      customerPhoneSnapshot,
      shippingAddressSnapshot: this.normalizeOptionalText(dto.shippingAddressSnapshot),
      billingAddressSnapshot: this.normalizeOptionalText(dto.billingAddressSnapshot),
      notes: this.normalizeNotes(dto.notes),
      totals,
      lines: totals.lines.map((line, index) => ({
        ...line,
        skuId: lineInputs[index]!.skuId,
        skuCodeSnapshot: lineInputs[index]!.skuCodeSnapshot,
        productNameSnapshot: lineInputs[index]!.productNameSnapshot,
        variantNameSnapshot: lineInputs[index]!.variantNameSnapshot,
        notes: lineInputs[index]!.notes,
      })),
    };
  }

  private async prepareLine(
    companyId: string,
    currency: CurrencyCode,
    item: SalesOrderItemInputDto,
  ) {
    const sku = await this.catalogQuery.getSkuIdentity(companyId, item.skuId);
    if (
      sku.skuStatus === CatalogLifecycleStatus.ARCHIVED ||
      sku.productStatus === CatalogLifecycleStatus.ARCHIVED
    ) {
      throw new AppError({
        code: ERROR_CODES.SALES_ORDER_SKU_NOT_ASSIGNABLE,
        message: SALES_ERROR_MESSAGES.SALES_ORDER_SKU_NOT_ASSIGNABLE,
        statusCode: 409,
      });
    }
    if (sku.skuStatus !== CatalogLifecycleStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.SALES_ORDER_SKU_NOT_ASSIGNABLE,
        message: SALES_ERROR_MESSAGES.SALES_ORDER_SKU_NOT_ASSIGNABLE,
        statusCode: 409,
      });
    }

    const unitPrice = parseSalesOrderUnitPrice(item.unitPrice, currency);
    const discountAmount = parseSalesOrderNonNegativeMoney(item.discountAmount ?? '0', currency);
    const money = computeSalesOrderTotals({
      lines: [{ quantity: item.quantity, unitPrice, discountAmount }],
    }).lines[0]!;

    return {
      skuId: item.skuId,
      quantity: money.quantity,
      unitPrice: money.unitPrice,
      discountAmount: money.discountAmount,
      lineSubtotal: money.lineSubtotal,
      lineNetTotal: money.lineNetTotal,
      skuCodeSnapshot: sku.skuCode,
      productNameSnapshot: sku.productName,
      variantNameSnapshot: sku.skuName,
      notes: this.normalizeNotes(item.notes),
    };
  }

  private async assertChannelActive(
    companyId: string,
    channelId: string,
    client: Prisma.TransactionClient | DatabaseService['client'],
  ): Promise<void> {
    const channel = await client.salesChannel.findFirst({
      where: { id: channelId, companyId },
    });
    if (!channel) {
      throw new AppError({
        code: ERROR_CODES.SALES_CHANNEL_NOT_FOUND,
        message: SALES_ERROR_MESSAGES.SALES_CHANNEL_NOT_FOUND,
        statusCode: 404,
      });
    }
    if (channel.status !== SalesChannelStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.SALES_ORDER_CHANNEL_NOT_ACTIVE,
        message: SALES_ERROR_MESSAGES.SALES_ORDER_CHANNEL_NOT_ACTIVE,
        statusCode: 409,
      });
    }
  }

  private async requireOrder(
    companyId: string,
    orderId: string,
    client: Prisma.TransactionClient | DatabaseService['client'] = this.database.client,
  ): Promise<DetailRow> {
    const row = await client.salesOrder.findFirst({
      where: { id: orderId, companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.SALES_ORDER_NOT_FOUND,
        message: SALES_ERROR_MESSAGES.SALES_ORDER_NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async toDetailView(
    companyId: string,
    row: DetailRow,
  ): Promise<SalesOrderDetailView> {
    const base = this.toView(row);
    const [reservationSummary, fulfillmentSummary, financeSummary] = await Promise.all([
      this.loadReservationSummary(companyId, row.id),
      this.loadFulfillmentSummary(companyId, row.id),
      this.loadFinanceSummary(companyId, row.id),
    ]);

    const reservedByItem = new Map<string, number>();
    for (const line of reservationSummary.lines) {
      reservedByItem.set(
        line.salesOrderItemId,
        (reservedByItem.get(line.salesOrderItemId) ?? 0) + line.remainingQuantity,
      );
    }

    return {
      ...base,
      items: base.items.map((item) => {
        const reservedRemaining = reservedByItem.get(item.id) ?? 0;
        return {
          ...item,
          quantities: {
            ordered: item.quantity,
            cancelled: item.cancelledQuantity,
            reservedRemaining,
            fulfilled: item.fulfilledQuantity,
            returned: item.returnedQuantity,
            remainingToFulfill: fulfillableQuantity({
              quantity: item.quantity,
              cancelledQuantity: item.cancelledQuantity,
              fulfilledQuantity: item.fulfilledQuantity,
            }),
          },
        };
      }),
      reservationSummary,
      fulfillmentSummary,
      financeSummary,
    };
  }

  private async loadReservationSummary(
    companyId: string,
    salesOrderId: string,
  ): Promise<SalesOrderReservationSummary> {
    const rows = await this.database.client.inventoryReservation.findMany({
      where: {
        companyId,
        sourceType: InventoryReservationSourceType.SALES_ORDER,
        sourceId: salesOrderId,
        status: InventoryReservationStatus.ACTIVE,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        sourceLineId: true,
        warehouseId: true,
        skuId: true,
        remainingQuantity: true,
        status: true,
      },
    });
    return {
      activeCount: rows.length,
      reservedRemainingTotal: rows.reduce((sum, r) => sum + r.remainingQuantity, 0),
      lines: rows.map((r) => ({
        salesOrderItemId: r.sourceLineId,
        reservationId: r.id,
        warehouseId: r.warehouseId,
        skuId: r.skuId,
        remainingQuantity: r.remainingQuantity,
        status: r.status,
      })),
    };
  }

  private async loadFulfillmentSummary(
    companyId: string,
    salesOrderId: string,
  ): Promise<SalesOrderFulfillmentSummary> {
    const items = await this.database.client.salesFulfillment.findMany({
      where: { companyId, salesOrderId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        fulfillmentNumber: true,
        status: true,
        warehouseId: true,
        completedAt: true,
        createdAt: true,
      },
    });
    return { count: items.length, items };
  }

  private async loadFinanceSummary(
    companyId: string,
    salesOrderId: string,
  ): Promise<SalesOrderFinanceSummary> {
    const receivables = await this.database.client.customerReceivable.findMany({
      where: { companyId, salesOrderId },
      orderBy: [{ recognizedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        number: true,
        currency: true,
        amount: true,
        status: true,
        recognizedAt: true,
        dueDate: true,
        salesFulfillmentId: true,
        salesReturnId: true,
      },
    });

    const outstanding = new Map<string, Prisma.Decimal>();
    for (const row of receivables) {
      if (row.status !== CustomerReceivableStatus.OPEN) continue;
      const prev = outstanding.get(row.currency) ?? new Prisma.Decimal(0);
      outstanding.set(row.currency, prev.add(row.amount));
    }

    return {
      source: 'CustomerReceivable',
      label:
        'Finance AR foundation linked by salesOrderId (read-only). Cash settlement is Phase 6.',
      receivableCount: receivables.length,
      outstandingTotalByCurrency: [...outstanding.entries()]
        .map(([currency, amount]) => ({ currency, amount: amount.toString() }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
      receivables: receivables.map((row) => ({
        id: row.id,
        number: row.number,
        currency: row.currency,
        amount: row.amount.toString(),
        status: row.status,
        recognizedAt: row.recognizedAt,
        dueDate: row.dueDate,
        salesFulfillmentId: row.salesFulfillmentId,
        salesReturnId: row.salesReturnId,
      })),
    };
  }

  private toView(row: DetailRow): SalesOrderView {
    return {
      id: row.id,
      companyId: row.companyId,
      orderNumber: row.orderNumber,
      channelId: row.channelId,
      customerId: row.customerId,
      status: row.status,
      currency: row.currency,
      paymentTermType: row.paymentTermType,
      dueDate: row.dueDate,
      expectedUpfrontAmount: row.expectedUpfrontAmount?.toString() ?? null,
      source: row.source,
      externalOrderId: row.externalOrderId,
      externalReference: row.externalReference,
      customerNameSnapshot: row.customerNameSnapshot,
      customerPhoneSnapshot: row.customerPhoneSnapshot,
      shippingAddressSnapshot: row.shippingAddressSnapshot,
      billingAddressSnapshot: row.billingAddressSnapshot,
      subtotal: row.subtotal.toString(),
      itemDiscountTotal: row.itemDiscountTotal.toString(),
      orderDiscountTotal: row.orderDiscountTotal.toString(),
      netItemsTotal: row.netItemsTotal.toString(),
      shippingAmount: row.shippingAmount.toString(),
      otherCharges: row.otherCharges.toString(),
      grandTotal: row.grandTotal.toString(),
      notes: row.notes,
      orderedAt: row.orderedAt,
      confirmedAt: row.confirmedAt,
      cancelledAt: row.cancelledAt,
      cancelReason: row.cancelReason,
      cancelNotes: row.cancelNotes,
      requestId: row.requestId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdById: row.createdById,
      channel: row.channel,
      customer: row.customer,
      createdBy: {
        id: row.createdBy.id,
        displayName: `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim(),
      },
      items: row.items.map((item) => ({
        id: item.id,
        salesOrderId: item.salesOrderId,
        skuId: item.skuId,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toString(),
        discountAmount: item.discountAmount.toString(),
        lineSubtotal: item.lineSubtotal.toString(),
        lineNetTotal: item.lineNetTotal.toString(),
        cancelledQuantity: item.cancelledQuantity,
        fulfilledQuantity: item.fulfilledQuantity,
        returnedQuantity: item.returnedQuantity,
        skuCodeSnapshot: item.skuCodeSnapshot,
        productNameSnapshot: item.productNameSnapshot,
        variantNameSnapshot: item.variantNameSnapshot,
        notes: item.notes,
        sku: item.sku,
      })),
      inventoryEffect:
        row.status === SalesOrderStatus.FULFILLED ||
        row.status === SalesOrderStatus.PARTIALLY_FULFILLED
          ? 'FULFILLED'
          : row.status === SalesOrderStatus.PROCESSING
            ? 'RESERVED'
            : 'NONE',
      financeEffect:
        row.status === SalesOrderStatus.FULFILLED ||
        row.status === SalesOrderStatus.PARTIALLY_FULFILLED
          ? 'AR_RECOGNIZED'
          : 'NONE',
    };
  }

  private snapshot(row: DetailRow): AuditSnapshot {
    return {
      id: row.id,
      orderNumber: row.orderNumber,
      status: row.status,
      channelId: row.channelId,
      customerId: row.customerId,
      currency: row.currency,
      paymentTermType: row.paymentTermType,
      grandTotal: row.grandTotal.toString(),
      itemCount: row.items.length,
      items: row.items.map((item) => ({
        id: item.id,
        skuId: item.skuId,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toString(),
        cancelledQuantity: item.cancelledQuantity,
        returnedQuantity: item.returnedQuantity,
      })),
    };
  }

  private requireActorUserId(): string {
    const userId = getRequestContext()?.userId;
    if (!userId) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Authentication required.',
        statusCode: 401,
      });
    }
    return userId;
  }

  private normalizeNotes(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, SALES_ORDER_NOTES_MAX_LENGTH);
  }

  private normalizeOptionalText(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  private mapUniqueViolation(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const target = String(error.meta?.target ?? '');
      if (target.includes('external_order')) {
        throw new AppError({
          code: ERROR_CODES.SALES_ORDER_EXTERNAL_ORDER_CONFLICT,
          message: SALES_ERROR_MESSAGES.SALES_ORDER_EXTERNAL_ORDER_CONFLICT,
          statusCode: 409,
        });
      }
    }
    throw error;
  }
}
