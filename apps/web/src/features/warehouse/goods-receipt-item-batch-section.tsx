'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatBatchDateOnly } from '@/features/warehouse/batch-labels';
import {
  createBatch,
  fetchBatches,
  removeGoodsReceiptItemBatch,
  updateGoodsReceiptItemBatch,
  upsertGoodsReceiptItemBatch,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { warehouseBatchPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { BatchListItem } from '@/types/batch';
import type { GoodsReceiptDetail, GoodsReceiptItem } from '@/types/goods-receipt';

const textareaClassName =
  'flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm';

type Props = {
  companyId: string;
  goodsReceiptId: string;
  item: GoodsReceiptItem;
  editable: boolean;
  onReceiptUpdated: (receipt: GoodsReceiptDetail) => void;
};

type AddMode = 'existing' | 'new';

function itemAllocatedQuantity(item: GoodsReceiptItem): number {
  return item.allocatedQuantity ?? item.batchAllocations?.reduce((s, a) => s + a.quantity, 0) ?? 0;
}

export function GoodsReceiptItemBatchSection({
  companyId,
  goodsReceiptId,
  item,
  editable,
  onReceiptUpdated,
}: Props) {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const canBatchManage = can(PERMISSIONS.WAREHOUSE_BATCH_MANAGE);

  const [addOpen, setAddOpen] = React.useState(false);
  const [addMode, setAddMode] = React.useState<AddMode>('existing');
  const [selectedBatchId, setSelectedBatchId] = React.useState('');
  const [addQty, setAddQty] = React.useState('');
  const [supplierBatch, setSupplierBatch] = React.useState('');
  const [manufacturedAt, setManufacturedAt] = React.useState('');
  const [expiresAt, setExpiresAt] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [batchSearch, setBatchSearch] = React.useState('');
  const [editQty, setEditQty] = React.useState<Record<string, string>>({});

  const allocated = itemAllocatedQuantity(item);
  const remaining = Math.max(0, item.quantity - allocated);
  const complete = item.quantity > 0 && allocated === item.quantity;

  const batchesQuery = useQuery({
    queryKey: warehouseKeys.batches.list(companyId, {
      skuId: item.skuId,
      page: 1,
      pageSize: 50,
      q: batchSearch.trim() || undefined,
    }),
    enabled: addOpen && addMode === 'existing' && Boolean(companyId),
    queryFn: () =>
      fetchBatches(companyId, {
        skuId: item.skuId,
        page: 1,
        pageSize: 50,
        q: batchSearch.trim() || undefined,
      }),
  });

  const allocatedBatchIds = new Set(item.batchAllocations.map((a) => a.batchId));
  const selectableBatches = (batchesQuery.data?.data ?? []).filter(
    (b) => !allocatedBatchIds.has(b.id),
  );

  const syncReceipt = async (receipt: GoodsReceiptDetail) => {
    onReceiptUpdated(receipt);
    queryClient.setQueryData(
      warehouseKeys.goodsReceipts.detail(companyId, goodsReceiptId),
      receipt,
    );
    await queryClient.invalidateQueries({
      queryKey: warehouseKeys.goodsReceipts.detail(companyId, goodsReceiptId),
    });
  };

  const addBatch = useMutation({
    mutationFn: async () => {
      const quantity = Number(addQty.trim());
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('quantity');
      if (quantity > remaining) throw new Error('exceeded');

      if (addMode === 'existing') {
        if (!selectedBatchId) throw new Error('batch');
        return upsertGoodsReceiptItemBatch(companyId, goodsReceiptId, item.id, {
          batchId: selectedBatchId,
          quantity,
        });
      }

      const notesTrim = notes.trim();
      if (notesTrim && canBatchManage) {
        const created = await createBatch(companyId, {
          skuId: item.skuId,
          supplierBatchNumber: supplierBatch.trim() || null,
          manufacturedAt: manufacturedAt.trim() || null,
          expiresAt: expiresAt.trim() || null,
          notes: notesTrim,
        });
        return upsertGoodsReceiptItemBatch(companyId, goodsReceiptId, item.id, {
          batchId: created.id,
          quantity,
        });
      }

      return upsertGoodsReceiptItemBatch(companyId, goodsReceiptId, item.id, {
        supplierBatchNumber: supplierBatch.trim() || null,
        manufacturedAt: manufacturedAt.trim() || null,
        expiresAt: expiresAt.trim() || null,
        quantity,
      });
    },
    onSuccess: async (receipt) => {
      toast.success('تخصیص بچ ثبت شد.');
      setAddOpen(false);
      resetAddForm();
      await syncReceipt(receipt);
    },
    onError: (error) => {
      if (error instanceof Error) {
        if (error.message === 'quantity') {
          toast.error('تعداد باید عدد صحیح مثبت باشد.');
          return;
        }
        if (error.message === 'exceeded') {
          toast.error('تعداد از باقیمانده تخصیص بیشتر است.');
          return;
        }
        if (error.message === 'batch') {
          toast.error('یک بچ موجود انتخاب کنید.');
          return;
        }
      }
      toast.error(mapBusinessError(error));
    },
  });

  const saveAllocation = useMutation({
    mutationFn: async (allocationId: string) => {
      const raw = editQty[allocationId];
      const quantity = Number(raw?.trim());
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('quantity');
      const other = item.batchAllocations
        .filter((a) => a.id !== allocationId)
        .reduce((s, a) => s + a.quantity, 0);
      if (other + quantity > item.quantity) throw new Error('exceeded');
      return updateGoodsReceiptItemBatch(
        companyId,
        goodsReceiptId,
        item.id,
        allocationId,
        { quantity },
      );
    },
    onSuccess: async (receipt) => {
      toast.success('تخصیص به‌روزرسانی شد.');
      await syncReceipt(receipt);
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'quantity') {
        toast.error('تعداد باید عدد صحیح مثبت باشد.');
        return;
      }
      if (error instanceof Error && error.message === 'exceeded') {
        toast.error('مجموع تخصیص‌ها از تعداد قلم بیشتر می‌شود.');
        return;
      }
      toast.error(mapBusinessError(error));
    },
  });

  const removeAllocation = useMutation({
    mutationFn: (allocationId: string) =>
      removeGoodsReceiptItemBatch(companyId, goodsReceiptId, item.id, allocationId),
    onSuccess: async (receipt) => {
      toast.success('تخصیص حذف شد.');
      await syncReceipt(receipt);
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  function resetAddForm() {
    setAddMode('existing');
    setSelectedBatchId('');
    setAddQty(remaining > 0 ? String(remaining) : '');
    setSupplierBatch('');
    setManufacturedAt('');
    setExpiresAt('');
    setNotes('');
    setBatchSearch('');
  }

  React.useEffect(() => {
    if (addOpen) {
      setAddQty(remaining > 0 ? String(remaining) : '');
    }
  }, [addOpen, remaining]);

  return (
    <div className="mt-2 space-y-2 rounded-md border border-slate-100 bg-slate-50/80 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-slate-600">
          تخصیص بچ:{' '}
          <span className="tabular-nums font-medium text-slate-900" dir="ltr">
            {allocated}/{item.quantity}
          </span>
          {!complete && item.quantity > 0 ? (
            <span className="ms-2 text-amber-800">
              (باقیمانده:{' '}
              <span className="tabular-nums" dir="ltr">
                {remaining}
              </span>
              )
            </span>
          ) : null}
          {complete ? (
            <span className="ms-2 text-emerald-800">کامل</span>
          ) : null}
        </div>
        {editable ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={remaining <= 0}
            onClick={() => {
              resetAddForm();
              setAddOpen(true);
            }}
          >
            افزودن بچ
          </Button>
        ) : null}
      </div>

      {item.batchAllocations.length === 0 ? (
        <p className="text-xs text-slate-500">تخصیص بچی ثبت نشده است.</p>
      ) : (
        <ul className="space-y-2 text-xs">
          {item.batchAllocations.map((a) => {
            const draft = editQty[a.id] ?? String(a.quantity);
            return (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1.5"
              >
                <Link
                  href={warehouseBatchPath(a.batchId)}
                  className="font-mono font-medium underline-offset-2 hover:underline"
                  dir="ltr"
                >
                  {a.batchNumber}
                </Link>
                {a.supplierBatchNumber ? (
                  <span className="text-slate-500" dir="ltr">
                    ({a.supplierBatchNumber})
                  </span>
                ) : null}
                {a.expiresAt ? (
                  <span className="text-slate-500">انقضا: {formatBatchDateOnly(a.expiresAt)}</span>
                ) : null}
                {editable ? (
                  <>
                    <Input
                      className="h-8 w-20"
                      inputMode="numeric"
                      dir="ltr"
                      value={draft}
                      onChange={(e) =>
                        setEditQty((prev) => ({ ...prev, [a.id]: e.target.value }))
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={saveAllocation.isPending}
                      onClick={() => saveAllocation.mutate(a.id)}
                    >
                      ذخیره
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-red-600"
                      disabled={removeAllocation.isPending}
                      onClick={() => removeAllocation.mutate(a.id)}
                    >
                      حذف
                    </Button>
                  </>
                ) : (
                  <span className="tabular-nums font-medium" dir="ltr">
                    ×{a.quantity}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen} title="افزودن تخصیص بچ">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`add-mode-${item.id}`}
                checked={addMode === 'existing'}
                onChange={() => setAddMode('existing')}
              />
              بچ موجود برای این SKU
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`add-mode-${item.id}`}
                checked={addMode === 'new'}
                onChange={() => setAddMode('new')}
              />
              بچ جدید
            </label>
          </div>

          {addMode === 'existing' ? (
            <div className="space-y-2">
              <Label htmlFor={`batch-q-${item.id}`}>جستجوی بچ</Label>
              <Input
                id={`batch-q-${item.id}`}
                value={batchSearch}
                onChange={(e) => setBatchSearch(e.target.value)}
                placeholder="شماره بچ یا سری سازنده"
              />
              <div className="max-h-40 space-y-1 overflow-y-auto rounded border border-slate-200 p-2">
                {batchesQuery.isPending ? (
                  <p className="text-xs text-slate-500">در حال بارگذاری…</p>
                ) : selectableBatches.length === 0 ? (
                  <p className="text-xs text-slate-500">بچ قابل انتخابی یافت نشد.</p>
                ) : (
                  selectableBatches.map((b: BatchListItem) => (
                    <label
                      key={b.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-slate-50"
                    >
                      <input
                        type="radio"
                        name={`pick-batch-${item.id}`}
                        checked={selectedBatchId === b.id}
                        onChange={() => setSelectedBatchId(b.id)}
                      />
                      <span className="font-mono text-xs" dir="ltr">
                        {b.batchNumber}
                      </span>
                      {b.supplierBatchNumber ? (
                        <span className="text-slate-500" dir="ltr">
                          · {b.supplierBatchNumber}
                        </span>
                      ) : null}
                    </label>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor={`sup-batch-${item.id}`}>سری سازنده (اختیاری)</Label>
                <Input
                  id={`sup-batch-${item.id}`}
                  dir="ltr"
                  value={supplierBatch}
                  onChange={(e) => setSupplierBatch(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`mfg-${item.id}`}>تاریخ تولید</Label>
                <Input
                  id={`mfg-${item.id}`}
                  type="date"
                  dir="ltr"
                  value={manufacturedAt}
                  onChange={(e) => setManufacturedAt(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`exp-${item.id}`}>تاریخ انقضا</Label>
                <Input
                  id={`exp-${item.id}`}
                  type="date"
                  dir="ltr"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </div>
              {canBatchManage ? (
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor={`batch-notes-${item.id}`}>یادداشت (اختیاری)</Label>
                  <textarea
                    id={`batch-notes-${item.id}`}
                    className={textareaClassName}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                  <p className="text-xs text-slate-500">
                    یادداشت فقط هنگام ایجاد بچ جدید با دسترسی مدیریت بچ ذخیره می‌شود.
                  </p>
                </div>
              ) : null}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor={`add-qty-${item.id}`}>تعداد تخصیص</Label>
            <Input
              id={`add-qty-${item.id}`}
              className="max-w-[120px]"
              inputMode="numeric"
              dir="ltr"
              value={addQty}
              onChange={(e) => setAddQty(e.target.value)}
            />
            <p className="text-xs text-slate-500">
              حداکثر قابل تخصیص برای این قلم:{' '}
              <span className="tabular-nums" dir="ltr">
                {remaining}
              </span>
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              انصراف
            </Button>
            <Button
              type="button"
              disabled={addBatch.isPending}
              onClick={() => addBatch.mutate()}
            >
              ثبت تخصیص
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
