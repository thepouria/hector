'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatBatchDateOnly } from '@/features/warehouse/batch-labels';
import { stockClassificationLabel } from '@/features/warehouse/stock-issue-labels';
import { fetchInventoryBalances, fetchWarehouses } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import {
  ROUTES,
  warehouseBatchPath,
  warehouseInventoryPositionMovementsPath,
  warehouseInventorySkuPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function InventoryPageClient() {
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const searchParams = useSearchParams();
  const initialWarehouseId = searchParams.get('warehouseId') ?? '';
  const initialClassification = searchParams.get('classification') ?? '';

  const [page, setPage] = React.useState(1);
  const [warehouseId, setWarehouseId] = React.useState(initialWarehouseId);
  const [classification, setClassification] = React.useState(initialClassification);
  const [includeZero, setIncludeZero] = React.useState(false);
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    setWarehouseId(initialWarehouseId);
    setClassification(initialClassification);
    setPage(1);
  }, [initialWarehouseId, initialClassification]);

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const warehousesQuery = useQuery({
    queryKey: warehouseKeys.list(companyId, { status: 'ACTIVE', pageSize: 100, sortBy: 'name' }),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_STOCK_READ),
    queryFn: () =>
      fetchWarehouses(companyId, {
        status: 'ACTIVE',
        pageSize: 100,
        sortBy: 'name',
        sortOrder: 'asc',
      }),
  });

  const filters = {
    page,
    pageSize: 20,
    warehouseId: warehouseId || undefined,
    classification: classification || undefined,
    q: search || undefined,
    includeZero: includeZero || undefined,
  };

  const query = useQuery({
    queryKey: warehouseKeys.inventory.balances(companyId, filters),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_STOCK_READ),
    queryFn: () => fetchInventoryBalances(companyId, filters),
  });

  if (!can(PERMISSIONS.WAREHOUSE_STOCK_READ)) return <AccessDenied />;

  const rows = query.data?.data ?? [];
  const meta = query.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;
  const warehouses = warehousesQuery.data?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="موجودی فیزیکی"
        description="موجودی On Hand بر اساس دفتر حرکات — فقط خواندنی. Available = On Hand فروش‌پذیر − رزرو فعال (صفحه رزرو موجودی). تعدیل و انتقال از این صفحه انجام نمی‌شود."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'موجودی فیزیکی' },
        ]}
        actions={
          <Link
            href={ROUTES.warehouseInventoryMovements}
            className={cn(buttonVariants({ variant: 'outline' }))}
          >
            حرکات انبار
          </Link>
        }
      />

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="inv-warehouse">انبار</Label>
          <select
            id="inv-warehouse"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">همه انبارها</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="inv-classification">طبقه‌بندی</Label>
          <select
            id="inv-classification"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={classification}
            onChange={(e) => {
              setClassification(e.target.value);
              setPage(1);
            }}
          >
            <option value="">همه</option>
            <option value="SELLABLE">فروش‌پذیر</option>
            <option value="TESTER">تستر</option>
            <option value="DAMAGED">آسیب‌دیده</option>
            <option value="QUARANTINE">قرنطینه</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="inv-search">جستجو / بارکد</Label>
          <Input
            id="inv-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="SKU، محصول، بارکد، بچ، مکان یا انبار"
          />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300"
              checked={includeZero}
              onChange={(e) => {
                setIncludeZero(e.target.checked);
                setPage(1);
              }}
            />
            نمایش موجودی صفر
          </label>
        </div>
      </div>

      {query.isPending ? (
        <TableSkeleton />
      ) : query.isError ? (
        <ErrorState message={mapBusinessError(query.error)} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="ردیف موجودی یافت نشد."
          description="پس از تکمیل جایگذاری، حرکات RECEIVE در دفتر ثبت و موجودی On Hand به‌روز می‌شود."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">انبار / مکان</th>
                <th className="px-3 py-2 text-start font-medium">SKU / محصول</th>
                <th className="px-3 py-2 text-start font-medium">بچ</th>
                <th className="px-3 py-2 text-start font-medium">طبقه‌بندی</th>
                <th className="px-3 py-2 text-start font-medium">موجودی فیزیکی (On Hand)</th>
                <th className="px-3 py-2 text-start font-medium">انقضا</th>
                <th className="px-3 py-2 text-start font-medium">آخرین به‌روزرسانی</th>
                <th className="px-3 py-2 text-start font-medium">تاریخچه</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const warn =
                  row.warnings?.negativeOnHand ||
                  row.warnings?.inactiveLocation ||
                  row.warnings?.inactiveWarehouse ||
                  row.warnings?.archivedSku;
                return (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs" dir="ltr">
                        {row.warehouseCode}
                      </div>
                      <div className="text-slate-600">{row.warehouseName}</div>
                      <div className="mt-1 font-mono text-xs text-slate-700" dir="ltr">
                        {row.locationCode}
                      </div>
                      {row.locationName ? (
                        <div className="text-xs text-slate-500">{row.locationName}</div>
                      ) : null}
                      {row.warnings?.inactiveLocation || row.warnings?.inactiveWarehouse ? (
                        <div className="mt-1 text-xs font-medium text-amber-700">
                          موقعیت غیرفعال با موجودی
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={warehouseInventorySkuPath(row.skuId)}
                        className="font-mono text-xs underline-offset-2 hover:underline"
                        dir="ltr"
                      >
                        {row.skuCode}
                      </Link>
                      <div>{row.productName ?? '—'}</div>
                      {row.warnings?.archivedSku ? (
                        <div className="mt-1 text-xs font-medium text-amber-700">
                          SKU آرشیو شده — موجودی همچنان قابل مشاهده است
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={warehouseBatchPath(row.batchId)}
                        className="font-mono text-xs underline-offset-2 hover:underline"
                        dir="ltr"
                      >
                        {row.batchNumber}
                      </Link>
                      {row.supplierBatchNumber ? (
                        <div className="text-xs text-slate-500" dir="ltr">
                          {row.supplierBatchNumber}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {row.classification
                        ? stockClassificationLabel(row.classification)
                        : '—'}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 tabular-nums font-medium',
                        row.warnings?.negativeOnHand
                          ? 'text-red-700'
                          : 'text-slate-900',
                      )}
                      dir="ltr"
                    >
                      {row.onHandQuantity}
                      {row.warnings?.negativeOnHand ? (
                        <div className="text-xs font-medium">خطای یکپارچگی منفی</div>
                      ) : null}
                      {warn && !row.warnings?.negativeOnHand ? (
                        <div className="sr-only">هشدار عملیاتی</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2" dir="ltr">
                      {row.expiresAt ? formatBatchDateOnly(row.expiresAt) : '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{formatDateTime(row.updatedAt)}</td>
                    <td className="px-3 py-2">
                      <Link
                        href={warehouseInventoryPositionMovementsPath({
                          skuId: row.skuId,
                          batchId: row.batchId,
                          warehouseId: row.warehouseId,
                          locationId: row.locationId,
                        })}
                        className="text-xs underline-offset-2 hover:underline"
                      >
                        مشاهده حرکات
                      </Link>
                    </td>
                  </tr>
                );
              })}
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
