'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { OfferPriceDisplay } from '@/features/purchasing/offer-price-display';
import { compareDecimalStrings } from '@/features/purchasing/offer-money';
import { expiryStateLabel, formatQuoteAge, paymentTermLabel, purchaseTypeLabel } from '@/features/purchasing/offer-labels';
import { SkuLookupPicker, type SkuPickerSelection } from '@/features/purchasing/sku-lookup-picker';
import { compareSupplierOffers, fetchSku } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { offerKeys } from '@/lib/query/keys';
import { ROUTES, purchasingOfferComparePath, purchasingOfferPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { OfferCurrency, SupplierOffer } from '@/types/purchasing';

function lowestPriceIdsByCurrency(offers: SupplierOffer[]): Map<OfferCurrency, Set<string>> {
  const map = new Map<OfferCurrency, Set<string>>();
  for (const currency of ['IRR', 'USD'] as const) {
    const group = offers.filter((o) => o.currency === currency);
    if (group.length === 0) continue;
    let minPrice = group[0].unitPrice;
    for (const offer of group) {
      if (compareDecimalStrings(offer.unitPrice, minPrice) < 0) minPrice = offer.unitPrice;
    }
    const ids = new Set(
      group.filter((o) => compareDecimalStrings(o.unitPrice, minPrice) === 0).map((o) => o.id),
    );
    map.set(currency, ids);
  }
  return map;
}

export function OfferComparePageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSkuId = searchParams.get('skuId');

  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';

  const [sku, setSku] = React.useState<SkuPickerSelection | null>(null);
  const [excludeExpired, setExcludeExpired] = React.useState(false);

  React.useEffect(() => {
    if (!initialSkuId || sku || !companyId) return;
    let cancelled = false;
    void fetchSku(companyId, initialSkuId)
      .then((detail) => {
        if (cancelled) return;
        setSku({
          skuId: detail.id,
          code: detail.code,
          label: detail.code,
          productName: detail.product.name,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setSku({
          skuId: initialSkuId,
          code: initialSkuId,
          label: initialSkuId,
          productName: '',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [initialSkuId, sku, companyId]);

  React.useEffect(() => {
    if (sku?.skuId) {
      router.replace(purchasingOfferComparePath(sku.skuId));
    }
  }, [sku?.skuId, router]);

  const compareQuery = useQuery({
    queryKey: offerKeys.compare(companyId, sku?.skuId ?? '', excludeExpired),
    enabled: Boolean(companyId) && Boolean(sku?.skuId) && can(PERMISSIONS.PURCHASING_READ),
    queryFn: () => compareSupplierOffers(companyId, sku!.skuId, excludeExpired),
  });

  if (!can(PERMISSIONS.PURCHASING_READ)) {
    return <AccessDenied />;
  }

  const rows = compareQuery.data ?? [];
  const lowestByCurrency = lowestPriceIdsByCurrency(rows);

  return (
    <div className="space-y-6">
      <PageHeader
        title="مقایسه قیمت تأمین‌کنندگان"
        description="آخرین استعلام هر تأمین‌کننده برای یک SKU (بدون اعلام «بهترین» بین ارزها یا شرایط متفاوت)"
        breadcrumbs={[
          { label: 'خرید', href: ROUTES.purchasing },
          { label: 'استعلام قیمت', href: ROUTES.purchasingOffers },
          { label: 'مقایسه' },
        ]}
      />

      <div className="max-w-xl space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <SkuLookupPicker value={sku} onChange={setSku} label="انتخاب SKU" />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={excludeExpired}
            onChange={(event) => setExcludeExpired(event.target.checked)}
          />
          حذف استعلام‌های منقضی‌شده
        </label>
      </div>

      {sku && lowestByCurrency.size > 0 ? (
        <p className="text-sm text-slate-600">
          در هر ارز، ردیف‌هایی که کمترین قیمت واحد همان ارز را دارند با پس‌زمینه سبز مشخص شده‌اند
          (فقط مقایسه درون همان ارز).
        </p>
      ) : null}

      {compareQuery.isLoading ? <TableSkeleton rows={5} /> : null}
      {compareQuery.isError ? (
        <ErrorState
          title="خطا در مقایسه"
          message={mapBusinessError(compareQuery.error)}
          onRetry={() => void compareQuery.refetch()}
        />
      ) : null}

      {sku && !compareQuery.isLoading && !compareQuery.isError && rows.length === 0 ? (
        <EmptyState
          title="استعلامی برای این SKU نیست"
          description="برای این SKU هنوز قیمتی از تأمین‌کنندگان ثبت نشده است."
        />
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-right text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">تأمین‌کننده</th>
                <th className="px-4 py-3 font-medium">قیمت واحد</th>
                <th className="px-4 py-3 font-medium">شرایط</th>
                <th className="px-4 py-3 font-medium">زمان استعلام</th>
                <th className="px-4 py-3 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((offer) => {
                const age = formatQuoteAge(offer.quotedAt);
                const isLowest = lowestByCurrency.get(offer.currency)?.has(offer.id);
                return (
                  <tr
                    key={offer.id}
                    className={`border-t border-slate-100 ${isLowest ? 'bg-emerald-50/80' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <Link href={purchasingOfferPath(offer.id)} className="font-medium hover:underline">
                        {offer.supplier.name}
                      </Link>
                      {isLowest ? (
                        <div className="mt-1 text-xs text-emerald-800">
                          کمترین قیمت در {offer.currency === 'IRR' ? 'تومان' : 'دلار'} در این فهرست
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <OfferPriceDisplay unitPrice={offer.unitPrice} currency={offer.currency} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {purchaseTypeLabel(offer.purchaseType)}
                      {offer.paymentTermType ? (
                        <span className="block text-xs">
                          {paymentTermLabel(offer.paymentTermType)}
                          {offer.netDays ? ` · ${offer.netDays} روز` : ''}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{age.relative}</div>
                      <div className="text-xs text-slate-500">{age.exact}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge>{expiryStateLabel(offer.expiryState)}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <Button type="button" variant="outline" onClick={() => router.push(ROUTES.purchasingOffers)}>
        بازگشت به فهرست
      </Button>
    </div>
  );
}
