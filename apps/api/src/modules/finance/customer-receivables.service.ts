import { Injectable } from '@nestjs/common';
import {
  CustomerReceivableCounterpartyType,
  CustomerReceivableStatus,
  Prisma,
  SalesChannelType,
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
  DomainEventFactory,
} from '../../infrastructure/events';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import type { CompanyContext } from '../companies/types/company.types';
import { SALES_ERROR_MESSAGES } from '../sales/sales.constants';
import { allocateSalesRecognition } from '../sales/sales-recognition-allocation';
import {
  allocateCustomerReceivableSequence,
  formatCustomerReceivableNumber,
} from './customer-receivable-numbering';
import { LEDGER_SYSTEM_KEYS } from './finance-journals.constants';
import {
  postSalesArCreditJournalInTx,
  postSalesArRecognitionJournalInTx,
} from './journal-builders';
import { JournalPostingService } from './journal-posting.service';
import { LedgerAccountsService } from './ledger-accounts.service';
import { ensureCompanyChartOfAccounts } from './ledger-coa-seed';

type Tx = Prisma.TransactionClient;

type DomainEvent = ReturnType<DomainEventFactory['create']>;

const detailInclude = {
  customer: { select: { id: true, code: true, displayName: true } },
  channel: { select: { id: true, code: true, name: true, type: true } },
  salesOrder: { select: { id: true, orderNumber: true } },
  salesFulfillment: { select: { id: true, fulfillmentNumber: true } },
  salesReturn: { select: { id: true, returnNumber: true } },
  lines: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] },
} satisfies Prisma.CustomerReceivableInclude;

type DetailRow = Prisma.CustomerReceivableGetPayload<{ include: typeof detailInclude }>;

export type CustomerReceivableView = {
  id: string;
  companyId: string;
  number: string;
  counterpartyType: CustomerReceivableCounterpartyType;
  customerId: string | null;
  channelId: string;
  salesOrderId: string;
  salesFulfillmentId: string | null;
  salesReturnId: string | null;
  currency: string;
  amount: string;
  dueDate: Date | null;
  status: CustomerReceivableStatus;
  recognizedAt: Date;
  notes: string | null;
  requestId: string | null;
  createdAt: Date;
  updatedAt: Date;
  customer: { id: string; code: string | null; displayName: string } | null;
  channel: { id: string; code: string; name: string; type: string };
  salesOrder: { id: string; orderNumber: string };
  salesFulfillment: { id: string; fulfillmentNumber: string } | null;
  salesReturn: { id: string; returnNumber: string } | null;
  lines: Array<{
    id: string;
    salesOrderItemId: string | null;
    salesFulfillmentItemId: string | null;
    skuId: string | null;
    quantity: number;
    amount: string;
    currency: string;
  }>;
};

/**
 * Customer / Channel receivable foundation (Phase 5.3).
 * Recognition on fulfillment complete; credit on physical return receive.
 * Does NOT move bank cash. CASH payment terms still create AR (no fake bank).
 */
