'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  AccessDenied,
  ErrorState,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { BarcodeScanInput } from '@/components/catalog/barcode-scan-input';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  fetchInventoryBalances,
  fetchInventorySkuSummary,
  resolveScannerLocation,
  resolveScannerProduct,
  type ScannerLocationResolve,
  type ScannerProductResolve,
} from '@/lib/api/hector';
import type { InventoryBalanceListItem } from '@/types/inventory';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { cn } from '@/lib/utils/cn';
import {
  ROUTES,
  warehouseInventorySkuPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

type Mode =
  | 'HOME'
  | 'LOOKUP'
  | 'LOCATION_LOOKUP';

type Feedback =
  | { kind: 'success'; title: string; detail?: string }
  | { kind: 'error'; title: string; detail?: string }
  | null;

/**
 * Scanner-first warehouse workspace (Phase 3.16).
 * Resolvers + lookup only; mutations go through canonical document pages.
 */
export function ScannerCenterPageClient() {
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const queryClient = useQueryClient();
  const [mode, setMode] = React.useState<Mode>('HOME');
  const [feedback, setFeedback] = React.useState<Feedback>(null);
  const [product, setProduct] = React.useState<ScannerProductResolve | null>(null);
  const [location, setLocation] = React.useState<ScannerLocationResolve | null>(null);
  const [skuSummary, setSkuSummary] = React.useState<Awaited<
    ReturnType<typeof fetchInventorySkuSummary>
  > | null>(null);
  const [locationContents, setLocationContents] = React.useState<
    InventoryBalanceListItem[] | null
  >(null);

  // WH-UI-001 / WH-SCAN-011: clear scanner state on company switch.
  React.useEffect(() => {
    setMode('HOME');
    setFeedback(null);
    setProduct(null);
    setLocation(null);
    setSkuSummary(null);
    setLocationContents(null);
  }, [companyId]);

  if (!can(PERMISSIONS.WAREHOUSE_SCANNER_USE)) return <AccessDenied />;

  const setModeSafe = (next: Mode) => {
    setMode(next);
    setFeedback(null);
    setProduct(null);
    setLocation(null);
    setSkuSummary(null);
    setLocationContents(null);
  };

  const onLookupScan = async (barcode: string) => {
    setFeedback(null);
    try {
      const resolved = await resolveScannerProduct(companyId, barcode);
      setProduct(resolved);
      const summary = await fetchInventorySkuSummary(companyId, resolved.skuId);
      setSkuSummary(summary);
      setFeedback({
        kind: 'success',
        title: '✓ محصول شناسایی شد',
        detail: `${resolved.productName} · ${resolved.skuCode}`,
      });
      void queryClient.invalidateQueries({
        queryKey: ['warehouses', companyId, 'inventory', 'sku', resolved.skuId],
      });
    } catch (error) {
      setProduct(null);
      setSkuSummary(null);
      setFeedback({
        kind: 'error',
        title: '✕ بارکد شناسایی نشد',
        detail: mapBusinessError(error),
      });
    }
  };

  const onLocationScan = async (barcode: string) => {
    setFeedback(null);
    try {
      const resolved = await resolveScannerLocation(companyId, barcode);
      setLocation(resolved);
      const contents = await fetchInventoryBalances(companyId, {
        locationId: resolved.locationId,
        pageSize: 50,
      });
      setLocationContents(contents.data.filter((row) => row.onHandQuantity > 0));
      setFeedback({
        kind: 'success',
        title: '✓ مکان شناسایی شد',
        detail: `${resolved.warehouseCode} / ${resolved.locationCode}`,
      });
    } catch (error) {
      setLocation(null);
      setLocationContents(null);
      setFeedback({
        kind: 'error',
        title: '✕ بارکد مکان شناسایی نشد',
        detail: mapBusinessError(error),
      });
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="مرکز اسکنر انبار"
        description="ورودی کیبورد-وج: بارکد + Enter. صفرهای ابتدایی حفظ می‌شوند. عملیات فیزیکی از اسناد رسمی انجام می‌شود."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'مرکز اسکنر' },
        ]}
      />

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
        <div className="font-medium text-slate-800">Context</div>
        <div className="mt-1 text-slate-600">
          شرکت فعال · حالت: <span className="font-mono" dir="ltr">{mode}</span>
        </div>
      </div>

      {mode === 'HOME' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <ActionCard
            title="LOOKUP محصول"
            description="اسکن بارکد کالا → موجودی / رزرو / Available"
            onClick={() => setModeSafe('LOOKUP')}
          />
          <ActionCard
            title="LOOKUP مکان"
            description="اسکن بارکد مکان → محتویات مکان"
            onClick={() => setModeSafe('LOCATION_LOOKUP')}
          />
          <NavCard title="دریافت" href={ROUTES.warehouseGoodsReceipts} permission={can(PERMISSIONS.WAREHOUSE_RECEIPT_READ)} />
          <NavCard title="جایگذاری" href={ROUTES.warehousePutaways} permission={can(PERMISSIONS.WAREHOUSE_PUTAWAY_READ)} />
          <NavCard title="انتقال" href={ROUTES.warehouseTransfers} permission={can(PERMISSIONS.WAREHOUSE_TRANSFER_READ)} />
          <NavCard title="خروج" href={ROUTES.warehouseIssues} permission={can(PERMISSIONS.WAREHOUSE_ISSUE_READ)} />
          <NavCard title="شمارش" href={ROUTES.warehouseCounts} permission={can(PERMISSIONS.WAREHOUSE_COUNT_READ)} />
          <NavCard
            title="برگشت تأمین‌کننده"
            href={ROUTES.warehouseSupplierReturns}
            permission={can(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_READ)}
          />
        </div>
      ) : null}

      {mode === 'LOOKUP' || mode === 'LOCATION_LOOKUP' ? (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">
              {mode === 'LOOKUP' ? 'اسکن بارکد محصول' : 'اسکن بارکد مکان'}
            </h2>
            <Button variant="outline" size="sm" onClick={() => setModeSafe('HOME')}>
              بازگشت
            </Button>
          </div>
          <BarcodeScanInput
            key={`${companyId}:${mode}`}
            onScan={mode === 'LOOKUP' ? onLookupScan : onLocationScan}
            placeholder={
              mode === 'LOOKUP' ? 'اسکن بارکد محصول...' : 'اسکن بارکد مکان...'
            }
          />

          {feedback ? (
            <div
              className={cn(
                'rounded-md border px-3 py-2 text-sm',
                feedback.kind === 'success'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                  : 'border-red-300 bg-red-50 text-red-900',
              )}
              role="status"
            >
              <div className="font-medium">{feedback.title}</div>
              {feedback.detail ? <div className="mt-1 text-xs opacity-90">{feedback.detail}</div> : null}
            </div>
          ) : null}

          {product && skuSummary ? (
            <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <div>
                <div className="text-base font-semibold text-slate-900">{product.productName}</div>
                <div className="font-mono text-sm text-slate-600" dir="ltr">
                  {product.skuCode} · {product.barcode}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <MiniStat label="On Hand" value={skuSummary.totalOnHand} />
                <MiniStat label="Sellable" value={skuSummary.sellableOnHand} />
                <MiniStat label="Reserved" value={skuSummary.reservedQuantity ?? 0} />
                <MiniStat label="Available" value={skuSummary.availableQuantity ?? 0} />
                <MiniStat label="Tester" value={skuSummary.testerOnHand} />
                <MiniStat label="Damaged" value={skuSummary.damagedOnHand} />
                <MiniStat label="Quarantine" value={skuSummary.quarantineOnHand} />
              </div>
              <Link
                href={warehouseInventorySkuPath(product.skuId)}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                جزئیات موجودی SKU
              </Link>
            </div>
          ) : null}

          {location ? (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="font-semibold text-slate-900">
                {location.warehouseCode} / {location.locationCode}
              </div>
              <div className="font-mono text-xs text-slate-600" dir="ltr">
                {location.locationBarcode}
                {location.pathCodes.length > 0 ? ` · ${location.pathCodes.join(' / ')}` : ''}
              </div>
              {locationContents ? (
                locationContents.length === 0 ? (
                  <div className="text-xs text-slate-500">موجودی مثبت در این مکان نیست.</div>
                ) : (
                  <ul className="max-h-64 space-y-2 overflow-auto rounded bg-white p-2 text-xs">
                    {locationContents.map((row) => (
                      <li
                        key={`${row.skuId}:${row.batchId}:${row.classification}:${row.locationId}`}
                        className="flex justify-between gap-2 border-b border-slate-100 pb-1"
                      >
                        <span className="font-mono" dir="ltr">
                          {row.skuCode} · {row.batchNumber} · {row.classification}
                        </span>
                        <span className="tabular-nums font-semibold" dir="ltr">
                          {row.onHandQuantity}
                        </span>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </div>
          ) : null}

          {feedback?.kind === 'error' ? (
            <ErrorState message={feedback.detail ?? feedback.title} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ActionCard({
  title,
  description,
  onClick,
}: {
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-slate-200 bg-white p-5 text-start shadow-sm transition hover:border-slate-400"
    >
      <div className="text-base font-semibold text-slate-900">{title}</div>
      <div className="mt-1 text-sm text-slate-600">{description}</div>
    </button>
  );
}

function NavCard({
  title,
  href,
  permission,
}: {
  title: string;
  href: string;
  permission: boolean;
}) {
  if (!permission) return null;
  return (
    <Link
      href={href}
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-400"
    >
      <div className="text-base font-semibold text-slate-900">{title}</div>
      <div className="mt-1 text-sm text-slate-600">باز کردن جریان عملیاتی</div>
    </Link>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-2 py-1">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="font-semibold tabular-nums" dir="ltr">
        {value}
      </div>
    </div>
  );
}
