'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccessDenied, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { stockClassificationLabel } from '@/features/warehouse/stock-count-labels';
import { createStockCount, fetchSkus, fetchWarehouseLocations, fetchWarehouses } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { ROUTES, warehouseCountPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { StockCountType } from '@/types/stock-count';
import type { StockClassification } from '@/types/stock-classification';

const textareaClassName =
  'flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm';

const ALL_CLASSIFICATIONS: StockClassification[] = [
  'SELLABLE',
  'TESTER',
  'DAMAGED',
  'QUARANTINE',
];

export function CountCreatePageClient() {
  const router = useRouter();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canCreate = can(PERMISSIONS.WAREHOUSE_COUNT_CREATE);

  const [warehouseId, setWarehouseId] = React.useState('');
  const [type, setType] = React.useState<StockCountType>('CYCLE');
  const [blindCount, setBlindCount] = React.useState(false);
  const [allowDiscovered, setAllowDiscovered] = React.useState(false);
  const [notes, setNotes] = React.useState('');
  const [locationIds, setLocationIds] = React.useState<string[]>([]);
  const [skuIds, setSkuIds] = React.useState<string[]>([]);
  const [classifications, setClassifications] = React.useState<StockClassification[]>([]);
  const [skuSearch, setSkuSearch] = React.useState('');

  const warehousesQuery = useQuery({
    queryKey: warehouseKeys.list(companyId, { status: 'ACTIVE', pageSize: 100, sortBy: 'name' }),
    enabled: Boolean(companyId) && canCreate,
    queryFn: () =>
      fetchWarehouses(companyId, {
        status: 'ACTIVE',
        pageSize: 100,
        sortBy: 'name',
        sortOrder: 'asc',
      }),
  });

  const locationsQuery = useQuery({
    queryKey: warehouseKeys.locations(companyId, warehouseId, {
      status: 'ACTIVE',
      pageSize: 300,
    }),
    enabled: Boolean(companyId) && Boolean(warehouseId) && canCreate,
    queryFn: () =>
      fetchWarehouseLocations(companyId, warehouseId, {
        status: 'ACTIVE',
        pageSize: 300,
        sortBy: 'code',
        sortOrder: 'asc',
      }),
  });

  const skusQuery = useQuery({
    queryKey: ['catalog-skus-search', companyId, skuSearch],
    enabled: Boolean(companyId) && skuSearch.trim().length >= 2 && canCreate,
    queryFn: () => fetchSkus(companyId, { q: skuSearch.trim(), pageSize: 20 }),
  });

  const warehouses = warehousesQuery.data?.data ?? [];
  const locations = locationsQuery.data?.data ?? [];
  const skuHits = skusQuery.data?.data ?? [];

  const toggleLocation = (id: string) => {
    setLocationIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleClassification = (c: StockClassification) => {
    setClassifications((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  };

  const addSku = (id: string) => {
    setSkuIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setSkuSearch('');
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createStockCount(companyId, {
        warehouseId,
        type,
        locationIds: locationIds.length ? locationIds : undefined,
        skuIds: skuIds.length ? skuIds : undefined,
        classifications: classifications.length ? classifications : undefined,
        blindCount,
        allowDiscoveredItems: allowDiscovered,
        notes: notes.trim() || undefined,
      }),
    onSuccess: (data) => {
      toast.success('پیش‌نویس شمارش ایجاد شد.');
      router.push(warehouseCountPath(data.id));
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!canCreate) return <AccessDenied />;
  if (warehousesQuery.isPending) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="شمارش جدید"
        description="محدوده شمارش را تعریف کنید. پس از «شروع»، ردیف‌ها از موجودی فعلی ساخته می‌شوند."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'شمارش موجودی', href: ROUTES.warehouseCounts },
          { label: 'جدید' },
        ]}
      />

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="count-wh">انبار</Label>
          <select
            id="count-wh"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setLocationIds([]);
            }}
          >
            <option value="">انتخاب انبار</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="count-type">نوع</Label>
          <select
            id="count-type"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value as StockCountType)}
          >
            <option value="FULL">کامل (FULL)</option>
            <option value="CYCLE">چرخه‌ای (CYCLE)</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="count-blind"
            type="checkbox"
            checked={blindCount}
            onChange={(e) => setBlindCount(e.target.checked)}
          />
          <Label htmlFor="count-blind">شمارش کور (بدون نمایش Snapshot)</Label>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="count-discovered"
            type="checkbox"
            checked={allowDiscovered}
            onChange={(e) => setAllowDiscovered(e.target.checked)}
          />
          <Label htmlFor="count-discovered">اجازه قلم کشف‌شده</Label>
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor="count-notes">یادداشت</Label>
          <textarea
            id="count-notes"
            className={textareaClassName}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold">محدوده (اختیاری)</h2>
        <p className="text-sm text-slate-600">
          اگر خالی بماند، شمارش کل انبار (یا طبق نوع FULL/CYCLE در سمت سرور) اعمال می‌شود.
        </p>

        <div className="space-y-2">
          <Label>طبقه‌بندی‌ها</Label>
          <div className="flex flex-wrap gap-3">
            {ALL_CLASSIFICATIONS.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={classifications.includes(c)}
                  onChange={() => toggleClassification(c)}
                />
                {stockClassificationLabel(c)}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>مکان‌ها</Label>
          <div className="max-h-48 overflow-y-auto rounded-md border border-slate-100 p-2">
            {!warehouseId ? (
              <p className="text-sm text-slate-500">ابتدا انبار را انتخاب کنید.</p>
            ) : locations.length === 0 ? (
              <p className="text-sm text-slate-500">مکانی یافت نشد.</p>
            ) : (
              locations.map((loc) => (
                <label key={loc.id} className="flex items-center gap-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    checked={locationIds.includes(loc.id)}
                    onChange={() => toggleLocation(loc.id)}
                  />
                  <span className="font-mono text-xs" dir="ltr">
                    {loc.code}
                  </span>
                </label>
              ))
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="count-sku-search">SKUها</Label>
          <Input
            id="count-sku-search"
            value={skuSearch}
            onChange={(e) => setSkuSearch(e.target.value)}
            placeholder="جستجوی کد SKU (حداقل ۲ حرف)"
          />
          {skuHits.length > 0 ? (
            <ul className="rounded-md border border-slate-100">
              {skuHits.map((sku) => (
                <li key={sku.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-start text-sm hover:bg-slate-50"
                    onClick={() => addSku(sku.id)}
                  >
                    <span className="font-mono text-xs" dir="ltr">
                      {sku.code}
                    </span>
                    <span className="text-xs text-slate-500">{sku.name ?? sku.product.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {skuIds.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {skuIds.map((id) => (
                <span
                  key={id}
                  className="rounded-full bg-slate-100 px-2 py-1 font-mono text-xs"
                  dir="ltr"
                >
                  {id.slice(0, 8)}…
                  <button
                    type="button"
                    className="ms-1 text-slate-500"
                    onClick={() => setSkuIds((prev) => prev.filter((x) => x !== id))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.push(ROUTES.warehouseCounts)}>
          انصراف
        </Button>
        <Button
          type="button"
          disabled={!warehouseId || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          ایجاد پیش‌نویس
        </Button>
      </div>
    </div>
  );
}
