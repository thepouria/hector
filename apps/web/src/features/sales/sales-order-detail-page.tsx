'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AccessDenied,
  ErrorState,
  PageSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  formatSalesMoney,
  paymentTermLabel,
  salesOrderStatusBadgeClass,
  salesOrderStatusLabel,
} from '@/features/sales/sales-labels';
import {
  cancelSalesOrder,
  cancelSalesOrderItem,
  completeSalesFulfillment,
  confirmSalesOrder,
  createSalesFulfillment,
  createSalesReturn,
  fetchBatches,
  fetchSalesOrder,
  fetchWarehouseLocations,
  fetchWarehouses,
  releaseSalesOrderReservations,
  reserveSalesOrder,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { salesKeys } from '@/lib/query/keys';
import { ROUTES, salesReturnPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function SalesOrderDetailPage({ orderId }: { orderId: string }) {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const queryClient = useQueryClient();
  const canRead = can(PERMISSIONS.SALES_ORDERS_READ);

  const [warehouseId, setWarehouseId] = React.useState('');
  const [fulfillQty, setFulfillQty] = React.useState<Record<string, string>>({});
  const [locationId, setLocationId] = React.useState('');
  const [batchId, setBatchId] = React.useState('');
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [itemCancel, setItemCancel] = React.useState<{ itemId: string; max: number } | null>(null);
  const [itemCancelQty, setItemCancelQty] = React.useState('1');

  const orderQuery = useQuery({
    queryKey: salesKeys.orders.detail(companyId, orderId),
    enabled: Boolean(companyId) && canRead && Boolean(orderId),
    queryFn: () => fetchSalesOrder(companyId, orderId),
  });

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', companyId, 'sales-order'],
    enabled: Boolean(companyId) && canRead,
    queryFn: () => fetchWarehouses(companyId, { pageSize: 50, status: 'ACTIVE' }),
  });

  React.useEffect(() => {
    if (!warehouseId && (warehousesQuery.data?.data?.length ?? 0) > 0) {
      const preferred =
        warehousesQuery.data!.data.find((w) => w.isDefault) ?? warehousesQuery.data!.data[0]!;
      setWarehouseId(preferred.id);
    }
  }, [warehouseId, warehousesQuery.data]);

  const locationsQuery = useQuery({
    queryKey: ['warehouse-locations', companyId, warehouseId],
    enabled: Boolean(companyId) && Boolean(warehouseId),
    queryFn: () =>
      fetchWarehouseLocations(companyId, warehouseId, { pageSize: 100, status: 'ACTIVE' }),
  });

  const batchesQuery = useQuery({
    queryKey: ['batches', companyId, 'sales'],
    enabled: Boolean(companyId),
    queryFn: () => fetchBatches(companyId, { pageSize: 50 }),
  });

  React.useEffect(() => {
    if (
      orderQuery.error &&
      isApiClientError(orderQuery.error) &&
      orderQuery.error.status === 401
    ) {
      handleUnauthorized();
    }
  }, [orderQuery.error, handleUnauthorized]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: salesKeys.orders.detail(companyId, orderId) });
    await queryClient.invalidateQueries({ queryKey: salesKeys.orders.all(companyId) });
    await queryClient.invalidateQueries({ queryKey: salesKeys.dashboard(companyId) });
  };

  const confirmMut = useMutation({
    mutationFn: () => confirmSalesOrder(companyId, orderId),
    onSuccess: async () => {
      toast.success('سفارش تأیید شد');
      await invalidate();
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });
  const reserveMut = useMutation({
    mutationFn: () => reserveSalesOrder(companyId, orderId, { warehouseId: warehouseId || undefined }),
    onSuccess: async () => {
      toast.success('رزرو انجام شد');
      await invalidate();
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });
  const releaseMut = useMutation({
    mutationFn: () => releaseSalesOrderReservations(companyId, orderId),
    onSuccess: async () => {
      toast.success('رزروها آزاد شدند');
      await invalidate();
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });
  const cancelMut = useMutation({
    mutationFn: () => cancelSalesOrder(companyId, orderId, { reason: 'MANUAL' }),
    onSuccess: async () => {
      toast.success('سفارش لغو شد');
      setConfirmCancel(false);
      await invalidate();
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });
  const cancelItemMut = useMutation({
    mutationFn: () =>
      cancelSalesOrderItem(companyId, orderId, itemCancel!.itemId, {
        quantity: Number(itemCancelQty),
      }),
    onSuccess: async () => {
      toast.success('قلم لغو شد');
      setItemCancel(null);
      await invalidate();
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });
  const fulfillMut = useMutation({
    mutationFn: async () => {
      const order = orderQuery.data!;
      if (!warehouseId || !locationId || !batchId) {
        throw new Error('انبار، محل و بچ الزامی است.');
      }
      const items = order.items
        .map((item) => {
          const remaining =
            item.quantities?.remainingToFulfill ??
            Math.max(0, item.quantity - item.cancelledQuantity - item.fulfilledQuantity);
          const qty = Number(fulfillQty[item.id] ?? '0');
          if (!Number.isInteger(qty) || qty < 1 || qty > remaining) return null;
          return {
            salesOrderItemId: item.id,
            skuId: item.skuId,
            locationId,
            batchId,
            quantity: qty,
            classification: 'SELLABLE',
          };
        })
        .filter(Boolean);
      if (items.length === 0) throw new Error('حداقل یک مقدار تحویل معتبر وارد کنید.');
      const draft = await createSalesFulfillment(companyId, {
        salesOrderId: orderId,
        warehouseId,
        items,
      });
      return completeSalesFulfillment(companyId, draft.id);
    },
    onSuccess: async () => {
      toast.success('تحویل تکمیل و مطالبه شناسایی شد');
      setFulfillQty({});
      await invalidate();
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });
  const returnMut = useMutation({
    mutationFn: async () => {
      const order = orderQuery.data!;
      const items = order.items
        .map((item) => {
          const returnable =
            (item.quantities?.fulfilled ?? item.fulfilledQuantity) -
            (item.quantities?.returned ?? item.returnedQuantity);
          if (returnable < 1) return null;
          return {
            salesOrderItemId: item.id,
            skuId: item.skuId,
            quantity: returnable,
            reason: 'CUSTOMER_REQUEST',
            condition: 'SELLABLE',
          };
        })
        .filter(Boolean);
      if (items.length === 0) throw new Error('مقدار قابل برگشت وجود ندارد.');
      return createSalesReturn(companyId, {
        salesOrderId: orderId,
        reason: 'CUSTOMER_REQUEST',
        condition: 'SELLABLE',
        items,
      });
    },
    onSuccess: async (ret) => {
      toast.success(`برگشت ${ret.returnNumber} ایجاد شد`);
      await queryClient.invalidateQueries({ queryKey: salesKeys.returns.all(companyId) });
      window.location.href = salesReturnPath(ret.id);
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  if (!canRead) {
    return <AccessDenied message="برای مشاهده سفارش به مجوز sales.orders.read نیاز است." />;
  }
  if (orderQuery.isLoading) return <PageSkeleton />;
  if (orderQuery.error) {
    return <ErrorState title="خطا" message={mapBusinessError(orderQuery.error)} />;
  }

  const order = orderQuery.data!;
  const canConfirm = can(PERMISSIONS.SALES_ORDERS_CONFIRM) && order.status === 'DRAFT';
  const canReserve =
    can(PERMISSIONS.SALES_ORDERS_RESERVE) &&
    ['CONFIRMED', 'PROCESSING', 'PARTIALLY_FULFILLED'].includes(order.status);
  const canCancel =
    can(PERMISSIONS.SALES_ORDERS_CANCEL) &&
    !['FULFILLED', 'CANCELLED'].includes(order.status);
  const canFulfill =
    can(PERMISSIONS.SALES_FULFILLMENTS_CREATE) &&
    can(PERMISSIONS.SALES_FULFILLMENTS_COMPLETE) &&
    ['CONFIRMED', 'PROCESSING', 'PARTIALLY_FULFILLED'].includes(order.status);
  const canReturn =
    can(PERMISSIONS.SALES_RETURNS_CREATE) &&
    order.items.some(
      (i) =>
        (i.quantities?.fulfilled ?? i.fulfilledQuantity) -
          (i.quantities?.returned ?? i.returnedQuantity) >
        0,
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title={order.orderNumber}
        description={`${order.channel.name} · ${paymentTermLabel(order.paymentTermType)}`}
        breadcrumbs={[
          { label: 'فروش', href: ROUTES.sales },
          { label: 'سفارش‌ها', href: ROUTES.salesOrders },
          { label: order.orderNumber },
        ]}
        actions={
          <Badge className={salesOrderStatusBadgeClass(order.status)}>
            {salesOrderStatusLabel(order.status)}
          </Badge>
        }
      />

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <div className="text-slate-500">مشتری</div>
          <div className="font-medium">
            {order.customer?.displayName ?? order.customerNameSnapshot ?? '—'}
          </div>
          <div className="mt-2 text-slate-500">مبلغ کل</div>
          <div className="text-lg font-semibold tabular-nums">
            {formatSalesMoney(order.grandTotal, order.currency)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm space-y-1">
          <div>ایجاد: {formatDateTime(order.createdAt)}</div>
          <div>تأیید: {order.confirmedAt ? formatDateTime(order.confirmedAt) : '—'}</div>
          <div>لغو: {order.cancelledAt ? formatDateTime(order.cancelledAt) : '—'}</div>
          <div>به‌روزرسانی: {formatDateTime(order.updatedAt)}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm space-y-1">
          <div>رزرو فعال: {order.reservationSummary?.activeCount ?? 0}</div>
          <div>واحد رزرو: {order.reservationSummary?.reservedRemainingTotal ?? 0}</div>
          <div>تحویل‌ها: {order.fulfillmentSummary?.count ?? 0}</div>
          <div>مطالبات: {order.financeSummary?.receivableCount ?? 0}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {canConfirm ? (
          <Button disabled={confirmMut.isPending} onClick={() => confirmMut.mutate()}>
            تأیید سفارش
          </Button>
        ) : null}
        {canReserve ? (
          <>
            <Button
              variant="outline"
              disabled={reserveMut.isPending}
              onClick={() => reserveMut.mutate()}
            >
              رزرو موجودی
            </Button>
            <Button
              variant="outline"
              disabled={releaseMut.isPending}
              onClick={() => releaseMut.mutate()}
            >
              آزادسازی رزرو
            </Button>
          </>
        ) : null}
        {canReturn ? (
          <Button variant="outline" disabled={returnMut.isPending} onClick={() => returnMut.mutate()}>
            ایجاد برگشت (کل قابل‌برگشت)
          </Button>
        ) : null}
        {canCancel ? (
          <Button variant="danger" onClick={() => setConfirmCancel(true)}>
            لغو سفارش
          </Button>
        ) : null}
      </div>

      {(canReserve || canFulfill) && (
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-3">
          <div className="space-y-1">
            <Label>انبار</Label>
            <select
              className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              {(warehousesQuery.data?.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          {canFulfill ? (
            <>
              <div className="space-y-1">
                <Label>محل</Label>
                <select
                  className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                >
                  <option value="">انتخاب محل</option>
                  {(locationsQuery.data?.data ?? []).map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.code}
                      {loc.name ? ` — ${loc.name}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>بچ</Label>
                <select
                  className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                  value={batchId}
                  onChange={(e) => setBatchId(e.target.value)}
                >
                  <option value="">انتخاب بچ</option>
                  {(batchesQuery.data?.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batchNumber}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : null}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-right">SKU</th>
              <th className="px-3 py-2 text-right">سفارش</th>
              <th className="px-3 py-2 text-right">لغو</th>
              <th className="px-3 py-2 text-right">رزرو</th>
              <th className="px-3 py-2 text-right">تحویل</th>
              <th className="px-3 py-2 text-right">برگشت</th>
              <th className="px-3 py-2 text-right">باقی‌مانده</th>
              <th className="px-3 py-2 text-right">مبلغ خط</th>
              {canFulfill ? <th className="px-3 py-2 text-right">تحویل الان</th> : null}
              {canCancel ? <th className="px-3 py-2 text-right">عملیات</th> : null}
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => {
              const q = item.quantities;
              const remaining =
                q?.remainingToFulfill ??
                Math.max(0, item.quantity - item.cancelledQuantity - item.fulfilledQuantity);
              return (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <div className="font-medium">{item.sku.code}</div>
                    <div className="text-xs text-slate-500">
                      {item.productNameSnapshot ?? item.sku.product.name}
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{q?.ordered ?? item.quantity}</td>
                  <td className="px-3 py-2 tabular-nums">{q?.cancelled ?? item.cancelledQuantity}</td>
                  <td className="px-3 py-2 tabular-nums">{q?.reservedRemaining ?? 0}</td>
                  <td className="px-3 py-2 tabular-nums">{q?.fulfilled ?? item.fulfilledQuantity}</td>
                  <td className="px-3 py-2 tabular-nums">{q?.returned ?? item.returnedQuantity}</td>
                  <td className="px-3 py-2 tabular-nums">{remaining}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatSalesMoney(item.lineNetTotal, order.currency)}
                  </td>
                  {canFulfill ? (
                    <td className="px-3 py-2">
                      <Input
                        className="h-8 w-20"
                        value={fulfillQty[item.id] ?? ''}
                        placeholder={String(remaining)}
                        onChange={(e) =>
                          setFulfillQty((prev) => ({ ...prev, [item.id]: e.target.value }))
                        }
                        disabled={remaining < 1}
                      />
                    </td>
                  ) : null}
                  {canCancel ? (
                    <td className="px-3 py-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={remaining < 1}
                        onClick={() => {
                          setItemCancel({ itemId: item.id, max: remaining });
                          setItemCancelQty(String(Math.min(1, remaining)));
                        }}
                      >
                        لغو قلم
                      </Button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canFulfill ? (
        <Button disabled={fulfillMut.isPending} onClick={() => fulfillMut.mutate()}>
          {fulfillMut.isPending ? 'در حال تحویل…' : 'ایجاد و تکمیل تحویل'}
        </Button>
      ) : null}

      {order.financeSummary && order.financeSummary.receivables.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">خلاصه مالی (CustomerReceivable)</h2>
          <p className="text-xs text-slate-500">{order.financeSummary.label}</p>
          <ul className="space-y-1 text-sm">
            {order.financeSummary.receivables.map((r) => (
              <li key={r.id} className="rounded border border-slate-200 bg-white px-3 py-2">
                {r.number} · {r.status} · {formatSalesMoney(r.amount, r.currency)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {order.fulfillmentSummary && order.fulfillmentSummary.items.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">تحویل‌ها</h2>
          <ul className="space-y-1 text-sm">
            {order.fulfillmentSummary.items.map((f) => (
              <li key={f.id} className="rounded border border-slate-200 bg-white px-3 py-2">
                {f.fulfillmentNumber} · {f.status}
                {f.completedAt ? ` · ${formatDateTime(f.completedAt)}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="لغو سفارش؟"
        description="مقادیر باز لغو می‌شوند و رزروهای فعال آزاد می‌گردند."
        confirmLabel="لغو سفارش"
        onConfirm={() => cancelMut.mutate()}
        loading={cancelMut.isPending}
        danger
      />

      <ConfirmDialog
        open={Boolean(itemCancel)}
        onOpenChange={(open) => {
          if (!open) setItemCancel(null);
        }}
        title="لغو جزئی قلم"
        description={
          itemCancel
            ? `مقدار لغو را در فیلد زیر قبل از تأیید تنظیم کنید. حداکثر: ${itemCancel.max}`
            : undefined
        }
        target={itemCancelQty}
        confirmLabel="لغو"
        onConfirm={() => cancelItemMut.mutate()}
        loading={cancelItemMut.isPending}
        danger
      />

      {itemCancel ? (
        <div className="fixed inset-x-0 bottom-4 z-50 mx-auto flex max-w-sm items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <Label className="shrink-0">مقدار لغو</Label>
          <Input
            value={itemCancelQty}
            onChange={(e) => setItemCancelQty(e.target.value)}
          />
        </div>
      ) : null}

      <div>
        <Link href={ROUTES.salesOrders} className="text-sm text-sky-700 hover:underline">
          بازگشت به لیست
        </Link>
      </div>
    </div>
  );
}
