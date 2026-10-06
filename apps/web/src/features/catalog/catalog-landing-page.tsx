'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Barcode,
  Boxes,
  FolderTree,
  Package,
  ScanBarcode,
  SlidersHorizontal,
  Tags,
  type LucideIcon,
} from 'lucide-react';
import { AccessDenied, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { buttonVariants } from '@/components/ui/button';
import { CatalogLookup } from '@/features/catalog/catalog-lookup';
import { fetchCatalogStats } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatNumber } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { catalogKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { CatalogStats } from '@/types/catalog';

type StatCard = {
  key: keyof CatalogStats;
  label: string;
  href: string;
  icon: LucideIcon;
};

/** Identity counts only: Catalog never reports stock, cost, price or sales. */
const STAT_CARDS: StatCard[] = [
  { key: 'products', label: 'محصولات', href: ROUTES.catalogProducts, icon: Package },
  { key: 'skus', label: 'SKUها', href: ROUTES.catalogSkus, icon: Boxes },
  { key: 'barcodes', label: 'بارکدها', href: ROUTES.catalogSkus, icon: Barcode },
  { key: 'categories', label: 'دسته‌بندی‌ها', href: ROUTES.catalogCategories, icon: FolderTree },
  { key: 'brands', label: 'برندها', href: ROUTES.catalogBrands, icon: Tags },
  {
    key: 'attributes',
    label: 'مشخصات محصولات',
    href: ROUTES.catalogAttributes,
    icon: SlidersHorizontal,
  },
];

const SECTION_CARDS: Array<{
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
}> = [
  {
    label: 'محصولات',
    description: 'ایجاد و مدیریت محصولات، ویژگی‌های تنوع و SKUهای هر محصول.',
    href: ROUTES.catalogProducts,
    icon: Package,
  },
  {
    label: 'SKUها',
    description: 'فهرست همه SKUهای شرکت با جستجو روی کد، نام محصول و بارکد.',
    href: ROUTES.catalogSkus,
    icon: Boxes,
  },
  {
    label: 'دسته‌بندی‌ها',
    description: 'درخت دسته‌بندی و مشخصات پیشنهادی هر دسته.',
    href: ROUTES.catalogCategories,
    icon: FolderTree,
  },
  {
    label: 'برندها',
    description: 'برندهای قابل انتساب به محصولات.',
    href: ROUTES.catalogBrands,
    icon: Tags,
  },
  {
    label: 'مشخصات محصولات',
    description: 'تعریف مشخصات اختیاری (متن، عدد، بله/خیر، انتخابی) و انتساب به دسته‌ها.',
    href: ROUTES.catalogAttributes,
    icon: SlidersHorizontal,
  },
  {
    label: 'تست اسکن بارکد',
    description: 'بررسی عملکرد بارکدخوان و تطبیق بارکد با SKU، بدون تغییر موجودی.',
    href: ROUTES.catalogBarcodeScan,
    icon: ScanBarcode,
  },
];

export function CatalogLandingPage() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.CATALOG_READ);
  const canManage = can(PERMISSIONS.CATALOG_MANAGE);

  const statsQuery = useQuery({
    queryKey: catalogKeys.stats(companyId),
    enabled: Boolean(companyId) && canRead,
    queryFn: () => fetchCatalogStats(companyId),
  });

  React.useEffect(() => {
    if (statsQuery.error && isApiClientError(statsQuery.error) && statsQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [handleUnauthorized, statsQuery.error]);

  if (!canRead) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="کاتالوگ"
        description={
          activeCompany
            ? `هویت کالاهای شرکت «${activeCompany.name}»: محصول، SKU، بارکد و مشخصات`
            : 'هویت کالاها: محصول، SKU، بارکد و مشخصات'
        }
        breadcrumbs={[{ label: 'هکتور', href: ROUTES.dashboard }, { label: 'کاتالوگ' }]}
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Link href={ROUTES.catalogProducts} className={cn(buttonVariants())}>
                محصول جدید
              </Link>
              <Link
                href={ROUTES.catalogBrands}
                className={cn(buttonVariants({ variant: 'outline' }))}
              >
                برند جدید
              </Link>
              <Link
                href={ROUTES.catalogCategories}
                className={cn(buttonVariants({ variant: 'outline' }))}
              >
                دسته‌بندی جدید
              </Link>
            </div>
          ) : null
        }
      />

      <CatalogLookup className="max-w-xl" />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">وضعیت کاتالوگ</h2>
        {statsQuery.isError ? (
          <ErrorState
            title="خطا در دریافت آمار کاتالوگ"
            message={mapBusinessError(statsQuery.error)}
            onRetry={() => void statsQuery.refetch()}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STAT_CARDS.map((card) => {
              const Icon = card.icon;
              const value = statsQuery.data?.[card.key];
              return (
                <Link
                  key={card.key}
                  href={card.href}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 hover:bg-slate-50"
                >
                  <span>
                    <span className="block text-sm text-slate-500">{card.label}</span>
                    <span className="mt-1 block text-xl font-semibold text-slate-900">
                      {statsQuery.isPending || value === undefined ? (
                        <span className="inline-block h-6 w-12 animate-pulse rounded bg-slate-100" />
                      ) : (
                        formatNumber(value)
                      )}
                    </span>
                  </span>
                  <span className="rounded-md border border-slate-200 bg-slate-50 p-2">
                    <Icon className="h-4 w-4 text-slate-700" aria-hidden />
                  </span>
                </Link>
              );
            })}
          </div>
        )}
        <p className="text-xs text-slate-500">
          کاتالوگ فقط هویت کالا را نگه می‌دارد. موجودی، قیمت خرید و فروش در ماژول‌های انبار، خرید و
          فروش مدیریت می‌شوند.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">بخش‌ها</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {SECTION_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.href}
                href={card.href}
                className="rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                    <Icon className="h-4 w-4 text-slate-700" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">{card.label}</div>
                    <p className="mt-1 text-sm text-slate-500">{card.description}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
