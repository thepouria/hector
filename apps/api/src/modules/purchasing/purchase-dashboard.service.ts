import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  Prisma,
  PurchaseCommercialType,
  PurchaseCostStatus,
  PurchaseDiscrepancyStatus,
  PurchaseOrderStatus,
  PurchaseReturnStatus,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { CompanyContext } from '../companies/types/company.types';
import {
  COMMITTED_PURCHASE_STATUSES,
  DASHBOARD_AGING_ORDERED_DAYS,
  DASHBOARD_ATTENTION_LIMIT,
  DASHBOARD_LIST_LIMIT,
  DASHBOARD_SUPPLIER_LIMIT,
  OPEN_PURCHASE_STATUSES,
  UNFULFILLED_PURCHASE_STATUSES,
  daysRemainingLabel,
  dueBucket,
  resolveDashboardRange,
  trendBucketKey,
  type DueBucket,
  type ResolvedDashboardRange,
} from './purchase-dashboard.metrics';
import type { PurchasingDashboardQueryDto } from './dto/purchasing-dashboard.query.dto';
import { toUtcBusinessDate, utcCalendarDaysBetween } from './purchase-order-due';
import { PURCHASE_ORDER_DUE_SOON_DAYS } from './purchasing.constants';

type MoneyByCurrency = { currency: CurrencyCode; amount: string; poCount: number };

function decimalToString(value: Prisma.Decimal | null | undefined): string {
  return (value ?? new Prisma.Decimal(0)).toString();
}

function addDecimal(
  map: Map<string, Prisma.Decimal>,
  currency: string,
  amount: Prisma.Decimal | string | number,
): void {
  const prev = map.get(currency) ?? new Prisma.Decimal(0);
  map.set(currency, prev.add(new Prisma.Decimal(amount)));
}

@Injectable()
export class PurchaseDashboardService {
  constructor(private readonly database: DatabaseService) {}

