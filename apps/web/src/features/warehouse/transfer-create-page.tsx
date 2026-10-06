'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccessDenied, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatTransferLocationLabel } from '@/features/warehouse/transfer-labels';
import {
  createStockTransfer,
  fetchInventoryBalances,
  fetchWarehouseLocations,
  fetchWarehouses,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { ROUTES, warehouseTransferPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { StockTransferItemInput } from '@/types/stock-transfer';

type LineDraft = StockTransferItemInput & {
  key: string;
  skuCode: string;
  productName: string | null;
  batchNumber: string;
};

const textareaClassName =
  'flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm';

export function TransferCreatePageClient() {
  const router = useRouter();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.WAREHOUSE_TRANSFER_MANAGE);

  const [sourceWarehouseId, setSourceWarehouseId] = React.useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [externalReference, setExternalReference] = React.useState('');
  const [lines, setLines] = React.useState<LineDraft[]>([]);

  const [sourceLocationId, setSourceLocationId] = React.useState('');
  const [destinationLocationId, setDestinationLocationId] = React.useState('');
  const [balanceKey, setBalanceKey] = React.useState('');
  const [quantityText, setQuantityText] = React.useState('');

  const warehousesQuery = useQuery({
    queryKey: warehouseKeys.list(companyId, { status: 'ACTIVE', pageSize: 100, sortBy: 'name' }),
    enabled: Boolean(companyId) && canManage,
    queryFn: () =>
      fetchWarehouses(companyId, {
        status: 'ACTIVE',
        pageSize: 100,
        sortBy: 'name',
        sortOrder: 'asc',
      }),
  });

  const warehouses = warehousesQuery.data?.data ?? [];

  const sourceLocationsQuery = useQuery({
    queryKey: warehouseKeys.locations(companyId, sourceWarehouseId, {
      status: 'ACTIVE',
      pageSize: 200,
    }),
    enabled: Boolean(companyId) && Boolean(sourceWarehouseId) && canManage,
    queryFn: () =>
      fetchWarehouseLocations(companyId, sourceWarehouseId, {
        status: 'ACTIVE',
        pageSize: 200,
        sortBy: 'code',
        sortOrder: 'asc',
      }),
  });

  const destLocationsQuery = useQuery({
    queryKey: warehouseKeys.locations(companyId, destinationWarehouseId, {
      status: 'ACTIVE',
      pageSize: 200,
    }),
    enabled: Boolean(companyId) && Boolean(destinationWarehouseId) && canManage,
    queryFn: () =>
      fetchWarehouseLocations(companyId, destinationWarehouseId, {
        status: 'ACTIVE',
        pageSize: 200,
        sortBy: 'code',
        sortOrder: 'asc',
      }),
  });

  const balancesQuery = useQuery({
    queryKey: warehouseKeys.inventory.balances(companyId, {
      warehouseId: sourceWarehouseId,
      locationId: sourceLocationId,
      pageSize: 100,
    }),
    enabled:
      Boolean(companyId) &&
      Boolean(sourceWarehouseId) &&
      Boolean(sourceLocationId) &&
      canManage,
    queryFn: () =>
      fetchInventoryBalances(companyId, {
        warehouseId: sourceWarehouseId,
        locationId: sourceLocationId,
        pageSize: 100,
      }),
  });

  const sourceLocations = sourceLocationsQuery.data?.data ?? [];
  const destLocations = destLocationsQuery.data?.data ?? [];
  const balances = (balancesQuery.data?.data ?? []).filter((b) => b.onHandQuantity > 0);

  React.useEffect(() => {
    setSourceLocationId('');
    setBalanceKey('');
  }, [sourceWarehouseId]);

  React.useEffect(() => {
    setDestinationLocationId('');
  }, [destinationWarehouseId]);

  React.useEffect(() => {
    setBalanceKey('');
  }, [sourceLocationId]);

  const addLine = () => {
    if (!sourceWarehouseId || !destinationWarehouseId) {
      toast.error('انبار مبدأ و مقصد را انتخاب کنید.');
      return;
    }
    if (sourceWarehouseId === destinationWarehouseId) {
      toast.error('انبار مبدأ و مقصد باید متفاوت باشند.');
      return;
    }
    if (!sourceLocationId || !destinationLocationId || !balanceKey) {
      toast.error('مکان، کالا/بچ و مکان مقصد را کامل کنید.');
      return;
    }
    const quantity = Number.parseInt(quantityText, 10);
    if (!Number.isFinite(quantity) || quantity < 1) {
      toast.error('تعداد باید عدد مثبت باشد.');
      return;
    }
    const balance = balances.find(
      (b) => `${b.skuId}:${b.batchId}` === balanceKey,
    );
    if (!balance) {
      toast.error('موقعیت موجودی یافت نشد.');
      return;
    }
    if (quantity > balance.onHandQuantity) {
      toast.error('تعداد بیش از موجودی فیزیکی در مبدأ است.');
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        key: `${Date.now()}-${prev.length}`,
        skuId: balance.skuId,
        batchId: balance.batchId,
        sourceLocationId,
        destinationLocationId,
        quantity,
        skuCode: balance.skuCode,
        productName: balance.productName,
        batchNumber: balance.batchNumber,
      },
    ]);
    setQuantityText('');
    setBalanceKey('');
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  const createMutation = useMutation({
    mutationFn: () => {
      if (!sourceWarehouseId || !destinationWarehouseId) throw new Error('wh');
      if (sourceWarehouseId === destinationWarehouseId) throw new Error('same');
      if (lines.length === 0) throw new Error('lines');
      return createStockTransfer(companyId, {
        sourceWarehouseId,
        destinationWarehouseId,
        notes: notes.trim() || undefined,
        externalReference: externalReference.trim() || undefined,
        items: lines.map(({ skuId, batchId, sourceLocationId, destinationLocationId, quantity, notes }) => ({
          skuId,
          batchId,
          sourceLocationId,
          destinationLocationId,
          quantity,
          notes,
        })),
      });
    },
    onSuccess: (transfer) => {
      toast.success(`انتقال ${transfer.number} ایجاد شد.`);
      router.push(warehouseTransferPath(transfer.id));
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!canManage) return <AccessDenied />;
  if (warehousesQuery.isPending) return <PageSkeleton />;
  if (warehousesQuery.isError) {
    return (
      <ErrorState
        message={mapBusinessError(warehousesQuery.error)}
        onRetry={() => warehousesQuery.refetch()}
      />
    );
  }

  const selectClassName =
    'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm';

  return (
    <div className="space-y-6">
      <PageHeader
        title="انتقال جدید"
        description="پیش‌نویس انتقال موجودی فیزیکی را بین انبارهای عملیاتی ثبت کنید — تا زمان ارسال، موجودی رزرو نمی‌شود."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'انتقال داخلی', href: ROUTES.warehouseTransfers },
          { label: 'جدید' },
        ]}
      />

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="trf-src-wh">انبار مبدأ</Label>
          <select
            id="trf-src-wh"
            className={selectClassName}
            value={sourceWarehouseId}
            onChange={(e) => setSourceWarehouseId(e.target.value)}
          >
            <option value="">انتخاب کنید</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="trf-dest-wh">انبار مقصد</Label>
          <select
            id="trf-dest-wh"
            className={selectClassName}
            value={destinationWarehouseId}
            onChange={(e) => setDestinationWarehouseId(e.target.value)}
          >
            <option value="">انتخاب کنید</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id} disabled={w.id === sourceWarehouseId}>
                {w.code} · {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="trf-notes">یادداشت</Label>
          <textarea
            id="trf-notes"
            className={textareaClassName}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="trf-ext-ref">مرجع خارجی (اختیاری)</Label>
          <Input
            id="trf-ext-ref"
            value={externalReference}
            onChange={(e) => setExternalReference(e.target.value)}
            dir="ltr"
          />
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">افزودن ردیف</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="trf-src-loc">مکان مبدأ</Label>
            <select
              id="trf-src-loc"
              className={selectClassName}
              value={sourceLocationId}
              disabled={!sourceWarehouseId}
              onChange={(e) => setSourceLocationId(e.target.value)}
            >
              <option value="">انتخاب کنید</option>
              {sourceLocations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {formatTransferLocationLabel(loc)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="trf-balance">SKU / بچ (موجودی فیزیکی)</Label>
            <select
              id="trf-balance"
              className={selectClassName}
              value={balanceKey}
              disabled={!sourceLocationId || balancesQuery.isPending}
              onChange={(e) => setBalanceKey(e.target.value)}
            >
              <option value="">انتخاب کنید</option>
              {balances.map((b) => (
                <option key={`${b.skuId}:${b.batchId}`} value={`${b.skuId}:${b.batchId}`}>
                  {b.skuCode} · {b.batchNumber} · {b.onHandQuantity} موجودی فیزیکی
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="trf-dest-loc">مکان مقصد</Label>
            <select
              id="trf-dest-loc"
              className={selectClassName}
              value={destinationLocationId}
              disabled={!destinationWarehouseId}
              onChange={(e) => setDestinationLocationId(e.target.value)}
            >
              <option value="">انتخاب کنید</option>
              {destLocations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {formatTransferLocationLabel(loc)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="trf-qty">تعداد</Label>
            <Input
              id="trf-qty"
              value={quantityText}
              onChange={(e) => setQuantityText(e.target.value)}
              dir="ltr"
              className="tabular-nums"
            />
          </div>
        </div>
        <Button type="button" variant="outline" onClick={addLine}>
          افزودن به فهرست
        </Button>
      </div>

      {lines.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">SKU</th>
                <th className="px-3 py-2 text-start font-medium">بچ</th>
                <th className="px-3 py-2 text-start font-medium">تعداد</th>
                <th className="px-3 py-2 text-start font-medium" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.key} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs" dir="ltr">
                      {line.skuCode}
                    </div>
                    <div className="text-xs text-slate-600">{line.productName ?? '—'}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                    {line.batchNumber}
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {line.quantity}
                  </td>
                  <td className="px-3 py-2 text-end">
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(line.key)}>
                      حذف
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-500">حداقل یک ردیف برای ایجاد انتقال لازم است.</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={createMutation.isPending || lines.length === 0}
          onClick={() => createMutation.mutate()}
        >
          ایجاد پیش‌نویس انتقال
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push(ROUTES.warehouseTransfers)}>
          انصراف
        </Button>
      </div>
    </div>
  );
}
