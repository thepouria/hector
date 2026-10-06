'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  BarcodeScanInput,
  type BarcodeScanInputHandle,
} from '@/components/catalog/barcode-scan-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { stockClassificationLabel } from '@/features/warehouse/stock-count-labels';
import { applyStockCountScan, fetchBatches } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { warehouseKeys } from '@/lib/query/keys';
import { useQuery } from '@tanstack/react-query';
import type { StockCountDetail } from '@/types/stock-count';
import type { StockClassification } from '@/types/stock-classification';

type StockCountScannerPanelProps = {
  companyId: string;
  countId: string;
  count: StockCountDetail;
  activeLocationId: string | null;
  onCountUpdated: (count: StockCountDetail) => void;
  onActiveLocationChange?: (locationId: string | null) => void;
  disabled?: boolean;
};

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function StockCountScannerPanel({
  companyId,
  countId,
  count,
  activeLocationId,
  onCountUpdated,
  onActiveLocationChange,
  disabled = false,
}: StockCountScannerPanelProps) {
  const [busy, setBusy] = React.useState(false);
  const [countedText, setCountedText] = React.useState('1');
  const [incrementMode, setIncrementMode] = React.useState(true);
  const [batchId, setBatchId] = React.useState('');
  const [classification, setClassification] = React.useState<StockClassification>('SELLABLE');
  const [lastSkuId, setLastSkuId] = React.useState<string | null>(null);

  const scanRef = React.useRef<BarcodeScanInputHandle>(null);
  const productScanRef = React.useRef<BarcodeScanInputHandle>(null);

  const activeLocation = count.items.find((i) => i.location.id === activeLocationId)?.location;

  const batchesQuery = useQuery({
    queryKey: warehouseKeys.batches.list(companyId, { skuId: lastSkuId ?? undefined, pageSize: 30 }),
    enabled: Boolean(companyId) && Boolean(lastSkuId),
    queryFn: () => fetchBatches(companyId, { skuId: lastSkuId!, pageSize: 30 }),
  });
  const batches = batchesQuery.data?.data ?? [];

  const focusScan = React.useCallback(() => {
    queueMicrotask(() => scanRef.current?.focus());
  }, []);

  React.useEffect(() => {
    focusScan();
  }, [focusScan, activeLocationId]);

  const runScan = async (
    payload: Parameters<typeof applyStockCountScan>[2] extends infer B
      ? Omit<B, 'requestId'>
      : never,
  ) => {
    if (disabled || busy) return;
    setBusy(true);
    try {
      const result = await applyStockCountScan(companyId, countId, {
        requestId: newRequestId(),
        batchId: batchId || undefined,
        classification,
        increment: payload.increment ?? incrementMode,
        ...payload,
      });
      onCountUpdated(result.count);
      if (result.activeLocationId) onActiveLocationChange?.(result.activeLocationId);
      if (result.item.skuId) setLastSkuId(result.item.skuId);
      toast.success(
        result.incremented
          ? `+1 · ${result.item.skuCode}`
          : `ثبت ${result.item.countedQuantity ?? '—'} · ${result.item.skuCode}`,
      );
      focusScan();
    } catch (error) {
      toast.error(mapBusinessError(error));
    } finally {
      setBusy(false);
    }
  };

  const onLocationScan = async (value: string) => {
    await runScan({ locationBarcode: value.trim(), increment: false });
  };

  const onProductScan = async (value: string) => {
    const qty = Number.parseInt(countedText, 10);
    await runScan({
      productBarcode: value.trim(),
      countedQuantity: Number.isFinite(qty) && !incrementMode ? qty : undefined,
      increment: incrementMode,
    });
  };

  const applyManualCount = async () => {
    const qty = Number.parseInt(countedText, 10);
    if (!Number.isFinite(qty) || qty < 0) {
      toast.error('تعداد نامعتبر است.');
      return;
    }
    await runScan({
      locationId: activeLocationId ?? undefined,
      batchId: batchId || undefined,
      classification,
      countedQuantity: qty,
      increment: incrementMode,
    });
  };

  return (
    <section className="space-y-4 rounded-lg border-2 border-slate-300 bg-white p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">محیط اسکن</h2>
        <div className="text-sm text-slate-600">
          پیشرفت:{' '}
          <span className="tabular-nums font-medium" dir="ltr">
            {count.progress.countedLines}/{count.progress.totalLines} (
            {count.progress.percentCounted}%)
          </span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md bg-slate-50 p-3 sm:col-span-3">
          <div className="text-xs text-slate-500">مکان فعال</div>
          <div className="text-xl font-mono font-semibold" dir="ltr">
            {activeLocation?.code ?? '— اسکن مکان —'}
          </div>
        </div>
        <div className="tabular-nums text-center sm:col-span-1">
          <div className="text-xs text-slate-500">مطابق</div>
          <div className="text-2xl font-semibold" dir="ltr">
            {count.progress.matchLines}
          </div>
        </div>
        <div className="tabular-nums text-center sm:col-span-1">
          <div className="text-xs text-slate-500">اختلاف</div>
          <div className="text-2xl font-semibold text-amber-700" dir="ltr">
            {count.progress.differenceLines}
          </div>
        </div>
        <div className="tabular-nums text-center sm:col-span-1">
          <div className="text-xs text-slate-500">باقی‌مانده</div>
          <div className="text-2xl font-semibold" dir="ltr">
            {count.progress.pendingLines}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-base">اسکن مکان</Label>
        <BarcodeScanInput
          ref={scanRef}
          disabled={disabled || busy}
          placeholder="بارکد مکان (LOC-…)"
          onScan={onLocationScan}
          className="h-12 text-lg"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-base">اسکن محصول</Label>
        <BarcodeScanInput
          ref={productScanRef}
          disabled={disabled || busy || !activeLocationId}
          placeholder="بارکد SKU / محصول"
          onScan={onProductScan}
          className="h-12 text-lg"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1">
          <Label>بچ (در صورت نیاز)</Label>
          <select
            className="flex h-12 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            disabled={!lastSkuId}
          >
            <option value="">پیش‌فرض / از اسکن</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.batchNumber}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label>طبقه‌بندی</Label>
          <select
            className="flex h-12 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={classification}
            onChange={(e) => setClassification(e.target.value as StockClassification)}
          >
            <option value="SELLABLE">قابل فروش</option>
            <option value="TESTER">تستر</option>
            <option value="DAMAGED">آسیب‌دیده</option>
            <option value="QUARANTINE">قرنطینه</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label>تعداد</Label>
          <Input
            className="h-12 text-lg tabular-nums"
            value={countedText}
            onChange={(e) => setCountedText(e.target.value)}
            inputMode="numeric"
            dir="ltr"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={incrementMode}
            onChange={(e) => setIncrementMode(e.target.checked)}
          />
          افزایشی (+1 با هر اسکن)
        </label>
        <Button
          type="button"
          size="lg"
          className="min-h-12 px-8 text-base"
          disabled={disabled || busy || !activeLocationId}
          onClick={() => void applyManualCount()}
        >
          ثبت تعداد
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="min-h-12 px-8 text-base"
          disabled={disabled || busy || !activeLocationId}
          onClick={() => {
            setCountedText('1');
            void runScan({ increment: true, countedQuantity: 1 });
          }}
        >
          +1 سریع
        </Button>
      </div>

      <p className="text-xs text-slate-500">
        طبقه‌بندی انتخاب‌شده: {stockClassificationLabel(classification)}
      </p>
    </section>
  );
}
