'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BarcodeScanInput } from '@/components/catalog/barcode-scan-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatBatchDateOnly } from '@/features/warehouse/batch-labels';
import {
  applyGoodsReceiptScan,
  fetchBatches,
  resolveGoodsReceiptScan,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { warehouseKeys } from '@/lib/query/keys';
import type { GoodsReceiptDetail, ScanResolveResult } from '@/types/goods-receipt';
import {
  DEFAULT_SCANNER_MODE,
  formatScanHistoryLabel,
  normalizeScannerInput,
  playScannerTone,
  type ScanHistoryEntry,
  type ScannerMode,
} from './scanner-receiving';

type PendingQuantity = {
  barcode: string;
  resolve: Extract<ScanResolveResult, { status: 'MATCHED' }>;
};

type ActiveBatchState = {
  skuId: string | null;
  batchId: string | null;
  batchNumber: string | null;
  supplierBatchNumber: string;
  manufacturedAt: string;
  expiresAt: string;
};

function emptyActiveBatch(): ActiveBatchState {
  return {
    skuId: null,
    batchId: null,
    batchNumber: null,
    supplierBatchNumber: '',
    manufacturedAt: '',
    expiresAt: '',
  };
}

function batchScanPayload(state: ActiveBatchState) {
  const has =
    state.batchId ||
    state.supplierBatchNumber.trim() ||
    state.manufacturedAt.trim() ||
    state.expiresAt.trim();
  if (!has) return {};
  return {
    batchId: state.batchId ?? undefined,
    supplierBatchNumber: state.supplierBatchNumber.trim() || null,
    manufacturedAt: state.manufacturedAt.trim() || null,
    expiresAt: state.expiresAt.trim() || null,
  };
}

type GoodsReceiptScannerPanelProps = {
  companyId: string;
  goodsReceiptId: string;
  receipt: GoodsReceiptDetail;
  onReceiptUpdated: (receipt: GoodsReceiptDetail) => void;
};

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function GoodsReceiptScannerPanel({
  companyId,
  goodsReceiptId,
  receipt,
  onReceiptUpdated,
}: GoodsReceiptScannerPanelProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = React.useState<ScannerMode>(DEFAULT_SCANNER_MODE);
  const [audioEnabled, setAudioEnabled] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [pending, setPending] = React.useState<PendingQuantity | null>(null);
  const [qtyText, setQtyText] = React.useState('');
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<ScanHistoryEntry[]>([]);
  const [activeBatch, setActiveBatch] = React.useState<ActiveBatchState>(emptyActiveBatch);
  const [batchPickerSkuId, setBatchPickerSkuId] = React.useState<string | null>(null);
  const qtyRef = React.useRef<HTMLInputElement>(null);
  const scanKeyRef = React.useRef(0);
  const submittingRef = React.useRef(false);

  const batchOptionsQuery = useQuery({
    queryKey: warehouseKeys.batches.list(companyId, {
      skuId: batchPickerSkuId ?? '',
      page: 1,
      pageSize: 30,
    }),
    enabled: Boolean(companyId) && Boolean(batchPickerSkuId),
    queryFn: () =>
      fetchBatches(companyId, { skuId: batchPickerSkuId!, page: 1, pageSize: 30 }),
  });

  const ensureBatchSkuCompatible = React.useCallback(
    (skuId: string): boolean => {
      if (activeBatch.skuId && activeBatch.skuId !== skuId) {
        setActiveBatch(emptyActiveBatch());
        toast.message('بچ فعال با SKU این اسکن هم‌خوان نیست — بچ پاک شد. بچ جدید تنظیم کنید.');
        return false;
      }
      return true;
    },
    [activeBatch.skuId],
  );

  const bindBatchToSku = React.useCallback((skuId: string) => {
    setActiveBatch((prev) => (prev.skuId === skuId ? prev : { ...prev, skuId }));
    setBatchPickerSkuId(skuId);
  }, []);

  const pushHistory = React.useCallback((entry: Omit<ScanHistoryEntry, 'id' | 'at'>) => {
    const row: ScanHistoryEntry = {
      ...entry,
      id: newRequestId(),
      at: new Date().toLocaleTimeString('fa-IR', { hour12: false }),
    };
    setHistory((prev) => [row, ...prev].slice(0, 40));
  }, []);

  const invalidate = React.useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: warehouseKeys.goodsReceipts.detail(companyId, goodsReceiptId),
    });
    await queryClient.invalidateQueries({
      queryKey: warehouseKeys.goodsReceipts.purchaseOrderProgress(
        companyId,
        receipt.purchaseOrderId,
      ),
    });
  }, [companyId, goodsReceiptId, queryClient, receipt.purchaseOrderId]);

  const handleApply = React.useCallback(
    async (barcode: string, quantity: number, skuIdForBatch?: string) => {
      if (skuIdForBatch && !ensureBatchSkuCompatible(skuIdForBatch)) {
        throw new Error('batch_sku_mismatch');
      }
      const requestId = newRequestId();
      const batchFields = batchScanPayload(activeBatch);
      const result = await applyGoodsReceiptScan(companyId, goodsReceiptId, {
        barcode,
        quantity,
        requestId,
        ...batchFields,
      });
      if (Object.keys(batchFields).length > 0) {
        bindBatchToSku(result.sku.id);
      }
      onReceiptUpdated(result.receipt);
      queryClient.setQueryData(
        warehouseKeys.goodsReceipts.detail(companyId, goodsReceiptId),
        result.receipt,
      );
      const batchNote =
        activeBatch.batchNumber || activeBatch.supplierBatchNumber.trim()
          ? `\nبچ: ${activeBatch.batchNumber ?? activeBatch.supplierBatchNumber.trim()}`
          : '';
      setFeedback(
        `✓ ${result.sku.productName ?? result.sku.code} +${result.quantityAdded} — این رسید: ${result.draftQuantity}${batchNote}`,
      );
      pushHistory({
        kind: 'success',
        barcode: result.barcode,
        label: formatScanHistoryLabel({
          kind: 'success',
          skuCode: result.sku.code,
          barcode: result.barcode,
          quantity: result.quantityAdded,
        }),
        quantity: result.quantityAdded,
      });
      playScannerTone('success', audioEnabled);
      setPending(null);
      setQtyText('');
      scanKeyRef.current += 1;
      await invalidate();
    },
    [
      activeBatch,
      audioEnabled,
      bindBatchToSku,
      companyId,
      ensureBatchSkuCompatible,
      goodsReceiptId,
      invalidate,
      onReceiptUpdated,
      pushHistory,
      queryClient,
    ],
  );

  const onScan = React.useCallback(
    async (raw: string) => {
      const barcode = normalizeScannerInput(raw);
      if (!barcode || busy || submittingRef.current) return;
      submittingRef.current = true;
      setBusy(true);
      setFeedback(null);
      try {
        if (mode === 'UNIT') {
          const resolvedUnit = await resolveGoodsReceiptScan(companyId, goodsReceiptId, { barcode });
          if (resolvedUnit.status === 'MATCHED') {
            if (!ensureBatchSkuCompatible(resolvedUnit.sku.id)) return;
            bindBatchToSku(resolvedUnit.sku.id);
            await handleApply(barcode, 1, resolvedUnit.sku.id);
            return;
          }
          if (resolvedUnit.status === 'UNKNOWN_BARCODE') {
            setFeedback(`✕ بارکد شناسایی نشد\n${resolvedUnit.barcode}`);
            playScannerTone('error', audioEnabled);
            return;
          }
          setFeedback(mapBusinessError(new Error(resolvedUnit.status)));
          playScannerTone('error', audioEnabled);
          return;
        }

        const resolved = await resolveGoodsReceiptScan(companyId, goodsReceiptId, { barcode });
        if (resolved.status === 'MATCHED') {
          if (!ensureBatchSkuCompatible(resolved.sku.id)) return;
          bindBatchToSku(resolved.sku.id);
          setPending({ barcode: resolved.barcode, resolve: resolved });
          setQtyText('');
          setFeedback(
            `${resolved.sku.productName ?? resolved.sku.code} — باقیمانده PO: ${resolved.line.remainingQuantity} — قابل افزودن به این پیش‌نویس: ${resolved.line.availableToAdd}`,
          );
          queueMicrotask(() => qtyRef.current?.focus());
          return;
        }

        if (resolved.status === 'UNKNOWN_BARCODE') {
          setFeedback(`✕ بارکد شناسایی نشد\n${resolved.barcode}`);
          pushHistory({
            kind: 'unknown',
            barcode: resolved.barcode,
            label: formatScanHistoryLabel({ kind: 'unknown', barcode: resolved.barcode }),
          });
          playScannerTone('error', audioEnabled);
          return;
        }

        if (resolved.status === 'SKU_NOT_IN_PURCHASE_ORDER') {
          setFeedback(
            `این کالا در سفارش خرید وجود ندارد.\nSKU: ${resolved.sku.code}\nProduct: ${resolved.sku.productName ?? '—'}\nBarcode: ${resolved.barcode}`,
          );
          pushHistory({
            kind: 'wrong_sku',
            barcode: resolved.barcode,
            label: formatScanHistoryLabel({
              kind: 'wrong_sku',
              skuCode: resolved.sku.code,
              barcode: resolved.barcode,
            }),
          });
          playScannerTone('error', audioEnabled);
          return;
        }

        if (
          resolved.status === 'PO_ITEM_ALREADY_FULLY_RECEIVED' ||
          resolved.status === 'PO_ITEM_RECEIVING_CLOSED'
        ) {
          setFeedback(
            resolved.status === 'PO_ITEM_RECEIVING_CLOSED'
              ? `⚠ دریافت این قلم بسته شده است (کسری).\n${resolved.sku.code}`
              : `⚠ این قلم قبلاً به‌طور کامل دریافت شده است.\n${resolved.sku.code}`,
          );
          pushHistory({
            kind: 'error',
            barcode: resolved.barcode,
            label: formatScanHistoryLabel({
              kind: 'error',
              barcode: resolved.barcode,
              message: resolved.status,
            }),
          });
          playScannerTone('error', audioEnabled);
          return;
        }

        setFeedback(`⚠ ${resolved.status}`);
        pushHistory({
          kind: 'error',
          barcode: resolved.barcode,
          label: formatScanHistoryLabel({
            kind: 'error',
            barcode: resolved.barcode,
            message: resolved.status,
          }),
        });
        playScannerTone('error', audioEnabled);
      } catch (error) {
        const details =
          isApiClientError(error) && error.details && typeof error.details === 'object'
            ? (error.details as Record<string, unknown>)
            : null;
        if (isApiClientError(error) && error.code === 'RECEIVING_QUANTITY_EXCEEDED') {
          const available = details?.availableToAdd;
          setFeedback(
            `⚠ فقط ${available ?? '—'} واحد هنوز می‌توان به این پیش‌نویس افزود`,
          );
          pushHistory({
            kind: 'capacity',
            barcode,
            label: formatScanHistoryLabel({
              kind: 'capacity',
              barcode,
              message: `only ${String(available ?? '?')} left`,
            }),
          });
        } else if (isApiClientError(error) && error.code === 'UNKNOWN_BARCODE') {
          setFeedback(`✕ بارکد شناسایی نشد\n${barcode}`);
          pushHistory({
            kind: 'unknown',
            barcode,
            label: formatScanHistoryLabel({ kind: 'unknown', barcode }),
          });
        } else if (isApiClientError(error) && error.code === 'SKU_NOT_IN_PURCHASE_ORDER') {
          const sku = details?.sku as { code?: string; productName?: string } | undefined;
          setFeedback(
            `این کالا در سفارش خرید وجود ندارد.\nSKU: ${sku?.code ?? '—'}\nProduct: ${sku?.productName ?? '—'}\nBarcode: ${barcode}`,
          );
          pushHistory({
            kind: 'wrong_sku',
            barcode,
            label: formatScanHistoryLabel({
              kind: 'wrong_sku',
              skuCode: sku?.code,
              barcode,
            }),
          });
        } else {
          setFeedback(mapBusinessError(error));
          toast.error(mapBusinessError(error));
        }
        playScannerTone('error', audioEnabled);
      } finally {
        submittingRef.current = false;
        setBusy(false);
      }
    },
    [
      audioEnabled,
      busy,
      companyId,
      goodsReceiptId,
      bindBatchToSku,
      ensureBatchSkuCompatible,
      handleApply,
      mode,
      pushHistory,
    ],
  );

  const confirmQuantity = React.useCallback(async () => {
    if (!pending || busy || submittingRef.current) return;
    const quantity = Number(qtyText.trim());
    if (!Number.isInteger(quantity) || quantity <= 0) {
      toast.error('تعداد باید عدد صحیح مثبت باشد.');
      qtyRef.current?.focus();
      return;
    }
    submittingRef.current = true;
    setBusy(true);
    try {
      await handleApply(pending.barcode, quantity, pending.resolve.sku.id);
    } catch (error) {
      if (error instanceof Error && error.message === 'batch_sku_mismatch') return;
      const details =
        isApiClientError(error) && error.details && typeof error.details === 'object'
          ? (error.details as Record<string, unknown>)
          : null;
      if (isApiClientError(error) && error.code === 'RECEIVING_QUANTITY_EXCEEDED') {
        setFeedback(
          `⚠ فقط ${details?.availableToAdd ?? '—'} واحد هنوز می‌توان به این پیش‌نویس افزود`,
        );
      } else {
        setFeedback(mapBusinessError(error));
        toast.error(mapBusinessError(error));
      }
      playScannerTone('error', audioEnabled);
      qtyRef.current?.focus();
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }, [audioEnabled, busy, handleApply, pending, qtyText]);

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">دریافت با بارکدخوان</h2>
          <p className="mt-1 text-xs text-slate-500">
            {receipt.number} · {receipt.purchaseOrderNumber} · {receipt.warehouseName}
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

      <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/80 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-slate-800">بچ فعال برای تخصیص</h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setActiveBatch(emptyActiveBatch());
              setBatchPickerSkuId(null);
            }}
          >
            پاک کردن بچ
          </Button>
        </div>
        {activeBatch.batchId ? (
          <p className="text-xs text-slate-600">
            انتخاب‌شده:{' '}
            <span className="font-mono font-medium" dir="ltr">
              {activeBatch.batchNumber}
            </span>
            {activeBatch.supplierBatchNumber.trim() ? (
              <span className="ms-1" dir="ltr">
                ({activeBatch.supplierBatchNumber.trim()})
              </span>
            ) : null}
          </p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="gr-active-supplier-batch">سری سازنده</Label>
            <Input
              id="gr-active-supplier-batch"
              dir="ltr"
              disabled={busy}
              value={activeBatch.supplierBatchNumber}
              onChange={(e) =>
                setActiveBatch((prev) => ({
                  ...prev,
                  batchId: null,
                  batchNumber: null,
                  supplierBatchNumber: e.target.value,
                }))
              }
              placeholder="اختیاری — برای بچ جدید یا یافتن بچ موجود"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gr-active-expires">تاریخ انقضا</Label>
            <Input
              id="gr-active-expires"
              type="date"
              dir="ltr"
              disabled={busy}
              value={activeBatch.expiresAt}
              onChange={(e) =>
                setActiveBatch((prev) => ({
                  ...prev,
                  batchId: null,
                  batchNumber: null,
                  expiresAt: e.target.value,
                }))
              }
            />
          </div>
        </div>
        {batchPickerSkuId ? (
          <div className="space-y-1">
            <Label htmlFor="gr-active-batch-pick">بچ موجود (این SKU)</Label>
            <select
              id="gr-active-batch-pick"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              disabled={busy || batchOptionsQuery.isPending}
              value={activeBatch.batchId ?? ''}
              onChange={(e) => {
                const id = e.target.value;
                if (!id) {
                  setActiveBatch((prev) => ({
                    ...prev,
                    batchId: null,
                    batchNumber: null,
                  }));
                  return;
                }
                const picked = batchOptionsQuery.data?.data.find((b) => b.id === id);
                if (!picked) return;
                setActiveBatch({
                  skuId: picked.skuId,
                  batchId: picked.id,
                  batchNumber: picked.batchNumber,
                  supplierBatchNumber: picked.supplierBatchNumber ?? '',
                  manufacturedAt: picked.manufacturedAt ?? '',
                  expiresAt: picked.expiresAt ?? '',
                });
              }}
            >
              <option value="">— انتخاب بچ —</option>
              {(batchOptionsQuery.data?.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNumber}
                  {b.supplierBatchNumber ? ` · ${b.supplierBatchNumber}` : ''}
                  {b.expiresAt ? ` · ${formatBatchDateOnly(b.expiresAt)}` : ''}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            پس از اولین اسکن موفق، می‌توانید بچ موجود همان SKU را انتخاب کنید.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="gr-scanner-input">اسکن بارکد</Label>
        <BarcodeScanInput
          id="gr-scanner-input"
          key={`scan-${scanKeyRef.current}-${mode}`}
          className="h-12 text-base"
          disabled={busy || Boolean(pending)}
          placeholder="بارکد را اسکن کنید یا تایپ کنید و Enter بزنید"
          onScan={onScan}
        />
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scanner-mode"
              checked={mode === 'QUANTITY'}
              disabled={busy}
              onChange={() => {
                setMode('QUANTITY');
                setPending(null);
              }}
            />
            اسکن + تعداد
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scanner-mode"
              checked={mode === 'UNIT'}
              disabled={busy}
              onChange={() => {
                setMode('UNIT');
                setPending(null);
              }}
            />
            هر واحد یک اسکن
          </label>
        </div>
      </div>

      {pending ? (
        <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3">
          <div className="text-sm font-medium text-slate-900">
            {pending.resolve.sku.productName ?? pending.resolve.sku.code}
          </div>
          <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
            <div>
              باقیمانده PO:{' '}
              <span className="tabular-nums" dir="ltr">
                {pending.resolve.line.remainingQuantity}
              </span>
            </div>
            <div>
              در این پیش‌نویس:{' '}
              <span className="tabular-nums" dir="ltr">
                {pending.resolve.line.draftQuantity}
              </span>
            </div>
            <div>
              قابل افزودن:{' '}
              <span className="tabular-nums" dir="ltr">
                {pending.resolve.line.availableToAdd}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="gr-scan-qty">تعداد</Label>
              <Input
                id="gr-scan-qty"
                ref={qtyRef}
                className="w-32"
                inputMode="numeric"
                dir="ltr"
                value={qtyText}
                disabled={busy}
                onChange={(e) => setQtyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void confirmQuantity();
                  }
                }}
              />
            </div>
            <Button type="button" disabled={busy} onClick={() => void confirmQuantity()}>
              افزودن
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setPending(null);
                setQtyText('');
                scanKeyRef.current += 1;
              }}
            >
              انصراف
            </Button>
          </div>
        </div>
      ) : null}

      {feedback ? (
        <pre className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
          {feedback}
        </pre>
      ) : null}

      <div>
        <h3 className="mb-2 text-xs font-medium text-slate-600">فعالیت اسکن (جلسه)</h3>
        {history.length === 0 ? (
          <p className="text-xs text-slate-400">هنوز اسکنی ثبت نشده است.</p>
        ) : (
          <ul className="max-h-40 space-y-1 overflow-y-auto font-mono text-xs" dir="ltr">
            {history.map((h) => (
              <li key={h.id}>
                {h.at} {h.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
