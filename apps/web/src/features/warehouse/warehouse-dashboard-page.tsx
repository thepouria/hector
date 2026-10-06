'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { buttonVariants } from '@/components/ui/button';
import { fetchWarehouseDashboard } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import {
  ROUTES,
  warehouseCountPath,
  warehouseGoodsReceiptPath,
  warehouseInventoryMovementPath,
  warehouseTransferPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function WarehouseDashboardPageClient() {
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canStock = can(PERMISSIONS.WAREHOUSE_STOCK_READ);
  const canValuation = can(PERMISSIONS.WAREHOUSE_VALUATION_READ);

  const dashboard = useQuery({
    queryKey: warehouseKeys.dashboard(companyId),
    enabled: Boolean(companyId) && canStock,
    queryFn: () => fetchWarehouseDashboard(companyId),
  });

  if (!canStock) return <AccessDenied />;

  const d = dashboard.data;
  const valuation = canValuation ? d?.valuation ?? null : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="داشبورد انبار"
        description="خلاصه عملیاتی موجودی، صف‌های باز و فعالیت اخیر — بدون پیش‌بینی یا هوش بازسفارش."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'داشبورد انبار' },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            {can(PERMISSIONS.WAREHOUSE_SCANNER_USE) ? (
              <Link
                href={ROUTES.warehouseScanner}
                className={cn(buttonVariants({ variant: 'default' }))}
              >
                مرکز اسکنر
              </Link>
            ) : null}
            <Link
              href={ROUTES.warehouseInventory}
              className={cn(buttonVariants({ variant: 'outline' }))}
            >
              موجودی
            </Link>
            {can(PERMISSIONS.AUDIT_READ) ? (
              <Link
                href={`${ROUTES.audit}?entityType=GOODS_RECEIPT`}
                className={cn(buttonVariants({ variant: 'outline' }))}
              >
                ممیزی انبار
              </Link>
            ) : null}
          </div>
        }
      />

      {dashboard.isPending ? (
        <TableSkeleton />
      ) : dashboard.isError ? (
        <ErrorState
          message={mapBusinessError(dashboard.error)}
          onRetry={() => dashboard.refetch()}
        />
      ) : d ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="SKU دارای موجودی" value={d.skusWithStock} href={ROUTES.warehouseInventory} />
            <Stat label="کل واحدها" value={d.totalUnits} />
            <Stat
              label="فروش‌پذیر (Sellable)"
              value={d.sellableUnits}
              href={`${ROUTES.warehouseInventory}?classification=SELLABLE`}
            />
            <Stat label="رزرو شده" value={d.reservedUnits} href={ROUTES.warehouseReservations} />
            <Stat label="قابل فروش (Available)" value={d.availableUnits} />
            <Stat
              label="تستر"
              value={d.testerUnits}
              href={`${ROUTES.warehouseInventory}?classification=TESTER`}
            />
            <Stat
              label="آسیب‌دیده"
              value={d.damagedUnits}
              href={`${ROUTES.warehouseInventory}?classification=DAMAGED`}
            />
            <Stat
              label="قرنطینه"
              value={d.quarantineUnits}
              href={`${ROUTES.warehouseInventory}?classification=QUARANTINE`}
            />
          </div>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">موجودی بر اساس انبار</h2>
            {d.warehouseSummary.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">انباری ثبت نشده است.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-500">
                      <th className="px-2 py-2 text-start font-medium">انبار</th>
                      <th className="px-2 py-2 text-start font-medium">کل</th>
                      <th className="px-2 py-2 text-start font-medium">فروش‌پذیر</th>
                      <th className="px-2 py-2 text-start font-medium">رزرو</th>
                      <th className="px-2 py-2 text-start font-medium">قابل فروش</th>
                      <th className="px-2 py-2 text-start font-medium">تستر</th>
                      <th className="px-2 py-2 text-start font-medium">آسیب</th>
                      <th className="px-2 py-2 text-start font-medium">قرنطینه</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.warehouseSummary.map((wh) => (
                      <tr key={wh.warehouseId} className="border-t border-slate-50">
                        <td className="px-2 py-2">
                          <Link
                            href={`${ROUTES.warehouseInventory}?warehouseId=${wh.warehouseId}`}
                            className="font-mono underline-offset-2 hover:underline"
                            dir="ltr"
                          >
                            {wh.warehouseCode}
                          </Link>
                        </td>
                        <td className="px-2 py-2 tabular-nums" dir="ltr">
                          {wh.totalUnits}
                        </td>
                        <td className="px-2 py-2 tabular-nums" dir="ltr">
                          {wh.sellableUnits}
                        </td>
                        <td className="px-2 py-2 tabular-nums" dir="ltr">
                          {wh.reservedUnits}
                        </td>
                        <td className="px-2 py-2 tabular-nums" dir="ltr">
                          {wh.availableUnits}
                        </td>
                        <td className="px-2 py-2 tabular-nums" dir="ltr">
                          {wh.testerUnits}
                        </td>
                        <td className="px-2 py-2 tabular-nums" dir="ltr">
                          {wh.damagedUnits}
                        </td>
                        <td className="px-2 py-2 tabular-nums" dir="ltr">
                          {wh.quarantineUnits}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat
              label="رسید پیش‌نویس"
              value={d.pendingReceipts}
              href={`${ROUTES.warehouseGoodsReceipts}?status=DRAFT`}
            />
            <Stat label="جایگذاری باز" value={d.pendingPutaways} href={ROUTES.warehousePutaways} />
            <Stat
              label="انتقال باز"
              value={d.openTransfers}
              href={`${ROUTES.warehouseTransfers}?status=DRAFT`}
            />
            <Stat label="شمارش باز" value={d.openStockCounts} href={ROUTES.warehouseCounts} />
            <Stat
              label="شمارش در انتظار تأیید"
              value={d.countsAwaitingApproval}
              href={`${ROUTES.warehouseCounts}?status=SUBMITTED`}
            />
            <Stat label="خروج پیش‌نویس" value={d.draftIssues} href={ROUTES.warehouseIssues} />
            <Stat
              label="برگشت تأمین‌کننده (پیش‌نویس اجرا)"
              value={d.pendingSupplierReturns}
              href={ROUTES.warehouseSupplierReturns}
            />
            <Stat
              label="برگشت تأییدشدهٔ باز"
              value={d.pendingSupplierReturnsOpen}
              href={ROUTES.warehouseSupplierReturns}
            />
          </div>

          {canValuation && valuation ? (
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="ارزش شناخته‌شده"
                value={valuation.totalInventoryValue}
                href={ROUTES.warehouseValuation}
                textual
              />
              <Stat label="مقدار ارزش‌دار" value={valuation.valuedQuantity} />
              <Stat label="مقدار بدون بها" value={valuation.unvaluedQuantity} />
              <Stat
                label="کامل بودن ارزش‌گذاری"
                value={valuation.valuationCompleteness}
                textual
              />
            </section>
          ) : null}

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">مغایرت‌های شمارش (در انتظار تأیید)</h2>
            {d.stockDiscrepancies.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">مغایرت بازی ثبت نشده است.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {d.stockDiscrepancies.map((row) => (
                  <li
                    key={row.stockCountItemId}
                    className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-2"
                  >
                    <Link
                      href={warehouseCountPath(row.stockCountId)}
                      className="underline-offset-2 hover:underline"
                    >
                      <span className="font-mono" dir="ltr">
                        {row.stockCountNumber}
                      </span>{' '}
                      · {row.skuCode} · {row.locationCode}
                    </Link>
                    <span className="tabular-nums text-slate-600" dir="ltr">
                      System={row.systemQuantity} Counted={row.countedQuantity} Δ={row.difference}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <ActivityCard title="رسیدهای اخیر">
              {d.recentActivity.recentReceipts.length === 0 ? (
                <EmptyState title="رسیدی ثبت نشده است." />
              ) : (
                <ul className="space-y-2 text-sm">
                  {d.recentActivity.recentReceipts.map((r) => (
                    <li key={r.id} className="border-t border-slate-100 pt-2">
                      <Link
                        href={warehouseGoodsReceiptPath(r.id)}
                        className="font-mono underline-offset-2 hover:underline"
                        dir="ltr"
                      >
                        {r.number}
                      </Link>
                      <div className="text-slate-500">
                        {r.status} · {r.warehouseCode} · qty {r.receivedQuantity}
                        {r.supplierName ? ` · ${r.supplierName}` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </ActivityCard>

            <ActivityCard title="حرکات اخیر">
              {d.recentActivity.recentMovements.length === 0 ? (
                <EmptyState title="حرکتی ثبت نشده است." />
              ) : (
                <ul className="space-y-2 text-sm">
                  {d.recentActivity.recentMovements.map((m) => (
                    <li
                      key={m.id}
                      className="flex justify-between gap-2 border-t border-slate-100 pt-2"
                    >
                      <Link
                        href={warehouseInventoryMovementPath(m.id)}
                        className="underline-offset-2 hover:underline"
                      >
                        <span className="font-mono" dir="ltr">
                          {m.skuCode}
                        </span>{' '}
                        {m.movementType}
                      </Link>
                      <span className="tabular-nums text-slate-500" dir="ltr">
                        {m.quantityDelta} · {formatDateTime(m.occurredAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </ActivityCard>

            <ActivityCard title="انتقال‌های اخیر">
              {d.recentActivity.recentTransfers.length === 0 ? (
                <EmptyState title="انتقالی ثبت نشده است." />
              ) : (
                <ul className="space-y-2 text-sm">
                  {d.recentActivity.recentTransfers.map((t) => (
                    <li key={t.id} className="border-t border-slate-100 pt-2">
                      <Link
                        href={warehouseTransferPath(t.id)}
                        className="font-mono underline-offset-2 hover:underline"
                        dir="ltr"
                      >
                        {t.number}
                      </Link>
                      <div className="text-slate-500" dir="ltr">
                        {t.sourceWarehouseCode} → {t.destinationWarehouseCode} · {t.quantity} ·{' '}
                        {t.status}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </ActivityCard>
          </section>
        </>
      ) : null}
    </div>
  );
}

function ActivityCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  href,
  textual,
}: {
  label: string;
  value: number | string;
  href?: string;
  textual?: boolean;
}) {
  const inner = (
    <div className="rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-300">
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={cn('mt-1 font-semibold text-slate-900', textual ? 'text-base' : 'text-2xl')}
        dir="ltr"
      >
        {value}
      </div>
    </div>
  );
  if (!href) return inner;
  return <Link href={href}>{inner}</Link>;
}
