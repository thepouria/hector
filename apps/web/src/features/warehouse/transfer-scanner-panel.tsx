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
import { applyStockTransferScan } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import type { StockTransferDetail } from '@/types/stock-transfer';

type Props = {
  companyId: string;
  transferId: string;
  transfer: StockTransferDetail;
  disabled?: boolean;
  onTransferUpdated: (transfer: StockTransferDetail) => void;
};

type Step = 'SOURCE' | 'PRODUCT' | 'DEST' | 'CONFIRM';

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function TransferScannerPanel({
  companyId,
  transferId,
  transfer,
  disabled,
  onTransferUpdated,
}: Props) {
  const [step, setStep] = React.useState<Step>('SOURCE');
  const [sourceBarcode, setSourceBarcode] = React.useState('');
  const [destBarcode, setDestBarcode] = React.useState('');
  const [productBarcode, setProductBarcode] = React.useState('');
  const [quantityText, setQuantityText] = React.useState('1');
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const scanRef = React.useRef<BarcodeScanInputHandle>(null);

  React.useEffect(() => {
    setStep('SOURCE');
    setSourceBarcode('');
    setDestBarcode('');
    setProductBarcode('');
    setQuantityText('1');
    setFeedback(null);
  }, [companyId, transferId]);

  React.useEffect(() => {
    queueMicrotask(() => scanRef.current?.focus());
  }, [step]);

  const apply = async () => {
    const quantity = Number.parseInt(quantityText, 10);
    if (!Number.isFinite(quantity) || quantity < 1) {
      toast.error('تعداد باید عدد مثبت باشد.');
      return;
    }
    if (!sourceBarcode || !destBarcode || !productBarcode) {
      toast.error('مبدأ، کالا و مقصد را کامل اسکن کنید.');
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const result = await applyStockTransferScan(companyId, transferId, {
        requestId: newRequestId(),
        sourceLocationBarcode: sourceBarcode,
        destinationLocationBarcode: destBarcode,
        productBarcode,
        quantity,
      });
      onTransferUpdated(result.transfer);
      const msg = result.incremented ? 'تعداد ردیف افزایش یافت.' : 'ردیف انتقال ثبت شد.';
      toast.success(msg);
      setFeedback(`✓ ${msg}`);
      setProductBarcode('');
      setStep('PRODUCT');
    } catch (error) {
      const message = mapBusinessError(error);
      toast.error(message);
      setFeedback(`✕ ${message}`);
    } finally {
      setBusy(false);
      queueMicrotask(() => scanRef.current?.focus());
    }
  };

  const onScan = async (barcode: string) => {
    setFeedback(null);
    if (step === 'SOURCE') {
      setSourceBarcode(barcode);
      setFeedback(`✓ مکان مبدأ: ${barcode}`);
      setStep('PRODUCT');
      return;
    }
    if (step === 'PRODUCT') {
      setProductBarcode(barcode);
      setFeedback(`✓ کالا: ${barcode}`);
      setStep('DEST');
      return;
    }
    if (step === 'DEST') {
      setDestBarcode(barcode);
      setFeedback(`✓ مکان مقصد: ${barcode}`);
      setStep('CONFIRM');
    }
  };

  const scanPlaceholder =
    step === 'SOURCE'
      ? 'اسکن بارکد مکان مبدأ...'
      : step === 'PRODUCT'
        ? 'اسکن بارکد کالا...'
        : step === 'DEST'
          ? 'اسکن بارکد مکان مقصد...'
          : 'برای اسکن بعدی پس از تأیید آماده است';

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">اسکن سریع انتقال</h2>
        <p className="mt-1 text-xs text-slate-600">
          {transfer.number} · {transfer.sourceWarehouse.code} → {transfer.destinationWarehouse.code}
        </p>
        <p className="mt-1 font-mono text-xs text-slate-500" dir="ltr">
          step={step}
          {sourceBarcode ? ` · src=${sourceBarcode}` : ''}
          {productBarcode ? ` · sku=${productBarcode}` : ''}
          {destBarcode ? ` · dest=${destBarcode}` : ''}
        </p>
      </div>

      {step !== 'CONFIRM' ? (
        <div className="space-y-1">
          <Label htmlFor="trf-scanner-input">اسکن بارکد</Label>
          <BarcodeScanInput
            ref={scanRef}
            id="trf-scanner-input"
            key={`${companyId}:${transferId}:${step}`}
            onScan={onScan}
            disabled={disabled || busy}
            placeholder={scanPlaceholder}
          />
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="trf-scan-qty">تعداد</Label>
          <Input
            id="trf-scan-qty"
            value={quantityText}
            onChange={(e) => setQuantityText(e.target.value)}
            disabled={disabled || busy}
            dir="ltr"
            className="tabular-nums"
          />
        </div>
        <div className="flex items-end gap-2">
          <Button
            type="button"
            disabled={disabled || busy || step !== 'CONFIRM'}
            onClick={() => void apply()}
          >
            تأیید ردیف انتقال
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || busy}
            onClick={() => {
              setStep('SOURCE');
              setSourceBarcode('');
              setDestBarcode('');
              setProductBarcode('');
              setFeedback(null);
            }}
          >
            بازنشانی
          </Button>
        </div>
      </div>

      {feedback ? (
        <div
          className={
            feedback.startsWith('✓')
              ? 'rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900'
              : 'rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900'
          }
          role="status"
        >
          {feedback}
        </div>
      ) : null}
    </div>
  );
}
