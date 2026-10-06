'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  ErrorState,
  PageSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  HorizontalBarList,
  SegmentBars,
  SimpleTrendBars,
} from '@/features/purchasing/dashboard-charts';
import { OfferPriceDisplay } from '@/features/purchasing/offer-price-display';
import {
  purchaseOrderStatusBadgeClass,
  purchaseOrderStatusLabel,
  purchaseTypeLabel,
} from '@/features/purchasing/purchase-order-labels';
import { SupplierPicker } from '@/features/purchasing/supplier-picker';
import { fetchPurchasingDashboard } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { purchasingKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import {
  ROUTES,
  purchasingOrderPath,
  purchasingReturnPath,
  purchasingSupplierPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type {
  OfferCurrency,
  PurchaseCommercialType,
  PurchaseOrderStatus,
  SupplierOption,
} from '@/types/purchasing';

const RANGE_OPTIONS = [
  { value: '7d', label: '۷ روز اخیر' },
  { value: '30d', label: '۳۰ روز اخیر' },
  { value: 'this_month', label: 'این ماه' },
  { value: 'last_month', label: 'ماه قبل' },
  { value: '90d', label: '۹۰ روز اخیر' },
  { value: 'custom', label: 'بازه دلخواه' },
] as const;

function irrAmount(rows: Array<{ currency: string; amount: string }> | undefined): string | null {
  const hit = rows?.find((r) => r.currency === 'IRR');
  return hit?.amount ?? null;
}

function parseBig(amount: string): number {
  // Display-only ratio helper — server remains Decimal-safe.
  const n = Number(amount);
  return Number.isFinite(n) ? n : 0;
}

export function PurchasingLandingPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.PURCHASING_READ);
  const canCreate = can(PERMISSIONS.PURCHASING_CREATE);

  const range = searchParams.get('range') ?? '30d';
  const supplierId = searchParams.get('supplierId') ?? '';
  const purchaseType = (searchParams.get('purchaseType') ?? '') as PurchaseCommercialType | '';
  const status = (searchParams.get('status') ?? '') as PurchaseOrderStatus | '';
  const currency = (searchParams.get('currency') ?? '') as OfferCurrency | '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';

  const [supplier, setSupplier] = React.useState<SupplierOption | null>(null);

  const filters = {
    range: range || '30d',
    ...(range === 'custom' && from ? { from } : {}),
    ...(range === 'custom' && to ? { to } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(purchaseType ? { purchaseType } : {}),
    ...(status ? { status } : {}),
    ...(currency ? { currency } : {}),
  };

  const replaceFilters = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    if (patch.range && patch.range !== 'custom') {
      params.delete('from');
      params.delete('to');
    }
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`);
  };

  const dashboardQuery = useQuery({
    queryKey: purchasingKeys.dashboard(companyId, filters),
    enabled: Boolean(companyId) && canRead,
    staleTime: 30_000,
    queryFn: () => fetchPurchasingDashboard(companyId, filters),
  });

  React.useEffect(() => {
    if (
      dashboardQuery.error &&
      isApiClientError(dashboardQuery.error) &&
      dashboardQuery.error.status === 401
    ) {
      handleUnauthorized();
    }
  }, [dashboardQuery.error, handleUnauthorized]);

  React.useEffect(() => {
    if (!supplierId) setSupplier(null);
  }, [supplierId]);

  if (!canRead) return <AccessDenied />;
  if (dashboardQuery.isPending) return <PageSkeleton />;
  if (dashboardQuery.isError || !dashboardQuery.data) {
    return (
      <ErrorState
        message={
          mapBusinessError(dashboardQuery.error) ||
          'دریافت اطلاعات خرید با مشکل مواجه شد.'
        }
        onRetry={() => dashboardQuery.refetch()}
      />
    );
  }

  const data = dashboardQuery.data;
  const localValue = irrAmount(data.kpis.localCommercialValueByCurrency);
  const prevLocal = irrAmount(data.kpis.previousLocalCommercialValueByCurrency);
  const fxUsd = data.kpis.foreignObligationsByCurrency.find((r) => r.currency === 'USD');
  const fxRef = data.kpis.fxReferenceLocalValueByCurrency[0];

  const openStatuses = 'APPROVED · ORDERED · PARTIALLY_RECEIVED';
  // List API accepts a single status; open KPI drills to the PO list (dashboard already scopes open).
  const openHref = ROUTES.purchasingOrders;
  const dueHref = `${ROUTES.purchasingOrders}?dueStatus=DUE_SOON`;
  const typeHref = (type: string) => `${ROUTES.purchasingOrders}?purchaseType=${type}`;

  const trendPoints = data.trend.map((point) => {
    const irr = irrAmount(point.localMerchandiseByCurrency) ?? '0';
    return {
      key: point.bucket,
      label: point.bucket.replace(/^W/, ''),
      value: parseBig(irr),
      tip: `${point.bucket} · ${point.poCount} سفارش · کالا IRR ${irr}`,
    };
  });

  const maxSupplier = Math.max(
    ...data.supplierBreakdown.map((s) =>
      parseBig(irrAmount(s.localMerchandiseByCurrency) ?? '0'),
    ),
    1,
  );

  const emptyCommitted =
    data.kpis.periodCommittedPoCount === 0 &&
    data.kpis.openPurchaseCount === 0 &&
    data.kpis.draftPurchaseCount === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="داشبورد خرید"
        description={
          activeCompany
            ? `نمای عملیاتی خرید «${activeCompany.name}» — تعهد تجاری، نه پرداخت یا موجودی`
            : 'نمای عملیاتی خرید'
        }
        breadcrumbs={[{ label: 'خرید' }]}
        actions={
          canCreate ? (
            <Link href={ROUTES.purchasingOrderNew} className={cn(buttonVariants())}>
              ثبت خرید جدید
            </Link>
          ) : null
        }
      />

      <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="space-y-1">
          <Label htmlFor="dash-range">بازه زمانی</Label>
          <select
            id="dash-range"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={range}
            onChange={(e) => replaceFilters({ range: e.target.value })}
          >
            {RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {range === 'custom' ? (
          <>
            <div className="space-y-1">
              <Label htmlFor="dash-from">از</Label>
              <Input
                id="dash-from"
                type="date"
                dir="ltr"
                value={from.slice(0, 10)}
                onChange={(e) => replaceFilters({ range: 'custom', from: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dash-to">تا</Label>
              <Input
                id="dash-to"
                type="date"
                dir="ltr"
                value={to.slice(0, 10)}
                onChange={(e) => replaceFilters({ range: 'custom', to: e.target.value })}
              />
            </div>
          </>
        ) : null}
        <div className="space-y-1 sm:col-span-2">
          <Label>تأمین‌کننده</Label>
          <SupplierPicker
            value={
              supplier ??
              (supplierId
                ? { id: supplierId, name: 'تأمین‌کننده انتخاب‌شده', code: null, status: 'ACTIVE' }
                : null)
            }
            onChange={(next) => {
              setSupplier(next);
              replaceFilters({ supplierId: next?.id });
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="dash-type">نوع خرید</Label>
          <select
            id="dash-type"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={purchaseType}
            onChange={(e) => replaceFilters({ purchaseType: e.target.value || undefined })}
          >
            <option value="">همه</option>
            <option value="CASH">نقدی</option>
            <option value="TERM_CREDIT">اعتباری مدت‌دار</option>
            <option value="FX_CREDIT">اعتباری ارزی</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="dash-status">وضعیت</Label>
          <select
            id="dash-status"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={status}
            onChange={(e) => replaceFilters({ status: e.target.value || undefined })}
          >
            <option value="">پیش‌فرض داشبورد</option>
            <option value="DRAFT">پیش‌نویس</option>
            <option value="APPROVED">تأیید شده</option>
            <option value="ORDERED">سفارش داده شده</option>
            <option value="PARTIALLY_RECEIVED">بخشی دریافت شده</option>
            <option value="RECEIVED">دریافت شده</option>
            <option value="CANCELLED">لغو شده</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="dash-currency">ارز</Label>
          <select
            id="dash-currency"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={currency}
            onChange={(e) => replaceFilters({ currency: e.target.value || undefined })}
          >
            <option value="">همه</option>
            <option value="IRR">IRR</option>
            <option value="USD">USD</option>
          </select>
        </div>
      </section>

      <p className="text-xs text-slate-500">
        تحلیل دوره بر اساس <span dir="ltr">orderDate</span> · وضعیت باز/سررسید/تحویل‌نشده = نمای جاری ·
        سررسید قراردادی است نه وضعیت پرداخت.
      </p>

      {emptyCommitted ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
          <p className="text-sm text-slate-600">هنوز خریدی ثبت نشده است.</p>
          {canCreate ? (
            <Link
              href={ROUTES.purchasingOrderNew}
              className={cn(buttonVariants(), 'mt-3 inline-flex')}
            >
              ثبت خرید جدید
            </Link>
          ) : null}
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label="خریدهای باز"
          href={`${ROUTES.purchasingOrders}`}
          value={String(data.kpis.openPurchaseCount)}
          hint={`پیش‌نویس جدا: ${data.kpis.draftPurchaseCount} · ${openStatuses}`}
        />
        <KpiCard
          label="ارزش خرید ریالی (بازه)"
          href={`${ROUTES.purchasingOrders}?currency=IRR`}
          valueNode={
            localValue ? (
              <OfferPriceDisplay unitPrice={localValue} currency="IRR" />
            ) : (
              '—'
            )
          }
          hint={
            prevLocal
              ? `دوره قبل: نمایش مقایسه‌ای کالا+هزینه IRR`
              : 'کالا + هزینه‌های ACTIVE هم‌ارز · بدون DRAFT/CANCELLED'
          }
        />
        <KpiCard
          label="تعهد ارزی"
          href={typeHref('FX_CREDIT')}
          valueNode={
            data.kpis.foreignObligationsByCurrency.length === 0 ? (
              '—'
            ) : (
              <div className="space-y-1 text-base">
                {data.kpis.foreignObligationsByCurrency.map((row) => (
                  <div key={row.currency} dir="ltr">
                    {row.amount} {row.currency}
                  </div>
                ))}
              </div>
            )
          }
          hint={
            fxRef
              ? `ارزش ریالی مرجع (نرخ زمان خرید): جداگانه نمایش داده می‌شود — تسویه نهایی نیست`
              : 'هر ارز جدا · بدون جمع‌زدن'
          }
        />
        <KpiCard
          label="سررسیدهای نزدیک"
          href={dueHref}
          value={String(data.kpis.upcomingDueCount)}
          hint={`سررسید گذشته: ${data.kpis.dueDatePassedCount} · نه بدهی پرداخت‌نشده`}
        />
        <KpiCard
          label="تأمین‌کنندگان فعال در بازه"
          href={ROUTES.purchasingSuppliers}
          value={String(data.kpis.activeSupplierCountInPeriod)}
          hint={`${data.kpis.periodCommittedPoCount} سفارش متعهد در بازه`}
        />
      </section>

      {fxRef ? (
        <p className="rounded-md border border-amber-100 bg-amber-50/70 px-3 py-2 text-xs text-amber-950">
          ارزش ریالی مرجع تعهدات ارزی:{' '}
          <OfferPriceDisplay unitPrice={fxRef.amount} currency="IRR" /> — بر اساس نرخ ثبت‌شده هنگام
          خرید محاسبه می‌شود و مبلغ نهایی تسویه نیست.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">نیازمند توجه</h2>
          {data.attention.length === 0 ? (
            <p className="text-sm text-slate-500">مورد فوری بر اساس داده‌های فعلی خرید نیست.</p>
          ) : (
            <ul className="space-y-2">
              {data.attention.map((item, index) => (
                <li key={`${item.kind}-${item.number}-${index}`}>
                  <Link
                    href={
                      item.purchaseReturnId
                        ? purchasingReturnPath(item.purchaseReturnId)
                        : item.purchaseOrderId
                          ? purchasingOrderPath(item.purchaseOrderId)
                          : ROUTES.purchasingOrders
                    }
                    className="block rounded-md border border-slate-100 px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    <div className="font-medium text-slate-900">
                      {item.number} — {item.label}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {item.supplierName}
                      {item.at ? ` · ${formatDateTime(item.at)}` : ''}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">سررسیدهای پیش رو</h2>
            <Link href={dueHref} className="text-xs text-slate-600 underline-offset-2 hover:underline">
              مشاهده در فهرست
            </Link>
          </div>
          {(['TODAY', 'D1_7', 'D8_30', 'PAST'] as const).map((bucket) => {
            const rows = data.upcomingDue[bucket];
            if (!rows.length) return null;
            const labels = {
              TODAY: 'امروز',
              D1_7: '۱–۷ روز آینده',
              D8_30: '۸–۳۰ روز آینده',
              PAST: 'سررسید گذشته',
            };
            return (
              <div key={bucket} className="space-y-1">
                <div className="text-xs font-medium text-slate-500">{labels[bucket]}</div>
                <ul className="space-y-1">
                  {rows.slice(0, 4).map((row) => (
                    <li key={row.id}>
                      <Link
                        href={purchasingOrderPath(row.id)}
                        className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50"
                      >
                        <span>
                          {row.number} · {row.supplier.name}
                        </span>
                        <span className="text-xs text-slate-500">{row.daysRemainingLabel}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {!data.upcomingDue.TODAY.length &&
          !data.upcomingDue.D1_7.length &&
          !data.upcomingDue.D8_30.length &&
          !data.upcomingDue.PAST.length ? (
            <p className="text-sm text-slate-500">سررسید نزدیکی در ۳۰ روز آینده نیست.</p>
          ) : null}
        </section>
      </div>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">خریدهای باز</h2>
          <Link
            href={openHref}
            className="text-xs text-slate-600 underline-offset-2 hover:underline"
          >
            مشاهده همه خریدهای باز
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="py-1 text-start font-medium">خرید</th>
                <th className="py-1 text-start font-medium">تأمین‌کننده</th>
                <th className="py-1 text-start font-medium">وضعیت</th>
                <th className="py-1 text-start font-medium">نوع</th>
                <th className="py-1 text-start font-medium">مبلغ / تعهد</th>
                <th className="py-1 text-start font-medium">سفارش</th>
                <th className="py-1 text-start font-medium">سررسید</th>
              </tr>
            </thead>
            <tbody>
              {data.openPurchases.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-500">
                    خرید بازی نیست.
                  </td>
                </tr>
              ) : (
                data.openPurchases.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="py-2">
                      <Link
                        href={purchasingOrderPath(row.id)}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {row.number}
                      </Link>
                    </td>
                    <td className="py-2">{row.supplier.name}</td>
                    <td className="py-2">
                      <Badge className={purchaseOrderStatusBadgeClass(row.status)}>
                        {purchaseOrderStatusLabel(row.status)}
                      </Badge>
                    </td>
                    <td className="py-2">
                      {row.purchaseType ? purchaseTypeLabel(row.purchaseType) : '—'}
                    </td>
                    <td className="py-2">
                      {row.amount.kind === 'FOREIGN_OBLIGATION' ? (
                        <span dir="ltr" className="font-mono text-xs">
                          {row.amount.amount} {row.amount.currency}
                        </span>
                      ) : (
                        <OfferPriceDisplay
                          unitPrice={row.amount.amount}
                          currency={row.amount.currency}
                        />
                      )}
                    </td>
                    <td className="py-2 text-xs text-slate-500">
                      {formatDateTime(row.orderDate)}
                    </td>
                    <td className="py-2 text-xs text-slate-500">
                      {row.dueDate ? formatDateTime(row.dueDate) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">روند خرید (کالای ریالی)</h2>
          <SimpleTrendBars points={trendPoints} />
          <p className="text-xs text-slate-400">
            تعهد ارزی جداگانه در KPI است و در این نمودار با ریال مخلوط نمی‌شود.
          </p>
        </section>
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">ترکیب نوع خرید</h2>
          <SegmentBars
            segments={data.purchaseTypeBreakdown
              .filter((row) => row.purchaseType)
              .map((row) => ({
                id: row.purchaseType!,
                label: purchaseTypeLabel(row.purchaseType),
                count: row.poCount,
                href: typeHref(row.purchaseType!),
              }))}
          />
          <h3 className="pt-2 text-xs font-semibold text-slate-500">ترکیب ارزی سفارش‌ها</h3>
          <ul className="space-y-1 text-sm">
            {data.currencyBreakdown.map((row) => (
              <li key={row.currency} className="flex justify-between gap-2">
                <Link
                  href={`${ROUTES.purchasingOrders}?currency=${row.currency}`}
                  className="underline-offset-2 hover:underline"
                >
                  {row.currency}
                </Link>
                <span className="font-mono text-xs tabular-nums" dir="ltr">
                  {row.poCount} PO
                </span>
              </li>
            ))}
            {fxUsd ? (
              <li className="flex justify-between gap-2 text-slate-700">
                <span>تعهد USD</span>
                <span className="font-mono text-xs" dir="ltr">
                  {fxUsd.amount} USD
                </span>
              </li>
            ) : null}
          </ul>
        </section>
      </div>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">خرید به تفکیک تأمین‌کننده</h2>
        <p className="text-xs text-slate-500">
          بیشترین خرید ریالی — نه «بهترین تأمین‌کننده». تعهد ارزی جداگانه زیر هر ردیف می‌آید.
        </p>
        <HorizontalBarList
          rows={data.supplierBreakdown.map((row) => {
            const irr = irrAmount(row.localMerchandiseByCurrency) ?? '0';
            const fx = row.foreignObligationByCurrency
              .map((f) => `${f.amount} ${f.currency}`)
              .join(' · ');
            return {
              id: row.supplierId,
              label: `${row.supplierName}${fx ? ` · FX: ${fx}` : ''}`,
              valueLabel: `${irr} IRR · ${row.poCount} PO${
                row.localIrrSharePercent ? ` · ${row.localIrrSharePercent}%` : ''
              }`,
              ratio: parseBig(irr) / maxSupplier,
              href: purchasingSupplierPath(row.supplierId),
            };
          })}
        />
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">سفارش‌های تحویل‌نشده</h2>
        <p className="text-xs text-slate-500">
          تعریف موقت فاز ۲: ORDERED + PARTIALLY_RECEIVED. تعداد دریافت‌شده واقعی در انبار خواهد آمد —
          درصد دریافت جعلی نشان داده نمی‌شود.
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="py-1 text-start font-medium">خرید</th>
                <th className="py-1 text-start font-medium">تأمین‌کننده</th>
                <th className="py-1 text-start font-medium">وضعیت</th>
                <th className="py-1 text-start font-medium">تاریخ سفارش</th>
                <th className="py-1 text-start font-medium">روز از سفارش</th>
                <th className="py-1 text-start font-medium">اقلام</th>
              </tr>
            </thead>
            <tbody>
              {data.unfulfilled.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
                    سفارش تحویل‌نشده‌ای نیست.
                  </td>
                </tr>
              ) : (
                data.unfulfilled.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="py-2">
                      <Link
                        href={purchasingOrderPath(row.id)}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {row.number}
                      </Link>
                    </td>
                    <td className="py-2">{row.supplier.name}</td>
                    <td className="py-2">
                      <Badge className={purchaseOrderStatusBadgeClass(row.status)}>
                        {purchaseOrderStatusLabel(row.status)}
                      </Badge>
                    </td>
                    <td className="py-2 text-xs text-slate-500">
                      {formatDateTime(row.orderDate)}
                    </td>
                    <td className="py-2 tabular-nums" dir="ltr">
                      {row.daysSinceOrder}
                    </td>
                    <td className="py-2 tabular-nums" dir="ltr">
                      {row.itemCount}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {data.recentActivity.length > 0 ? (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">آخرین فعالیت‌ها</h2>
          <ul className="space-y-2 text-sm">
            {data.recentActivity.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-50 py-2 first:border-0"
              >
                <span>
                  <span className="font-medium">{row.action}</span>
                  <span className="text-slate-500">
                    {' '}
                    · {row.entityType} · {row.actor?.displayName ?? '—'}
                  </span>
                </span>
                <span className="text-xs text-slate-400">{formatDateTime(row.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function KpiCard({
  label,
  value,
  valueNode,
  hint,
  href,
}: {
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
  hint?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-slate-300 hover:bg-slate-50"
    >
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">
        {valueNode ?? (
          <span className="tabular-nums" dir="ltr">
            {value}
          </span>
        )}
      </div>
      {hint ? <div className="mt-1 text-[11px] text-slate-400">{hint}</div> : null}
    </Link>
  );
}
