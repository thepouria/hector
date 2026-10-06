'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccessDenied, EmptyState, ErrorState, TableSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RowActionsMenu } from '@/components/ui/row-actions';
import {
  activateSku,
  archiveSku,
  deactivateSku,
  executeCatalogBulk,
  fetchProduct,
  fetchSkus,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { productKeys, skuKeys } from '@/lib/query/keys';
import {
  ROUTES,
  catalogProductPath,
  catalogSkuBarcodePrintPath,
  catalogSkuPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import {
  DEFAULT_SKU_LIST_PARAMS,
  buildSkuListQuery,
  parseSkuListParams,
  serializeSkuListParams,
  totalPages as pageCount,
  type CatalogStatusFilter,
  type HasBarcodeFilter,
  type SkuSortField,
  type SortOrder,
} from '@/features/catalog/catalog-list-params';
import {
  FilterChips,
  ListPagination,
  type FilterChip,
} from '@/features/catalog/catalog-list-chrome';
import {
  useCatalogListParams,
  useDebouncedSearchInput,
} from '@/features/catalog/use-catalog-list-params';
import {
  buildBulkSelectionPayload,
  useCatalogBulkSelection,
} from '@/features/catalog/use-catalog-bulk-selection';
import { CatalogBulkBar } from '@/features/catalog/catalog-bulk-bar';
import type { Sku } from '@/types/catalog';

type SkuListParamsWithVariant = typeof DEFAULT_SKU_LIST_PARAMS & { variantValueId?: string };

const selectClassName =
  'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm';

const SKU_SORT_OPTIONS: Array<{
  value: string;
  label: string;
  sortBy: SkuSortField;
  sortOrder: SortOrder;
}> = [
  { value: 'code:asc', label: 'کد SKU (صعودی)', sortBy: 'code', sortOrder: 'asc' },
  { value: 'code:desc', label: 'کد SKU (نزولی)', sortBy: 'code', sortOrder: 'desc' },
  { value: 'updatedAt:desc', label: 'آخرین به‌روزرسانی', sortBy: 'updatedAt', sortOrder: 'desc' },
  { value: 'createdAt:desc', label: 'جدیدترین', sortBy: 'createdAt', sortOrder: 'desc' },
  { value: 'name:asc', label: 'نام', sortBy: 'name', sortOrder: 'asc' },
];

function statusLabel(status: string): string {
  if (status === 'ACTIVE') return 'فعال';
  if (status === 'INACTIVE') return 'غیرفعال';
  if (status === 'ARCHIVED') return 'بایگانی';
  return status;
}

function variantLabel(sku: Sku): string {
  if (sku.variantValues.length === 0) return 'ساده';
  return [...sku.variantValues]
    .sort((a, b) => a.optionPosition - b.optionPosition)
    .map((value) => `${value.optionName}: ${value.value}`)
    .join(' · ');
}

/**
 * Company-wide SKU list. Search, filters, sorting and pagination all run on the API
 * (`GET /catalog/skus`) and are mirrored in the URL. Identity data only — no stock or price.
 */
export function SkusPageClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.CATALOG_READ);
  const canManage = can(PERMISSIONS.CATALOG_MANAGE);

  const { params, setParams, resetParams } = useCatalogListParams({
    parse: parseSkuListParams,
    serialize: serializeSkuListParams,
    defaults: DEFAULT_SKU_LIST_PARAMS,
  });
  const commitSearch = React.useCallback((q: string) => setParams({ q }), [setParams]);
  const [searchInput, setSearchInput] = useDebouncedSearchInput(params.q, commitSearch);

  const [confirm, setConfirm] = React.useState<
    { type: 'deactivate' | 'activate' | 'archive'; sku: Sku } | null
  >(null);
  const bulk = useCatalogBulkSelection();
  const [bulkAction, setBulkAction] = React.useState<
    null | { type: 'SKU_ACTIVATE' | 'SKU_DEACTIVATE' | 'SKU_ARCHIVE' }
  >(null);

  const filters = buildSkuListQuery(params);
  const variantValueId =
    'variantValueId' in params
      ? ((params as SkuListParamsWithVariant).variantValueId ?? '')
      : '';

  const filterKey = React.useMemo(
    () =>
      JSON.stringify({
        q: params.q,
        status: params.status,
        productId: params.productId,
        hasBarcode: params.hasBarcode,
        variantValueId,
      }),
    [params.q, params.status, params.productId, params.hasBarcode, variantValueId],
  );
  React.useEffect(() => {
    bulk.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clear only when filters change
  }, [filterKey, companyId]);

  const skusQuery = useQuery({
    queryKey: skuKeys.listAll(companyId, filters),
    enabled: Boolean(companyId) && canRead,
    queryFn: () => fetchSkus(companyId, filters),
  });

  // Only to label the product chip when the list is scoped from a product drill-down.
  const scopedProductQuery = useQuery({
    queryKey: productKeys.detail(companyId, params.productId),
    enabled: Boolean(companyId && params.productId) && canRead,
    queryFn: () => fetchProduct(companyId, params.productId),
  });

  React.useEffect(() => {
    if (skusQuery.error && isApiClientError(skusQuery.error) && skusQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [handleUnauthorized, skusQuery.error]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: skuKeys.all(companyId) });
  };

  const lifecycleMutation = useMutation({
    mutationFn: ({ type, sku }: { type: 'deactivate' | 'activate' | 'archive'; sku: Sku }) => {
      if (type === 'deactivate') return deactivateSku(companyId, sku.id);
      if (type === 'activate') return activateSku(companyId, sku.id);
      return archiveSku(companyId, sku.id);
    },
    onSuccess: async (_result, variables) => {
      toast.success(
        variables.type === 'archive'
          ? 'SKU بایگانی شد.'
          : variables.type === 'deactivate'
            ? 'SKU غیرفعال شد.'
            : 'SKU فعال شد.',
      );
      setConfirm(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const bulkMutation = useMutation({
    mutationFn: async () => {
      if (!bulkAction) throw new Error('No bulk action');
      const selection = buildBulkSelectionPayload(bulk.state, filters);
      if (!selection) throw new Error('No selection');
      return executeCatalogBulk(companyId, {
        operation: bulkAction.type,
        selection,
      });
    },
    onSuccess: async (result) => {
      const title =
        result.failed > 0 ? 'بخشی از عملیات انجام شد' : 'عملیات گروهی انجام شد';
      toast.success(
        `${title}: ${result.succeeded} تغییر / ${result.skipped} بدون تغییر / ${result.failed} ناموفق از ${result.matched}`,
      );
      setBulkAction(null);
      bulk.clear();
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!canRead) {
    return <AccessDenied />;
  }

  const rows = skusQuery.data?.data ?? [];
  const meta = skusQuery.data?.meta;
  const totalPages = pageCount(meta);
  const pageIds = rows.map((row) => row.id);
  const pageCheck = bulk.getPageChecked(pageIds);

  const chips: FilterChip[] = [
    ...(params.q
      ? [{ key: 'q', label: `جستجو: ${params.q}`, onRemove: () => setParams({ q: '' }) }]
      : []),
    ...(params.status
      ? [
          {
            key: 'status',
            label: `وضعیت: ${statusLabel(params.status)}`,
            onRemove: () => setParams({ status: '' as const }),
          },
        ]
      : []),
    ...(params.hasBarcode
      ? [
          {
            key: 'barcode',
            label: params.hasBarcode === 'true' ? 'دارای بارکد' : 'بدون بارکد',
            onRemove: () => setParams({ hasBarcode: '' as const }),
          },
        ]
      : []),
    ...(params.productId
      ? [
          {
            key: 'product',
            label: `محصول: ${scopedProductQuery.data?.name ?? '...'}`,
            onRemove: () => setParams({ productId: '' }),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="SKUها"
        description="واحدهای قابل‌فروش و انبارداری کاتالوگ شرکت فعال"
        breadcrumbs={[{ label: 'کاتالوگ', href: ROUTES.catalog }, { label: 'SKUها' }]}
        actions={
          <Button type="button" variant="outline" onClick={() => router.push(ROUTES.catalogProducts)}>
            مدیریت محصولات
          </Button>
        }
      />

      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        ساخت SKU و ویرایش ترکیب تنوع در صفحه محصول انجام می‌شود تا ویژگی‌های تنوع همان محصول در
        دسترس باشد.
      </p>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor="sku-search">جستجو</Label>
          <Input
            id="sku-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="کد SKU، نام محصول یا بارکد"
          />
        </div>
        <div className="w-full space-y-1 sm:w-40">
          <Label htmlFor="sku-status">وضعیت</Label>
          <select
            id="sku-status"
            className={selectClassName}
            value={params.status}
            onChange={(event) => setParams({ status: event.target.value as CatalogStatusFilter })}
          >
            <option value="">همه</option>
            <option value="ACTIVE">فعال</option>
            <option value="INACTIVE">غیرفعال</option>
            <option value="ARCHIVED">بایگانی</option>
          </select>
        </div>
        <div className="w-full space-y-1 sm:w-40">
          <Label htmlFor="sku-barcode">بارکد</Label>
          <select
            id="sku-barcode"
            className={selectClassName}
            value={params.hasBarcode}
            onChange={(event) =>
              setParams({ hasBarcode: event.target.value as HasBarcodeFilter })
            }
          >
            <option value="">همه</option>
            <option value="true">دارای بارکد</option>
            <option value="false">بدون بارکد</option>
          </select>
        </div>
        <div className="w-full space-y-1 sm:w-48">
          <Label htmlFor="sku-sort">مرتب‌سازی</Label>
          <select
            id="sku-sort"
            className={selectClassName}
            value={`${params.sortBy}:${params.sortOrder}`}
            onChange={(event) => {
              const option = SKU_SORT_OPTIONS.find((item) => item.value === event.target.value);
              if (!option) return;
              setParams({ sortBy: option.sortBy, sortOrder: option.sortOrder });
            }}
          >
            {SKU_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <FilterChips chips={chips} onClearAll={resetParams} />

      {skusQuery.isLoading ? <TableSkeleton rows={6} /> : null}
      {skusQuery.isError ? (
        <ErrorState
          title="خطا در دریافت SKUها"
          message={mapBusinessError(skusQuery.error)}
          onRetry={() => void skusQuery.refetch()}
        />
      ) : null}

      {!skusQuery.isLoading && !skusQuery.isError && rows.length === 0 ? (
        chips.length > 0 ? (
          <EmptyState
            title="SKU با این فیلترها پیدا نشد."
            description="عبارت جستجو یا فیلترها را تغییر دهید."
            action={
              <Button type="button" variant="outline" onClick={resetParams}>
                پاک کردن فیلترها
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="هنوز SKU ثبت نشده است."
            description="برای ساخت SKU، ابتدا محصول را باز کنید."
            action={
              <Button type="button" onClick={() => router.push(ROUTES.catalogProducts)}>
                رفتن به محصولات
              </Button>
            }
          />
        )
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-right text-slate-600">
              <tr>
                {canManage ? (
                  <th className="px-3 py-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={pageCheck === 'all'}
                      ref={(el) => {
                        if (el) el.indeterminate = pageCheck === 'some';
                      }}
                      aria-label="انتخاب همه SKUهای این صفحه"
                      onChange={() => bulk.togglePage(pageIds)}
                    />
                  </th>
                ) : null}
                <th className="px-4 py-3 font-medium">کد SKU</th>
                <th className="px-4 py-3 font-medium">محصول</th>
                <th className="px-4 py-3 font-medium">تنوع</th>
                <th className="px-4 py-3 font-medium">بارکد اصلی</th>
                <th className="px-4 py-3 font-medium">وضعیت</th>
                <th className="px-4 py-3 font-medium">به‌روزرسانی</th>
                <th className="px-4 py-3 font-medium">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((sku) => (
                <tr
                  key={sku.id}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  onClick={() => router.push(catalogSkuPath(sku.id))}
                >
                  {canManage ? (
                    <td
                      className="px-3 py-3"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={bulk.isSelected(sku.id)}
                        aria-label={`انتخاب SKU ${sku.code}`}
                        onChange={() => bulk.toggleId(sku.id)}
                      />
                    </td>
                  ) : null}
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link
                      href={catalogSkuPath(sku.id)}
                      dir="ltr"
                      className="block font-mono underline-offset-2 hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {sku.code}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <Link
                      href={catalogProductPath(sku.productId)}
                      className="hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {sku.product.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{variantLabel(sku)}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {sku.primaryBarcode ? (
                      <span dir="ltr" className="block font-mono">
                        {sku.primaryBarcode.value}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge>{statusLabel(sku.status)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(sku.updatedAt)}</td>
                  <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                    <RowActionsMenu
                      actions={[
                        {
                          label: 'جزئیات و بارکدها',
                          onSelect: () => router.push(catalogSkuPath(sku.id)),
                        },
                        {
                          label: 'محصول',
                          onSelect: () => router.push(catalogProductPath(sku.productId)),
                        },
                        ...(sku.primaryBarcode
                          ? [
                              {
                                label: 'چاپ برچسب',
                                onSelect: () =>
                                  router.push(catalogSkuBarcodePrintPath(sku.id)),
                              },
                            ]
                          : []),
                        ...(canManage && sku.status === 'ACTIVE'
                          ? [
                              {
                                label: 'غیرفعال کردن',
                                onSelect: () => setConfirm({ type: 'deactivate', sku }),
                              },
                            ]
                          : []),
                        ...(canManage && (sku.status === 'INACTIVE' || sku.status === 'ARCHIVED')
                          ? [
                              {
                                label: 'فعال‌سازی',
                                onSelect: () => setConfirm({ type: 'activate', sku }),
                              },
                            ]
                          : []),
                        ...(canManage && sku.status !== 'ARCHIVED'
                          ? [
                              {
                                label: 'بایگانی',
                                onSelect: () => setConfirm({ type: 'archive', sku }),
                                danger: true,
                              },
                            ]
                          : []),
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {canManage ? (
        <CatalogBulkBar
          count={bulk.selectedCount}
          entityLabel="SKU"
          pageSize={params.pageSize}
          matchedTotal={meta?.total ?? 0}
          isQueryMode={bulk.state.mode === 'query'}
          onSelectAllMatching={() => bulk.selectAllMatching(meta?.total ?? 0)}
          onClear={bulk.clear}
          actions={[
            {
              label: 'فعال کردن',
              onClick: () => setBulkAction({ type: 'SKU_ACTIVATE' }),
            },
            {
              label: 'غیرفعال کردن',
              onClick: () => setBulkAction({ type: 'SKU_DEACTIVATE' }),
            },
            {
              label: 'آرشیو',
              onClick: () => setBulkAction({ type: 'SKU_ARCHIVE' }),
              danger: true,
            },
          ]}
        />
      ) : null}

      {meta && meta.total > 0 ? (
        <ListPagination
          page={params.page}
          pageCount={totalPages}
          total={meta.total}
          pageSize={params.pageSize}
          onPageChange={(page) => setParams({ page })}
          onPageSizeChange={(pageSize) => setParams({ pageSize })}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm?.type === 'archive'
            ? 'بایگانی SKU'
            : confirm?.type === 'deactivate'
              ? 'غیرفعال کردن SKU'
              : 'فعال‌سازی SKU'
        }
        description={
          confirm?.type === 'archive'
            ? 'SKU حذف نمی‌شود؛ کد و ترکیب تنوع آن رزرو می‌ماند و بارکدها حفظ می‌شوند.'
            : confirm?.type === 'deactivate'
              ? 'SKU از فهرست‌های عملیاتی حذف می‌شود اما حذف دائمی نمی‌شود.'
              : 'SKU دوباره فعال می‌شود؛ محصول باید فعال و ترکیب تنوع معتبر باشد.'
        }
        target={confirm?.sku.code}
        confirmLabel={
          confirm?.type === 'archive'
            ? 'بایگانی'
            : confirm?.type === 'deactivate'
              ? 'غیرفعال کردن'
              : 'فعال‌سازی'
        }
        danger={confirm?.type === 'archive'}
        loading={lifecycleMutation.isPending}
        onConfirm={() => {
          if (!confirm) return;
          lifecycleMutation.mutate(confirm);
        }}
      />

      <ConfirmDialog
        open={Boolean(bulkAction)}
        onOpenChange={(open) => {
          if (!open && !bulkMutation.isPending) setBulkAction(null);
        }}
        title={
          bulkAction?.type === 'SKU_ARCHIVE'
            ? 'آرشیو گروهی SKUها'
            : bulkAction?.type === 'SKU_DEACTIVATE'
              ? 'غیرفعال‌سازی گروهی SKUها'
              : 'فعال‌سازی گروهی SKUها'
        }
        description={
          bulkAction?.type === 'SKU_ARCHIVE'
            ? `این عملیات روی ${bulk.selectedCount.toLocaleString('fa-IR')} SKU اعمال می‌شود. آرشیو حذف دائمی نیست و کد SKU رزرو می‌ماند.`
            : bulkAction?.type === 'SKU_DEACTIVATE'
              ? `این عملیات روی ${bulk.selectedCount.toLocaleString('fa-IR')} SKU اعمال می‌شود. SKUها از فهرست‌های عملیاتی حذف می‌شوند اما حذف دائمی نمی‌شوند.`
              : `این عملیات روی ${bulk.selectedCount.toLocaleString('fa-IR')} SKU اعمال می‌شود. برای فعال‌سازی، محصول باید فعال و ترکیب تنوع معتبر باشد.`
        }
        confirmLabel="اعمال تغییر"
        danger={bulkAction?.type === 'SKU_ARCHIVE'}
        loading={bulkMutation.isPending}
        onConfirm={() => bulkMutation.mutate()}
      />
    </div>
  );
}
