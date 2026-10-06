'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccessDenied, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatBatchDateOnly } from '@/features/warehouse/batch-labels';
import { PutawayScannerPanel } from '@/features/warehouse/putaway-scanner-panel';
import {
  formatPutawayLocationPath,
  putawayStatusLabel,
} from '@/features/warehouse/putaway-labels';
import {
  cancelPutaway,
  completePutaway,
  fetchPutaway,
  removePutawayItem,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { ROUTES, warehouseGoodsReceiptPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { PutawayDetail, PutawaySourceLine } from '@/types/putaway';

export function PutawayDetailPageClient({ putawayId }: { putawayId: string }) {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.WAREHOUSE_PUTAWAY_MANAGE);
  const canComplete = can(PERMISSIONS.WAREHOUSE_PUTAWAY_COMPLETE);

  const [selectedAllocationId, setSelectedAllocationId] = React.useState<string | null>(null);
  const [quantityText, setQuantityText] = React.useState('');
  const [completeOpen, setCompleteOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);

  const query = useQuery({
    queryKey: warehouseKeys.putaways.detail(companyId, putawayId),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_PUTAWAY_READ),
    queryFn: () => fetchPutaway(companyId, putawayId),
  });

  const row = query.data;
  const isEditable = row?.status === 'DRAFT' || row?.status === 'IN_PROGRESS';

  React.useEffect(() => {
    if (!row) return;
    const fromUrl = searchParams.get('allocation');
    if (fromUrl && row.sources.some((s) => s.receiptBatchAllocationId === fromUrl)) {
      setSelectedAllocationId(fromUrl);
      return;
    }
    setSelectedAllocationId((current) => {
      if (current && row.sources.some((s) => s.receiptBatchAllocationId === current)) {
        return current;
      }
      const next = row.sources.find((s) => s.availableToAllocate > 0);
      return next?.receiptBatchAllocationId ?? null;
    });
  }, [row?.id, row?.updatedAt, row?.sources, searchParams, row]);

  const selectedLine: PutawaySourceLine | null =
    row?.sources.find((s) => s.receiptBatchAllocationId === selectedAllocationId) ?? null;

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: warehouseKeys.putaways.detail(companyId, putawayId),
    });
    await queryClient.invalidateQueries({
      queryKey: warehouseKeys.putaways.all(companyId),
    });
    await queryClient.invalidateQueries({
      queryKey: warehouseKeys.dashboard(companyId),
    });
    await queryClient.invalidateQueries({
      queryKey: warehouseKeys.inventory.all(companyId),
    });
  };

  const onPutawayUpdated = (updated: PutawayDetail) => {
    queryClient.setQueryData(warehouseKeys.putaways.detail(companyId, putawayId), updated);
    const still = updated.sources.find(
      (s) => s.receiptBatchAllocationId === selectedAllocationId && s.availableToAllocate > 0,
    );
    if (!still) {
      const next = updated.sources.find((s) => s.availableToAllocate > 0);
      setSelectedAllocationId(next?.receiptBatchAllocationId ?? selectedAllocationId);
    }
  };

  const removeItem = useMutation({
    mutationFn: (itemId: string) => removePutawayItem(companyId, putawayId, itemId),
    onSuccess: async (updated) => {
      toast.success('ردیف جایگذاری حذف شد.');
      onPutawayUpdated(updated);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const complete = useMutation({
    mutationFn: () => completePutaway(companyId, putawayId),
    onSuccess: async (updated) => {
      toast.success('جایگذاری تکمیل شد.');
      queryClient.setQueryData(warehouseKeys.putaways.detail(companyId, putawayId), updated);
      setCompleteOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const cancel = useMutation({
    mutationFn: () => cancelPutaway(companyId, putawayId),
    onSuccess: async (updated) => {
      toast.success('جایگذاری لغو شد.');
      queryClient.setQueryData(warehouseKeys.putaways.detail(companyId, putawayId), updated);
      setCancelOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.WAREHOUSE_PUTAWAY_READ)) return <AccessDenied />;
  if (query.isPending) return <PageSkeleton />;
  if (query.isError || !row) {
    return (
      <ErrorState message={mapBusinessError(query.error)} onRetry={() => query.refetch()} />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={row.number}
        description="جایگذاری تاریخی — قرارگیری کالای دریافت‌شده در مکان انبار."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'جایگذاری', href: ROUTES.warehousePutaways },
          { label: row.number },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            {isEditable && canManage ? (
              <Button type="button" variant="outline" onClick={() => setCancelOpen(true)}>
                لغو جایگذاری
              </Button>
            ) : null}
            {isEditable && canComplete ? (
              <Button type="button" onClick={() => setCompleteOpen(true)}>
                تکمیل جایگذاری
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="text-xs text-slate-500">وضعیت</div>
          <Badge className="mt-1">{putawayStatusLabel(row.status)}</Badge>
        </div>
        <div>
          <div className="text-xs text-slate-500">رسید کالا</div>
          <Link
            href={warehouseGoodsReceiptPath(row.goodsReceiptId)}
            className="mt-1 block font-medium underline-offset-2 hover:underline"
          >
            {row.goodsReceiptNumber}
          </Link>
        </div>
        <div>
          <div className="text-xs text-slate-500">انبار</div>
          <div className="mt-1">
            <span className="font-mono text-xs" dir="ltr">
              {row.warehouseCode}
            </span>
            <span className="ms-1">{row.warehouseName}</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">مجموع این جایگذاری</div>
          <div className="mt-1 tabular-nums font-medium" dir="ltr">
            {row.totals.totalQuantity} واحد · {row.totals.itemCount} ردیف
          </div>
        </div>
        {row.completedAt ? (
          <div className="sm:col-span-2">
            <div className="text-xs text-slate-500">تکمیل</div>
            <div className="mt-1 text-sm text-slate-700">
              {formatDateTime(row.completedAt)}
              {row.completedBy ? ` · ${row.completedBy.displayName}` : ''}
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">ردیف‌های منبع (رسید)</h2>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium w-8" />
                <th className="px-3 py-2 text-start font-medium">SKU</th>
                <th className="px-3 py-2 text-start font-medium">محصول</th>
                <th className="px-3 py-2 text-start font-medium">بچ</th>
                <th className="px-3 py-2 text-start font-medium">دریافت‌شده</th>
                <th className="px-3 py-2 text-start font-medium">قبلاً جایگذاری</th>
                <th className="px-3 py-2 text-start font-medium">در این PUT</th>
                <th className="px-3 py-2 text-start font-medium">باقیمانده</th>
              </tr>
            </thead>
            <tbody>
              {row.sources.map((line) => {
                const selected = line.receiptBatchAllocationId === selectedAllocationId;
                return (
                  <tr
                    key={line.receiptBatchAllocationId}
                    className={`border-t border-slate-100 ${
                      selected ? 'bg-amber-50/80' : 'hover:bg-slate-50'
                    } ${isEditable ? 'cursor-pointer' : ''}`}
                    onClick={() => {
                      if (!isEditable) return;
                      setSelectedAllocationId(line.receiptBatchAllocationId);
                      setQuantityText('');
                    }}
                  >
                    <td className="px-3 py-2">
                      {isEditable ? (
                        <input
                          type="radio"
                          checked={selected}
                          readOnly
                          aria-label="انتخاب ردیف"
                        />
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                      {line.skuCode ?? '—'}
                    </td>
                    <td className="px-3 py-2">{line.productName ?? '—'}</td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs" dir="ltr">
                        {line.batchNumber}
                      </div>
                      {line.expiresAt ? (
                        <div className="text-xs text-slate-500">
                          انقضا: {formatBatchDateOnly(line.expiresAt)}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 tabular-nums" dir="ltr">
                      {line.receivedQuantity}
                    </td>
                    <td className="px-3 py-2 tabular-nums" dir="ltr">
                      {line.alreadyPutAway}
                    </td>
                    <td className="px-3 py-2 tabular-nums" dir="ltr">
                      {line.draftAllocated}
                    </td>
                    <td className="px-3 py-2 tabular-nums font-medium" dir="ltr">
                      {line.remainingToPutAway}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {isEditable && canManage ? (
        <PutawayScannerPanel
          companyId={companyId}
          putawayId={putawayId}
          putaway={row}
          selectedLine={selectedLine}
          quantityText={quantityText}
          onQuantityTextChange={setQuantityText}
          onPutawayUpdated={onPutawayUpdated}
        />
      ) : null}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">اقلام ثبت‌شده در این جایگذاری</h2>
        {row.items.length === 0 ? (
          <p className="text-sm text-slate-500">هنوز جایگذاری ثبت نشده است.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">SKU</th>
                  <th className="px-3 py-2 text-start font-medium">بچ</th>
                  <th className="px-3 py-2 text-start font-medium">مکان</th>
                  <th className="px-3 py-2 text-start font-medium">تعداد</th>
                  <th className="px-3 py-2 text-start font-medium" />
                </tr>
              </thead>
              <tbody>
                {row.items.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs" dir="ltr">
                        {item.skuCode ?? '—'}
                      </div>
                      <div className="text-xs text-slate-600">{item.productName ?? '—'}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs" dir="ltr">
                        {item.batchNumber}
                      </div>
                      {item.expiresAt ? (
                        <div className="text-xs text-slate-500">
                          {formatBatchDateOnly(item.expiresAt)}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs" dir="ltr">
                        {formatPutawayLocationPath(item.location)}
                      </div>
                      <div className="text-xs text-slate-500" dir="ltr">
                        {item.location.barcode}
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular-nums" dir="ltr">
                      {item.quantity}
                    </td>
                    <td className="px-3 py-2 text-end">
                      {isEditable && canManage ? (
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
        open={completeOpen}
        title="تکمیل جایگذاری"
        description="پس از تکمیل، این جایگذاری به‌عنوان واقعیت تاریخی ثبت می‌شود و دیگر قابل ویرایش نیست."
        confirmLabel="تکمیل"
        loading={complete.isPending}
        onConfirm={() => complete.mutate()}
        onOpenChange={setCompleteOpen}
      />

      <ConfirmDialog
        open={cancelOpen}
        title="لغو جایگذاری"
        description="تمام اقلام این پیش‌نویس حذف می‌شوند و جایگذاری لغو می‌گردد."
        confirmLabel="لغو جایگذاری"
        danger
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onOpenChange={setCancelOpen}
      />
    </div>
  );
}
