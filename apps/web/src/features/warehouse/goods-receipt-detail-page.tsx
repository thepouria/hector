'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccessDenied, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GoodsReceiptItemBatchSection } from '@/features/warehouse/goods-receipt-item-batch-section';
import { GoodsReceiptScannerPanel } from '@/features/warehouse/goods-receipt-scanner-panel';
import { goodsReceiptStatusLabel } from '@/features/warehouse/goods-receipt-labels';
import { WarehouseEntityActivity } from '@/features/warehouse/warehouse-entity-activity';
import { purchaseOrderStatusLabel } from '@/features/purchasing/purchase-order-labels';
import {
  addGoodsReceiptItem,
  cancelGoodsReceipt,
  fetchGoodsReceipt,
  fetchPurchaseOrderReceivingProgress,
  postGoodsReceipt,
  removeGoodsReceiptItem,
  updateGoodsReceipt,
  updateGoodsReceiptItem,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { ROUTES, purchasingOrderPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { GoodsReceiptDetail, GoodsReceiptItem } from '@/types/goods-receipt';

const textareaClassName =
  'flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm';

type ItemDraft = {
  quantity: string;
  notes: string;
};

function toLocalDatetimeInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalDatetimeInput(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function itemAllocatedQuantity(item: GoodsReceiptItem): number {
  return item.allocatedQuantity ?? item.batchAllocations?.reduce((s, a) => s + a.quantity, 0) ?? 0;
}

function receiptBatchAllocationIncomplete(items: GoodsReceiptItem[]): boolean {
  return items.some((item) => {
    if (item.quantity <= 0) return false;
    return itemAllocatedQuantity(item) !== item.quantity;
  });
}

export function GoodsReceiptDetailPageClient({ goodsReceiptId }: { goodsReceiptId: string }) {
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const queryClient = useQueryClient();
  const canManage = can(PERMISSIONS.WAREHOUSE_RECEIPT_MANAGE);
  const canPost = can(PERMISSIONS.WAREHOUSE_RECEIPT_POST);

  const [postOpen, setPostOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [receivedAtLocal, setReceivedAtLocal] = React.useState('');
  const [itemDrafts, setItemDrafts] = React.useState<Record<string, ItemDraft>>({});

  const query = useQuery({
    queryKey: warehouseKeys.goodsReceipts.detail(companyId, goodsReceiptId),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_RECEIPT_READ),
    queryFn: () => fetchGoodsReceipt(companyId, goodsReceiptId),
  });

  const row = query.data;
  const isDraft = row?.status === 'DRAFT';
  const isReadOnly = row?.status === 'POSTED' || row?.status === 'CANCELLED';

  const progressQuery = useQuery({
    queryKey: warehouseKeys.goodsReceipts.purchaseOrderProgress(
      companyId,
      row?.purchaseOrderId ?? '',
    ),
    enabled: Boolean(companyId) && Boolean(row?.purchaseOrderId) && isDraft && canManage,
    queryFn: () => fetchPurchaseOrderReceivingProgress(companyId, row!.purchaseOrderId),
  });

  React.useEffect(() => {
    if (!row) return;
    setNotes(row.notes ?? '');
    setReceivedAtLocal(toLocalDatetimeInput(row.receivedAt));
    const drafts: Record<string, ItemDraft> = {};
    for (const item of row.items) {
      drafts[item.id] = {
        quantity: String(item.quantity),
        notes: item.notes ?? '',
      };
    }
    setItemDrafts(drafts);
  }, [row?.id, row?.updatedAt, row?.items, row?.notes, row?.receivedAt, row]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: warehouseKeys.goodsReceipts.detail(companyId, goodsReceiptId),
    });
    await queryClient.invalidateQueries({
      queryKey: warehouseKeys.goodsReceipts.all(companyId),
    });
    await queryClient.invalidateQueries({
      queryKey: warehouseKeys.dashboard(companyId),
    });
    if (row?.purchaseOrderId) {
      await queryClient.invalidateQueries({
        queryKey: warehouseKeys.goodsReceipts.purchaseOrderProgress(companyId, row.purchaseOrderId),
      });
    }
  };

  const saveHeader = useMutation({
    mutationFn: () =>
      updateGoodsReceipt(companyId, goodsReceiptId, {
        notes: notes.trim() ? notes.trim() : null,
        receivedAt: fromLocalDatetimeInput(receivedAtLocal),
      }),
    onSuccess: async () => {
      toast.success('اطلاعات رسید به‌روزرسانی شد.');
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const saveItem = useMutation({
    mutationFn: async (item: GoodsReceiptItem) => {
      const draft = itemDrafts[item.id];
      if (!draft) throw new Error('draft');
      const quantity = Number(draft.quantity.trim());
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('quantity');
      return updateGoodsReceiptItem(companyId, goodsReceiptId, item.id, {
        quantity,
        notes: draft.notes.trim() ? draft.notes.trim() : null,
      });
    },
    onSuccess: async () => {
      toast.success('قلم به‌روزرسانی شد.');
      await invalidate();
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'quantity') {
        toast.error('تعداد باید عدد صحیح مثبت باشد.');
        return;
      }
      toast.error(mapBusinessError(error));
    },
  });

  const removeItem = useMutation({
    mutationFn: (itemId: string) => removeGoodsReceiptItem(companyId, goodsReceiptId, itemId),
    onSuccess: async () => {
      toast.success('قلم حذف شد.');
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const addLine = useMutation({
    mutationFn: async (purchaseOrderItemId: string) => {
      const progressItem = progressQuery.data?.items.find(
        (p) => p.purchaseOrderItemId === purchaseOrderItemId,
      );
      if (!progressItem || progressItem.remainingQuantity <= 0) throw new Error('none');
      return addGoodsReceiptItem(companyId, goodsReceiptId, {
        purchaseOrderItemId,
        quantity: progressItem.remainingQuantity,
      });
    },
    onSuccess: async () => {
      toast.success('قلم به رسید اضافه شد.');
      await invalidate();
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'none') {
        toast.error('باقیمانده‌ای برای این قلم وجود ندارد.');
        return;
      }
      toast.error(mapBusinessError(error));
    },
  });

  const post = useMutation({
    mutationFn: () => postGoodsReceipt(companyId, goodsReceiptId),
    onSuccess: async () => {
      toast.success('رسید کالا ثبت نهایی شد.');
      setPostOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const cancel = useMutation({
    mutationFn: () =>
      cancelGoodsReceipt(companyId, goodsReceiptId, {
        reason: cancelReason.trim() || undefined,
      }),
    onSuccess: async () => {
      toast.success('پیش‌نویس رسید لغو شد.');
      setCancelOpen(false);
      setCancelReason('');
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.WAREHOUSE_RECEIPT_READ)) return <AccessDenied />;
  if (query.isPending) return <PageSkeleton />;
  if (query.isError || !row) {
    return (
      <ErrorState message={mapBusinessError(query.error)} onRetry={() => query.refetch()} />
    );
  }

  const receiptPoItemIds = new Set(row.items.map((i) => i.purchaseOrderItemId));
  const addableLines =
    progressQuery.data?.items.filter(
      (p) => p.remainingQuantity > 0 && !receiptPoItemIds.has(p.purchaseOrderItemId),
    ) ?? [];

  const batchAllocationIncomplete =
    isDraft && row.items.length > 0 && receiptBatchAllocationIncomplete(row.items);

  return (
    <div className="space-y-6">
      <PageHeader
        title={row.number}
        description="رسید کالا"
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'رسید کالا', href: ROUTES.warehouseGoodsReceipts },
          { label: row.number },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge>{goodsReceiptStatusLabel(row.status)}</Badge>
            {isDraft && canPost ? (
              <Button
                type="button"
                disabled={batchAllocationIncomplete}
                title={
                  batchAllocationIncomplete
                    ? 'قبل از ثبت نهایی، تخصیص بچ همه اقلام باید کامل باشد.'
                    : undefined
                }
                onClick={() => setPostOpen(true)}
              >
                ثبت نهایی رسید
              </Button>
            ) : null}
            {isDraft && canManage ? (
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  setCancelReason('');
                  setCancelOpen(true);
                }}
              >
                لغو پیش‌نویس
              </Button>
            ) : null}
          </div>
        }
      />

      {batchAllocationIncomplete ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          برای ثبت نهایی، تعداد تخصیص‌شده به بچ باید با «تعداد این رسید» برای هر قلم برابر باشد.
          از بخش تخصیص بچ زیر یا دریافت با بارکدخوان (با بچ فعال) تکمیل کنید.
        </p>
      ) : null}

      {row.status === 'POSTED' ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
          این رسید ثبت نهایی شده و سابقه دریافت فیزیکی است. ویرایش یا لغو در این فاز امکان‌پذیر نیست.
        </p>
      ) : null}
      {row.status === 'CANCELLED' ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          این پیش‌نویس لغو شده است.
          {row.cancellationReason ? ` دلیل: ${row.cancellationReason}` : null}
        </p>
      ) : null}

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <div>
          <div className="text-xs text-slate-500">وضعیت</div>
          <div className="mt-1">
            <Badge>{goodsReceiptStatusLabel(row.status)}</Badge>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">تأمین‌کننده</div>
          <div className="mt-1 text-sm">{row.supplierName}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">سفارش خرید</div>
          <div className="mt-1 text-sm">
            <Link
              href={purchasingOrderPath(row.purchaseOrderId)}
              className="underline-offset-2 hover:underline"
            >
              {row.purchaseOrderNumber}
            </Link>
            <span className="ms-2 text-xs text-slate-500">
              ({purchaseOrderStatusLabel(row.purchaseOrderStatus)})
            </span>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">انبار</div>
          <div className="mt-1 text-sm">
            <span className="font-mono text-xs" dir="ltr">
              {row.warehouseCode}
            </span>
            <span className="ms-1">{row.warehouseName}</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">ایجاد</div>
          <div className="mt-1 text-sm">{formatDateTime(row.createdAt)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">ثبت نهایی</div>
          <div className="mt-1 text-sm">
            {row.postedAt ? formatDateTime(row.postedAt) : '—'}
          </div>
        </div>
      </section>

      {isDraft && canManage ? (
        <GoodsReceiptScannerPanel
          companyId={companyId}
          goodsReceiptId={goodsReceiptId}
          receipt={row}
          onReceiptUpdated={(next: GoodsReceiptDetail) => {
            queryClient.setQueryData(
              warehouseKeys.goodsReceipts.detail(companyId, goodsReceiptId),
              next,
            );
          }}
        />
      ) : null}

      {isDraft && canManage ? (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">اطلاعات پیش‌نویس</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="gr-received-at">زمان دریافت فیزیکی</Label>
              <Input
                id="gr-received-at"
                type="datetime-local"
                dir="ltr"
                value={receivedAtLocal}
                onChange={(e) => setReceivedAtLocal(e.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="gr-detail-notes">یادداشت</Label>
              <textarea
                id="gr-detail-notes"
                className={textareaClassName}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={saveHeader.isPending}
              onClick={() => saveHeader.mutate()}
            >
              ذخیره سربرگ
            </Button>
          </div>
        </section>
      ) : (
        <>
          {row.receivedAt ? (
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">زمان دریافت فیزیکی</div>
              <div className="mt-1 text-sm">{formatDateTime(row.receivedAt)}</div>
              {row.notes ? (
                <>
                  <div className="mt-3 text-xs text-slate-500">یادداشت</div>
                  <div className="mt-1 whitespace-pre-wrap text-sm">{row.notes}</div>
                </>
              ) : null}
            </section>
          ) : null}
        </>
      )}

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">اقلام</h2>
        {row.items.length === 0 ? (
          <p className="text-sm text-slate-500">قلمی ثبت نشده است.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1 text-start font-medium">SKU</th>
                  <th className="py-1 text-start font-medium">محصول</th>
                  <th className="py-1 text-start font-medium">سفارش</th>
                  <th className="py-1 text-start font-medium">قبلاً دریافت</th>
                  <th className="py-1 text-start font-medium">باقیمانده PO</th>
                  <th className="py-1 text-start font-medium">تعداد این رسید</th>
                  {!isReadOnly && canManage ? (
                    <th className="py-1 text-start font-medium">عملیات</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {row.items.map((item) => {
                  const draft = itemDrafts[item.id] ?? {
                    quantity: String(item.quantity),
                    notes: item.notes ?? '',
                  };
                  return (
                    <tr key={item.id} className="border-t border-slate-100">
                      <td className="py-2 font-mono" dir="ltr">
                        {item.skuCode ?? '—'}
                      </td>
                      <td className="py-2">{item.productName ?? '—'}</td>
                      <td className="py-2 tabular-nums" dir="ltr">
                        {item.orderedQuantity}
                      </td>
                      <td className="py-2 tabular-nums" dir="ltr">
                        {item.previouslyReceivedQuantity}
                      </td>
                      <td className="py-2 tabular-nums" dir="ltr">
                        {item.remainingQuantity}
                      </td>
                      <td className="py-2">
                        {isReadOnly || !canManage ? (
                          <span className="tabular-nums" dir="ltr">
                            {item.quantity}
                          </span>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <Input
                              className="max-w-[100px]"
                              inputMode="numeric"
                              dir="ltr"
                              value={draft.quantity}
                              onChange={(e) =>
                                setItemDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: { ...draft, quantity: e.target.value },
                                }))
                              }
                            />
                            <Input
                              className="max-w-[180px]"
                              placeholder="یادداشت قلم"
                              value={draft.notes}
                              onChange={(e) =>
                                setItemDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: { ...draft, notes: e.target.value },
                                }))
                              }
                            />
                          </div>
                        )}
                      </td>
                      {!isReadOnly && canManage ? (
                        <td className="py-2">
                          <div className="flex flex-col gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={saveItem.isPending}
                              onClick={() => saveItem.mutate(item)}
                            >
                              ذخیره
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-red-600"
                              disabled={removeItem.isPending}
                              onClick={() => removeItem.mutate(item.id)}
                            >
                              حذف
                            </Button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {isDraft && canManage && addableLines.length > 0 ? (
          <div className="border-t border-slate-100 pt-3">
            <div className="mb-2 text-xs font-medium text-slate-600">افزودن قلم از سفارش</div>
            <ul className="space-y-1 text-sm">
              {addableLines.map((line) => (
                <li key={line.purchaseOrderItemId} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs" dir="ltr">
                    {line.skuCode ?? '—'}
                  </span>
                  <span>{line.productName ?? '—'}</span>
                  <span className="text-slate-500">
                    باقیمانده:{' '}
                    <span dir="ltr" className="tabular-nums">
                      {line.remainingQuantity}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={addLine.isPending}
                    onClick={() => addLine.mutate(line.purchaseOrderItemId)}
                  >
                    افزودن با باقیمانده
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {row.items.some((i) => i.quantity > 0) ? (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">تخصیص بچ / سری ساخت</h2>
          <p className="text-xs text-slate-500">
            تخصیص بچ هویت دریافت را ثبت می‌کند؛ موجودی فیزیکی انبار در این فاز به‌روز نمی‌شود.
          </p>
          <ul className="space-y-3">
            {row.items
              .filter((i) => i.quantity > 0)
              .map((item) => (
                <li key={item.id} className="border-t border-slate-100 pt-3 first:border-0 first:pt-0">
                  <div className="mb-1 text-sm font-medium text-slate-800">
                    <span className="font-mono text-xs" dir="ltr">
                      {item.skuCode ?? '—'}
                    </span>
                    <span className="ms-2">{item.productName ?? '—'}</span>
                    <span className="ms-2 text-xs font-normal text-slate-500">
                      تعداد رسید:{' '}
                      <span className="tabular-nums" dir="ltr">
                        {item.quantity}
                      </span>
                    </span>
                  </div>
                  <GoodsReceiptItemBatchSection
                    companyId={companyId}
                    goodsReceiptId={goodsReceiptId}
                    item={item}
                    editable={isDraft && canManage}
                    onReceiptUpdated={(next) => {
                      queryClient.setQueryData(
                        warehouseKeys.goodsReceipts.detail(companyId, goodsReceiptId),
                        next,
                      );
                    }}
                  />
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <ConfirmDialog
        open={postOpen}
        onOpenChange={setPostOpen}
        title="ثبت نهایی رسید کالا"
        description="با ثبت نهایی، دریافت فیزیکی کالا به‌عنوان واقعیت غیرقابل بازگشت ثبت می‌شود. پس از ثبت نهایی، ویرایش یا لغو این رسید در این فاز امکان‌پذیر نیست. حرکت موجودی انبار هنوز در این مرحله انجام نمی‌شود، اما سابقه دریافت برای سفارش خرید به‌روز می‌شود."
        target={row.number}
        confirmLabel="ثبت نهایی"
        loading={post.isPending}
        onConfirm={() => post.mutate()}
      />

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen} title="لغو پیش‌نویس رسید">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            لغو فقط برای پیش‌نویس است و اثری روی دریافت‌های ثبت‌شده ندارد.
          </p>
          <div className="space-y-1">
            <Label htmlFor="gr-cancel-reason">دلیل لغو (اختیاری)</Label>
            <textarea
              id="gr-cancel-reason"
              className={textareaClassName}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCancelOpen(false)}>
              انصراف
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              لغو پیش‌نویس
            </Button>
          </div>
        </div>
      </Dialog>

      <WarehouseEntityActivity
        kind="GOODS_RECEIPT"
        entityId={goodsReceiptId}
        readPermission={PERMISSIONS.WAREHOUSE_RECEIPT_READ}
      />
    </div>
  );
}
