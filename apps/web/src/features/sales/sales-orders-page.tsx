'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  formatSalesMoney,
  paymentTermLabel,
  salesOrderStatusBadgeClass,
  salesOrderStatusLabel,
} from '@/features/sales/sales-labels';
import { fetchSalesChannels, fetchSalesCustomers, fetchSalesOrders } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { salesKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { ROUTES, salesOrderPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function SalesOrdersPage() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.SALES_ORDERS_READ);
  const canCreate = can(PERMISSIONS.SALES_ORDERS_CREATE);

  const [page, setPage] = React.useState(1);
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [channelId, setChannelId] = React.useState('');
  const [customerId, setCustomerId] = React.useState('');
  const [paymentTermType, setPaymentTermType] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const filters = {
    page,
    pageSize: 20,
    search: search || undefined,
    status: status || undefined,
    channelId: channelId || undefined,
    customerId: customerId || undefined,
    paymentTermType: paymentTermType || undefined,
    from: from || undefined,
    to: to || undefined,
  };

  const ordersQuery = useQuery({
    queryKey: salesKeys.orders.list(companyId, filters),
    enabled: Boolean(companyId) && canRead,
    queryFn: () => fetchSalesOrders(companyId, filters),
  });

  const channelsQuery = useQuery({
    queryKey: salesKeys.channels.list(companyId, { pageSize: 100 }),
    enabled: Boolean(companyId) && canRead,
    queryFn: () => fetchSalesChannels(companyId, { pageSize: 100 }),
  });

  const customersQuery = useQuery({
    queryKey: salesKeys.customers.list(companyId, { pageSize: 100 }),
    enabled: Boolean(companyId) && canRead,
    queryFn: () => fetchSalesCustomers(companyId, { pageSize: 100 }),
  });

  React.useEffect(() => {
    if (
      ordersQuery.error &&
      isApiClientError(ordersQuery.error) &&
      ordersQuery.error.status === 401
    ) {
      handleUnauthorized();
    }
  }, [ordersQuery.error, handleUnauthorized]);

  if (!canRead) {
    return <AccessDenied message="برای مشاهده سفارش‌های فروش به مجوز sales.orders.read نیاز است." />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="سفارش‌های فروش"
        description="لیست سفارش‌های تجاری شرکت فعال"
        actions={
          canCreate ? (
            <Link href={ROUTES.salesOrderNew} className={cn(buttonVariants())}>
              سفارش جدید
            </Link>
          ) : null
        }
      />

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-3 lg:grid-cols-4">
        <div className="space-y-1 md:col-span-2">
          <Label>جستجو</Label>
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="شماره سفارش، مرجع خارجی، مشتری…"
          />
        </div>
        <div className="space-y-1">
          <Label>وضعیت</Label>
          <select
            className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">همه</option>
            {['DRAFT', 'CONFIRMED', 'PROCESSING', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED'].map(
              (s) => (
                <option key={s} value={s}>
                  {salesOrderStatusLabel(s)}
                </option>
              ),
            )}
          </select>
        </div>
        <div className="space-y-1">
          <Label>کانال</Label>
          <select
            className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={channelId}
            onChange={(e) => {
              setChannelId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">همه</option>
            {(channelsQuery.data?.data ?? []).map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label>مشتری</Label>
          <select
            className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">همه</option>
            {(customersQuery.data?.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label>شرایط پرداخت</Label>
          <select
            className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={paymentTermType}
            onChange={(e) => {
              setPaymentTermType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">همه</option>
            {['CASH', 'CREDIT', 'PARTIAL'].map((t) => (
              <option key={t} value={t}>
                {paymentTermLabel(t)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label>از تاریخ</Label>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        </div>
        <div className="space-y-1">
          <Label>تا تاریخ</Label>
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </div>
      </div>

      {ordersQuery.isLoading ? <TableSkeleton rows={8} /> : null}
      {ordersQuery.error ? (
        <ErrorState title="خطا" message={mapBusinessError(ordersQuery.error)} />
      ) : null}
      {ordersQuery.data && ordersQuery.data.data.length === 0 ? (
        <EmptyState title="سفارشی یافت نشد" description="با فیلترهای فعلی نتیجه‌ای نیست." />
      ) : null}
      {ordersQuery.data && ordersQuery.data.data.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">شماره</th>
                  <th className="px-3 py-2 text-right font-medium">وضعیت</th>
                  <th className="px-3 py-2 text-right font-medium">کانال</th>
                  <th className="px-3 py-2 text-right font-medium">مشتری</th>
                  <th className="px-3 py-2 text-right font-medium">پرداخت</th>
                  <th className="px-3 py-2 text-right font-medium">مبلغ</th>
                  <th className="px-3 py-2 text-right font-medium">تاریخ</th>
                </tr>
              </thead>
              <tbody>
                {ordersQuery.data.data.map((order) => (
                  <tr key={order.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                    <td className="px-3 py-2">
                      <Link href={salesOrderPath(order.id)} className="font-medium text-sky-700 hover:underline">
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={salesOrderStatusBadgeClass(order.status)}>
                        {salesOrderStatusLabel(order.status)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">{order.channel.name}</td>
                    <td className="px-3 py-2">{order.customer?.displayName ?? order.customerNameSnapshot ?? '—'}</td>
                    <td className="px-3 py-2">{paymentTermLabel(order.paymentTermType)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatSalesMoney(order.grandTotal, order.currency)}
                    </td>
                    <td className="px-3 py-2">{formatDateTime(order.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>
              صفحه {ordersQuery.data.meta.page} از {ordersQuery.data.meta.totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                قبلی
              </button>
              <button
                type="button"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                disabled={page >= ordersQuery.data.meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                بعدی
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
