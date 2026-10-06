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
import { stockTransferStatusLabel } from '@/features/warehouse/transfer-labels';
import { fetchStockTransfers } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import {
  ROUTES,
  warehouseTransferPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { StockTransferStatus } from '@/types/stock-transfer';

export function TransfersPageClient() {
  const router = useRouter();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.WAREHOUSE_TRANSFER_MANAGE);

  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState<StockTransferStatus | ''>('');
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const listFilters = {
    page,
    pageSize: 20,
    status: status || undefined,
    q: search || undefined,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  };

  const listQuery = useQuery({
    queryKey: warehouseKeys.transfers.list(companyId, listFilters),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_TRANSFER_READ),
    queryFn: () => fetchStockTransfers(companyId, listFilters),
  });

  if (!can(PERMISSIONS.WAREHOUSE_TRANSFER_READ)) return <AccessDenied />;

  const listRows = listQuery.data?.data ?? [];
  const meta = listQuery.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="انتقال داخلی"
        description="جابجایی موجودی فیزیکی بین انبارها — پیش‌نویس موجودی را رزرو نمی‌کند."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'انتقال داخلی' },
        ]}
        actions={
          canManage ? (
            <Link href={ROUTES.warehouseTransferNew} className={cn(buttonVariants())}>
              انتقال جدید
            </Link>
          ) : null
        }
      />

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="transfer-search">جستجو</Label>
          <Input
            id="transfer-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="شماره TRF، مرجع یا کد انبار"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="transfer-status">وضعیت</Label>
          <select
            id="transfer-status"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StockTransferStatus | '');
              setPage(1);
            }}
          >
            <option value="">همه</option>
            <option value="DRAFT">پیش‌نویس</option>
            <option value="IN_TRANSIT">در مسیر</option>
            <option value="COMPLETED">تکمیل‌شده</option>
            <option value="CANCELLED">لغو شده</option>
          </select>
        </div>
      </div>

      {listQuery.isPending ? (
        <TableSkeleton />
      ) : listQuery.isError ? (
        <ErrorState message={mapBusinessError(listQuery.error)} onRetry={() => listQuery.refetch()} />
      ) : listRows.length === 0 ? (
        <EmptyState
          title="انتقالی ثبت نشده است."
          description="برای جابجایی بین انبارهای عملیاتی، یک انتقال جدید ایجاد کنید."
          action={
            canManage ? (
              <Link href={ROUTES.warehouseTransferNew} className={cn(buttonVariants())}>
                انتقال جدید
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">شماره</th>
                <th className="px-3 py-2 text-start font-medium">وضعیت</th>
                <th className="px-3 py-2 text-start font-medium">مبدأ</th>
                <th className="px-3 py-2 text-start font-medium">مقصد</th>
                <th className="px-3 py-2 text-start font-medium">تعداد</th>
                <th className="px-3 py-2 text-start font-medium">ایجاد</th>
              </tr>
            </thead>
            <tbody>
              {listRows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  onClick={() => router.push(warehouseTransferPath(row.id))}
                >
                  <td className="px-3 py-2 font-medium text-slate-900" dir="ltr">
                    {row.number}
                  </td>
                  <td className="px-3 py-2">
                    <Badge>{stockTransferStatusLabel(row.status)}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs" dir="ltr">
                      {row.sourceWarehouse.code}
                    </span>
                    <span className="ms-1">{row.sourceWarehouse.name}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs" dir="ltr">
                      {row.destinationWarehouse.code}
                    </span>
                    <span className="ms-1">{row.destinationWarehouse.name}</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {row.totalQuantity}
                    <span className="ms-1 text-xs text-slate-500">({row.itemCount} ردیف)</span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{formatDateTime(row.createdAt)}</td>
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
