import { Injectable } from '@nestjs/common';
import {
  CustomerReceivableStatus,
  Prisma,
  SalesOrderStatus,
  SalesReturnStatus,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { CompanyContext } from '../companies/types/company.types';
import type { SalesDashboardQueryDto } from './dto/sales-dashboard.query.dto';
import {
  COMMITTED_SALES_ORDER_STATUSES,
  DASHBOARD_MAX_RANGE_DAYS,
  DASHBOARD_RECEIVABLES_LIMIT,
  DASHBOARD_RECENT_ORDERS_LIMIT,
  OPEN_RETURN_STATUSES,
  OPEN_SALES_ORDER_STATUSES,
  PENDING_FULFILLMENT_STATUSES,
  resolveSalesDashboardRange,
  type ResolvedSalesDashboardRange,
} from './sales-dashboard.metrics';
import { fulfillableQuantity } from './sales-order-quantities';

type MoneyByCurrency = { currency: string; amount: string; orderCount: number };

function decimalToString(value: Prisma.Decimal | null | undefined): string {
  return (value ?? new Prisma.Decimal(0)).toString();
}

function addMoney(
  map: Map<string, { amount: Prisma.Decimal; orderCount: number }>,
  currency: string,
  amount: Prisma.Decimal | string | number,
  orderCount = 1,
): void {
  const prev = map.get(currency) ?? { amount: new Prisma.Decimal(0), orderCount: 0 };
  map.set(currency, {
    amount: prev.amount.add(new Prisma.Decimal(amount)),
    orderCount: prev.orderCount + orderCount,
  });
}

function moneyMapToRows(
  map: Map<string, { amount: Prisma.Decimal; orderCount: number }>,
): MoneyByCurrency[] {
  return [...map.entries()]
    .map(([currency, row]) => ({
      currency,
      amount: row.amount.toString(),
      orderCount: row.orderCount,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

@Injectable()
export class SalesDashboardService {
  constructor(private readonly database: DatabaseService) {}

  async getDashboard(company: CompanyContext, query: SalesDashboardQueryDto) {
    const companyId = company.companyId;
    let range: ResolvedSalesDashboardRange;
    try {
      range = resolveSalesDashboardRange({
        range: query.range,
        from: query.from,
        to: query.to,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'INVALID_DATE_RANGE';
      if (message === 'DATE_RANGE_TOO_LARGE') {
        throw new AppError({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `Date range cannot exceed ${DASHBOARD_MAX_RANGE_DAYS} days.`,
          statusCode: 400,
        });
      }
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message:
          message === 'CUSTOM_RANGE_REQUIRES_FROM_TO'
            ? 'Custom range requires both from and to.'
            : 'Invalid dashboard date range.',
        statusCode: 400,
      });
    }

    if (query.channelId) {
      const channel = await this.database.client.salesChannel.findFirst({
        where: { id: query.channelId, companyId },
        select: { id: true },
      });
      if (!channel) {
        throw new AppError({
          code: ERROR_CODES.SALES_CHANNEL_NOT_FOUND,
          message: 'Sales channel not found in this company.',
          statusCode: 404,
        });
      }
    }

    const channelFilter = query.channelId ? { channelId: query.channelId } : {};
    const periodWhere: Prisma.SalesOrderWhereInput = {
      companyId,
      ...channelFilter,
      status: { in: [...COMMITTED_SALES_ORDER_STATUSES] },
      OR: [
        { orderedAt: { gte: range.from, lte: range.to } },
        {
          orderedAt: null,
          createdAt: { gte: range.from, lte: range.to },
        },
      ],
    };

    const snapshotBase: Prisma.SalesOrderWhereInput = {
      companyId,
      ...channelFilter,
    };

    const [
      ordersInPeriod,
      openCount,
      confirmedCount,
      processingCount,
      partiallyFulfilledCount,
      pendingFulfillmentOrders,
      openReturnsCount,
      pendingReturnsCount,
      salesByChannelRows,
      recentOrders,
      outstandingReceivables,
      periodItems,
    ] = await Promise.all([
      this.database.client.salesOrder.findMany({
        where: periodWhere,
        select: {
          id: true,
          currency: true,
          grandTotal: true,
          channelId: true,
        },
      }),
      this.database.client.salesOrder.count({
        where: { ...snapshotBase, status: { in: [...OPEN_SALES_ORDER_STATUSES] } },
      }),
      this.database.client.salesOrder.count({
        where: { ...snapshotBase, status: SalesOrderStatus.CONFIRMED },
      }),
      this.database.client.salesOrder.count({
        where: { ...snapshotBase, status: SalesOrderStatus.PROCESSING },
      }),
      this.database.client.salesOrder.count({
        where: { ...snapshotBase, status: SalesOrderStatus.PARTIALLY_FULFILLED },
      }),
      this.database.client.salesOrder.findMany({
        where: {
          ...snapshotBase,
          status: { in: [...PENDING_FULFILLMENT_STATUSES] },
        },
        select: {
          items: {
            select: {
              quantity: true,
              cancelledQuantity: true,
              fulfilledQuantity: true,
            },
          },
        },
      }),
      this.database.client.salesReturn.count({
        where: {
          companyId,
          status: { in: [...OPEN_RETURN_STATUSES] },
          ...(query.channelId
            ? { salesOrder: { channelId: query.channelId } }
            : {}),
        },
      }),
      this.database.client.salesReturn.count({
        where: {
          companyId,
          status: SalesReturnStatus.APPROVED,
          ...(query.channelId
            ? { salesOrder: { channelId: query.channelId } }
            : {}),
        },
      }),
      this.database.client.salesOrder.groupBy({
        by: ['channelId', 'currency'],
        where: periodWhere,
        _count: { _all: true },
        _sum: { grandTotal: true },
      }),
      this.database.client.salesOrder.findMany({
        where: snapshotBase,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: DASHBOARD_RECENT_ORDERS_LIMIT,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          currency: true,
          grandTotal: true,
          createdAt: true,
          orderedAt: true,
          channel: { select: { id: true, code: true, name: true } },
          customer: { select: { id: true, displayName: true } },
        },
      }),
      this.database.client.customerReceivable.findMany({
        where: {
          companyId,
          status: CustomerReceivableStatus.OPEN,
          amount: { gt: 0 },
          ...(query.channelId ? { channelId: query.channelId } : {}),
        },
        orderBy: [{ recognizedAt: 'desc' }, { id: 'desc' }],
        take: DASHBOARD_RECEIVABLES_LIMIT,
        select: {
          id: true,
          number: true,
          currency: true,
          amount: true,
          status: true,
          recognizedAt: true,
          dueDate: true,
          salesOrderId: true,
          channel: { select: { id: true, code: true, name: true } },
          customer: { select: { id: true, displayName: true } },
          salesOrder: { select: { id: true, orderNumber: true } },
        },
      }),
      this.database.client.salesOrderItem.findMany({
        where: {
          companyId,
          salesOrder: periodWhere,
        },
        select: {
          quantity: true,
          cancelledQuantity: true,
          salesOrder: { select: { channelId: true } },
        },
      }),
    ]);

    const salesMap = new Map<string, { amount: Prisma.Decimal; orderCount: number }>();
    for (const order of ordersInPeriod) {
      addMoney(salesMap, order.currency, order.grandTotal, 1);
    }

    const pendingFulfillmentUnits = pendingFulfillmentOrders.reduce((sum, order) => {
      return (
        sum +
        order.items.reduce((lineSum, item) => lineSum + fulfillableQuantity(item), 0)
      );
    }, 0);

    const channelIds = [...new Set(salesByChannelRows.map((r) => r.channelId))];
    const channels =
      channelIds.length === 0
        ? []
        : await this.database.client.salesChannel.findMany({
            where: { companyId, id: { in: channelIds } },
            select: { id: true, code: true, name: true, type: true },
          });
    const channelById = new Map(channels.map((c) => [c.id, c]));

    const unitsByChannel = new Map<string, number>();
    for (const item of periodItems) {
      const openQty = Math.max(0, item.quantity - item.cancelledQuantity);
      const channelId = item.salesOrder.channelId;
      unitsByChannel.set(channelId, (unitsByChannel.get(channelId) ?? 0) + openQty);
    }

    type ChannelAgg = {
      channelId: string;
      code: string;
      name: string;
      orderCount: number;
      salesValue: MoneyByCurrency[];
      units: number;
    };
    const channelAgg = new Map<string, ChannelAgg>();
    for (const row of salesByChannelRows) {
      const channel = channelById.get(row.channelId);
      if (!channel) continue;
      const existing = channelAgg.get(row.channelId) ?? {
        channelId: channel.id,
        code: channel.code,
        name: channel.name,
        orderCount: 0,
        salesValue: [],
        units: unitsByChannel.get(row.channelId) ?? 0,
      };
      existing.orderCount += row._count._all;
      existing.salesValue.push({
        currency: row.currency,
        amount: decimalToString(row._sum.grandTotal),
        orderCount: row._count._all,
      });
      channelAgg.set(row.channelId, existing);
    }

    const salesByChannel = [...channelAgg.values()]
      .map((row) => ({
        ...row,
        salesValue: row.salesValue.sort((a, b) => a.currency.localeCompare(b.currency)),
      }))
      .sort((a, b) => b.orderCount - a.orderCount || a.code.localeCompare(b.code));

    return {
      meta: {
        range: {
          preset: range.preset,
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          dayCount: range.dayCount,
        },
        channelId: query.channelId ?? null,
        labels: {
          outstandingReceivables:
            'Finance truth (CustomerReceivable OPEN) — not a Sales debt store; settlement is Phase 6.',
          salesValue: 'Committed order grand totals in period (DRAFT/CANCELLED excluded).',
          pendingFulfillmentEstimate:
            'Sum of open unfulfilled quantities on CONFIRMED/PROCESSING/PARTIALLY_FULFILLED orders.',
        },
      },
      snapshot: {
        openOrders: openCount,
        confirmedOrders: confirmedCount,
        processingOrders: processingCount,
        partiallyFulfilledOrders: partiallyFulfilledCount,
        pendingFulfillmentUnits,
        openReturns: openReturnsCount,
        pendingReturns: pendingReturnsCount,
      },
      period: {
        ordersCount: ordersInPeriod.length,
        salesByCurrency: moneyMapToRows(salesMap),
      },
      salesByChannel,
      recentOrders: recentOrders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        currency: order.currency,
        grandTotal: order.grandTotal.toString(),
        createdAt: order.createdAt,
        orderedAt: order.orderedAt,
        channel: order.channel,
        customer: order.customer,
      })),
      outstandingReceivables: {
        source: 'CustomerReceivable' as const,
        label:
          'Outstanding AR foundation from Finance (OPEN, amount > 0). Cash settlement is Phase 6.',
        items: outstandingReceivables.map((row) => ({
          id: row.id,
          number: row.number,
          currency: row.currency,
          amount: row.amount.toString(),
          status: row.status,
          recognizedAt: row.recognizedAt,
          dueDate: row.dueDate,
          salesOrderId: row.salesOrderId,
          salesOrderNumber: row.salesOrder.orderNumber,
          channel: row.channel,
          customer: row.customer,
        })),
      },
    };
  }
}
