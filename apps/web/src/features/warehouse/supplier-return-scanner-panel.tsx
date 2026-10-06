'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { applySupplierReturnExecutionScan } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import type { SupplierReturnCommercialItem } from '@/types/supplier-return-execution';
import type { SupplierReturnExecutionDetail } from '@/types/supplier-return-execution';
import type { StockClassification } from '@/types/stock-classification';

type Props = {
  companyId: string;
  executionId: string;
  execution: SupplierReturnExecutionDetail;
  returnItems: SupplierReturnCommercialItem[];
  disabled?: boolean;
  onExecutionUpdated: (execution: SupplierReturnExecutionDetail) => void;
};

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function SupplierReturnScannerPanel({
  companyId,
  executionId,
  execution,
  returnItems,
  disabled,
  onExecutionUpdated,
}: Props) {
  const [purchaseReturnItemId, setPurchaseReturnItemId] = React.useState(
    returnItems[0]?.id ?? '',
  );
  const [locationBarcode, setLocationBarcode] = React.useState('');
  const [productBarcode, setProductBarcode] = React.useState('');
  const [classification, setClassification] = React.useState<StockClassification>('SELLABLE');
  const [quantityText, setQuantityText] = React.useState('1');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!purchaseReturnItemId && returnItems[0]) {
      setPurchaseReturnItemId(returnItems[0].id);
    }
  }, [purchaseReturnItemId, returnItems]);

  const apply = async () => {
    if (!purchaseReturnItemId) {
      toast.error('ردیف برگشت خرید را انتخاب کنید.');
      return;
    }
    const quantity = Number.parseInt(quantityText, 10);
    if (!Number.isFinite(quantity) || quantity < 1) {
      toast.error('تعداد باید عدد مثبت باشد.');
      return;
    }
    setBusy(true);
    try {
      const result = await applySupplierReturnExecutionScan(companyId, executionId, {
        requestId: newRequestId(),
        purchaseReturnItemId,
        locationBarcode: locationBarcode.trim() || undefined,
        productBarcode: productBarcode.trim() || undefined,
        classification,
        quantity,
      });
      onExecutionUpdated(result.execution);
      toast.success(result.incremented ? 'تعداد ردیف افزایش یافت.' : 'ردیف تخصیص ثبت شد.');
      setProductBarcode('');
    } catch (error) {
      toast.error(mapBusinessError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">اسکن سریع (پیش‌نویس)</h2>
        <p className="mt-1 text-xs text-slate-600">
          {execution.number} · {execution.warehouse.code} · {execution.purchaseReturnNumber}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="sre-return-line">ردیف برگشت خرید</Label>
          <select
            id="sre-return-line"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={purchaseReturnItemId}
            onChange={(e) => setPurchaseReturnItemId(e.target.value)}
            disabled={disabled || busy}
          >
            {returnItems.map((line) => (
              <option key={line.id} value={line.id}>
                {line.sku.code} · مجاز {line.quantity}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sre-loc-barcode">بارکد مکان</Label>
          <Input
            id="sre-loc-barcode"
            value={locationBarcode}
            onChange={(e) => setLocationBarcode(e.target.value)}
            disabled={disabled || busy}
            dir="ltr"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sre-product-barcode">بارکد کالا</Label>
          <Input
            id="sre-product-barcode"
            value={productBarcode}
            onChange={(e) => setProductBarcode(e.target.value)}
            disabled={disabled || busy}
            dir="ltr"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sre-classification">طبقه‌بندی</Label>
          <select
            id="sre-classification"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={classification}
            onChange={(e) => setClassification(e.target.value as StockClassification)}
            disabled={disabled || busy}
          >
            <option value="SELLABLE">قابل فروش</option>
            <option value="QUARANTINE">قرنطینه</option>
            <option value="DAMAGED">آسیب‌دیده</option>
            <option value="TESTER">تستر</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sre-qty">تعداد</Label>
          <Input
            id="sre-qty"
            value={quantityText}
            onChange={(e) => setQuantityText(e.target.value)}
            disabled={disabled || busy}
            dir="ltr"
            className="font-mono text-xs"
          />
        </div>
      </div>
      <Button type="button" onClick={() => void apply()} disabled={disabled || busy}>
        اعمال اسکن
      </Button>
    </div>
  );
}
