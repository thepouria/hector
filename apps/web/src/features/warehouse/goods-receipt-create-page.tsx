'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccessDenied, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { purchaseOrderStatusLabel } from '@/features/purchasing/purchase-order-labels';
import {
  createGoodsReceipt,
  fetchEligiblePurchaseOrdersForReceipt,
  fetchPurchaseOrderReceivingProgress,
  fetchWarehouses,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { ROUTES, warehouseGoodsReceiptPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

const textareaClassName =
  'flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm';

type LineDraft = {
  purchaseOrderItemId: string;
  skuCode: string | null;
  productName: string | null;
  orderedQuantity: number;
  postedReceivedQuantity: number;
  shortQuantity: number;
  remainingQuantity: number;
  quantity: string;
};

export function GoodsReceiptCreatePageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.WAREHOUSE_RECEIPT_MANAGE);
  const initialPoId = searchParams.get('purchaseOrderId') ?? '';

  const [purchaseOrderId, setPurchaseOrderId] = React.useState(initialPoId);
  const [warehouseId, setWarehouseId] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState<LineDraft[]>([]);

  React.useEffect(() => {
    if (initialPoId) setPurchaseOrderId(initialPoId);
  }, [initialPoId]);

  const eligibleQuery = useQuery({
    queryKey: warehouseKeys.goodsReceipts.eligiblePurchaseOrders(companyId),
    enabled: Boolean(companyId) && canManage,
    queryFn: () => fetchEligiblePurchaseOrdersForReceipt(companyId),
  });

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

  const progressQuery = useQuery({
    queryKey: warehouseKeys.goodsReceipts.purchaseOrderProgress(companyId, purchaseOrderId),
    enabled: Boolean(companyId) && Boolean(purchaseOrderId) && canManage,
    queryFn: () => fetchPurchaseOrderReceivingProgress(companyId, purchaseOrderId),
  });

  React.useEffect(() => {
    const progress = progressQuery.data;
    if (!progress) {
      setLines([]);
      return;
    }
    setLines(
      progress.items.map((item) => ({
        purchaseOrderItemId: item.purchaseOrderItemId,
        skuCode: item.skuCode,
        productName: item.productName,
        orderedQuantity: item.orderedQuantity,
        postedReceivedQuantity: item.postedReceivedQuantity ?? item.receivedQuantity,
        shortQuantity: item.shortQuantity ?? item.closedUnfulfilledQuantity ?? 0,
        remainingQuantity: item.remainingQuantity,
        quantity: '',
      })),
    );
  }, [progressQuery.data]);

  React.useEffect(() => {
    const warehouses = warehousesQuery.data?.data ?? [];
    const defaultWh = warehouses.find((w) => w.isDefault);
    if (!warehouseId && defaultWh) {
      setWarehouseId(defaultWh.id);
    }
  }, [warehousesQuery.data, warehouseId]);

  const receiveAllRemaining = () => {
    setLines((prev) =>
      prev.map((line) => ({
        ...line,
        quantity: line.remainingQuantity > 0 ? String(line.remainingQuantity) : '',
      })),
    );
  };

  const createMutation = useMutation({
    mutationFn: () => {
      if (!purchaseOrderId) throw new Error('po');
      if (!warehouseId) throw new Error('warehouse');
      const items = lines
        .map((line) => {
          const trimmed = line.quantity.trim();
          if (!trimmed) return null;
          const quantity = Number(trimmed);
          if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('quantity');
          return {
            purchaseOrderItemId: line.purchaseOrderItemId,
            quantity,
          };
        })
        .filter((item): item is { purchaseOrderItemId: string; quantity: number } => item !== null);
      return createGoodsReceipt(companyId, {
        purchaseOrderId,
        warehouseId,
        notes: notes.trim() || undefined,
        items: items.length > 0 ? items : undefined,
      });
    },
    onSuccess: async (row) => {
      toast.success('رسید کالا به‌صورت پیش‌نویس ذخیره شد.');
      await queryClient.invalidateQueries({
        queryKey: warehouseKeys.goodsReceipts.all(companyId),
      });
      router.push(warehouseGoodsReceiptPath(row.id));
    },
    onError: (error) => {
      if (error instanceof Error) {
        if (error.message === 'po') {
          toast.error('سفارش خرید را انتخاب کنید.');
          return;
        }
        if (error.message === 'warehouse') {
          toast.error('انبار مقصد را انتخاب کنید.');
          return;
        }
        if (error.message === 'quantity') {
          toast.error('تعداد دریافت باید عدد صحیح مثبت باشد.');
          return;
        }
      }
      toast.error(mapBusinessError(error));
    },
  });

  if (!canManage) return <AccessDenied />;

  const eligible = eligibleQuery.data ?? [];
  const warehouses = warehousesQuery.data?.data ?? [];
  const progress = progressQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="رسید کالای جدید"
        description="پیش‌نویس دریافت فیزیکی — ثبت نهایی جداگانه انجام می‌شود."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'رسید کالا', href: ROUTES.warehouseGoodsReceipts },
          { label: 'رسید جدید' },
        ]}
      />

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="space-y-1">
          <Label htmlFor="gr-po">سفارش خرید (قابل دریافت)</Label>
          {eligibleQuery.isPending ? (
            <p className="text-sm text-slate-500">در حال بارگذاری…</p>
          ) : eligibleQuery.isError ? (
            <ErrorState
              message={mapBusinessError(eligibleQuery.error)}
              onRetry={() => eligibleQuery.refetch()}
            />
          ) : (
            <select
              id="gr-po"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={purchaseOrderId}
              onChange={(e) => setPurchaseOrderId(e.target.value)}
            >
              <option value="">انتخاب کنید…</option>
              {eligible.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.number} — {row.supplierName} ({purchaseOrderStatusLabel(row.status)})
                </option>
              ))}
            </select>
          )}
          <p className="text-xs text-slate-500">
            فقط سفارش‌های سفارش‌داده‌شده یا دریافت جزئی نمایش داده می‌شوند.
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="gr-warehouse">انبار مقصد</Label>
          {warehousesQuery.isPending ? (
            <p className="text-sm text-slate-500">در حال بارگذاری…</p>
          ) : warehousesQuery.isError ? (
            <ErrorState
              message={mapBusinessError(warehousesQuery.error)}
              onRetry={() => warehousesQuery.refetch()}
            />
          ) : (
            <select
              id="gr-warehouse"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              <option value="">انتخاب کنید…</option>
              {warehouses.map((wh) => (
                <option key={wh.id} value={wh.id}>
                  {wh.code} — {wh.name}
                  {wh.isDefault ? ' (پیش‌فرض)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="gr-notes">یادداشت</Label>
          <textarea
            id="gr-notes"
            className={textareaClassName}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </section>

      {purchaseOrderId ? (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">اقلام قابل دریافت</h2>
            {lines.some((l) => l.remainingQuantity > 0) ? (
              <Button type="button" variant="outline" size="sm" onClick={receiveAllRemaining}>
                دریافت همه باقیمانده
              </Button>
            ) : null}
          </div>

          {progressQuery.isPending ? (
            <PageSkeleton />
          ) : progressQuery.isError ? (
            <ErrorState
              message={mapBusinessError(progressQuery.error)}
              onRetry={() => progressQuery.refetch()}
            />
          ) : progress && lines.length === 0 ? (
            <p className="text-sm text-slate-500">قلمی برای دریافت باقی نمانده است.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="py-1 text-start font-medium">SKU</th>
                    <th className="py-1 text-start font-medium">محصول</th>
                    <th className="py-1 text-start font-medium">سفارش</th>
                    <th className="py-1 text-start font-medium">دریافت‌شده</th>
                    <th className="py-1 text-start font-medium">باقیمانده</th>
                    <th className="py-1 text-start font-medium">تعداد این رسید</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.purchaseOrderItemId} className="border-t border-slate-100">
                      <td className="py-2 font-mono" dir="ltr">
                        {line.skuCode ?? '—'}
                      </td>
                      <td className="py-2">{line.productName ?? '—'}</td>
                      <td className="py-2 tabular-nums" dir="ltr">
                        {line.orderedQuantity}
                      </td>
                      <td className="py-2 tabular-nums" dir="ltr">
                        {line.postedReceivedQuantity}
                      </td>
                      <td className="py-2 tabular-nums" dir="ltr">
                        {line.remainingQuantity}
                      </td>
                      <td className="py-2">
                        <Input
                          className="max-w-[120px]"
                          inputMode="numeric"
                          dir="ltr"
                          value={line.quantity}
                          disabled={line.remainingQuantity <= 0}
                          placeholder="0"
                          onChange={(e) => {
                            const value = e.target.value;
                            setLines((prev) =>
                              prev.map((row) =>
                                row.purchaseOrderItemId === line.purchaseOrderItemId
                                  ? { ...row, quantity: value }
                                  : row,
                              ),
                            );
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.push(ROUTES.warehouseGoodsReceipts)}>
          انصراف
        </Button>
        <Button
          type="button"
          disabled={createMutation.isPending || !purchaseOrderId || !warehouseId}
          onClick={() => createMutation.mutate()}
        >
          ذخیره پیش‌نویس
        </Button>
      </div>
    </div>
  );
}
