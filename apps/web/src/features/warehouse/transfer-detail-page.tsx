'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccessDenied, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TransferScannerPanel } from '@/features/warehouse/transfer-scanner-panel';
import {
  formatStockTransferActor,
  formatTransferLocationLabel,
  stockTransferStatusLabel,
} from '@/features/warehouse/transfer-labels';
import { WarehouseEntityActivity } from '@/features/warehouse/warehouse-entity-activity';
import {
  cancelStockTransfer,
  completeStockTransfer,
  dispatchStockTransfer,
  fetchStockTransfer,
  removeStockTransferItem,
  upsertStockTransferItem,
  fetchInventoryBalances,
  fetchWarehouseLocations,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import {
  ROUTES,
  warehouseInventoryTransferMovementsPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function TransferDetailPageClient({ transferId }: { transferId: string }) {
  const queryClient = useQueryClient();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.WAREHOUSE_TRANSFER_MANAGE);
  const canDispatch = can(PERMISSIONS.WAREHOUSE_TRANSFER_DISPATCH);
  const canComplete = can(PERMISSIONS.WAREHOUSE_TRANSFER_COMPLETE);
  const canCancel = can(PERMISSIONS.WAREHOUSE_TRANSFER_CANCEL);

  const [dispatchOpen, setDispatchOpen] = React.useState(false);
  const [completeOpen, setCompleteOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);

  const [sourceLocationId, setSourceLocationId] = React.useState('');
  const [destinationLocationId, setDestinationLocationId] = React.useState('');
  const [balanceKey, setBalanceKey] = React.useState('');
  const [quantityText, setQuantityText] = React.useState('');

  const query = useQuery({
    queryKey: warehouseKeys.transfers.detail(companyId, transferId),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_TRANSFER_READ),
    queryFn: () => fetchStockTransfer(companyId, transferId),
  });

  const row = query.data;
  const isDraft = row?.status === 'DRAFT';
  const isInTransit = row?.status === 'IN_TRANSIT';

  const sourceLocationsQuery = useQuery({
    queryKey: warehouseKeys.locations(companyId, row?.sourceWarehouse.id ?? '', {
      status: 'ACTIVE',
      pageSize: 200,
    }),
    enabled: Boolean(companyId) && Boolean(row?.sourceWarehouse.id) && isDraft && canManage,
    queryFn: () =>
      fetchWarehouseLocations(companyId, row!.sourceWarehouse.id, {
        status: 'ACTIVE',
        pageSize: 200,
        sortBy: 'code',
        sortOrder: 'asc',
      }),
  });

  const destLocationsQuery = useQuery({
    queryKey: warehouseKeys.locations(companyId, row?.destinationWarehouse.id ?? '', {
      status: 'ACTIVE',
      pageSize: 200,
    }),
    enabled: Boolean(companyId) && Boolean(row?.destinationWarehouse.id) && isDraft && canManage,
    queryFn: () =>
      fetchWarehouseLocations(companyId, row!.destinationWarehouse.id, {
        status: 'ACTIVE',
        pageSize: 200,
        sortBy: 'code',
        sortOrder: 'asc',
      }),
  });

  const balancesQuery = useQuery({
    queryKey: warehouseKeys.inventory.balances(companyId, {
      warehouseId: row?.sourceWarehouse.id,
      locationId: sourceLocationId,
      pageSize: 100,
    }),
    enabled:
      Boolean(companyId) &&
      Boolean(row?.sourceWarehouse.id) &&
      Boolean(sourceLocationId) &&
      isDraft &&
      canManage,
    queryFn: () =>
      fetchInventoryBalances(companyId, {
        warehouseId: row!.sourceWarehouse.id,
        locationId: sourceLocationId,
        pageSize: 100,
      }),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: warehouseKeys.transfers.detail(companyId, transferId),
    });
    await queryClient.invalidateQueries({
      queryKey: warehouseKeys.transfers.all(companyId),
    });
    await queryClient.invalidateQueries({
      queryKey: warehouseKeys.dashboard(companyId),
    });
    await queryClient.invalidateQueries({
      queryKey: warehouseKeys.inventory.all(companyId),
    });
  };

  const onTransferUpdated = (updated: NonNullable<typeof row>) => {
    queryClient.setQueryData(warehouseKeys.transfers.detail(companyId, transferId), updated);
  };

  const removeItem = useMutation({
    mutationFn: (itemId: string) => removeStockTransferItem(companyId, transferId, itemId),
    onSuccess: async (updated) => {
      toast.success('ردیف حذف شد.');
      onTransferUpdated(updated);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const addItem = useMutation({
    mutationFn: (body: {
      skuId: string;
      batchId: string;
      sourceLocationId: string;
      destinationLocationId: string;
      quantity: number;
    }) => upsertStockTransferItem(companyId, transferId, body),
    onSuccess: async (updated) => {
      toast.success('ردیف ثبت شد.');
      onTransferUpdated(updated);
      setQuantityText('');
      setBalanceKey('');
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const dispatch = useMutation({
    mutationFn: () => dispatchStockTransfer(companyId, transferId),
    onSuccess: async (updated) => {
      toast.success('انتقال ارسال شد — موجودی از مبدأ خارج و در مسیر ثبت شد.');
      onTransferUpdated(updated);
      setDispatchOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const complete = useMutation({
    mutationFn: () => completeStockTransfer(companyId, transferId),
    onSuccess: async (updated) => {
      toast.success('انتقال در مقصد تکمیل شد.');
      onTransferUpdated(updated);
      setCompleteOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const cancel = useMutation({
    mutationFn: () => cancelStockTransfer(companyId, transferId),
    onSuccess: async (updated) => {
      toast.success('انتقال لغو شد.');
      onTransferUpdated(updated);
      setCancelOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.WAREHOUSE_TRANSFER_READ)) return <AccessDenied />;
  if (query.isPending) return <PageSkeleton />;
  if (query.isError || !row) {
    return (
      <ErrorState message={mapBusinessError(query.error)} onRetry={() => query.refetch()} />
    );
  }

  const sourceLocations = sourceLocationsQuery.data?.data ?? [];
  const destLocations = destLocationsQuery.data?.data ?? [];
  const balances = (balancesQuery.data?.data ?? []).filter((b) => b.onHandQuantity > 0);

  const selectClassName =
    'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm';

  const cancelDescription = isDraft
    ? 'پیش‌نویس بدون تغییر موجودی حذف می‌شود.'
    : isInTransit
      ? 'کالای در مسیر به مکان‌های مبدأ در انبار مبدأ برمی‌گردد.'
      : '';

  const totalQty = row.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={row.number}
        description="انتقال داخلی موجودی فیزیکی بین انبارها."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'انتقال داخلی', href: ROUTES.warehouseTransfers },
          { label: row.number },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            {(row.status === 'IN_TRANSIT' || row.status === 'COMPLETED') &&
            can(PERMISSIONS.WAREHOUSE_STOCK_READ) ? (
              <Link
                href={warehouseInventoryTransferMovementsPath(row.id)}
                className={cn(buttonVariants({ variant: 'outline' }))}
              >
                مشاهده حرکات
              </Link>
            ) : null}
            {isDraft && canCancel ? (
              <Button type="button" variant="outline" onClick={() => setCancelOpen(true)}>
                لغو پیش‌نویس
              </Button>
            ) : null}
            {isInTransit && canCancel ? (
              <Button type="button" variant="outline" onClick={() => setCancelOpen(true)}>
                لغو و بازگشت به مبدأ
              </Button>
            ) : null}
            {isDraft && canDispatch ? (
              <Button type="button" onClick={() => setDispatchOpen(true)}>
                ارسال (خروج از مبدأ)
              </Button>
            ) : null}
            {isInTransit && canComplete ? (
              <Button type="button" onClick={() => setCompleteOpen(true)}>
                تکمیل در مقصد
              </Button>
            ) : null}
          </div>
        }
      />

      {isDraft ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          این سند پیش‌نویس است و موجودی فیزیکی را رزرو یا کم نمی‌کند. تا زمان «ارسال»، موجودی
          در مبدأ بدون تغییر می‌ماند. ستون «موجودی فیزیکی در مبدأ» فقط برای راهنمایی است.
        </p>
      ) : null}

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="text-xs text-slate-500">وضعیت</div>
          <Badge className="mt-1">{stockTransferStatusLabel(row.status)}</Badge>
        </div>
        <div>
          <div className="text-xs text-slate-500">مبدأ</div>
          <div className="mt-1">
            <span className="font-mono text-xs" dir="ltr">
              {row.sourceWarehouse.code}
            </span>
            <span className="ms-1">{row.sourceWarehouse.name}</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">مقصد</div>
          <div className="mt-1">
            <span className="font-mono text-xs" dir="ltr">
              {row.destinationWarehouse.code}
            </span>
            <span className="ms-1">{row.destinationWarehouse.name}</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">مجموع</div>
          <div className="mt-1 tabular-nums font-medium" dir="ltr">
            {totalQty} واحد · {row.items.length} ردیف
          </div>
        </div>
        {row.notes ? (
          <div className="sm:col-span-2">
            <div className="text-xs text-slate-500">یادداشت</div>
            <div className="mt-1 text-sm text-slate-700">{row.notes}</div>
          </div>
        ) : null}
        {row.externalReference ? (
          <div className="sm:col-span-2">
            <div className="text-xs text-slate-500">مرجع خارجی</div>
            <div className="mt-1 font-mono text-sm" dir="ltr">
              {row.externalReference}
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">زمان‌بندی</h2>
        <ul className="space-y-2 text-sm text-slate-700">
          <li>
            <span className="text-slate-500">ایجاد:</span> {formatDateTime(row.createdAt)}
            {row.createdBy ? ` · ${formatStockTransferActor(row.createdBy)}` : ''}
          </li>
          {row.dispatchedAt ? (
            <li>
              <span className="text-slate-500">ارسال:</span> {formatDateTime(row.dispatchedAt)}
              {row.dispatchedBy ? ` · ${formatStockTransferActor(row.dispatchedBy)}` : ''}
            </li>
          ) : null}
          {row.completedAt ? (
            <li>
              <span className="text-slate-500">تکمیل:</span> {formatDateTime(row.completedAt)}
              {row.completedBy ? ` · ${formatStockTransferActor(row.completedBy)}` : ''}
            </li>
          ) : null}
          {row.cancelledAt ? (
            <li>
              <span className="text-slate-500">لغو:</span> {formatDateTime(row.cancelledAt)}
              {row.cancelledBy ? ` · ${formatStockTransferActor(row.cancelledBy)}` : ''}
            </li>
          ) : null}
        </ul>
      </div>

      {isDraft && canManage ? (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">افزودن ردیف</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="detail-src-loc">
                مکان مبدأ
              </label>
              <select
                id="detail-src-loc"
                className={selectClassName}
                value={sourceLocationId}
                onChange={(e) => {
                  setSourceLocationId(e.target.value);
                  setBalanceKey('');
                }}
              >
                <option value="">انتخاب</option>
                {sourceLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {formatTransferLocationLabel(loc)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="detail-balance">
                SKU / بچ
              </label>
              <select
                id="detail-balance"
                className={selectClassName}
                value={balanceKey}
                disabled={!sourceLocationId}
                onChange={(e) => setBalanceKey(e.target.value)}
              >
                <option value="">انتخاب</option>
                {balances.map((b) => (
                  <option key={`${b.skuId}:${b.batchId}`} value={`${b.skuId}:${b.batchId}`}>
                    {b.skuCode} · {b.batchNumber}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="detail-dest-loc">
                مکان مقصد
              </label>
              <select
                id="detail-dest-loc"
                className={selectClassName}
                value={destinationLocationId}
                onChange={(e) => setDestinationLocationId(e.target.value)}
              >
                <option value="">انتخاب</option>
                {destLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {formatTransferLocationLabel(loc)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="detail-qty">
                تعداد
              </label>
              <input
                id="detail-qty"
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm tabular-nums"
                dir="ltr"
                value={quantityText}
                onChange={(e) => setQuantityText(e.target.value)}
              />
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={addItem.isPending}
            onClick={() => {
              const quantity = Number.parseInt(quantityText, 10);
              const balance = balances.find((b) => `${b.skuId}:${b.batchId}` === balanceKey);
              if (!balance || !sourceLocationId || !destinationLocationId) {
                toast.error('فیلدهای ردیف را کامل کنید.');
                return;
              }
              if (!Number.isFinite(quantity) || quantity < 1) {
                toast.error('تعداد نامعتبر است.');
                return;
              }
              addItem.mutate({
                skuId: balance.skuId,
                batchId: balance.batchId,
                sourceLocationId,
                destinationLocationId,
                quantity,
              });
            }}
          >
            افزودن ردیف
          </Button>
        </div>
      ) : null}

      {isDraft && canManage ? (
        <TransferScannerPanel
          companyId={companyId}
          transferId={transferId}
          transfer={row}
          onTransferUpdated={onTransferUpdated}
        />
      ) : null}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">اقلام انتقال</h2>
        {row.items.length === 0 ? (
          <p className="text-sm text-slate-500">ردیفی ثبت نشده است.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">SKU</th>
                  <th className="px-3 py-2 text-start font-medium">بچ</th>
                  <th className="px-3 py-2 text-start font-medium">مبدأ</th>
                  <th className="px-3 py-2 text-start font-medium">مقصد</th>
                  <th className="px-3 py-2 text-start font-medium">تعداد</th>
                  {isDraft ? (
                    <th className="px-3 py-2 text-start font-medium">موجودی فیزیکی در مبدأ</th>
                  ) : null}
                  <th className="px-3 py-2 text-start font-medium" />
                </tr>
              </thead>
              <tbody>
                {row.items.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs" dir="ltr">
                        {item.skuCode}
                      </div>
                      <div className="text-xs text-slate-600">{item.productName ?? '—'}</div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                      {item.batchNumber}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs" dir="ltr">
                        {formatTransferLocationLabel(item.sourceLocation)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs" dir="ltr">
                        {formatTransferLocationLabel(item.destinationLocation)}
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular-nums" dir="ltr">
                      {item.quantity}
                    </td>
                    {isDraft ? (
                      <td className="px-3 py-2 tabular-nums text-slate-600" dir="ltr">
                        {item.sourceOnHand ?? '—'}
                      </td>
                    ) : null}
                    <td className="px-3 py-2 text-end">
                      {isDraft && canManage ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={removeItem.isPending}
                          onClick={() => removeItem.mutate(item.id)}
                        >
                          حذف
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={dispatchOpen}
        title="ارسال انتقال"
        description="موجودی فیزیکی از مکان‌های مبدأ خارج و در انبار سیستمی «در مسیر» ثبت می‌شود. این عمل قابل بازگشت با لغو در وضعیت در مسیر است."
        confirmLabel="ارسال"
        loading={dispatch.isPending}
        onConfirm={() => dispatch.mutate()}
        onOpenChange={setDispatchOpen}
      />

      <ConfirmDialog
        open={completeOpen}
        title="تکمیل انتقال"
        description="کالای در مسیر در مکان‌های مقصد ثبت می‌شود و انتقال بسته می‌شود."
        confirmLabel="تکمیل"
        loading={complete.isPending}
        onConfirm={() => complete.mutate()}
        onOpenChange={setCompleteOpen}
      />

      <ConfirmDialog
        open={cancelOpen}
        title={isInTransit ? 'لغو انتقال در مسیر' : 'لغو پیش‌نویس'}
        description={cancelDescription}
        confirmLabel="لغو انتقال"
        danger
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onOpenChange={setCancelOpen}
      />

      <WarehouseEntityActivity
        kind="STOCK_TRANSFER"
        entityId={transferId}
        readPermission={PERMISSIONS.WAREHOUSE_TRANSFER_READ}
      />
    </div>
  );
}
