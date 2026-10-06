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
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatBatchDateOnly } from '@/features/warehouse/batch-labels';
import {
  formatInventoryQuantityDelta,
  inventoryMovementTypeLabel,
  inventorySourceTypeLabel,
} from '@/features/warehouse/inventory-labels';
import { fetchInventoryMovements, fetchWarehouses } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import {
  ROUTES,
  warehouseInventoryMovementPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { InventoryMovementType } from '@/types/inventory';

const MOVEMENT_TYPE_OPTIONS: { value: InventoryMovementType | ''; label: string }[] = [
  { value: '', label: 'همه انواع' },
  { value: 'RECEIVE', label: 'دریافت' },
  { value: 'ISSUE', label: 'خروج' },
  { value: 'TRANSFER_OUT', label: 'انتقال (خروج)' },
  { value: 'TRANSFER_IN', label: 'انتقال (ورود)' },
  { value: 'ADJUSTMENT_IN', label: 'تعدیل (افزایش)' },
  { value: 'ADJUSTMENT_OUT', label: 'تعدیل (کاهش)' },
  { value: 'RETURN_IN', label: 'برگشت (ورود)' },
  { value: 'RETURN_OUT', label: 'برگشت (خروج)' },
  { value: 'STOCK_COUNT_ADJUSTMENT_IN', label: 'انبارگردانی (افزایش)' },
  { value: 'STOCK_COUNT_ADJUSTMENT_OUT', label: 'انبارگردانی (کاهش)' },
  { value: 'OPENING_BALANCE', label: 'موجودی اول دوره' },
  { value: 'SYSTEM_CORRECTION', label: 'اصلاح سیستمی' },
];

export function InventoryMovementsPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';

  const positionSkuId = searchParams.get('skuId') ?? '';
  const positionBatchId = searchParams.get('batchId') ?? '';
  const positionLocationId = searchParams.get('locationId') ?? '';
  const positionWarehouseId = searchParams.get('warehouseId') ?? '';
  const filterSourceType = searchParams.get('sourceType') ?? '';
  const filterSourceId = searchParams.get('sourceId') ?? '';

  const [page, setPage] = React.useState(1);
  const [warehouseId, setWarehouseId] = React.useState(positionWarehouseId);
  const [movementType, setMovementType] = React.useState<InventoryMovementType | ''>('');
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    if (positionWarehouseId) setWarehouseId(positionWarehouseId);
  }, [positionWarehouseId]);

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
    locationId: positionLocationId || undefined,
    skuId: positionSkuId || undefined,
    batchId: positionBatchId || undefined,
    movementType: movementType || undefined,
    sourceType: filterSourceType || undefined,
    sourceId: filterSourceId || undefined,
    q: search || undefined,
  };

  const query = useQuery({
    queryKey: warehouseKeys.inventory.movements.list(companyId, filters),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_STOCK_READ),
    queryFn: () => fetchInventoryMovements(companyId, filters),
  });

  if (!can(PERMISSIONS.WAREHOUSE_STOCK_READ)) return <AccessDenied />;

  const rows = query.data?.data ?? [];
  const meta = query.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;
  const warehouses = warehousesQuery.data?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="حرکات انبار"
        description="دفتر حرکات موجودی — هر ردیف ثبت‌شده غیرقابل ویرایش یا حذف است."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'موجودی فیزیکی', href: ROUTES.warehouseInventory },
          { label: 'حرکات انبار' },
        ]}
        actions={
          <Link href={ROUTES.warehouseInventory} className={cn(buttonVariants({ variant: 'outline' }))}>
            موجودی فیزیکی
          </Link>
        }
      />

      {positionSkuId || positionBatchId || positionLocationId ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          فیلتر موقعیت موجودی فعال است
          <span className="ms-2 font-mono text-xs" dir="ltr">
            {[
              positionWarehouseId && `warehouse=${positionWarehouseId.slice(0, 8)}`,
              positionLocationId && `location=${positionLocationId.slice(0, 8)}`,
              positionSkuId && `sku=${positionSkuId.slice(0, 8)}`,
              positionBatchId && `batch=${positionBatchId.slice(0, 8)}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      ) : null}

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="mov-warehouse">انبار</Label>
          <select
            id="mov-warehouse"
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
          <Label htmlFor="mov-type">نوع حرکت</Label>
          <select
            id="mov-type"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={movementType}
            onChange={(e) => {
              setMovementType(e.target.value as InventoryMovementType | '');
              setPage(1);
            }}
          >
            {MOVEMENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value || 'all'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="mov-search">جستجو</Label>
          <Input
            id="mov-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="SKU، بچ، مکان یا شناسه منبع"
          />
        </div>
      </div>

      {query.isPending ? (
        <TableSkeleton />
      ) : query.isError ? (
        <ErrorState message={mapBusinessError(query.error)} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="حرکتی ثبت نشده است."
          description="حرکات پس از تکمیل جایگذاری و سایر عملیات انبار در این دفتر ظاهر می‌شوند."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">زمان</th>
                <th className="px-3 py-2 text-start font-medium">نوع</th>
                <th className="px-3 py-2 text-start font-medium">تغییر تعداد</th>
                <th className="px-3 py-2 text-start font-medium">SKU / بچ</th>
                <th className="px-3 py-2 text-start font-medium">انبار / مکان</th>
                <th className="px-3 py-2 text-start font-medium">منبع</th>
                <th className="px-3 py-2 text-start font-medium">ثبت‌کننده</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const deltaText = formatInventoryQuantityDelta(row.quantityDelta);
                const deltaClass =
                  row.quantityDelta > 0
                    ? 'text-emerald-800'
                    : row.quantityDelta < 0
                      ? 'text-red-800'
                      : 'text-slate-700';
                return (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                    onClick={() => router.push(warehouseInventoryMovementPath(row.id))}
                  >
                    <td className="px-3 py-2 text-slate-600">{formatDateTime(row.occurredAt)}</td>
                    <td className="px-3 py-2">
                      <Badge>{inventoryMovementTypeLabel(row.movementType)}</Badge>
                    </td>
                    <td className={`px-3 py-2 tabular-nums font-semibold ${deltaClass}`} dir="ltr">
                      {deltaText}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs" dir="ltr">
                        {row.skuCode}
                      </div>
                      <div className="font-mono text-xs text-slate-600" dir="ltr">
                        {row.batchNumber}
                      </div>
                      {row.expiresAt ? (
                        <div className="text-xs text-slate-500">
                          انقضا: {formatBatchDateOnly(row.expiresAt)}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs" dir="ltr">
                        {row.warehouseCode} · {row.locationCode}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>{inventorySourceTypeLabel(row.sourceType)}</div>
                      <div className="font-mono text-xs text-slate-500" dir="ltr">
                        {row.sourceId.slice(0, 8)}…
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {row.createdBy?.displayName ?? '—'}
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