@Injectable()
export class CustomerReceivablesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly journals: JournalPostingService,
    private readonly ledger: LedgerAccountsService,
  ) {}

  async list(
    company: CompanyContext,
    query: {
      page?: number;
      pageSize?: number;
      status?: CustomerReceivableStatus;
      customerId?: string;
      channelId?: string;
      salesOrderId?: string;
    },
  ): Promise<{ data: CustomerReceivableView[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.CustomerReceivableWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.channelId ? { channelId: query.channelId } : {}),
      ...(query.salesOrderId ? { salesOrderId: query.salesOrderId } : {}),
    };
    const [total, rows] = await Promise.all([
      this.database.client.customerReceivable.count({ where }),
      this.database.client.customerReceivable.findMany({
        where,
        include: detailInclude,
        orderBy: [{ recognizedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      data: rows.map((r) => this.toView(r)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async get(company: CompanyContext, id: string): Promise<CustomerReceivableView> {
    const row = await this.database.client.customerReceivable.findFirst({
      where: { id, companyId: company.companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.CUSTOMER_RECEIVABLE_NOT_FOUND,
        message: SALES_ERROR_MESSAGES.CUSTOMER_RECEIVABLE_NOT_FOUND,
        statusCode: 404,
      });
    }
    return this.toView(row);
  }

  /**
   * Idempotent fulfillment-scoped recognition. Unique on (companyId, salesFulfillmentId).
   */
  async recognizeFromFulfillmentInTx(
    tx: Tx,
    input: {
      companyId: string;
      actorUserId: string;
      salesFulfillmentId: string;
      requestId?: string | null;
    },
    events?: DomainEvent[],
  ): Promise<DetailRow> {
    const existing = await tx.customerReceivable.findUnique({
      where: {
        salesFulfillmentId_companyId: {
          companyId: input.companyId,
          salesFulfillmentId: input.salesFulfillmentId,
        },
      },
      include: detailInclude,
    });
    if (existing) return existing;

    await ensureCompanyChartOfAccounts(tx, input.companyId, input.actorUserId);

    const fulfillment = await tx.salesFulfillment.findFirst({
      where: { id: input.salesFulfillmentId, companyId: input.companyId },
      include: {
        items: true,
        salesOrder: {
          include: {
            items: true,
            channel: true,
          },
        },
      },
    });
    if (!fulfillment) {
      throw new AppError({
        code: ERROR_CODES.SALES_FULFILLMENT_NOT_FOUND,
        message: SALES_ERROR_MESSAGES.SALES_FULFILLMENT_NOT_FOUND,
        statusCode: 404,
      });
    }

    const priorCompleted = await tx.salesFulfillment.count({
      where: {
        companyId: input.companyId,
        salesOrderId: fulfillment.salesOrderId,
        status: 'COMPLETED',
        id: { not: fulfillment.id },
      },
    });

    const qtyByOrderItem = new Map<string, number>();
    for (const item of fulfillment.items) {
      qtyByOrderItem.set(
        item.salesOrderItemId,
        (qtyByOrderItem.get(item.salesOrderItemId) ?? 0) + item.quantity,
      );
    }

    const allocation = allocateSalesRecognition({
      currency: fulfillment.salesOrder.currency,
      netItemsTotal: fulfillment.salesOrder.netItemsTotal,
      orderDiscountTotal: fulfillment.salesOrder.orderDiscountTotal,
      shippingAmount: fulfillment.salesOrder.shippingAmount,
      otherCharges: fulfillment.salesOrder.otherCharges,
      isFirstFulfillment: priorCompleted === 0,
      orderItems: fulfillment.salesOrder.items
        .filter((oi) => (qtyByOrderItem.get(oi.id) ?? 0) > 0)
        .map((oi) => ({
          salesOrderItemId: oi.id,
          skuId: oi.skuId,
          orderedQuantity: oi.quantity,
          lineNetTotal: oi.lineNetTotal,
          fulfilledQuantity: qtyByOrderItem.get(oi.id) ?? 0,
        })),
      fulfillmentItemLinks: fulfillment.items.map((fi) => ({
        salesFulfillmentItemId: fi.id,
        salesOrderItemId: fi.salesOrderItemId,
        skuId: fi.skuId,
        quantity: fi.quantity,
      })),
    });

    const counterparty = this.resolveCounterparty(
      fulfillment.salesOrder.channel.type,
      fulfillment.salesOrder.customerId,
    );
    const arKey =
      counterparty.type === CustomerReceivableCounterpartyType.CHANNEL
        ? LEDGER_SYSTEM_KEYS.CHANNEL_RECEIVABLE
        : LEDGER_SYSTEM_KEYS.CUSTOMER_RECEIVABLE;

    const seq = await allocateCustomerReceivableSequence(tx, input.companyId);
    const number = formatCustomerReceivableNumber(seq);
    const recognizedAt = fulfillment.completedAt ?? new Date();

    const header = await tx.customerReceivable.create({
      data: {
        companyId: input.companyId,
        number,
        counterpartyType: counterparty.type,
        customerId: counterparty.customerId,
        channelId: fulfillment.salesOrder.channelId,
        salesOrderId: fulfillment.salesOrderId,
        salesFulfillmentId: fulfillment.id,
        currency: fulfillment.salesOrder.currency,
        amount: allocation.totalAmount,
        dueDate: fulfillment.salesOrder.dueDate,
        status: CustomerReceivableStatus.OPEN,
        recognizedAt,
        requestId: input.requestId ?? null,
        createdById: input.actorUserId,
      },
      select: { id: true },
    });

    const lineRows = allocation.lines.filter((l) => l.salesOrderItemId || l.amount.gt(0));
    if (lineRows.length > 0) {
      await tx.customerReceivableLine.createMany({
        data: lineRows.map((l) => ({
          companyId: input.companyId,
          receivableId: header.id,
          salesOrderItemId: l.salesOrderItemId || null,
          salesFulfillmentItemId: l.salesFulfillmentItemId,
          skuId: l.skuId || null,
          quantity: l.quantity,
          amount: l.amount,
          currency: fulfillment.salesOrder.currency,
        })),
      });
    }

    const created = await tx.customerReceivable.findUniqueOrThrow({
      where: { id: header.id },
      include: detailInclude,
    });

    await postSalesArRecognitionJournalInTx(
      tx,
      { journals: this.journals, ledger: this.ledger },
      {
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        salesFulfillmentId: fulfillment.id,
        receivableNumber: number,
        amount: allocation.totalAmount,
        currency: fulfillment.salesOrder.currency,
        effectiveAt: recognizedAt,
        arSystemKey: arKey,
      },
    );

    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.CUSTOMER_RECEIVABLE_RECOGNIZED,
      entityType: AUDIT_ENTITY_TYPES.CUSTOMER_RECEIVABLE,
      entityId: created.id,
      before: null,
      after: {
        number: created.number,
        amount: created.amount.toString(),
        salesFulfillmentId: fulfillment.id,
        counterpartyType: created.counterpartyType,
      },
    });

    events?.push(
      this.eventFactory.create({
        type: DOMAIN_EVENTS.CUSTOMER_RECEIVABLE_RECOGNIZED,
        payload: {
          companyId: input.companyId,
          receivableId: created.id,
          number: created.number,
          salesFulfillmentId: fulfillment.id,
          salesOrderId: fulfillment.salesOrderId,
          amount: created.amount.toString(),
          counterpartyType: created.counterpartyType,
        },
      }),
    );

    return created;
  }

  /**
   * Idempotent return-scoped credit document. Unique on (companyId, salesReturnId).
   * Amount is stored negative; journal DR REVENUE · CR AR.
   */
  async creditFromReturnInTx(
    tx: Tx,
    input: {
      companyId: string;
      actorUserId: string;
      salesReturnId: string;
      requestId?: string | null;
    },
    events?: DomainEvent[],
  ): Promise<DetailRow> {
    const existing = await tx.customerReceivable.findUnique({
      where: {
        salesReturnId_companyId: {
          companyId: input.companyId,
          salesReturnId: input.salesReturnId,
        },
      },
      include: detailInclude,
    });
    if (existing) return existing;

    await ensureCompanyChartOfAccounts(tx, input.companyId, input.actorUserId);

    const salesReturn = await tx.salesReturn.findFirst({
      where: { id: input.salesReturnId, companyId: input.companyId },
      include: {
        items: true,
        salesOrder: {
          include: { items: true, channel: true },
        },
      },
    });
    if (!salesReturn) {
      throw new AppError({
        code: ERROR_CODES.SALES_RETURN_NOT_FOUND,
        message: SALES_ERROR_MESSAGES.SALES_RETURN_NOT_FOUND,
        statusCode: 404,
      });
    }

    // Credit uses same pro-rata policy on returned qty / ordered qty × lineNet (no shipping on credit).
    const allocation = allocateSalesRecognition({
      currency: salesReturn.salesOrder.currency,
      netItemsTotal: salesReturn.salesOrder.netItemsTotal,
      orderDiscountTotal: salesReturn.salesOrder.orderDiscountTotal,
      shippingAmount: new Prisma.Decimal(0),
      otherCharges: new Prisma.Decimal(0),
      isFirstFulfillment: false,
      orderItems: salesReturn.salesOrder.items
        .map((oi) => {
          const returnedQty = salesReturn.items
            .filter((ri) => ri.salesOrderItemId === oi.id)
            .reduce((sum, ri) => sum + ri.quantity, 0);
          return {
            salesOrderItemId: oi.id,
            skuId: oi.skuId,
            orderedQuantity: oi.quantity,
            lineNetTotal: oi.lineNetTotal,
            fulfilledQuantity: returnedQty,
          };
        })
        .filter((oi) => oi.fulfilledQuantity > 0),
      fulfillmentItemLinks: salesReturn.items.map((ri) => ({
        salesFulfillmentItemId: ri.id,
        salesOrderItemId: ri.salesOrderItemId,
        skuId: ri.skuId,
        quantity: ri.quantity,
      })),
    });

    const creditAbs = allocation.totalAmount;
    const counterparty = this.resolveCounterparty(
      salesReturn.salesOrder.channel.type,
      salesReturn.salesOrder.customerId,
    );
    const arKey =
      counterparty.type === CustomerReceivableCounterpartyType.CHANNEL
        ? LEDGER_SYSTEM_KEYS.CHANNEL_RECEIVABLE
        : LEDGER_SYSTEM_KEYS.CUSTOMER_RECEIVABLE;

    const seq = await allocateCustomerReceivableSequence(tx, input.companyId);
    const number = formatCustomerReceivableNumber(seq);
    const recognizedAt = salesReturn.receivedAt ?? new Date();

    const header = await tx.customerReceivable.create({
      data: {
        companyId: input.companyId,
        number,
        counterpartyType: counterparty.type,
        customerId: counterparty.customerId,
        channelId: salesReturn.salesOrder.channelId,
        salesOrderId: salesReturn.salesOrderId,
        salesReturnId: salesReturn.id,
        currency: salesReturn.salesOrder.currency,
        amount: creditAbs.neg(),
        dueDate: null,
        status: CustomerReceivableStatus.CREDITED,
        recognizedAt,
        requestId: input.requestId ?? null,
        createdById: input.actorUserId,
        notes: `Credit for sales return ${salesReturn.returnNumber}`,
      },
      select: { id: true },
    });

    const creditLines = allocation.lines.filter((l) => l.salesOrderItemId);
    if (creditLines.length > 0) {
      await tx.customerReceivableLine.createMany({
        data: creditLines.map((l) => ({
          companyId: input.companyId,
          receivableId: header.id,
          salesOrderItemId: l.salesOrderItemId || null,
          salesFulfillmentItemId: null,
          skuId: l.skuId || null,
          quantity: l.quantity,
          amount: l.amount.neg(),
          currency: salesReturn.salesOrder.currency,
        })),
      });
    }

    const created = await tx.customerReceivable.findUniqueOrThrow({
      where: { id: header.id },
      include: detailInclude,
    });

    await postSalesArCreditJournalInTx(
      tx,
      { journals: this.journals, ledger: this.ledger },
      {
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        salesReturnId: salesReturn.id,
        receivableNumber: number,
        amount: creditAbs,
        currency: salesReturn.salesOrder.currency,
        effectiveAt: recognizedAt,
        arSystemKey: arKey,
      },
    );

    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.CUSTOMER_RECEIVABLE_CREDITED,
      entityType: AUDIT_ENTITY_TYPES.CUSTOMER_RECEIVABLE,
      entityId: created.id,
      before: null,
      after: {
        number: created.number,
        amount: created.amount.toString(),
        salesReturnId: salesReturn.id,
        counterpartyType: created.counterpartyType,
      },
    });

    events?.push(
      this.eventFactory.create({
        type: DOMAIN_EVENTS.CUSTOMER_RECEIVABLE_CREDITED,
        payload: {
          companyId: input.companyId,
          receivableId: created.id,
          number: created.number,
          salesReturnId: salesReturn.id,
          salesOrderId: salesReturn.salesOrderId,
          amount: created.amount.toString(),
          counterpartyType: created.counterpartyType,
        },
      }),
    );

    return created;
  }

  private resolveCounterparty(
    channelType: SalesChannelType,
    customerId: string | null,
  ): { type: CustomerReceivableCounterpartyType; customerId: string | null } {
    if (channelType === SalesChannelType.MARKETPLACE) {
      return { type: CustomerReceivableCounterpartyType.CHANNEL, customerId: null };
    }
    return {
      type: CustomerReceivableCounterpartyType.CUSTOMER,
      customerId,
    };
  }

  private toView(row: DetailRow): CustomerReceivableView {
    return {
      id: row.id,
      companyId: row.companyId,
      number: row.number,
      counterpartyType: row.counterpartyType,
      customerId: row.customerId,
      channelId: row.channelId,
      salesOrderId: row.salesOrderId,
      salesFulfillmentId: row.salesFulfillmentId,
      salesReturnId: row.salesReturnId,
      currency: row.currency,
      amount: row.amount.toString(),
      dueDate: row.dueDate,
      status: row.status,
      recognizedAt: row.recognizedAt,
      notes: row.notes,
      requestId: row.requestId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      customer: row.customer,
      channel: row.channel,
      salesOrder: row.salesOrder,
      salesFulfillment: row.salesFulfillment,
      salesReturn: row.salesReturn,
      lines: row.lines.map((l) => ({
        id: l.id,
        salesOrderItemId: l.salesOrderItemId,
        salesFulfillmentItemId: l.salesFulfillmentItemId,
        skuId: l.skuId,
        quantity: l.quantity,
        amount: l.amount.toString(),
        currency: l.currency,
      })),
    };
  }
}
