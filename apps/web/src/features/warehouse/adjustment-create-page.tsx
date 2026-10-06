'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccessDenied, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  inventoryAdjustmentDirectionLabel,
  stockClassificationLabel,
} from '@/features/warehouse/inventory-adjustment-labels';
import {
  createInventoryAdjustment,
  fetchBatches,
  fetchInventoryBalances,
  fetchWarehouseLocations,
  fetchWarehouses,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { ROUTES, warehouseAdjustmentPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type {
  InventoryAdjustmentDirection,
  InventoryAdjustmentItemInput,
  InventoryAdjustmentReason,
} from '@/types/inventory-adjustment';
import type { StockClassification } from '@/types/stock-classification';

type LineDraft = InventoryAdjustmentItemInput & {
  key: string;
  skuCode: string;
  productName: string | null;
  batchNumber: string;
  onHand: number;
  lineNotes: string;
};

const textareaClassName =
  'flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm';

export function AdjustmentCreatePageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canCreate = can(PERMISSIONS.WAREHOUSE_ADJUSTMENT_CREATE);

  const [warehouseId, setWarehouseId] = React.useState(searchParams.get('warehouseId') ?? '');
  const [reason, setReason] = React.useState<InventoryAdjustmentReason>(
    (searchParams.get('reason') as InventoryAdjustmentReason) || 'CORRECTION',
  );
  const [reasonText, setReasonText] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState<LineDraft[]>([]);

  const [locationId, setLocationId] = React.useState(searchParams.get('locationId') ?? '');
  const [direction, setDirection] = React.useState<InventoryAdjustmentDirection>('IN');
  const [balanceKey, setBalanceKey] = React.useState('');
  const [skuIdForIn, setSkuIdForIn] = React.useState('');
  const [batchIdForIn, setBatchIdForIn] = React.useState('');
  const [classification, setClassification] = React.useState<StockClassification>(
    (searchParams.get('classification') as StockClassification) || 'SELLABLE',
  );
  const [quantityText, setQuantityText] = React.useState('');
  const [lineNotes, setLineNotes] = React.useState('');

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
      pageSize: 200,
    }),
    enabled: Boolean(companyId) && Boolean(warehouseId) && canCreate,
    queryFn: () =>
      fetchWarehouseLocations(companyId, warehouseId, {
        status: 'ACTIVE',
        pageSize: 200,
        sortBy: 'code',
        sortOrder: 'asc',
      }),
  });

  const balancesQuery = useQuery({
    queryKey: warehouseKeys.inventory.balances(companyId, {
      warehouseId,
      locationId,
      classification,
      pageSize: 100,
    }),
    enabled: Boolean(companyId) && Boolean(warehouseId) && Boolean(locationId) && canCreate,
    queryFn: () =>
      fetchInventoryBalances(companyId, {
        warehouseId,
        locationId,
        classification,
        pageSize: 100,
      }),
  });

  const batchesQuery = useQuery({
    queryKey: warehouseKeys.batches.list(companyId, { skuId: skuIdForIn, pageSize: 50 }),
    enabled: Boolean(companyId) && direction === 'IN' && Boolean(skuIdForIn) && canCreate,
    queryFn: () => fetchBatches(companyId, { skuId: skuIdForIn, pageSize: 50 }),
  });

  const warehouses = warehousesQuery.data?.data ?? [];
  const locations = locationsQuery.data?.data ?? [];
  const balances = balancesQuery.data?.data ?? [];
  const balanceOptions =
    direction === 'OUT' ? balances.filter((b) => b.onHandQuantity > 0) : balances;
  const batches = batchesQuery.data?.data ?? [];

  React.useEffect(() => {
    if (!searchParams.get('locationId')) setLocationId('');
    setBalanceKey('');
    setSkuIdForIn('');
    setBatchIdForIn('');
  }, [warehouseId, searchParams]);

  React.useEffect(() => {
    setBalanceKey('');
    setSkuIdForIn('');
    setBatchIdForIn('');
  }, [locationId, classification, direction]);

  const previewLine = (
    onHand: number,
    qty: number,
    dir: InventoryAdjustmentDirection,
  ): { change: number; result: number } => {
    const change = dir === 'IN' ? qty : -qty;
    return { change, result: onHand + change };
  };

  const addLine = () => {
    if (!warehouseId || !locationId) {
      toast.error('انبار و مکان را کامل کنید.');
      return;
    }
    const quantity = Number.parseInt(quantityText, 10);
    if (!Number.isFinite(quantity) || quantity < 1) {
      toast.error('تعداد باید عدد مثبت باشد.');
      return;
    }

    let skuId = '';
    let batchId = '';
    let skuCode = '';
    let productName: string | null = null;
    let batchNumber = '';
    let onHand = 0;

    if (direction === 'OUT') {
      if (!balanceKey) {
        toast.error('موقعیت موجودی را انتخاب کنید.');
        return;
      }
      const balance = balances.find(
        (b) => `${b.skuId}:${b.batchId}:${b.classification}` === balanceKey,
      );
      if (!balance) {
        toast.error('موقعیت موجودی یافت نشد.');
        return;
      }
      if (quantity > balance.onHandQuantity) {
        toast.error('تعداد بیش از موجودی فعلی است.');
        return;
      }
      skuId = balance.skuId;
      batchId = balance.batchId;
      skuCode = balance.skuCode;
      productName = balance.productName;
      batchNumber = balance.batchNumber;
      onHand = balance.onHandQuantity;
    } else {
      if (balanceKey) {
        const balance = balances.find(
          (b) => `${b.skuId}:${b.batchId}:${b.classification}` === balanceKey,
        );
        if (balance) {
          skuId = balance.skuId;
          batchId = balance.batchId;
          skuCode = balance.skuCode;
          productName = balance.productName;
          batchNumber = balance.batchNumber;
          onHand = balance.onHandQuantity;
        }
      }
      if (!skuId && skuIdForIn && batchIdForIn) {
        const batch = batches.find((b) => b.id === batchIdForIn);
        if (!batch) {
          toast.error('بچ یافت نشد.');
          return;
        }
        skuId = skuIdForIn;
        batchId = batchIdForIn;
        skuCode = batch.skuCode;
        productName = batch.productName;
        batchNumber = batch.batchNumber;
        onHand = 0;
      }
      if (!skuId || !batchId) {
        toast.error('محصول / SKU و بچ را انتخاب کنید.');
        return;
      }
    }

    setLines((prev) => [
      ...prev,
      {
        key: `${Date.now()}-${prev.length}`,
        locationId,
        skuId,
        batchId,
        classification,
        direction,
        quantity,
        notes: lineNotes.trim() || undefined,
        skuCode,
        productName,
        batchNumber,
        onHand,
        lineNotes: lineNotes.trim(),
      },
    ]);
    setQuantityText('');
    setLineNotes('');
    setBalanceKey('');
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createInventoryAdjustment(companyId, {
        warehouseId,
        reason,
        reasonText: reasonText.trim() || undefined,
        notes: notes.trim() || undefined,
        items: lines.map(
          ({ locationId, skuId, batchId, classification, direction, quantity, notes }) => ({
            locationId,
            skuId,
            batchId,
            classification,
            direction,
            quantity,
            notes,
          }),
        ),
      }),
    onSuccess: (data) => {
      toast.success('پیش‌نویس تعدیل ایجاد شد.');
      router.push(warehouseAdjustmentPath(data.id));
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!canCreate) return <AccessDenied />;
  if (warehousesQuery.isPending) return <PageSkeleton />;

  const needsReasonText =
    reason === 'REGISTRATION_ERROR' || reason === 'CORRECTION' || reason === 'OTHER';

  const selectedBalance = balanceKey
    ? balances.find((b) => `${b.skuId}:${b.batchId}:${b.classification}` === balanceKey)
    : null;
  const previewQty = Number.parseInt(quantityText, 10);
  const showPreview =
    selectedBalance &&
    Number.isFinite(previewQty) &&
    previewQty >= 1 &&
    direction === (balanceKey ? direction : direction);

  return (
    <div className="space-y-6">
      <PageHeader
        title="تعدیل جدید"
        description="پیش‌نویس تعدیل موجودی — تا قبل از ثبت، موجودی تغییر نمی‌کند."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'تعدیل موجودی', href: ROUTES.warehouseAdjustments },
          { label: 'جدید' },
        ]}
      />

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="adj-wh">انبار</Label>
          <select
            id="adj-wh"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
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
          <Label htmlFor="adj-reason">دلیل</Label>
          <select
            id="adj-reason"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value as InventoryAdjustmentReason)}
          >
            <option value="FOUND">یافت‌شده</option>
            <option value="MISSING">مفقود</option>
            <option value="REGISTRATION_ERROR">خطای ثبت</option>
            <option value="CORRECTION">اصلاح</option>
            <option value="OTHER">سایر</option>
          </select>
        </div>
        {needsReasonText ? (
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="adj-reason-text">توضیح دلیل (الزامی)</Label>
            <Input
              id="adj-reason-text"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
            />
          </div>
        ) : null}
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor="adj-notes">یادداشت</Label>
          <textarea
            id="adj-notes"
            className={textareaClassName}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold">افزودن قلم</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label>مکان</Label>
            <select
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              disabled={!warehouseId}
            >
              <option value="">انتخاب مکان</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.code}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>جهت</Label>
            <select
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={direction}
              onChange={(e) => setDirection(e.target.value as InventoryAdjustmentDirection)}
            >
              <option value="IN">ورود (IN)</option>
              <option value="OUT">خروج (OUT)</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>طبقه‌بندی</Label>
            <select
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={classification}
              onChange={(e) => setClassification(e.target.value as StockClassification)}
            >
              <option value="SELLABLE">قابل فروش</option>
              <option value="TESTER">تستر</option>
              <option value="DAMAGED">آسیب‌دیده</option>
              <option value="QUARANTINE">قرنطینه</option>
            </select>
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>SKU / بچ (موجودی)</Label>
            <select
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={balanceKey}
              onChange={(e) => {
                setBalanceKey(e.target.value);
                const parts = e.target.value.split(':');
                if (parts[0]) setSkuIdForIn(parts[0]);
                if (parts[1]) setBatchIdForIn(parts[1]);
              }}
              disabled={!locationId}
            >
              <option value="">انتخاب موقعیت (اختیاری برای ورود جدید)</option>
              {balanceOptions.map((b) => (
                <option
                  key={`${b.skuId}:${b.batchId}:${b.classification}`}
                  value={`${b.skuId}:${b.batchId}:${b.classification}`}
                >
                  {b.skuCode} · {b.batchNumber} · On Hand {b.onHandQuantity}
                </option>
              ))}
            </select>
          </div>
          {direction === 'IN' && !balanceKey ? (
            <>
              <div className="space-y-1">
                <Label>SKU (شناسه)</Label>
                <Input
                  value={skuIdForIn}
                  onChange={(e) => {
                    setSkuIdForIn(e.target.value.trim());
                    setBatchIdForIn('');
                  }}
                  placeholder="UUID"
                  dir="ltr"
                />
              </div>
              <div className="space-y-1">
                <Label>بچ</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={batchIdForIn}
                  onChange={(e) => setBatchIdForIn(e.target.value)}
                  disabled={!skuIdForIn}
                >
                  <option value="">انتخاب بچ</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batchNumber}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : null}
          <div className="space-y-1">
            <Label>تعداد</Label>
            <Input
              value={quantityText}
              onChange={(e) => setQuantityText(e.target.value)}
              inputMode="numeric"
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>یادداشت قلم</Label>
            <Input value={lineNotes} onChange={(e) => setLineNotes(e.target.value)} />
          </div>
          {showPreview && selectedBalance ? (
            <div className="rounded-md bg-slate-50 px-3 py-2 text-sm md:col-span-2 lg:col-span-4">
              <span className="text-slate-600">پیش‌نمایش: </span>
              <span dir="ltr" className="tabular-nums">
                Current {selectedBalance.onHandQuantity} · Change{' '}
                {previewLine(selectedBalance.onHandQuantity, previewQty, direction).change} · Result{' '}
                {previewLine(selectedBalance.onHandQuantity, previewQty, direction).result}
              </span>
            </div>
          ) : null}
          <div className="flex items-end">
            <Button type="button" variant="outline" onClick={addLine}>
              افزودن قلم
            </Button>
          </div>
        </div>

        {lines.length > 0 ? (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-100">
            {lines.map((line) => {
              const p = previewLine(line.onHand, line.quantity, line.direction);
              return (
                <li key={line.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div>
                    <div className="font-mono text-xs" dir="ltr">
                      {line.skuCode} · {line.batchNumber}
                    </div>
                    <div className="text-xs text-slate-600">
                      {inventoryAdjustmentDirectionLabel(line.direction)} ·{' '}
                      {stockClassificationLabel(line.classification)} · qty {line.quantity}
                    </div>
                    <div className="text-xs text-slate-500" dir="ltr">
                      Current {line.onHand} → Result {p.result}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                  >
                    حذف
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(ROUTES.warehouseAdjustments)}
        >
          انصراف
        </Button>
        <Button
          type="button"
          disabled={
            !warehouseId ||
            lines.length === 0 ||
            (needsReasonText && !reasonText.trim()) ||
            createMutation.isPending
          }
          onClick={() => createMutation.mutate()}
        >
          ایجاد پیش‌نویس
        </Button>
      </div>
    </div>
  );
}
