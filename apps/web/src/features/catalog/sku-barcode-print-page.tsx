'use client';

import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AccessDenied, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { BarcodeGlyph } from '@/components/catalog/barcode-glyph';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchSku, fetchSkuBarcodes } from '@/lib/api/hector';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { barcodeKeys, skuKeys } from '@/lib/query/keys';
import { useSession } from '@/providers/app-providers';

export function SkuBarcodePrintPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const skuId = params.id;
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.CATALOG_READ);
  const [quantity, setQuantity] = React.useState(1);
  const [selectedId, setSelectedId] = React.useState<string | null>(search.get('barcodeId'));

  const skuQuery = useQuery({
    queryKey: skuKeys.detail(companyId, skuId),
    queryFn: () => fetchSku(companyId, skuId),
    enabled: Boolean(companyId && skuId && canRead),
  });

  const barcodesQuery = useQuery({
    queryKey: barcodeKeys.bySku(companyId, skuId),
    queryFn: () => fetchSkuBarcodes(companyId, skuId),
    enabled: Boolean(companyId && skuId && canRead),
  });

  const active = (barcodesQuery.data ?? []).filter((b) => !b.archivedAt);
  const selected =
    active.find((b) => b.id === selectedId) ??
    active.find((b) => b.isPrimary) ??
    active[0] ??
    null;

  React.useEffect(() => {
    if (!selectedId && selected) setSelectedId(selected.id);
  }, [selected, selectedId]);

  if (!canRead) return <AccessDenied />;
  if (skuQuery.isLoading || barcodesQuery.isLoading) return <PageSkeleton />;
  if (skuQuery.isError || !skuQuery.data) {
    return <ErrorState title="SKU پیدا نشد" onRetry={() => void skuQuery.refetch()} />;
  }

  const sku = skuQuery.data;
  const variant =
    sku.variantValues.length > 0
      ? sku.variantValues.map((v) => `${v.optionName} ${v.value}`).join(' / ')
      : sku.name;

  const count = Math.min(100, Math.max(1, quantity || 1));

  return (
    <div className="space-y-4 p-4 print:p-0">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="space-y-1">
          <Label htmlFor="qty">تعداد لیبل</Label>
          <Input
            id="qty"
            type="number"
            min={1}
            max={100}
            className="w-28"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value) || 1)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="bc">بارکد</Label>
          <select
            id="bc"
            className="flex h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={selected?.id ?? ''}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {active.map((b) => (
              <option key={b.id} value={b.id}>
                {b.value} ({b.type}){b.isPrimary ? ' — اصلی' : ''}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={() => window.print()} disabled={!selected}>
          چاپ
        </Button>
      </div>

      {!selected ? (
        <p className="text-sm text-slate-600 print:hidden">بارکدی برای این SKU ثبت نشده است.</p>
      ) : (
        <div className="grid gap-4 print:grid-cols-2">
          {Array.from({ length: count }, (_, i) => (
            <article
              key={`${selected.id}-${i}`}
              className="flex flex-col items-center gap-2 rounded border border-slate-300 bg-white p-3 text-center"
              style={{ width: '50mm', minHeight: '30mm' }}
            >
              <p className="text-[10px] text-slate-500">Hector / پیشته</p>
              <p className="text-xs font-semibold text-slate-900">{sku.product.name}</p>
              {variant ? <p className="text-[11px] text-slate-700">{variant}</p> : null}
              <p dir="ltr" className="font-mono text-[11px] text-slate-800">
                {sku.code}
              </p>
              <BarcodeGlyph barcode={selected} height={48} className="max-w-full" />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
