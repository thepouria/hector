'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OfferPriceDisplay } from '@/features/purchasing/offer-price-display';
import {
  paymentTermsSummary,
  purchaseDueStatusBadgeClass,
  purchaseDueStatusLabel,
  purchaseOrderStatusBadgeClass,
  purchaseOrderStatusLabel,
  purchaseTypeLabel,
} from '@/features/purchasing/purchase-order-labels';
import { formatGroupedDigits } from '@/features/purchasing/offer-money';
import { fetchPurchaseOrders } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { purchaseOrderKeys } from '@/lib/query/keys';
import { ROUTES, purchasingOrderPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type {
  PurchaseCommercialType,
  PurchaseDueStatus,
  PurchaseOrderStatus,
} from '@/types/purchasing';

function syncOrdersUrl(
  router: ReturnType<typeof useRouter>,
  next: {
    status?: string;
    dueStatus?: string;
    purchaseType?: string;
    currency?: string;
  },
) {
  const params = new URLSearchParams();
  if (next.status) params.set('status', next.status);
  if (next.dueStatus) params.set('dueStatus', next.dueStatus);
  if (next.purchaseType) params.set('purchaseType', next.purchaseType);
  if (next.currency) params.set('currency', next.currency);
  const qs = params.toString();
  router.replace(`${ROUTES.purchasingOrders}${qs ? `?${qs}` : ''}`);
}

export function PurchaseOrdersPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canCreate = can(PERMISSIONS.PURCHASING_CREATE);

  const [page, setPage] = React.useState(1);
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<PurchaseOrderStatus | ''>(
    () => (searchParams.get('status') as PurchaseOrderStatus | null) ?? '',
  );
  const [purchaseType, setPurchaseType] = React.useState<PurchaseCommercialType | ''>(
    () => (searchParams.get('purchaseType') as PurchaseCommercialType | null) ?? '',
  );
  const [dueStatus, setDueStatus] = React.useState<PurchaseDueStatus | ''>(
    () => (searchParams.get('dueStatus') as PurchaseDueStatus | null) ?? '',
  );
  const [currency, setCurrency] = React.useState(() => searchParams.get('currency') ?? '');
  const [sortBy, setSortBy] = React.useState('orderDate');
  const [sortOrder, setSortOrder] = React.useState('desc');

  React.useEffect(() => {
    setStatus((searchParams.get('status') as PurchaseOrderStatus | null) ?? '');
    setPurchaseType(
      (searchParams.get('purchaseType') as PurchaseCommercialType | null) ?? '',
    );
    setDueStatus((searchParams.get('dueStatus') as PurchaseDueStatus | null) ?? '');
    setCurrency(searchParams.get('currency') ?? '');
  }, [searchParams]);

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
    purchaseType: purchaseType || undefined,
    dueStatus: dueStatus || undefined,
    currency: currency || undefined,
    sortBy,
    sortOrder,
  };

  const listQuery = useQuery({
    queryKey: purchaseOrderKeys.list(companyId, filters),
    enabled: Boolean(companyId) && can(PERMISSIONS.PURCHASING_READ),
    queryFn: () => fetchPurchaseOrders(companyId, filters),
  });

  React.useEffect(() => {
    if (
      listQuery.error &&
      isApiClientError(listQuery.error) &&
      listQuery.error.status === 401
    ) {
      handleUnauthorized();
    }
  }, [listQuery.error, handleUnauthorized]);

  if (!can(PERMISSIONS.PURCHASING_READ)) {
    return <AccessDenied />;
  }

  const rows = listQuery.data?.data ?? [];
  const meta = listQuery.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="سفارش‌های خرید"
        description="تعهد خرید شرکت از تأمین‌کنندگان"
        breadcrumbs={[
          { label: 'خرید', href: ROUTES.purchasing },
          { label: 'سفارش‌های خرید' },
        ]}
        actions={
          canCreate ? (
            <Button type="button" onClick={() => router.push(ROUTES.purchasingOrderNew)}>
              سفارش جدید
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="po-search">جستجو</Label>
          <Input
            id="po-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="شماره سفارش، تأمین‌کننده، SKU…"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="po-status">وضعیت</Label>
          <select
            id="po-status"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={status}
            onChange={(event) => {
              const next = event.target.value as PurchaseOrderStatus | '';
              setStatus(next);
              setPage(1);
              syncOrdersUrl(router, {
                status: next,
                dueStatus,
                purchaseType,
                currency,
              });
            }}
          >
            <option value="">همه</option>
            <option value="DRAFT">پیش‌نویس</option>
            <option value="APPROVED">تأیید شده</option>
            <option value="ORDERED">سفارش داده شده</option>
            <option value="PARTIALLY_RECEIVED">بخشی دریافت شده</option>
            <option value="RECEIVED">دریافت کامل</option>
            <option value="CANCELLED">لغو شده</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="po-purchase-type">نوع خرید</Label>
          <select
            id="po-purchase-type"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={purchaseType}
            onChange={(event) => {
              const next = event.target.value as PurchaseCommercialType | '';
              setPurchaseType(next);
              setPage(1);
              syncOrdersUrl(router, {
                status,
                dueStatus,
                purchaseType: next,
                currency,
              });
            }}
          >
            <option value="">همه</option>
            <option value="CASH">نقدی</option>
            <option value="TERM_CREDIT">اعتباری ریالی</option>
            <option value="FX_CREDIT">اعتباری ارزی</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="po-due-status">وضعیت سررسید</Label>
          <select
            id="po-due-status"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={dueStatus}
            onChange={(event) => {
              const next = event.target.value as PurchaseDueStatus | '';
              setDueStatus(next);
              setPage(1);
              syncOrdersUrl(router, {
                status,
                dueStatus: next,
                purchaseType,
                currency,
              });
            }}
          >
            <option value="">همه</option>
            <option value="UPCOMING">آینده</option>
            <option value="DUE_SOON">نزدیک سررسید</option>
            <option value="DUE_TODAY">امروز</option>
            <option value="OVERDUE">گذشته از سررسید</option>
            <option value="NO_DUE_DATE">بدون سررسید</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="po-currency">ارز</Label>
          <select
            id="po-currency"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={currency}
            onChange={(event) => {
              const next = event.target.value;
              setCurrency(next);
              setPage(1);
              syncOrdersUrl(router, {
                status,
                dueStatus,
                purchaseType,
                currency: next,
              });
            }}
          >
            <option value="">همه</option>
            <option value="IRR">تومان / ریال</option>
            <option value="USD">دلار</option>
          </select>
        </div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="po-sort">مرتب‌سازی</Label>
          <select
            id="po-sort"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={`${sortBy}:${sortOrder}`}
            onChange={(event) => {
              const [nextSort, nextOrder] = event.target.value.split(':');
              setSortBy(nextSort);
              setSortOrder(nextOrder);
              setPage(1);
            }}
          >
            <option value="orderDate:desc">تاریخ سفارش (جدید)</option>
            <option value="orderDate:asc">تاریخ سفارش (قدیم)</option>
            <option value="dueDate:asc">سررسید (نزدیک)</option>
            <option value="dueDate:desc">سررسید (دور)</option>
            <option value="createdAt:desc">تاریخ ثبت</option>
            <option value="number:asc">شماره</option>
            <option value="total:desc">مبلغ (بیشتر)</option>
            <option value="total:asc">مبلغ (کمتر)</option>
          </select>
        </div>
      </div>

      {listQuery.isPending ? <TableSkeleton rows={8} /> : null}
      {listQuery.isError ? (
        <ErrorState message={mapBusinessError(listQuery.error)} onRetry={() => listQuery.refetch()} />
      ) : null}
      {!listQuery.isPending && !listQuery.isError && rows.length === 0 ? (
        <EmptyState
          title="سفارشی ثبت نشده"
          description="اولین سفارش خرید پیش‌نویس را ایجاد کنید."
          action={
            canCreate ? (
              <Button type="button" onClick={() => router.push(ROUTES.purchasingOrderNew)}>
                سفارش جدید
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">شماره</th>
                <th className="px-3 py-2 text-start font-medium">تأمین‌کننده</th>
                <th className="px-3 py-2 text-start font-medium">نوع خرید</th>
                <th className="px-3 py-2 text-start font-medium">تاریخ سفارش</th>
                <th className="px-3 py-2 text-start font-medium">وضعیت</th>
                <th className="px-3 py-2 text-start font-medium">اقلام</th>
                <th className="px-3 py-2 text-start font-medium">مبلغ / تعهد</th>
                <th className="px-3 py-2 text-start font-medium">شرایط پرداخت</th>
                <th className="px-3 py-2 text-start font-medium">سررسید</th>
                <th className="px-3 py-2 text-start font-medium">وضعیت سررسید</th>
                <th className="px-3 py-2 text-start font-medium">به‌روزرسانی</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const supplierName = row.supplierNameSnapshot ?? row.supplier.name;
                return (
                  <tr key={row.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2">
                      <Link
                        href={purchasingOrderPath(row.id)}
                        className="font-mono text-sm font-medium text-slate-900 underline-offset-2 hover:underline"
                        dir="ltr"
                      >
                        {row.number}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-slate-800">{supplierName}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {purchaseTypeLabel(row.purchaseType)}
                    </td>
                    <td className="px-3 py-2 text-slate-600" dir="ltr">
                      {formatDateTime(row.orderDate)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={purchaseOrderStatusBadgeClass(row.status)}>
                        {purchaseOrderStatusLabel(row.status)}
                        <span className="ms-1 font-mono text-[10px] opacity-70" dir="ltr">
                          {row.status}
                        </span>
                      </Badge>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-700" dir="ltr">
                      {row.itemCount}
                    </td>
                    <td className="px-3 py-2">
                      {row.purchaseType === 'FX_CREDIT' &&
                      row.obligationAmount &&
                      row.obligationCurrency ? (
                        <span className="font-semibold tabular-nums" dir="ltr">
                          {formatGroupedDigits(row.obligationAmount)} {row.obligationCurrency}
                        </span>
                      ) : (
                        <OfferPriceDisplay unitPrice={row.total} currency={row.currency} />
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {paymentTermsSummary(row.paymentTermType, row.netDays)}
                    </td>
                    <td className="px-3 py-2 text-slate-600" dir="ltr">
                      {row.dueDate ? formatDateTime(row.dueDate) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={purchaseDueStatusBadgeClass(row.dueStatus)}>
                        {purchaseDueStatusLabel(row.dueStatus)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-slate-500" dir="ltr">
                      {formatDateTime(row.updatedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {meta && meta.total > meta.pageSize ? (
        <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
          <span>
            صفحه {page} از {totalPages} — {meta.total} مورد
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              قبلی
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              بعدی
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
