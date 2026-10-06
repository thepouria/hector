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
import { stockClassificationLabel } from '@/features/warehouse/stock-issue-labels';
import { applyStockIssueScan } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import type { StockClassification } from '@/types/stock-classification';
import type { StockIssueDetail } from '@/types/stock-issue';

type Props = {
  companyId: string;
  issueId: string;
  issue: StockIssueDetail;
  disabled?: boolean;
  onIssueUpdated: (issue: StockIssueDetail) => void;
};

type Step = 'LOCATION' | 'PRODUCT' | 'CONFIRM';

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function IssueScannerPanel({
  companyId,
  issueId,
  issue,
  disabled,
  onIssueUpdated,
}: Props) {
  const [step, setStep] = React.useState<Step>('LOCATION');
  const [locationBarcode, setLocationBarcode] = React.useState('');
  const [productBarcode, setProductBarcode] = React.useState('');
  const [classification, setClassification] = React.useState<StockClassification>('SELLABLE');
  const [quantityText, setQuantityText] = React.useState('1');
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const scanRef = React.useRef<BarcodeScanInputHandle>(null);

  React.useEffect(() => {
    setStep('LOCATION');
    setLocationBarcode('');
    setProductBarcode('');
    setQuantityText('1');
    setFeedback(null);
  }, [companyId, issueId]);

  React.useEffect(() => {
    queueMicrotask(() => scanRef.current?.focus());
  }, [step]);

  const apply = async () => {
    const quantity = Number.parseInt(quantityText, 10);
    if (!Number.isFinite(quantity) || quantity < 1) {
      toast.error('تعداد باید عدد مثبت باشد.');
      return;
    }
    if (!locationBarcode || !productBarcode) {
      toast.error('مکان و کالا را اسکن کنید.');
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const result = await applyStockIssueScan(companyId, issueId, {
        requestId: newRequestId(),
        locationBarcode,
        productBarcode,
        classification,
        quantity,
      });
      onIssueUpdated(result.issue);
      const msg = result.incremented ? 'تعداد ردیف افزایش یافت.' : 'ردیف خروج ثبت شد.';
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
    if (step === 'LOCATION') {
      setLocationBarcode(barcode);
      setFeedback(`✓ مکان: ${barcode}`);
      setStep('PRODUCT');
      return;
    }
    if (step === 'PRODUCT') {
      setProductBarcode(barcode);
      setFeedback(`✓ کالا: ${barcode}`);
      setStep('CONFIRM');
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">اسکن سریع خروج</h2>
        <p className="mt-1 text-xs text-slate-600">
          {issue.number} · {issue.warehouse.code}
        </p>
        <p className="mt-1 font-mono text-xs text-slate-500" dir="ltr">
          step={step}
          {locationBarcode ? ` · loc=${locationBarcode}` : ''}
          {productBarcode ? ` · sku=${productBarcode}` : ''}
        </p>
        <p className="mt-2 text-xs text-amber-800">
          برای SELLABLE، موجودی رزروشده مصرف نمی‌شود — در صورت کمبود Available سرور رد می‌کند.
        </p>
      </div>

      {step !== 'CONFIRM' ? (
        <div className="space-y-1">
          <Label htmlFor="issue-scanner-input">اسکن بارکد</Label>
          <BarcodeScanInput
            ref={scanRef}
            id="issue-scanner-input"
            key={`${companyId}:${issueId}:${step}`}
            onScan={onScan}
            disabled={disabled || busy}
            placeholder={
              step === 'LOCATION' ? 'اسکن بارکد مکان...' : 'اسکن بارکد کالا...'
            }
          />
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="issue-scan-class">طبقه‌بندی</Label>
          <select
            id="issue-scan-class"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={classification}
            onChange={(e) => setClassification(e.target.value as StockClassification)}
            disabled={disabled || busy}
          >
            <option value="SELLABLE">{stockClassificationLabel('SELLABLE')}</option>
            <option value="TESTER">{stockClassificationLabel('TESTER')}</option>
            <option value="DAMAGED">{stockClassificationLabel('DAMAGED')}</option>
            <option value="QUARANTINE">{stockClassificationLabel('QUARANTINE')}</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="issue-scan-qty">تعداد</Label>
          <Input
            id="issue-scan-qty"
            value={quantityText}
            onChange={(e) => setQuantityText(e.target.value)}
            disabled={disabled || busy}
            dir="ltr"
            className="tabular-nums"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={disabled || busy || step !== 'CONFIRM'}
          onClick={() => void apply()}
        >
          تأیید ردیف خروج
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || busy}
          onClick={() => {
            setStep('LOCATION');
            setLocationBarcode('');
            setProductBarcode('');
            setFeedback(null);
          }}
        >
          بازنشانی
        </Button>
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