  async getDashboard(company: CompanyContext, query: PurchasingDashboardQueryDto) {
    const companyId = company.companyId;
    let range: ResolvedDashboardRange;
    try {
      range = resolveDashboardRange({
        range: query.range,
        from: query.from,
        to: query.to,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'INVALID_DATE_RANGE';
      if (message === 'DATE_RANGE_TOO_LARGE') {
        throw new AppError({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `Date range cannot exceed ${366} days.`,
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

    if (query.supplierId) {
      const supplier = await this.database.client.supplier.findFirst({
        where: { id: query.supplierId, companyId },
        select: { id: true },
      });
      if (!supplier) {
        throw new AppError({
          code: ERROR_CODES.SUPPLIER_NOT_FOUND,
          message: 'Supplier not found in this company.',
          statusCode: 404,
        });
      }
    }

    const now = new Date();
    const today = toUtcBusinessDate(now);
    const todayStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0),
    );
    const dueSoonEnd = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() + PURCHASE_ORDER_DUE_SOON_DAYS,
        23,
        59,
        59,
        999,
      ),
    );
    const due30End = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() + 30,
        23,
        59,
        59,
        999,
      ),
    );

    const analyticsWhere: Prisma.PurchaseOrderWhereInput = {
      companyId,
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.purchaseType ? { purchaseType: query.purchaseType } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
      orderDate: { gte: range.from, lte: range.to },
      status: query.status
        ? query.status
        : { in: [...COMMITTED_PURCHASE_STATUSES] },
    };

    const previousAnalyticsWhere: Prisma.PurchaseOrderWhereInput = {
      ...analyticsWhere,
      orderDate: { gte: range.previousFrom, lte: range.previousTo },
    };

    const openWhere: Prisma.PurchaseOrderWhereInput = {
      companyId,
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.purchaseType ? { purchaseType: query.purchaseType } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
      status: query.status
        ? query.status
        : { in: [...OPEN_PURCHASE_STATUSES] },
      // Operational snapshot — not limited by analytics period (labeled in response.meta).
    };

    const [
      openCount,
      draftCount,
      dueSoonCount,
      duePassedCount,
      periodPoCount,
      previousPeriodPoCount,
      localMerchandiseGroups,
      previousLocalMerchandiseGroups,
      fxObligationRows,
      previousFxObligationRows,
      costGroups,
      commercialIrrCostGroups,
      previousCommercialIrrCostGroups,
      purchaseTypeGroups,
      currencyGroups,
      supplierGroups,
      openPurchases,
      upcomingDueRows,
      unfulfilledRows,
      draftReturns,
      openDiscrepancies,
      agingOrdered,
      activityRows,
      activeSuppliersInPeriod,
    ] = await Promise.all([
      this.database.client.purchaseOrder.count({ where: openWhere }),
      this.database.client.purchaseOrder.count({
        where: {
          companyId,
          status: PurchaseOrderStatus.DRAFT,
          ...(query.supplierId ? { supplierId: query.supplierId } : {}),
          ...(query.purchaseType ? { purchaseType: query.purchaseType } : {}),
          ...(query.currency ? { currency: query.currency } : {}),
        },
      }),
      this.database.client.purchaseOrder.count({
        where: {
          ...openWhere,
          status: { in: [...OPEN_PURCHASE_STATUSES] },
          dueDate: { gte: todayStart, lte: dueSoonEnd },
        },
      }),
      this.database.client.purchaseOrder.count({
        where: {
          ...openWhere,
          status: { in: [...OPEN_PURCHASE_STATUSES] },
          dueDate: { lt: todayStart },
        },
      }),
      this.database.client.purchaseOrder.count({ where: analyticsWhere }),
      this.database.client.purchaseOrder.count({ where: previousAnalyticsWhere }),
      this.database.client.purchaseOrder.groupBy({
        by: ['currency'],
        where: {
          ...analyticsWhere,
          ...(query.purchaseType === PurchaseCommercialType.FX_CREDIT
            ? { id: { in: [] } }
            : {
                purchaseType: query.purchaseType
                  ? query.purchaseType
                  : {
                      in: [
                        PurchaseCommercialType.CASH,
                        PurchaseCommercialType.TERM_CREDIT,
                      ],
                    },
                currency: query.currency ?? CurrencyCode.IRR,
              }),
        },
        _sum: { subtotal: true },
        _count: { _all: true },
      }),
      this.database.client.purchaseOrder.groupBy({
        by: ['currency'],
        where: {
          ...previousAnalyticsWhere,
          ...(query.purchaseType === PurchaseCommercialType.FX_CREDIT
            ? { id: { in: [] } }
            : {
                purchaseType: query.purchaseType
                  ? query.purchaseType
                  : {
                      in: [
                        PurchaseCommercialType.CASH,
                        PurchaseCommercialType.TERM_CREDIT,
                      ],
                    },
                currency: query.currency ?? CurrencyCode.IRR,
              }),
        },
        _sum: { subtotal: true },
        _count: { _all: true },
      }),
      this.database.client.purchaseOrder.findMany({
        where:
          query.purchaseType &&
          query.purchaseType !== PurchaseCommercialType.FX_CREDIT
            ? { id: { in: [] } }
            : {
                ...analyticsWhere,
                purchaseType: PurchaseCommercialType.FX_CREDIT,
                obligationAmount: { not: null },
                obligationCurrency: { not: null },
              },
        select: {
          obligationAmount: true,
          obligationCurrency: true,
          referenceFxRate: true,
          referenceFxQuoteCurrency: true,
        },
      }),
      this.database.client.purchaseOrder.findMany({
        where:
          query.purchaseType &&
          query.purchaseType !== PurchaseCommercialType.FX_CREDIT
            ? { id: { in: [] } }
            : {
                ...previousAnalyticsWhere,
                purchaseType: PurchaseCommercialType.FX_CREDIT,
                obligationAmount: { not: null },
                obligationCurrency: { not: null },
              },
        select: {
          obligationAmount: true,
          obligationCurrency: true,
          referenceFxRate: true,
          referenceFxQuoteCurrency: true,
        },
      }),
      this.database.client.purchaseOrderCost.groupBy({
        by: ['currency'],
        where: {
          companyId,
          status: PurchaseCostStatus.ACTIVE,
          purchaseOrder: analyticsWhere,
        },
        _sum: { amount: true },
      }),
      // IRR costs on CASH/TERM only — never fold FX courier IRR into local commercial value.
      this.database.client.purchaseOrderCost.groupBy({
        by: ['currency'],
        where: {
          companyId,
          status: PurchaseCostStatus.ACTIVE,
          currency: CurrencyCode.IRR,
          purchaseOrder: {
            ...analyticsWhere,
            ...(query.purchaseType === PurchaseCommercialType.FX_CREDIT
              ? { id: { in: [] } }
              : {
                  purchaseType: query.purchaseType
                    ? query.purchaseType
                    : {
                        in: [
                          PurchaseCommercialType.CASH,
                          PurchaseCommercialType.TERM_CREDIT,
                        ],
                      },
                }),
          },
        },
        _sum: { amount: true },
      }),
      this.database.client.purchaseOrderCost.groupBy({
        by: ['currency'],
        where: {
          companyId,
          status: PurchaseCostStatus.ACTIVE,
          currency: CurrencyCode.IRR,
          purchaseOrder: {
            ...previousAnalyticsWhere,
            ...(query.purchaseType === PurchaseCommercialType.FX_CREDIT
              ? { id: { in: [] } }
              : {
                  purchaseType: query.purchaseType
                    ? query.purchaseType
                    : {
                        in: [
                          PurchaseCommercialType.CASH,
                          PurchaseCommercialType.TERM_CREDIT,
                        ],
                      },
                }),
          },
        },
        _sum: { amount: true },
      }),
      this.database.client.purchaseOrder.groupBy({
        by: ['purchaseType'],
        where: analyticsWhere,
        _count: { _all: true },
        _sum: { subtotal: true },
      }),
      this.database.client.purchaseOrder.groupBy({
        by: ['currency'],
        where: analyticsWhere,
        _count: { _all: true },
        _sum: { subtotal: true },
      }),
      this.database.client.purchaseOrder.groupBy({
        by: ['supplierId', 'currency'],
        where: analyticsWhere,
        _count: { _all: true },
        _sum: { subtotal: true },
        orderBy: { _sum: { subtotal: 'desc' } },
        take: 40,
      }),
      this.database.client.purchaseOrder.findMany({
        where: {
          ...openWhere,
          status: { in: [...OPEN_PURCHASE_STATUSES] },
        },
        orderBy: [{ dueDate: 'asc' }, { orderDate: 'desc' }],
        take: DASHBOARD_LIST_LIMIT,
        select: {
          id: true,
          number: true,
          status: true,
          purchaseType: true,
          currency: true,
          subtotal: true,
          total: true,
          obligationAmount: true,
          obligationCurrency: true,
          orderDate: true,
          dueDate: true,
          orderedAt: true,
          supplier: { select: { id: true, name: true, code: true } },
        },
      }),
      this.database.client.purchaseOrder.findMany({
        where: {
          companyId,
          ...(query.supplierId ? { supplierId: query.supplierId } : {}),
          ...(query.purchaseType ? { purchaseType: query.purchaseType } : {}),
          ...(query.currency ? { currency: query.currency } : {}),
          status: { in: [...OPEN_PURCHASE_STATUSES] },
          dueDate: { not: null, lte: due30End },
        },
        orderBy: [{ dueDate: 'asc' }],
        take: 40,
        select: {
          id: true,
          number: true,
          status: true,
          purchaseType: true,
          currency: true,
          subtotal: true,
          obligationAmount: true,
          obligationCurrency: true,
          dueDate: true,
          supplier: { select: { id: true, name: true, code: true } },
        },
      }),
      this.database.client.purchaseOrder.findMany({
        where: {
          companyId,
          ...(query.supplierId ? { supplierId: query.supplierId } : {}),
          ...(query.purchaseType ? { purchaseType: query.purchaseType } : {}),
          ...(query.currency ? { currency: query.currency } : {}),
          status: { in: [...UNFULFILLED_PURCHASE_STATUSES] },
        },
        orderBy: [{ orderedAt: 'asc' }, { orderDate: 'asc' }],
        take: DASHBOARD_LIST_LIMIT,
        select: {
          id: true,
          number: true,
          status: true,
          orderDate: true,
          orderedAt: true,
          _count: { select: { items: true } },
          supplier: { select: { id: true, name: true, code: true } },
        },
      }),
      this.database.client.purchaseReturn.findMany({
        where: {
          companyId,
          status: PurchaseReturnStatus.DRAFT,
          ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 5,
        select: {
          id: true,
          number: true,
          createdAt: true,
          supplier: { select: { id: true, name: true } },
          purchaseOrder: { select: { id: true, number: true } },
        },
      }),
      this.database.client.purchaseDiscrepancy.findMany({
        where: {
          companyId,
          status: PurchaseDiscrepancyStatus.OPEN,
          ...(query.supplierId
            ? { purchaseOrder: { supplierId: query.supplierId } }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 5,
        select: {
          id: true,
          type: true,
          createdAt: true,
          purchaseOrder: {
            select: {
              id: true,
              number: true,
              supplier: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.database.client.purchaseOrder.findMany({
        where: {
          companyId,
          status: PurchaseOrderStatus.ORDERED,
          orderedAt: {
            lte: new Date(
              Date.UTC(
                today.getUTCFullYear(),
                today.getUTCMonth(),
                today.getUTCDate() - DASHBOARD_AGING_ORDERED_DAYS,
                23,
                59,
                59,
                999,
              ),
            ),
          },
          ...(query.supplierId ? { supplierId: query.supplierId } : {}),
          ...(query.purchaseType ? { purchaseType: query.purchaseType } : {}),
          ...(query.currency ? { currency: query.currency } : {}),
        },
        orderBy: [{ orderedAt: 'asc' }],
        take: 5,
        select: {
          id: true,
          number: true,
          orderedAt: true,
          supplier: { select: { id: true, name: true } },
        },
      }),
      this.database.client.auditLog.findMany({
        where: {
          companyId,
          entityType: {
            in: ['PURCHASE_ORDER', 'PURCHASE_RETURN', 'PURCHASE_ORDER_CORRECTION'],
          },
          createdAt: { gte: range.from, lte: range.to },
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 15,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          actor: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.database.client.purchaseOrder.findMany({
        where: analyticsWhere,
        distinct: ['supplierId'],
        select: { supplierId: true },
      }),
    ]);

    // Local merchandise (IRR CASH/TERM by default)
    const localMerchandise = localMerchandiseGroups.map((g) => ({
      currency: g.currency,
      amount: decimalToString(g._sum.subtotal),
      poCount: g._count._all,
    }));
    const previousLocalMerchandise = previousLocalMerchandiseGroups.map((g) => ({
      currency: g.currency,
      amount: decimalToString(g._sum.subtotal),
      poCount: g._count._all,
    }));

    const costsByCurrency: MoneyByCurrency[] = costGroups.map((g) => ({
      currency: g.currency,
      amount: decimalToString(g._sum.amount),
      poCount: 0,
    }));

    const commercialIrrCosts: MoneyByCurrency[] = commercialIrrCostGroups.map((g) => ({
      currency: g.currency,
      amount: decimalToString(g._sum.amount),
      poCount: 0,
    }));
    const previousCommercialIrrCosts: MoneyByCurrency[] = previousCommercialIrrCostGroups.map(
      (g) => ({
        currency: g.currency,
        amount: decimalToString(g._sum.amount),
        poCount: 0,
      }),
    );

    const localCommercialValue = this.mergeSameCurrency(localMerchandise, commercialIrrCosts);
    const previousLocalCommercialValue = this.mergeSameCurrency(
      previousLocalMerchandise,
      previousCommercialIrrCosts,
    );

    const fxObligations = this.sumFxObligations(fxObligationRows);
    const previousFxObligations = this.sumFxObligations(previousFxObligationRows);
    const fxReferenceLocal = this.sumFxReferenceLocal(fxObligationRows);

    // Trend from period committed rows (bounded by date range + max days)
    const trendSource = await this.database.client.purchaseOrder.findMany({
      where: analyticsWhere,
      select: {
        orderDate: true,
        currency: true,
        purchaseType: true,
        subtotal: true,
        obligationAmount: true,
        obligationCurrency: true,
      },
    });
    const trend = this.buildTrend(trendSource, range);

    const supplierIds = [...new Set(supplierGroups.map((g) => g.supplierId))];
    const suppliers = supplierIds.length
      ? await this.database.client.supplier.findMany({
          where: { companyId, id: { in: supplierIds } },
          select: { id: true, name: true, code: true },
        })
      : [];
    const supplierName = new Map(suppliers.map((s) => [s.id, s]));

    const irrMerchandiseTotal = new Prisma.Decimal(
      localMerchandise.find((r) => r.currency === CurrencyCode.IRR)?.amount ?? '0',
    );

    const fxBySupplierGroups = await this.database.client.purchaseOrder.groupBy({
      by: ['supplierId', 'obligationCurrency'],
      where: {
        ...analyticsWhere,
        purchaseType: PurchaseCommercialType.FX_CREDIT,
        obligationCurrency: { not: null },
      },
      _sum: { obligationAmount: true },
      _count: { _all: true },
    });

    const supplierBreakdown = this.buildSupplierBreakdown(
      supplierGroups,
      supplierName,
      irrMerchandiseTotal,
      fxBySupplierGroups,
    );

    const attention = this.buildAttention({
      approvedNotOrdered: await this.database.client.purchaseOrder.findMany({
        where: {
          companyId,
          status: PurchaseOrderStatus.APPROVED,
          ...(query.supplierId ? { supplierId: query.supplierId } : {}),
          ...(query.purchaseType ? { purchaseType: query.purchaseType } : {}),
          ...(query.currency ? { currency: query.currency } : {}),
        },
        orderBy: [{ approvedAt: 'asc' }],
        take: 5,
        select: {
          id: true,
          number: true,
          approvedAt: true,
          supplier: { select: { id: true, name: true } },
        },
      }),
      dueSoon: upcomingDueRows
        .filter((r) => r.dueDate && r.dueDate >= todayStart && r.dueDate <= dueSoonEnd)
        .slice(0, 5),
      duePassed: upcomingDueRows.filter((r) => r.dueDate && r.dueDate < todayStart).slice(0, 5),
      draftReturns,
      openDiscrepancies,
      agingOrdered,
      today,
    });

    const dueBuckets = this.buildDueBuckets(upcomingDueRows, today);

    return {
      meta: {
        range: {
          preset: range.preset,
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          dayCount: range.dayCount,
          granularity: range.granularity,
          previousFrom: range.previousFrom.toISOString(),
          previousTo: range.previousTo.toISOString(),
          /** Analytics period uses PurchaseOrder.orderDate (commercial order date). */
          dateBasis: 'orderDate' as const,
        },
        filters: {
          supplierId: query.supplierId ?? null,
          purchaseType: query.purchaseType ?? null,
          status: query.status ?? null,
          currency: query.currency ?? null,
        },
        definitions: {
          openPurchase: 'APPROVED + ORDERED + PARTIALLY_RECEIVED',
          committedPurchase: 'APPROVED + ORDERED + PARTIALLY_RECEIVED + RECEIVED',
          localPurchaseValue:
            'IRR merchandise subtotal (CASH/TERM_CREDIT) + ACTIVE IRR costs on those same CASH/TERM POs; FX courier IRR stays in localPurchaseCostsByCurrency only; excludes DRAFT/CANCELLED; returns do not reduce value',
          unfulfilledPurchase:
            'ORDERED + PARTIALLY_RECEIVED (lifecycle-only Phase 2 placeholder; Warehouse qty later)',
          foreignObligation: 'FX_CREDIT obligationAmount grouped by obligationCurrency',
          fxReferenceLocal:
            'obligationAmount × referenceFxRate when quote currency is IRR — reference only, not settlement',
          unfulfilled:
            'ORDERED + PARTIALLY_RECEIVED (lifecycle-only Phase 2 placeholder; Warehouse qty later)',
          due: 'Contractual purchase dueDate — not payment state',
        },
        financeKpis: 'DEFERRED_TO_FINANCE' as const,
        inventoryKpis: 'DEFERRED_TO_WAREHOUSE' as const,
        operationalSectionsScope: 'current_snapshot' as const,
        analyticsSectionsScope: 'selected_period_orderDate' as const,
      },
      kpis: {
        openPurchaseCount: openCount,
        draftPurchaseCount: draftCount,
        periodCommittedPoCount: periodPoCount,
        previousPeriodCommittedPoCount: previousPeriodPoCount,
        localMerchandiseByCurrency: localMerchandise,
        localPurchaseCostsByCurrency: costsByCurrency,
        localCommercialValueByCurrency: localCommercialValue,
        previousLocalCommercialValueByCurrency: previousLocalCommercialValue,
        foreignObligationsByCurrency: fxObligations,
        previousForeignObligationsByCurrency: previousFxObligations,
        fxReferenceLocalValueByCurrency: fxReferenceLocal,
        upcomingDueCount: dueSoonCount,
        dueDatePassedCount: duePassedCount,
        activeSupplierCountInPeriod: activeSuppliersInPeriod.length,
      },
      attention,
      openPurchases: openPurchases.map((po) => this.mapPoRow(po, today)),
      upcomingDue: dueBuckets,
      unfulfilled: unfulfilledRows.map((po) => ({
        id: po.id,
        number: po.number,
        status: po.status,
        orderDate: po.orderDate.toISOString(),
        orderedAt: po.orderedAt?.toISOString() ?? null,
        daysSinceOrder: po.orderedAt
          ? Math.max(0, utcCalendarDaysBetween(toUtcBusinessDate(po.orderedAt), today))
          : Math.max(0, utcCalendarDaysBetween(toUtcBusinessDate(po.orderDate), today)),
        itemCount: po._count.items,
        supplier: po.supplier,
        phase2Note:
          'Not fully completed by Purchasing lifecycle only — received quantities require Warehouse.',
      })),
      trend,
      supplierBreakdown,
      purchaseTypeBreakdown: purchaseTypeGroups.map((g) => ({
        purchaseType: g.purchaseType,
        poCount: g._count._all,
        merchandiseSubtotal: decimalToString(g._sum.subtotal),
      })),
      currencyBreakdown: currencyGroups.map((g) => ({
        currency: g.currency,
        poCount: g._count._all,
        merchandiseSubtotal: decimalToString(g._sum.subtotal),
      })),
      recentActivity: activityRows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        createdAt: row.createdAt.toISOString(),
        actor: row.actor
          ? {
              id: row.actor.id,
              displayName: `${row.actor.firstName} ${row.actor.lastName}`.trim(),
            }
          : null,
      })),
    };
  }

  private mergeSameCurrency(
    merchandise: MoneyByCurrency[],
    costs: MoneyByCurrency[],
  ): MoneyByCurrency[] {
    const map = new Map<string, { amount: Prisma.Decimal; poCount: number }>();
    for (const row of merchandise) {
      map.set(row.currency, {
        amount: new Prisma.Decimal(row.amount),
        poCount: row.poCount,
      });
    }
    for (const row of costs) {
      const prev = map.get(row.currency) ?? {
        amount: new Prisma.Decimal(0),
        poCount: 0,
      };
      map.set(row.currency, {
        amount: prev.amount.add(row.amount),
        poCount: prev.poCount,
      });
    }
    return [...map.entries()].map(([currency, v]) => ({
      currency: currency as CurrencyCode,
      amount: v.amount.toString(),
      poCount: v.poCount,
    }));
  }

  private sumFxObligations(
    rows: Array<{
      obligationAmount: Prisma.Decimal | null;
      obligationCurrency: CurrencyCode | null;
    }>,
  ): MoneyByCurrency[] {
    const map = new Map<string, { amount: Prisma.Decimal; poCount: number }>();
    for (const row of rows) {
      if (!row.obligationAmount || !row.obligationCurrency) continue;
      const prev = map.get(row.obligationCurrency) ?? {
        amount: new Prisma.Decimal(0),
        poCount: 0,
      };
      map.set(row.obligationCurrency, {
        amount: prev.amount.add(row.obligationAmount),
        poCount: prev.poCount + 1,
      });
    }
    return [...map.entries()].map(([currency, v]) => ({
      currency: currency as CurrencyCode,
      amount: v.amount.toString(),
      poCount: v.poCount,
    }));
  }

  private sumFxReferenceLocal(
    rows: Array<{
      obligationAmount: Prisma.Decimal | null;
      obligationCurrency: CurrencyCode | null;
      referenceFxRate: Prisma.Decimal | null;
      referenceFxQuoteCurrency: CurrencyCode | null;
    }>,
  ): Array<{ currency: CurrencyCode; amount: string; note: string }> {
    let irr = new Prisma.Decimal(0);
    let counted = 0;
    for (const row of rows) {
      if (
        !row.obligationAmount ||
        !row.referenceFxRate ||
        row.referenceFxQuoteCurrency !== CurrencyCode.IRR
      ) {
        continue;
      }
      irr = irr.add(row.obligationAmount.mul(row.referenceFxRate));
      counted += 1;
    }
    if (counted === 0) return [];
    return [
      {
        currency: CurrencyCode.IRR,
        amount: irr.toString(),
        note: 'REFERENCE_ONLY_AT_PURCHASE_RATE',
      },
    ];
  }

  private buildTrend(
    rows: Array<{
      orderDate: Date;
      currency: CurrencyCode;
      purchaseType: PurchaseCommercialType | null;
      subtotal: Prisma.Decimal;
      obligationAmount: Prisma.Decimal | null;
      obligationCurrency: CurrencyCode | null;
    }>,
    range: ResolvedDashboardRange,
  ) {
    type Bucket = {
      key: string;
      poCount: number;
      localMerchandiseByCurrency: Map<string, Prisma.Decimal>;
      foreignObligationByCurrency: Map<string, Prisma.Decimal>;
    };
    const buckets = new Map<string, Bucket>();

    for (const row of rows) {
      const key = trendBucketKey(row.orderDate, range.granularity);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          key,
          poCount: 0,
          localMerchandiseByCurrency: new Map(),
          foreignObligationByCurrency: new Map(),
        };
        buckets.set(key, bucket);
      }
      bucket.poCount += 1;
      if (
        row.purchaseType === PurchaseCommercialType.CASH ||
        row.purchaseType === PurchaseCommercialType.TERM_CREDIT
      ) {
        addDecimal(bucket.localMerchandiseByCurrency, row.currency, row.subtotal);
      }
      if (
        row.purchaseType === PurchaseCommercialType.FX_CREDIT &&
        row.obligationAmount &&
        row.obligationCurrency
      ) {
        addDecimal(
          bucket.foreignObligationByCurrency,
          row.obligationCurrency,
          row.obligationAmount,
        );
      }
    }

    return [...buckets.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((b) => ({
        bucket: b.key,
        poCount: b.poCount,
        localMerchandiseByCurrency: [...b.localMerchandiseByCurrency.entries()].map(
          ([currency, amount]) => ({ currency, amount: amount.toString() }),
        ),
        foreignObligationByCurrency: [...b.foreignObligationByCurrency.entries()].map(
          ([currency, amount]) => ({ currency, amount: amount.toString() }),
        ),
      }));
  }

  private buildSupplierBreakdown(
    groups: Array<{
      supplierId: string;
      currency: CurrencyCode;
      _count: { _all: number };
      _sum: { subtotal: Prisma.Decimal | null };
    }>,
    supplierName: Map<string, { id: string; name: string; code: string | null }>,
    irrCommercialTotal: Prisma.Decimal,
    fxBySupplier: Array<{
      supplierId: string;
      obligationCurrency: CurrencyCode | null;
      _count: { _all: number };
      _sum: { obligationAmount: Prisma.Decimal | null };
    }>,
  ) {
    type Acc = {
      supplierId: string;
      poCount: number;
      localMerchandiseByCurrency: Map<string, Prisma.Decimal>;
      foreignObligationByCurrency: Map<string, Prisma.Decimal>;
      lastSort: Prisma.Decimal;
    };
    const map = new Map<string, Acc>();
    for (const g of groups) {
      let acc = map.get(g.supplierId);
      if (!acc) {
        acc = {
          supplierId: g.supplierId,
          poCount: 0,
          localMerchandiseByCurrency: new Map(),
          foreignObligationByCurrency: new Map(),
          lastSort: new Prisma.Decimal(0),
        };
        map.set(g.supplierId, acc);
      }
      acc.poCount += g._count._all;
      const sub = g._sum.subtotal ?? new Prisma.Decimal(0);
      addDecimal(acc.localMerchandiseByCurrency, g.currency, sub);
      if (g.currency === CurrencyCode.IRR) {
        acc.lastSort = acc.lastSort.add(sub);
      }
    }
    for (const g of fxBySupplier) {
      if (!g.obligationCurrency) continue;
      let acc = map.get(g.supplierId);
      if (!acc) {
        acc = {
          supplierId: g.supplierId,
          poCount: 0,
          localMerchandiseByCurrency: new Map(),
          foreignObligationByCurrency: new Map(),
          lastSort: new Prisma.Decimal(0),
        };
        map.set(g.supplierId, acc);
      }
      addDecimal(
        acc.foreignObligationByCurrency,
        g.obligationCurrency,
        g._sum.obligationAmount ?? 0,
      );
    }

    return [...map.values()]
      .sort((a, b) => b.lastSort.cmp(a.lastSort))
      .slice(0, DASHBOARD_SUPPLIER_LIMIT)
      .map((acc) => {
        const irr = acc.localMerchandiseByCurrency.get(CurrencyCode.IRR) ?? new Prisma.Decimal(0);
        const share =
          irrCommercialTotal.gt(0) && irr.gt(0)
            ? irr.div(irrCommercialTotal).mul(100).toFixed(2)
            : null;
        const supplier = supplierName.get(acc.supplierId);
        return {
          supplierId: acc.supplierId,
          supplierName: supplier?.name ?? '—',
          supplierCode: supplier?.code ?? null,
          poCount: acc.poCount,
          localMerchandiseByCurrency: [...acc.localMerchandiseByCurrency.entries()].map(
            ([currency, amount]) => ({ currency, amount: amount.toString() }),
          ),
          foreignObligationByCurrency: [...acc.foreignObligationByCurrency.entries()].map(
            ([currency, amount]) => ({ currency, amount: amount.toString() }),
          ),
          localIrrSharePercent: share,
        };
      });
  }

  private buildDueBuckets(
    rows: Array<{
      id: string;
      number: string;
      status: PurchaseOrderStatus;
      purchaseType: PurchaseCommercialType | null;
      currency: CurrencyCode;
      subtotal: Prisma.Decimal;
      obligationAmount: Prisma.Decimal | null;
      obligationCurrency: CurrencyCode | null;
      dueDate: Date | null;
      supplier: { id: string; name: string; code: string | null };
    }>,
    today: Date,
  ) {
    const buckets: Record<DueBucket, typeof rows> = {
      TODAY: [],
      D1_7: [],
      D8_30: [],
      PAST: [],
    };
    for (const row of rows) {
      if (!row.dueDate) continue;
      const bucket = dueBucket(toUtcBusinessDate(row.dueDate), today);
      if (bucket === 'D8_30') {
        const days = utcCalendarDaysBetween(today, toUtcBusinessDate(row.dueDate));
        if (days > 30) continue;
      }
      buckets[bucket].push(row);
    }

    const mapRow = (row: (typeof rows)[number]) => {
      const due = toUtcBusinessDate(row.dueDate!);
      const days = utcCalendarDaysBetween(today, due);
      return {
        id: row.id,
        number: row.number,
        status: row.status,
        purchaseType: row.purchaseType,
        dueDate: row.dueDate!.toISOString(),
        daysRemaining: days,
        daysRemainingLabel: daysRemainingLabel(days),
        supplier: row.supplier,
        referenceAmount:
          row.purchaseType === PurchaseCommercialType.FX_CREDIT && row.obligationAmount
            ? {
                amount: row.obligationAmount.toString(),
                currency: row.obligationCurrency!,
                kind: 'FOREIGN_OBLIGATION' as const,
              }
            : {
                amount: row.subtotal.toString(),
                currency: row.currency,
                kind: 'MERCHANDISE_SUBTOTAL' as const,
              },
      };
    };

    return {
      TODAY: buckets.TODAY.map(mapRow),
      D1_7: buckets.D1_7.map(mapRow),
      D8_30: buckets.D8_30.map(mapRow),
      PAST: buckets.PAST.map(mapRow),
    };
  }

  private buildAttention(input: {
    approvedNotOrdered: Array<{
      id: string;
      number: string;
      approvedAt: Date | null;
      supplier: { id: string; name: string };
    }>;
    dueSoon: Array<{
      id: string;
      number: string;
      dueDate: Date | null;
      supplier: { id: string; name: string; code: string | null };
    }>;
    duePassed: Array<{
      id: string;
      number: string;
      dueDate: Date | null;
      supplier: { id: string; name: string; code: string | null };
    }>;
    draftReturns: Array<{
      id: string;
      number: string;
      createdAt: Date;
      supplier: { id: string; name: string };
      purchaseOrder: { id: string; number: string } | null;
    }>;
    openDiscrepancies: Array<{
      id: string;
      type: string;
      createdAt: Date;
      purchaseOrder: {
        id: string;
        number: string;
        supplier: { id: string; name: string };
      };
    }>;
    agingOrdered: Array<{
      id: string;
      number: string;
      orderedAt: Date | null;
      supplier: { id: string; name: string };
    }>;
    today: Date;
  }) {
    const items: Array<{
      kind: string;
      label: string;
      purchaseOrderId?: string;
      purchaseReturnId?: string;
      number: string;
      supplierName: string;
      at: string | null;
    }> = [];

    for (const row of input.approvedNotOrdered) {
      items.push({
        kind: 'APPROVED_NOT_ORDERED',
        label: 'تأیید شده، هنوز سفارش نشده',
        purchaseOrderId: row.id,
        number: row.number,
        supplierName: row.supplier.name,
        at: row.approvedAt?.toISOString() ?? null,
      });
    }
    for (const row of input.duePassed) {
      items.push({
        kind: 'DUE_DATE_PASSED',
        label: 'سررسید گذشته (قراردادی — نه وضعیت پرداخت)',
        purchaseOrderId: row.id,
        number: row.number,
        supplierName: row.supplier.name,
        at: row.dueDate?.toISOString() ?? null,
      });
    }
    for (const row of input.dueSoon) {
      items.push({
        kind: 'DUE_SOON',
        label: 'سررسید نزدیک',
        purchaseOrderId: row.id,
        number: row.number,
        supplierName: row.supplier.name,
        at: row.dueDate?.toISOString() ?? null,
      });
    }
    for (const row of input.openDiscrepancies) {
      items.push({
        kind: 'OPEN_DISCREPANCY',
        label: `مغایرت باز (${row.type})`,
        purchaseOrderId: row.purchaseOrder.id,
        number: row.purchaseOrder.number,
        supplierName: row.purchaseOrder.supplier.name,
        at: row.createdAt.toISOString(),
      });
    }
    for (const row of input.draftReturns) {
      items.push({
        kind: 'RETURN_AWAITING_APPROVAL',
        label: 'برگشت در انتظار تأیید',
        purchaseReturnId: row.id,
        purchaseOrderId: row.purchaseOrder?.id,
        number: row.number,
        supplierName: row.supplier.name,
        at: row.createdAt.toISOString(),
      });
    }
    for (const row of input.agingOrdered) {
      const days = row.orderedAt
        ? utcCalendarDaysBetween(toUtcBusinessDate(row.orderedAt), input.today)
        : DASHBOARD_AGING_ORDERED_DAYS;
      items.push({
        kind: 'ORDERED_AGING',
        label: `${days} روز از ثبت سفارش گذشته`,
        purchaseOrderId: row.id,
        number: row.number,
        supplierName: row.supplier.name,
        at: row.orderedAt?.toISOString() ?? null,
      });
    }

    return items.slice(0, DASHBOARD_ATTENTION_LIMIT);
  }

  private mapPoRow(
    po: {
      id: string;
      number: string;
      status: PurchaseOrderStatus;
      purchaseType: PurchaseCommercialType | null;
      currency: CurrencyCode;
      subtotal: Prisma.Decimal;
      total: Prisma.Decimal;
      obligationAmount: Prisma.Decimal | null;
      obligationCurrency: CurrencyCode | null;
      orderDate: Date;
      dueDate: Date | null;
      orderedAt: Date | null;
      supplier: { id: string; name: string; code: string | null };
    },
    today: Date,
  ) {
    return {
      id: po.id,
      number: po.number,
      status: po.status,
      purchaseType: po.purchaseType,
      orderDate: po.orderDate.toISOString(),
      dueDate: po.dueDate?.toISOString() ?? null,
      daysRemaining:
        po.dueDate != null
          ? utcCalendarDaysBetween(today, toUtcBusinessDate(po.dueDate))
          : null,
      supplier: po.supplier,
      amount:
        po.purchaseType === PurchaseCommercialType.FX_CREDIT && po.obligationAmount
          ? {
              amount: po.obligationAmount.toString(),
              currency: po.obligationCurrency!,
              kind: 'FOREIGN_OBLIGATION' as const,
            }
          : {
              amount: po.subtotal.toString(),
              currency: po.currency,
              kind: 'MERCHANDISE_SUBTOTAL' as const,
            },
    };
  }
}
