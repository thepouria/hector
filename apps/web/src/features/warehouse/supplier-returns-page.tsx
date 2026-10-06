'use client';

import * as React from 'react';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  supplierReturnFulfillmentStatusLabel,
} from '@/features/warehouse/supplier-return-labels';
import { fetchWarehouseSupplierReturns } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { ROUTES, warehouseSupplierReturnPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { SupplierReturnFulfillmentStatus } from '@/types/supplier-return-execution';

export function SupplierReturnsPageClient() {
  const router = useRouter();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';

  const [page, setPage] = React.useState(1);
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [fulfillmentStatus, setFulfillmentStatus] = React.useState<
    SupplierReturnFulfillmentStatus | ''
  >('');
  const [queueOnly, setQueueOnly] = React.useState(true);

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
    q: search || undefined,
    fulfillmentStatus: fulfillmentStatus || undefined,
  };

  const listQuery = useQuery({
    queryKey: warehouseKeys.supplierReturns.list(companyId, listFilters),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_READ),
    queryFn: () => fetchWarehouseSupplierReturns(companyId, listFilters),
  });

  if (!can(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_READ)) return <AccessDenied />;

  let listRows = listQuery.data?.data ?? [];
  if (queueOnly) {
    listRows = listRows.filter((row) => row.progress.remainingQuantity > 0);
  }
  const meta = listQuery.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="برگشت به تأمین‌کننده"
        description="صف اجرای فیزیکی برگشت‌های خرید تأیید‌شده — خروج فقط از طریق RETURN_OUT."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'برگشت به تأمین‌کننده' },
        ]}
      />

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="sret-search">جستجو</Label>
          <Input
            id="sret-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="شماره PR یا تأمین‌کننده"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sret-fulfillment">پیشرفت ارسال</Label>
          <select
            id="sret-fulfillment"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={fulfillmentStatus}
            onChange={(e) => {
              setFulfillmentStatus(e.target.value as SupplierReturnFulfillmentStatus | '');
              setPage(1);
            }}
          >
            <option value="">همه</option>
            <option value="NOT_DISPATCHED">بدون ارسال</option>
            <option value="PARTIALLY_DISPATCHED">ارسال جزئی</option>
            <option value="FULLY_DISPATCHED">ارسال کامل</option>
          </select>
        </div>
        <div className="flex items-end gap-2 pb-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={queueOnly}
              onChange={(e) => setQueueOnly(e.target.checked)}
            />
            فقط با مانده ارسال
          </label>
        </div>
      </div>

      {listQuery.isPending ? (
        <TableSkeleton />
      ) : listQuery.isError ? (
        <ErrorState
          message={mapBusinessError(listQuery.error)}
          onRetry={() => listQuery.refetch()}
        />
      ) : listRows.length === 0 ? (
        <EmptyState title="برگشت تأیید‌شده‌ای در صف نیست." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">شماره PR</th>
                <th className="px-3 py-2 text-start font-medium">تأمین‌کننده</th>
                <th className="px-3 py-2 text-start font-medium">سفارش خرید</th>
                <th className="px-3 py-2 text-start font-medium">پیشرفت</th>
                <th className="px-3 py-2 text-start font-medium">مجاز</th>
                <th className="px-3 py-2 text-start font-medium">ارسال‌شده</th>
                <th className="px-3 py-2 text-start font-medium">مانده</th>
                <th className="px-3 py-2 text-start font-medium">تأیید</th>
              </tr>
            </thead>
            <tbody>
              {listRows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  onClick={() => router.push(warehouseSupplierReturnPath(row.id))}
                >
                  <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                    {row.number}
                  </td>
                  <td className="px-3 py-2">{row.supplierName}</td>
                  <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                    {row.purchaseOrderNumber ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Badge>{supplierReturnFulfillmentStatusLabel(row.progress.fulfillmentStatus)}</Badge>
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {row.progress.approvedQuantity}
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {row.progress.dispatchedQuantity}
                  </td>
                  <td className="px-3 py-2 tabular-nums font-medium" dir="ltr">
                    {row.progress.remainingQuantity}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {row.approvedAt ? formatDateTime(row.approvedAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta && totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            قبلی
          </Button>
          <div className="text-sm text-slate-600" dir="ltr">
            {page} / {totalPages}
          </div>
          <Button
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            بعدی
          </Button>
        </div>
      ) : null}
    </div>
  );
}
