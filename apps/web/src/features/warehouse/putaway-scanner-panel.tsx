'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  BarcodeScanInput,
  type BarcodeScanInputHandle,
} from '@/components/catalog/barcode-scan-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatPutawayLocationPath } from '@/features/warehouse/putaway-labels';
import {
  derivePutawayScannerExpectation,
  normalizeScannerInput,
  parseScannerQuantity,
  putawayScannerExpectationLabel,
} from '@/features/warehouse/scanner-putaway';
import { playScannerTone } from '@/features/warehouse/scanner-receiving';
import {
  applyPutawayScan,
  fetchWarehouseLocations,
  resolvePutawayLocation,
  upsertPutawayItem,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { warehouseKeys } from '@/lib/query/keys';
import type { PutawayDetail, PutawayLocationRef, PutawaySourceLine } from '@/types/putaway';

type PutawayScannerPanelProps = {
  companyId: string;
  putawayId: string;
  putaway: PutawayDetail;
  selectedLine: PutawaySourceLine | null;
  quantityText: string;
  onQuantityTextChange: (value: string) => void;
  onPutawayUpdated: (putaway: PutawayDetail) => void;
  disabled?: boolean;
  allowProductScan?: boolean;
};

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function PutawayScannerPanel({
  companyId,
  putawayId,
  putaway,
  selectedLine,
  quantityText,
  onQuantityTextChange,
  onPutawayUpdated,
  disabled = false,
  allowProductScan = false,
}: PutawayScannerPanelProps) {
  const [audioEnabled, setAudioEnabled] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const [resolvedLocation, setResolvedLocation] = React.useState<PutawayLocationRef | null>(null);
  const [locationSearch, setLocationSearch] = React.useState('');
  const [locationSearchDebounced, setLocationSearchDebounced] = React.useState('');
  const [selectedLocationId, setSelectedLocationId] = React.useState('');

  const qtyRef = React.useRef<HTMLInputElement>(null);
  const scanRef = React.useRef<BarcodeScanInputHandle>(null);
  const scanKeyRef = React.useRef(0);

  const parsedQty = React.useMemo(() => {
    const trimmed = quantityText.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n <= 0) return null;
    return n;
  }, [quantityText]);

  const expectation = derivePutawayScannerExpectation({
    selectedAllocationId: selectedLine?.receiptBatchAllocationId ?? null,
    quantity: parsedQty,
    allowProductScan,
  });

  React.useEffect(() => {
    const t = window.setTimeout(() => setLocationSearchDebounced(locationSearch.trim()), 300);
    return () => window.clearTimeout(t);
  }, [locationSearch]);

  React.useEffect(() => {
    setResolvedLocation(null);
    setSelectedLocationId('');
    setLocationSearch('');
  }, [selectedLine?.receiptBatchAllocationId]);

  const locationOptionsQuery = useQuery({
    queryKey: warehouseKeys.locations(companyId, putaway.warehouseId, {
      search: locationSearchDebounced || undefined,
      view: 'flat',
      page: 1,
      pageSize: 30,
      status: 'ACTIVE',
    }),
    enabled: Boolean(companyId) && Boolean(locationSearchDebounced),
    queryFn: () =>
      fetchWarehouseLocations(companyId, putaway.warehouseId, {
        search: locationSearchDebounced,
        view: 'flat',
        page: 1,
        pageSize: 30,
        status: 'ACTIVE',
      }),
  });

  const focusScan = React.useCallback(() => {
    queueMicrotask(() => scanRef.current?.focus());
  }, []);

  const focusQty = React.useCallback(() => {
    queueMicrotask(() => qtyRef.current?.focus());
  }, []);

  React.useEffect(() => {
    if (selectedLine) focusQty();
  }, [selectedLine?.receiptBatchAllocationId, focusQty, selectedLine]);

  const applyAllocation = React.useCallback(
    async (location: PutawayLocationRef, quantity: number, locationBarcode?: string) => {
      if (!selectedLine) return;
      const requestId = newRequestId();
      if (locationBarcode) {
        const result = await applyPutawayScan(companyId, putawayId, {
          receiptBatchAllocationId: selectedLine.receiptBatchAllocationId,
          locationBarcode,
          quantity,
          requestId,
        });
        onPutawayUpdated(result.putaway);
        setFeedback(
          `✓ ${formatPutawayLocationPath(result.location)} +${result.quantity}${
            result.replayed ? ' (تکرار)' : ''
          }`,
        );
      } else {
        const updated = await upsertPutawayItem(companyId, putawayId, {
          receiptBatchAllocationId: selectedLine.receiptBatchAllocationId,
          warehouseLocationId: location.id,
          quantity,
        });
        onPutawayUpdated(updated);
        setFeedback(`✓ ${formatPutawayLocationPath(location)} · ${quantity} واحد`);
      }
      playScannerTone('success', audioEnabled);
      setResolvedLocation(null);
      setSelectedLocationId('');
      onQuantityTextChange('');
      scanKeyRef.current += 1;
      focusScan();
    },
    [
      audioEnabled,
      companyId,
      focusScan,
      onPutawayUpdated,
      onQuantityTextChange,
      putawayId,
      selectedLine,
    ],
  );

  const onScan = React.useCallback(
    async (raw: string) => {
      const barcode = normalizeScannerInput(raw);
      if (!barcode || busy || disabled) return;

      if (expectation === 'EXPECT_PRODUCT') {
        setFeedback('اسکن کالا در این جریان فعال نیست — یک ردیف منبع را انتخاب کنید.');
        playScannerTone('error', audioEnabled);
        return;
      }

      if (!selectedLine) {
        setFeedback('ابتدا یک ردیف منبع با باقیمانده انتخاب کنید.');
        playScannerTone('error', audioEnabled);
        return;
      }

      if (expectation === 'EXPECT_QUANTITY') {
        const fromScan = parseScannerQuantity(barcode);
        if (fromScan != null) {
          onQuantityTextChange(String(fromScan));
          setFeedback(`تعداد ${fromScan} — اکنون بارکد مکان را اسکن کنید.`);
          focusScan();
          return;
        }
        setFeedback('تعداد را در فیلد مربوطه وارد کنید، سپس مکان را اسکن کنید.');
        focusQty();
        return;
      }

      setBusy(true);
      setFeedback(null);
      try {
        const qty = parsedQty;
        if (!qty) {
          focusQty();
          throw new Error('qty');
        }
        if (qty > selectedLine.availableToAllocate) {
          setFeedback(
            `⚠ حداکثر ${selectedLine.availableToAllocate} واحد برای این ردیف در این جایگذاری قابل ثبت است.`,
          );
          playScannerTone('error', audioEnabled);
          focusQty();
          return;
        }

        const location = await resolvePutawayLocation(companyId, putawayId, { barcode });
        setResolvedLocation(location);
        await applyAllocation(location, qty, barcode);
      } catch (error) {
        if (error instanceof Error && error.message === 'qty') return;
        setFeedback(mapBusinessError(error));
        if (!isApiClientError(error)) toast.error(mapBusinessError(error));
        playScannerTone('error', audioEnabled);
        focusScan();
      } finally {
        setBusy(false);
      }
    },
    [
      applyAllocation,
      audioEnabled,
      busy,
      companyId,
      disabled,
      expectation,
      focusQty,
      focusScan,
      onQuantityTextChange,
      parsedQty,
      putawayId,
      selectedLine,
    ],
  );

  const confirmManualLocation = React.useCallback(async () => {
    if (!selectedLine || busy || disabled) return;
    const qty = parsedQty;
    if (!qty) {
      toast.error('تعداد باید عدد صحیح مثبت باشد.');
      focusQty();
      return;
    }
    if (qty > selectedLine.availableToAllocate) {
      toast.error(`حداکثر ${selectedLine.availableToAllocate} واحد قابل ثبت است.`);
      focusQty();
      return;
    }

    let location = resolvedLocation;
    if (!location && selectedLocationId) {
      const picked = locationOptionsQuery.data?.data.find((l) => l.id === selectedLocationId);
      if (picked) {
        location = {
          id: picked.id,
          code: picked.code,
          name: picked.name,
          barcode: picked.barcode,
          type: picked.type,
          status: picked.status,
          path: picked.breadcrumb?.map((b) => b.code) ?? [],
        };
      }
    }
    if (!location) {
      toast.error('مکان را با اسکن بارکد یا جستجو انتخاب کنید.');
      return;
    }

    setBusy(true);
    try {
      await applyAllocation(location, qty);
    } catch (error) {
      setFeedback(mapBusinessError(error));
      toast.error(mapBusinessError(error));
      playScannerTone('error', audioEnabled);
    } finally {
      setBusy(false);
    }
  }, [
    applyAllocation,
    audioEnabled,
    busy,
    disabled,
    focusQty,
    locationOptionsQuery.data?.data,
    parsedQty,
    resolvedLocation,
    selectedLine,
    selectedLocationId,
  ]);

  const resolveOnly = React.useCallback(async () => {
    const barcode = locationSearch.trim();
    if (!barcode || busy || disabled) return;
    setBusy(true);
    try {
      const location = await resolvePutawayLocation(companyId, putawayId, { barcode });
      setResolvedLocation(location);
      setFeedback(`مکان: ${formatPutawayLocationPath(location)}`);
      playScannerTone('success', audioEnabled);
    } catch (error) {
      setFeedback(mapBusinessError(error));
      playScannerTone('error', audioEnabled);
    } finally {
      setBusy(false);
    }
  }, [audioEnabled, busy, companyId, disabled, locationSearch, putawayId]);

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">جایگذاری با اسکن</h2>
          <p className="mt-1 text-xs text-slate-500">
            {putaway.number} · {putaway.goodsReceiptNumber} · {putaway.warehouseName}
          </p>
          <p className="mt-1 text-xs font-medium text-amber-800">
            {putawayScannerExpectationLabel(expectation)}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={audioEnabled}
            onChange={(e) => setAudioEnabled(e.target.checked)}
          />
          صدای تأیید
        </label>
      </div>

      {selectedLine ? (
        <div className="rounded-md border border-slate-200 bg-slate-50/80 p-3 text-sm">
          <div className="font-medium">{selectedLine.productName ?? selectedLine.skuCode}</div>
          <div className="mt-1 grid gap-1 text-xs text-slate-600 sm:grid-cols-3">
            <div>
              باقیمانده جایگذاری:{' '}
              <span className="tabular-nums font-medium" dir="ltr">
                {selectedLine.remainingToPutAway}
              </span>
            </div>
            <div>
              قابل ثبت در این PUT:{' '}
              <span className="tabular-nums font-medium" dir="ltr">
                {selectedLine.availableToAllocate}
              </span>
            </div>
            <div>
              قبلاً جایگذاری‌شده:{' '}
              <span className="tabular-nums" dir="ltr">
                {selectedLine.alreadyPutAway}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="putaway-qty">تعداد</Label>
          <Input
            id="putaway-qty"
            ref={qtyRef}
            className="w-32"
            inputMode="numeric"
            dir="ltr"
            disabled={disabled || busy || !selectedLine}
            value={quantityText}
            onChange={(e) => onQuantityTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                focusScan();
              }
            }}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="putaway-scanner-input">اسکن بارکد مکان</Label>
        <BarcodeScanInput
          id="putaway-scanner-input"
          ref={scanRef}
          key={`putaway-scan-${scanKeyRef.current}`}
          className="h-12 text-base"
          disabled={disabled || busy || !selectedLine || !parsedQty}
          placeholder={
            parsedQty
              ? 'بارکد مکان را اسکن کنید (نه بارکد کالا)'
              : 'پس از انتخاب ردیف و تعداد فعال می‌شود'
          }
          onScan={onScan}
        />
      </div>

      <div className="space-y-2 rounded-md border border-slate-200 p-3">
        <Label htmlFor="putaway-location-search">جستجو / بارکد مکان</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="putaway-location-search"
            dir="ltr"
            disabled={disabled || busy || !selectedLine}
            value={locationSearch}
            onChange={(e) => setLocationSearch(e.target.value)}
            placeholder="کد، نام یا بارکد مکان"
            className="max-w-md"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || busy || !locationSearch.trim()}
            onClick={() => void resolveOnly()}
          >
            resolve بارکد
          </Button>
        </div>
        {locationOptionsQuery.data?.data.length ? (
          <select
            className="flex h-10 w-full max-w-md rounded-md border border-slate-200 bg-white px-3 text-sm"
            disabled={disabled || busy}
            value={selectedLocationId}
            onChange={(e) => {
              setSelectedLocationId(e.target.value);
              setResolvedLocation(null);
            }}
          >
            <option value="">— انتخاب از نتایج جستجو —</option>
            {locationOptionsQuery.data.data.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.barcode} · {loc.code}
                {loc.name ? ` · ${loc.name}` : ''}
              </option>
            ))}
          </select>
        ) : null}
        {resolvedLocation ? (
          <p className="text-xs text-slate-700">
            مکان حل‌شده:{' '}
            <span className="font-mono" dir="ltr">
              {formatPutawayLocationPath(resolvedLocation)}
            </span>
          </p>
        ) : null}
        <Button
          type="button"
          disabled={disabled || busy || !selectedLine || !parsedQty}
          onClick={() => void confirmManualLocation()}
        >
          ثبت جایگذاری
        </Button>
      </div>

      {feedback ? (
        <pre className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
          {feedback}
        </pre>
      ) : null}
    </section>
  );
}
