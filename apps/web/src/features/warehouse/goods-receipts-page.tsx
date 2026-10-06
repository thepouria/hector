'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { goodsReceiptStatusLabel } from '@/features/warehouse/goods-receipt-labels';
import { fetchGoodsReceipts } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import {
  ROUTES,
  purchasingOrderPath,
  warehouseGoodsReceiptPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { GoodsReceiptStatus } from '@/types/goods-receipt';

export function GoodsReceiptsPageClient() {
  const router = useRouter();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.WAREHOUSE_RECEIPT_MANAGE);

  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState<GoodsReceiptStatus | ''>('');
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const filters = {
    page,
    pageSize: 20,
    status: status || undefined,
    search: search || undefined,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  };

  const query = useQuery({
    queryKey: warehouseKeys.goodsReceipts.list(companyId, filters),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_RECEIPT_READ),
    queryFn: () => fetchGoodsReceipts(companyId, filters),
  });

  if (!can(PERMISSIONS.WAREHOUSE_RECEIPT_READ)) return <AccessDenied />;

  const rows = query.data?.data ?? [];
  const meta = query.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="رسید کالا"
        description="ثبت دریافت فیزیکی کالا بر اساس سفارش خرید — بدون حرکت موجودی در این فاز."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'رسید کالا' },
        ]}
        actions={
          canManage ? (
            <Link href={ROUTES.warehouseGoodsReceiptNew} className={cn(buttonVariants())}>
              رسید جدید
            </Link>
          ) : null
        }
      />

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="gr-search">جستجو</Label>
          <Input
            id="gr-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="شماره رسید، PO یا تأمین‌کننده"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="gr-status">وضعیت</Label>
          <select
            id="gr-status"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as GoodsReceiptStatus | '');
              setPage(1);
            }}
          >
            <option value="">همه</option>
            <option value="DRAFT">پیش‌نویس</option>
            <option value="POSTED">ثبت نهایی</option>
            <option value="CANCELLED">لغو شده</option>
          </select>
        </div>
      </div>

      {query.isPending ? (
        <TableSkeleton />
      ) : query.isError ? (
        <ErrorState message={mapBusinessError(query.error)} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="رسیدی ثبت نشده است."
          description="دریافت فیزیکی کالا را بر اساس سفارش خرید سفارش‌داده‌شده ثبت کنید."
          action={
            canManage ? (
              <Link href={ROUTES.warehouseGoodsReceiptNew} className={cn(buttonVariants())}>
                ثبت اولین رسید
              </Link>
            ) : null
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">شماره رسید</th>
                <th className="px-3 py-2 text-start font-medium">وضعیت</th>
                <th className="px-3 py-2 text-start font-medium">سفارش خرید</th>
                <th className="px-3 py-2 text-start font-medium">تأمین‌کننده</th>
                <th className="px-3 py-2 text-start font-medium">انبار</th>
                <th className="px-3 py-2 text-start font-medium">تاریخ دریافت</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  onClick={() => router.push(warehouseGoodsReceiptPath(row.id))}
                >
                  <td className="px-3 py-2">
                    <Link
                      href={warehouseGoodsReceiptPath(row.id)}
                      className="font-medium text-slate-900 underline-offset-2 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {row.number}
                    </Link>
                    <div className="text-xs text-slate-500">{row.itemCount} قلم</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge>{goodsReceiptStatusLabel(row.status)}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={purchasingOrderPath(row.purchaseOrderId)}
                      className="underline-offset-2 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {row.purchaseOrderNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{row.supplierName}</td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs" dir="ltr">
                      {row.warehouseCode}
                    </span>
                    <span className="ms-1">{row.warehouseName}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {row.receivedAt ? formatDateTime(row.receivedAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta && meta.total > meta.pageSize ? (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            صفحه {meta.page} از {totalPages} · {meta.total} مورد
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              قبلی
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
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
