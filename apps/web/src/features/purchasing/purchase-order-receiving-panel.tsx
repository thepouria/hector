'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  closeRemainingPurchaseOrderItem,
  fetchPurchaseOrderReceiving,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { purchaseOrderKeys } from '@/lib/query/keys';
import { ROUTES, warehouseGoodsReceiptPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { PurchaseOrder } from '@/types/purchasing';
import type {
  PurchaseItemReceivingStatus,
  PurchaseReceivingOutcome,
} from '@/types/goods-receipt';

const textareaClassName =
  'flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

function outcomeLabel(outcome: PurchaseReceivingOutcome): string {
  switch (outcome) {
    case 'AWAITING':
      return 'در انتظار دریافت';
    case 'PARTIAL':
      return 'دریافت ناقص';
    case 'FULLY_RECEIVED':
      return 'کامل دریافت شد';
    case 'CLOSED_WITH_SHORTAGE':
      return 'دریافت بسته شد — دارای کسری';
    default:
      return outcome;
  }
}

function itemStatusLabel(status: PurchaseItemReceivingStatus): string {
  switch (status) {
    case 'NOT_RECEIVED':
      return 'دریافت نشده';
    case 'PARTIAL':
      return 'ناقص';
    case 'COMPLETE':
      return 'کامل';
    case 'SHORT_CLOSED':
      return 'بسته با کسری';
    default:
      return status;
  }
}

function receiptStatusLabel(status: string): string {
  if (status === 'POSTED') return 'ثبت‌شده';
  if (status === 'DRAFT') return 'پیش‌نویس';
  if (status === 'CANCELLED') return 'لغو شده';
  return status;
}

type Props = {
  purchaseOrder: PurchaseOrder;
};

export function PurchaseOrderReceivingPanel({ purchaseOrder }: Props) {
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const queryClient = useQueryClient();
  const canRead = can(PERMISSIONS.PURCHASING_READ);
  const canShortClose = can(PERMISSIONS.PURCHASING_PO_SHORT_CLOSE);
  const canCreateReceipt = can(PERMISSIONS.WAREHOUSE_RECEIPT_MANAGE);

  const [closeItemId, setCloseItemId] = React.useState<string | null>(null);
  const [closeReason, setCloseReason] = React.useState('تأمین‌کننده باقیمانده را ارسال نمی‌کند');

  const receivingQuery = useQuery({
    queryKey: purchaseOrderKeys.receiving(companyId, purchaseOrder.id),
    queryFn: () => fetchPurchaseOrderReceiving(companyId, purchaseOrder.id),
    enabled: Boolean(companyId) && canRead,
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      if (!closeItemId) throw new Error('item');
      return closeRemainingPurchaseOrderItem(companyId, purchaseOrder.id, closeItemId, {
        reason: closeReason.trim(),
        version: purchaseOrder.version,
      });
    },
    onSuccess: async (data) => {
      toast.success(
        data.receivingOutcome === 'CLOSED_WITH_SHORTAGE'
          ? 'باقیمانده به‌عنوان کسری بسته شد'
          : 'کسری ثبت شد',
      );
      setCloseItemId(null);
      await queryClient.invalidateQueries({
        queryKey: purchaseOrderKeys.detail(companyId, purchaseOrder.id),
      });
      await queryClient.invalidateQueries({
        queryKey: purchaseOrderKeys.receiving(companyId, purchaseOrder.id),
      });
    },
    onError: (error) => {
      toast.error(
        isApiClientError(error) ? mapBusinessError(error) : 'بستن کسری انجام نشد',
      );
    },
  });

  if (!canRead) return null;
  if (receivingQuery.isLoading) {
    return (
      <section className="rounded-lg border border-slate-200 p-4 text-sm text-slate-500">
        در حال بارگذاری وضعیت دریافت…
      </section>
    );
  }
  if (receivingQuery.isError || !receivingQuery.data) {
    return (
      <section className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        بارگذاری وضعیت دریافت ممکن نشد.
      </section>
    );
  }

  const progress = receivingQuery.data;
  const closeItem = progress.items.find((i) => i.purchaseOrderItemId === closeItemId);
  const createReceiptHref = `${ROUTES.warehouseGoodsReceiptNew}?purchaseOrderId=${purchaseOrder.id}`;

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">وضعیت دریافت سفارش</h2>
          <p className="mt-1 text-sm text-slate-600">
            {outcomeLabel(progress.receivingOutcome)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCreateReceipt && progress.totals.remainingQuantity > 0 ? (
            <Link href={createReceiptHref} className={buttonVariants({ size: 'sm' })}>
              ثبت دریافت جدید
            </Link>
          ) : null}
          <Link
            href={ROUTES.warehouseGoodsReceipts}
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            فهرست رسیدها
          </Link>
        </div>
      </div>

      <div className="grid gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <div className="text-slate-500">سفارش داده‌شده</div>
          <div className="font-mono" dir="ltr">
            {progress.totals.orderedQuantity}
          </div>
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <div className="text-slate-500">دریافت‌شده</div>
          <div className="font-mono" dir="ltr">
            {progress.totals.receivedQuantity}
          </div>
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <div className="text-slate-500">کسری تأییدشده</div>
          <div className="font-mono" dir="ltr">
            {progress.totals.shortQuantity}
          </div>
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <div className="text-slate-500">باقی‌مانده</div>
          <div className="font-mono" dir="ltr">
            {progress.totals.remainingQuantity}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-slate-500">
              <th className="px-2 py-2 text-start font-medium">SKU</th>
              <th className="px-2 py-2 text-start font-medium">سفارش</th>
              <th className="px-2 py-2 text-start font-medium">دریافت</th>
              <th className="px-2 py-2 text-start font-medium">کسری</th>
              <th className="px-2 py-2 text-start font-medium">باقیمانده</th>
              <th className="px-2 py-2 text-start font-medium">وضعیت</th>
              <th className="px-2 py-2 text-start font-medium">اقدام</th>
            </tr>
          </thead>
          <tbody>
            {progress.items.map((item) => (
              <tr key={item.purchaseOrderItemId} className="border-b border-slate-100">
                <td className="px-2 py-2">
                  <div className="font-mono text-xs" dir="ltr">
                    {item.skuCode}
                  </div>
                  <div className="text-slate-600">{item.productName}</div>
                </td>
                <td className="px-2 py-2 font-mono" dir="ltr">
                  {item.orderedQuantity}
                </td>
                <td className="px-2 py-2 font-mono" dir="ltr">
                  {item.receivedQuantity}
                </td>
                <td className="px-2 py-2 font-mono" dir="ltr">
                  {item.shortQuantity}
                </td>
                <td className="px-2 py-2 font-mono" dir="ltr">
                  {item.remainingQuantity}
                </td>
                <td className="px-2 py-2">
                  <Badge>{itemStatusLabel(item.receivingStatus)}</Badge>
                </td>
                <td className="px-2 py-2">
                  {canShortClose && item.remainingQuantity > 0 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setCloseItemId(item.purchaseOrderItemId);
                        setCloseReason('تأمین‌کننده باقیمانده را ارسال نمی‌کند');
                      }}
                    >
                      بستن باقیمانده به‌عنوان کسری
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {progress.receipts.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-slate-800">دریافت‌ها</h3>
          <ul className="space-y-1 text-sm">
            {progress.receipts.map((r) => (
              <li
                key={r.goodsReceiptId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-100 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={warehouseGoodsReceiptPath(r.goodsReceiptId)}
                    className="font-mono text-sky-700 underline-offset-2 hover:underline"
                    dir="ltr"
                  >
                    {r.number}
                  </Link>
                  <Badge>{receiptStatusLabel(r.status)}</Badge>
                  <span className="font-mono text-slate-600" dir="ltr">
                    {r.totalQuantity} عدد
                  </span>
                </div>
                <span className="text-xs text-slate-500">
                  {r.receivedAt ? formatDateTime(r.receivedAt) : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {progress.shortages.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-slate-800">کسری‌های تأییدشده</h3>
          <ul className="space-y-1 text-sm">
            {progress.shortages.map((s) => (
              <li
                key={s.discrepancyId}
                className="rounded-md border border-amber-100 bg-amber-50/60 px-3 py-2"
              >
                <div className="flex flex-wrap gap-2">
                  <span className="font-mono" dir="ltr">
                    {s.quantity} عدد
                  </span>
                  <span className="text-slate-700">{s.reason}</span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {s.confirmedBy?.displayName ?? '—'}
                  {s.confirmedAt ? ` · ${formatDateTime(s.confirmedAt)}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Dialog
        open={Boolean(closeItem)}
        onOpenChange={(open) => {
          if (!open) setCloseItemId(null);
        }}
        title="بستن باقیمانده به‌عنوان کسری"
        description="این کار موجودی انبار اضافه نمی‌کند. فقط انتظار دریافت از این سفارش را می‌بندد."
      >
        {closeItem ? (
          <div className="space-y-3 text-sm">
            <p>
              هنوز{' '}
              <span className="font-mono" dir="ltr">
                {closeItem.remainingQuantity}
              </span>{' '}
              واحد انتظار می‌رود. با تأیید، سیستم دیگر این مقدار را از این سفارش انتظار ندارد.
            </p>
            <div className="rounded-md bg-slate-50 px-3 py-2 text-slate-600">
              دریافت فیزیکی: {closeItem.receivedQuantity} / سفارش: {closeItem.orderedQuantity}
            </div>
            <div className="space-y-1">
              <Label htmlFor="close-reason">دلیل</Label>
              <textarea
                id="close-reason"
                className={textareaClassName}
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCloseItemId(null)}>
                انصراف
              </Button>
              <Button
                type="button"
                disabled={closeMutation.isPending || closeReason.trim().length < 1}
                onClick={() => closeMutation.mutate()}
              >
                {closeMutation.isPending ? 'در حال انجام…' : 'تأیید بستن کسری'}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
