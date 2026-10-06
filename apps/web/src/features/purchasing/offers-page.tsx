'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OfferPriceDisplay } from '@/features/purchasing/offer-price-display';
import { expiryStateLabel, formatQuoteAge, validityFilterLabel } from '@/features/purchasing/offer-labels';
import { fetchSupplierOffers } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { offerKeys } from '@/lib/query/keys';
import { ROUTES, purchasingOfferPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { SupplierOfferValidityFilter } from '@/types/purchasing';

export function OffersPageClient() {
  const router = useRouter();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canCreate = can(PERMISSIONS.PURCHASING_CREATE);

  const [page, setPage] = React.useState(1);
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [validity, setValidity] = React.useState<SupplierOfferValidityFilter | ''>('ACTIVE');
  const [currency, setCurrency] = React.useState('');
  const [sortBy, setSortBy] = React.useState('quotedAt');
  const [sortOrder, setSortOrder] = React.useState('desc');

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const filters = {
    page,
    pageSize: 20,
    search: search || undefined,
    validity: validity || undefined,
    currency: currency || undefined,
    sortBy,
    sortOrder,
  };

  const offersQuery = useQuery({
    queryKey: offerKeys.list(companyId, filters),
    enabled: Boolean(companyId) && can(PERMISSIONS.PURCHASING_READ),
    queryFn: () => fetchSupplierOffers(companyId, filters),
  });

  React.useEffect(() => {
    if (
      offersQuery.error &&
      isApiClientError(offersQuery.error) &&
      offersQuery.error.status === 401
    ) {
      handleUnauthorized();
    }
  }, [offersQuery.error, handleUnauthorized]);

  if (!can(PERMISSIONS.PURCHASING_READ)) {
    return <AccessDenied />;
  }

  const rows = offersQuery.data?.data ?? [];
  const meta = offersQuery.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="استعلام قیمت"
        description="فهرست قیمت‌های ثبت‌شده از تأمین‌کنندگان"
        breadcrumbs={[
          { label: 'خرید', href: ROUTES.purchasing },
          { label: 'استعلام قیمت' },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => router.push(ROUTES.purchasingOfferCompare)}>
              مقایسه SKU
            </Button>
            {canCreate ? (
              <Button type="button" onClick={() => router.push(ROUTES.purchasingOfferNew)}>
                ثبت قیمت جدید
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="offer-search">جستجو</Label>
          <Input
            id="offer-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="تأمین‌کننده، SKU، محصول..."
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="offer-validity">اعتبار</Label>
          <select
            id="offer-validity"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={validity}
            onChange={(event) => {
              setValidity(event.target.value as SupplierOfferValidityFilter | '');
              setPage(1);
            }}
          >
            <option value="ACTIVE">{validityFilterLabel('ACTIVE')}</option>
            <option value="CURRENT">{validityFilterLabel('CURRENT')}</option>
            <option value="EXPIRED">{validityFilterLabel('EXPIRED')}</option>
            <option value="NO_EXPIRY">{validityFilterLabel('NO_EXPIRY')}</option>
            <option value="ARCHIVED">{validityFilterLabel('ARCHIVED')}</option>
            <option value="">{validityFilterLabel('')}</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="offer-currency">ارز</Label>
          <select
            id="offer-currency"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={currency}
            onChange={(event) => {
              setCurrency(event.target.value);
              setPage(1);
            }}
          >
            <option value="">همه</option>
            <option value="IRR">تومان (IRR)</option>
            <option value="USD">دلار</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="offer-sort">مرتب‌سازی</Label>
          <select
            id="offer-sort"
            className="flex h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={`${sortBy}:${sortOrder}`}
            onChange={(event) => {
              const [by, order] = event.target.value.split(':');
              setSortBy(by);
              setSortOrder(order);
              setPage(1);
            }}
          >
            <option value="quotedAt:desc">تاریخ استعلام (جدیدتر)</option>
            <option value="quotedAt:asc">تاریخ استعلام (قدیمی‌تر)</option>
            <option value="unitPrice:asc">قیمت (کم به زیاد)</option>
            <option value="unitPrice:desc">قیمت (زیاد به کم)</option>
            <option value="createdAt:desc">تاریخ ثبت</option>
          </select>
        </div>
      </div>

      {offersQuery.isLoading ? <TableSkeleton rows={8} /> : null}
      {offersQuery.isError ? (
        <ErrorState
          title="خطا در دریافت استعلام‌ها"
          message={mapBusinessError(offersQuery.error)}
          onRetry={() => void offersQuery.refetch()}
        />
      ) : null}

      {!offersQuery.isLoading && !offersQuery.isError && rows.length === 0 ? (
        <EmptyState
          title="استعلامی ثبت نشده"
          description="اولین قیمت را از تأمین‌کننده ثبت کنید."
          action={
            canCreate ? (
              <Button type="button" onClick={() => router.push(ROUTES.purchasingOfferNew)}>
                ثبت قیمت
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-right text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">تأمین‌کننده</th>
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 font-medium">قیمت واحد</th>
                <th className="px-4 py-3 font-medium">زمان استعلام</th>
                <th className="px-4 py-3 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((offer) => {
                const age = formatQuoteAge(offer.quotedAt);
                return (
                  <tr
                    key={offer.id}
                    className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                    onClick={() => router.push(purchasingOfferPath(offer.id))}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={purchasingOfferPath(offer.id)}
                        className="font-medium text-slate-900 hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {offer.supplier.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-slate-900" dir="ltr">
                        {offer.sku.code}
                      </div>
                      <div className="text-xs text-slate-500">{offer.sku.product.name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <OfferPriceDisplay unitPrice={offer.unitPrice} currency={offer.currency} />
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

      {meta && meta.total > meta.pageSize ? (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            صفحه {page} از {totalPages} ({meta.total} مورد)
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              قبلی
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              بعدی
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
