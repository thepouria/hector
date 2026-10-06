'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { stockClassificationLabel } from '@/features/warehouse/stock-issue-labels';
import { changeStockClassification } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { warehouseKeys } from '@/lib/query/keys';
import type { StockClassification } from '@/types/stock-classification';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  warehouseId: string;
  warehouseCode: string;
  locationId: string;
  locationCode: string;
  skuId: string;
  skuCode: string;
  batchId: string;
  batchNumber: string;
  fromClassification: StockClassification;
  sourceOnHand: number;
  companyTotal: number;
  initialTo?: StockClassification;
};

const CLASSIFICATIONS: StockClassification[] = [
  'SELLABLE',
  'TESTER',
  'DAMAGED',
  'QUARANTINE',
];

export function ClassificationChangeDialog({
  open,
  onOpenChange,
  companyId,
  warehouseId,
  warehouseCode,
  locationId,
  locationCode,
  skuId,
  skuCode,
  batchId,
  batchNumber,
  fromClassification,
  sourceOnHand,
  companyTotal,
  initialTo,
}: Props) {
  const queryClient = useQueryClient();
  const [toClassification, setToClassification] = React.useState<StockClassification>(
    initialTo ?? 'TESTER',
  );
  const [quantityText, setQuantityText] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [confirming, setConfirming] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setToClassification(initialTo && initialTo !== fromClassification ? initialTo : 'TESTER');
      setQuantityText('');
      setReason('');
      setConfirming(false);
    }
  }, [open, initialTo, fromClassification]);

  const quantity = Number.parseInt(quantityText, 10);
  const validQty = Number.isFinite(quantity) && quantity > 0 && quantity <= sourceOnHand;
  const sameClass = toClassification === fromClassification;

  const mutation = useMutation({
    mutationFn: () =>
      changeStockClassification(companyId, {
        warehouseId,
        locationId,
        skuId,
        batchId,
        fromClassification,
        toClassification,
        quantity,
        reason: reason.trim() || undefined,
      }),
    onSuccess: async () => {
      toast.success('طبقه‌بندی موجودی تغییر کرد — مجموع شرکت ثابت ماند.');
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: warehouseKeys.inventory.all(companyId) });
    await queryClient.invalidateQueries({ queryKey: warehouseKeys.dashboard(companyId) });
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!open) return null;

  const fromAfter = sourceOnHand - (validQty ? quantity : 0);
  const toAfter = validQty ? quantity : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-200 bg-white p-5 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">تغییر طبقه‌بندی موجودی</h2>
        <p className="mt-1 text-sm text-slate-600">
          این عملیات خروج از شرکت نیست. مجموع موجودی شرکت ثابت می‌ماند.
        </p>

        <div className="mt-4 space-y-3 text-sm">
          <div className="rounded-md bg-slate-50 px-3 py-2 font-mono text-xs" dir="ltr">
            {warehouseCode} / {locationCode} · {skuCode} · {batchNumber}
          </div>
          <div>
            <div className="text-xs text-slate-500">موجودی منبع فعلی</div>
            <div className="tabular-nums font-medium" dir="ltr">
              {stockClassificationLabel(fromClassification)} = {sourceOnHand}
            </div>
          </div>
          <div className="space-y-1">
            <Label>به طبقه‌بندی</Label>
            <select
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={toClassification}
              onChange={(e) => setToClassification(e.target.value as StockClassification)}
            >
              {CLASSIFICATIONS.filter((c) => c !== fromClassification).map((c) => (
                <option key={c} value={c}>
                  {stockClassificationLabel(c)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>تعداد</Label>
            <Input
              value={quantityText}
              onChange={(e) => setQuantityText(e.target.value)}
              inputMode="numeric"
            />
          </div>
          <div className="space-y-1">
            <Label>دلیل / یادداشت</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>

        {confirming && validQty && !sameClass ? (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-950">
            <div className="font-medium">تأیید پیش‌نمایش (خروج نیست)</div>
            <ul className="mt-2 space-y-1 font-mono text-xs" dir="ltr">
              <li>
                {fromClassification}: {sourceOnHand} → {fromAfter}
              </li>
              <li>
                {toClassification}: +{toAfter}
              </li>
              <li>
                Company Total: {companyTotal} → {companyTotal}
              </li>
            </ul>
          </div>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            انصراف
          </Button>
          {!confirming ? (
            <Button
              type="button"
              disabled={!validQty || sameClass}
              onClick={() => setConfirming(true)}
            >
              ادامه
            </Button>
          ) : (
            <Button
              type="button"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              تأیید تغییر طبقه‌بندی
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
