'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  ErrorState,
  PageSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  formatSalesMoney,
  salesOrderStatusBadgeClass,
  salesOrderStatusLabel,
} from '@/features/sales/sales-labels';
import { fetchSalesChannels, fetchSalesDashboard } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { salesKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { ROUTES, salesOrderPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

const RANGE_OPTIONS = [
  { value: 'today', label: 'امروز' },
  { value: '7d', label: '۷ روز' },
  { value: '30d', label: '۳۰ روز' },
  { value: 'custom', label: 'بازه دلخواه' },
] as const;

export function SalesDashboardPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.SALES_DASHBOARD_READ);
  const canOrders = can(PERMISSIONS.SALES_ORDERS_READ);

  const range = searchParams.get('range') ?? '30d';
  const channelId = searchParams.get('channelId') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';

  const filters = {
    range: range || '30d',
    ...(range === 'custom' && from ? { from } : {}),
    ...(range === 'custom' && to ? { to } : {}),
    ...(channelId ? { channelId } : {}),
  };

  const replaceFilters = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    if (patch.range && patch.range !== 'custom') {
      params.delete('from');
      params.delete('to');
    }
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`);
  };

  const dashboardQuery = useQuery({
    queryKey: salesKeys.dashboard(companyId, filters),
    enabled: Boolean(companyId) && canRead,
    staleTime: 30_000,
    queryFn: () => fetchSalesDashboard(companyId, filters),
  });

  const channelsQuery = useQuery({
    queryKey: salesKeys.channels.list(companyId, { pageSize: 100, status: 'ACTIVE' }),
    enabled: Boolean(companyId) && canRead,
    queryFn: () => fetchSalesChannels(companyId, { pageSize: 100, status: 'ACTIVE' }),
  });

  React.useEffect(() => {
    if (
      dashboardQuery.error &&
      isApiClientError(dashboardQuery.error) &&
      dashboardQuery.error.status === 401
    ) {
      handleUnauthorized();
    }
  }, [dashboardQuery.error, handleUnauthorized]);

  if (!canRead) {
    return <AccessDenied message="برای مشاهده داشبورد فروش به مجوز sales.dashboard.read نیاز است." />;
  }

  if (dashboardQuery.isLoading) return <PageSkeleton />;
  if (dashboardQuery.error) {
    return (
      <ErrorState
        title="خطا در بارگذاری داشبورد فروش"
        message={mapBusinessError(dashboardQuery.error)}
      />
    );
  }

  const data = dashboardQuery.data!;
  const snap = data.snapshot;

  return (
    <div className="space-y-6">
      <PageHeader
        title="داشبورد فروش"
        description="خلاصه عملیاتی سفارش‌ها، کانال‌ها و مطالبات باز (منبع مالی — تسویه در فاز ۶)"
        actions={
          canOrders ? (
            <Link href={ROUTES.salesOrders} className={cn(buttonVariants())}>
              سفارش‌ها
            </Link>
          ) : null
        }
      />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="space-y-1">
          <Label>بازه</Label>
          <select
            className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={range}
            onChange={(e) => replaceFilters({ range: e.target.value })}
          >
            {RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {range === 'custom' ? (
          <>
            <div className="space-y-1">
              <Label>از</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => replaceFilters({ from: e.target.value, range: 'custom' })}
              />
            </div>
            <div className="space-y-1">
              <Label>تا</Label>
              <Input
                type="date"
                value={to}
                onChange={(e) => replaceFilters({ to: e.target.value, range: 'custom' })}
              />
            </div>
          </>
        ) : null}
        <div className="space-y-1">
          <Label>کانال</Label>
          <select
            className="h-10 min-w-[180px] rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={channelId}
            onChange={(e) => replaceFilters({ channelId: e.target.value || undefined })}
          >
            <option value="">همه کانال‌ها</option>
            {(channelsQuery.data?.data ?? []).map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.name} ({ch.code})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'سفارش‌های باز', value: snap.openOrders },
          { label: 'تأییدشده', value: snap.confirmedOrders },
          { label: 'در حال پردازش', value: snap.processingOrders },
          { label: 'نیمه‌تحویل', value: snap.partiallyFulfilledOrders },
          { label: 'واحدهای در انتظار تحویل', value: snap.pendingFulfillmentUnits },
          { label: 'برگشت‌های باز', value: snap.openReturns },
          { label: 'برگشت در انتظار دریافت', value: snap.pendingReturns },
          { label: 'سفارش در بازه', value: data.period.ordersCount },
        ].map((card) => (
          <div key={card.label} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">{card.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {new Intl.NumberFormat('fa-IR').format(card.value)}
            </div>
          </div>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">فروش بر اساس کانال (بازه)</h2>
        {data.salesByChannel.length === 0 ? (
          <p className="text-sm text-slate-500">در این بازه سفارش متعهدی ثبت نشده است.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.salesByChannel.map((ch) => (
              <div key={ch.channelId} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="font-medium">{ch.name}</div>
                <div className="text-xs text-slate-500">{ch.code}</div>
                <div className="mt-2 text-sm">
                  سفارش: {new Intl.NumberFormat('fa-IR').format(ch.orderCount)} · واحد:{' '}
                  {new Intl.NumberFormat('fa-IR').format(ch.units)}
                </div>
                <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
                  {ch.salesValue.map((row) => (
                    <li key={row.currency}>{formatSalesMoney(row.amount, row.currency)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">سفارش‌های اخیر</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-right font-medium">شماره</th>
                <th className="px-3 py-2 text-right font-medium">وضعیت</th>
                <th className="px-3 py-2 text-right font-medium">کانال</th>
                <th className="px-3 py-2 text-right font-medium">مشتری</th>
                <th className="px-3 py-2 text-right font-medium">مبلغ</th>
                <th className="px-3 py-2 text-right font-medium">تاریخ</th>
              </tr>
            </thead>
            <tbody>
              {data.recentOrders.map((order) => (
                <tr key={order.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <Link href={salesOrderPath(order.id)} className="text-sky-700 hover:underline">
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Badge className={salesOrderStatusBadgeClass(order.status)}>
                      {salesOrderStatusLabel(order.status)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">{order.channel.name}</td>
                  <td className="px-3 py-2">{order.customer?.displayName ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatSalesMoney(order.grandTotal, order.currency)}
                  </td>
                  <td className="px-3 py-2">{formatDateTime(order.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-800">مطالبات باز (مالی)</h2>
        <p className="text-xs text-slate-500">{data.outstandingReceivables.label}</p>
        {data.outstandingReceivables.items.length === 0 ? (
          <p className="text-sm text-slate-500">مطلبه باز ثبت‌شده‌ای نیست.</p>
        ) : (
          <ul className="space-y-2">
            {data.outstandingReceivables.items.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <span>
                  {row.number} · سفارش{' '}
                  <Link href={salesOrderPath(row.salesOrderId)} className="text-sky-700 hover:underline">
                    {row.salesOrderNumber}
                  </Link>
                </span>
                <span className="tabular-nums">{formatSalesMoney(row.amount, row.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
