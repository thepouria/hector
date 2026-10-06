'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RowActionsMenu } from '@/components/ui/row-actions';
import {
  activateProduct,
  archiveProduct,
  createProduct,
  deactivateProduct,
  putProductAttributes,
  executeCatalogBulk,
  fetchBrands,
  fetchCategoryTree,
  fetchProducts,
  updateProduct,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { brandKeys, categoryKeys, productKeys } from '@/lib/query/keys';
import { ROUTES, catalogProductPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import {
  ProductCreateOptionalSpecs,
  type ProductCreateSpecsHandle,
} from '@/features/catalog/product-create-optional-specs';
import {
  DEFAULT_PRODUCT_LIST_PARAMS,
  buildProductListQuery,
  parseProductListParams,
  serializeProductListParams,
  totalPages as pageCount,
  type CatalogStatusFilter,
  type ProductSortField,
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
import type { CategoryTreeNode, Product } from '@/types/catalog';

const selectClassName =
  'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm';

const PRODUCT_SORT_OPTIONS: Array<{
  value: string;
  label: string;
  sortBy: ProductSortField;
  sortOrder: SortOrder;
}> = [
  { value: 'name:asc', label: 'نام (الف تا ی)', sortBy: 'name', sortOrder: 'asc' },
  { value: 'name:desc', label: 'نام (ی تا الف)', sortBy: 'name', sortOrder: 'desc' },
  { value: 'updatedAt:desc', label: 'آخرین به‌روزرسانی', sortBy: 'updatedAt', sortOrder: 'desc' },
  { value: 'createdAt:desc', label: 'جدیدترین', sortBy: 'createdAt', sortOrder: 'desc' },
  { value: 'code:asc', label: 'کد داخلی', sortBy: 'code', sortOrder: 'asc' },
];

function statusLabel(status: string): string {
  if (status === 'ACTIVE') return 'فعال';
  if (status === 'INACTIVE') return 'غیرفعال';
  if (status === 'ARCHIVED') return 'بایگانی';
  return status;
}

function collectAssignableCategoryOptions(
  nodes: CategoryTreeNode[],
  path: string[] = [],
  ancestorsAllActive = true,
): Array<{ id: string; path: string }> {
  const result: Array<{ id: string; path: string }> = [];
  for (const node of nodes) {
    const nextPath = [...path, node.name];
    const chainActive = ancestorsAllActive && node.status === 'ACTIVE';
    if (chainActive) {
      result.push({ id: node.id, path: nextPath.join(' / ') });
    }
    result.push(...collectAssignableCategoryOptions(node.children, nextPath, chainActive));
  }
  return result;
}

export function ProductsPageClient() {
  const router = useRouter();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.CATALOG_MANAGE);

  const { params, setParams, resetParams } = useCatalogListParams({
    parse: parseProductListParams,
    serialize: serializeProductListParams,
    defaults: DEFAULT_PRODUCT_LIST_PARAMS,
  });
  const commitSearch = React.useCallback((q: string) => setParams({ q }), [setParams]);
  const [searchInput, setSearchInput] = useDebouncedSearchInput(params.q, commitSearch);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Product | null>(null);
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [formBrandId, setFormBrandId] = React.useState('');
  const [formCategoryId, setFormCategoryId] = React.useState('');
  const [brandFilterInput, setBrandFilterInput] = React.useState('');
  const [confirm, setConfirm] = React.useState<
    { type: 'deactivate' | 'activate' | 'archive'; product: Product } | null
  >(null);
  const createSpecsRef = React.useRef<ProductCreateSpecsHandle>(null);
  const bulk = useCatalogBulkSelection();
  const [bulkAction, setBulkAction] = React.useState<
    | null
    | { type: 'PRODUCT_ACTIVATE' | 'PRODUCT_DEACTIVATE' | 'PRODUCT_ARCHIVE' }
    | { type: 'PRODUCT_CHANGE_BRAND'; brandId: string }
    | { type: 'PRODUCT_CHANGE_CATEGORY'; categoryId: string }
  >(null);
  const [bulkBrandId, setBulkBrandId] = React.useState('');
  const [bulkCategoryId, setBulkCategoryId] = React.useState('');
  const [bulkDialog, setBulkDialog] = React.useState<'brand' | 'category' | null>(null);

  const filters = buildProductListQuery(params);

  // Filter changes invalidate selection semantics.
  const filterKey = React.useMemo(
    () =>
      JSON.stringify({
        q: params.q,
        status: params.status,
        brandId: params.brandId,
        categoryId: params.categoryId,
        hasSku: params.hasSku,
        attrs: params.attrs,
        includeDescendants: params.includeDescendants,
      }),
    [
      params.q,
      params.status,
      params.brandId,
      params.categoryId,
      params.hasSku,
      params.attrs,
      params.includeDescendants,
    ],
  );
  React.useEffect(() => {
    bulk.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clear only when filters change
  }, [filterKey, companyId]);

  const productsQuery = useQuery({
    queryKey: productKeys.list(companyId, filters),
    enabled: Boolean(companyId) && can(PERMISSIONS.CATALOG_READ),
    queryFn: () => fetchProducts(companyId, filters),
  });

  const brandsFilterQuery = useQuery({
    queryKey: brandKeys.list(companyId, { status: 'ACTIVE', page: 1, pageSize: 100 }),
    enabled: Boolean(companyId) && can(PERMISSIONS.CATALOG_READ),
    queryFn: () => fetchBrands(companyId, { status: 'ACTIVE', page: 1, pageSize: 100 }),
  });

  const categoryTreeQuery = useQuery({
    queryKey: categoryKeys.tree(companyId),
    enabled: Boolean(companyId) && can(PERMISSIONS.CATALOG_READ),
    queryFn: () => fetchCategoryTree(companyId),
  });

  const formBrandsQuery = useQuery({
    queryKey: brandKeys.list(companyId, { status: 'ACTIVE', page: 1, pageSize: 100, for: 'product-form' }),
    enabled: Boolean(companyId) && formOpen && canManage,
    queryFn: () => fetchBrands(companyId, { status: 'ACTIVE', page: 1, pageSize: 100 }),
  });

  React.useEffect(() => {
    if (
      productsQuery.error &&
      isApiClientError(productsQuery.error) &&
      productsQuery.error.status === 401
    ) {
      handleUnauthorized();
    }
  }, [productsQuery.error, handleUnauthorized]);

  const assignableCategories = React.useMemo(
    () => collectAssignableCategoryOptions(categoryTreeQuery.data ?? []),
    [categoryTreeQuery.data],
  );

  const filterBrands = brandsFilterQuery.data?.data ?? [];
  const formBrands = formBrandsQuery.data?.data ?? [];
  const brandSearch = brandFilterInput.trim().toLowerCase();
  const filteredFormBrands = brandSearch
    ? formBrands.filter(
        (brand) =>
          brand.name.toLowerCase().includes(brandSearch) ||
          (brand.code?.toLowerCase().includes(brandSearch) ?? false),
      )
    : formBrands;

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: productKeys.all(companyId) });
  };

  const openCreate = () => {
    setEditing(null);
    setName('');
    setCode('');
    setDescription('');
    setFormBrandId('');
    setFormCategoryId('');
    setBrandFilterInput('');
    setFormOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditing(product);
    setName(product.name);
    setCode(product.code ?? '');
    setDescription(product.description ?? '');
    setFormBrandId(product.brandId ?? '');
    setFormCategoryId(product.categoryId ?? '');
    setBrandFilterInput('');
    setFormOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing) {
        return updateProduct(companyId, editing.id, {
          name,
          code: code.trim() ? code.trim() : null,
          description: description.trim() ? description.trim() : null,
          brandId: formBrandId ? formBrandId : null,
          categoryId: formCategoryId ? formCategoryId : null,
        });
      }
      const created = await createProduct(companyId, {
        name,
        ...(code.trim() ? { code: code.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(formBrandId ? { brandId: formBrandId } : {}),
        ...(formCategoryId ? { categoryId: formCategoryId } : {}),
      });
      const attrPayload = createSpecsRef.current?.buildPayload() ?? [];
      if (attrPayload.length > 0) {
        await putProductAttributes(companyId, created.id, attrPayload);
      }
      return created;
    },
    onSuccess: async (product) => {
      toast.success(editing ? 'محصول به‌روز شد.' : 'محصول ایجاد شد.');
      setFormOpen(false);
      await invalidate();
      if (!editing) {
        router.push(catalogProductPath(product.id));
      }
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const deactivateMutation = useMutation({
    mutationFn: (productId: string) => deactivateProduct(companyId, productId),
    onSuccess: async () => {
      toast.success('محصول غیرفعال شد.');
      setConfirm(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const activateMutation = useMutation({
    mutationFn: (productId: string) => activateProduct(companyId, productId),
    onSuccess: async () => {
      toast.success('محصول فعال شد.');
      setConfirm(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const archiveMutation = useMutation({
    mutationFn: (productId: string) => archiveProduct(companyId, productId),
    onSuccess: async () => {
      toast.success('محصول بایگانی شد.');
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
      const payload =
        bulkAction.type === 'PRODUCT_CHANGE_BRAND'
          ? { brandId: bulkAction.brandId || null }
          : bulkAction.type === 'PRODUCT_CHANGE_CATEGORY'
            ? { categoryId: bulkAction.categoryId || null }
            : undefined;
      return executeCatalogBulk(companyId, {
        operation: bulkAction.type,
        selection,
        ...(payload ? { payload } : {}),
      });
    },
    onSuccess: async (result) => {
      const title =
        result.failed > 0
          ? 'بخشی از عملیات انجام شد'
          : 'عملیات گروهی انجام شد';
      toast.success(
        `${title}: ${result.succeeded} تغییر / ${result.skipped} بدون تغییر / ${result.failed} ناموفق از ${result.matched}`,
      );
      setBulkAction(null);
      setBulkDialog(null);
      bulk.clear();
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.CATALOG_READ)) {
    return <AccessDenied />;
  }

  const rows = productsQuery.data?.data ?? [];
  const meta = productsQuery.data?.meta;
  const totalPages = pageCount(meta);
  const pageIds = rows.map((row) => row.id);
  const pageCheck = bulk.getPageChecked(pageIds);

  const lifecycleLoading =
    deactivateMutation.isPending || activateMutation.isPending || archiveMutation.isPending;

  const selectedBrandName = filterBrands.find((brand) => brand.id === params.brandId)?.name;
  const selectedCategoryPath = assignableCategories.find(
    (option) => option.id === params.categoryId,
  )?.path;

  const chips: FilterChip[] = [
    ...(params.q ? [{ key: 'q', label: `جستجو: ${params.q}`, onRemove: () => setParams({ q: '' }) }] : []),
    ...(params.status
      ? [
          {
            key: 'status',
            label: `وضعیت: ${statusLabel(params.status)}`,
            onRemove: () => setParams({ status: '' as const }),
          },
        ]
      : []),
    ...(params.brandId
      ? [
          {
            key: 'brand',
            label: `برند: ${selectedBrandName ?? '—'}`,
            onRemove: () => setParams({ brandId: '' }),
          },
        ]
      : []),
    ...(params.categoryId
      ? [
          {
            key: 'category',
            label: `دسته‌بندی: ${selectedCategoryPath ?? '—'}${
              params.includeDescendants ? '' : ' (فقط همین)'
            }`,
            onRemove: () => setParams({ categoryId: '', includeDescendants: true }),
          },
        ]
      : []),
    ...(params.hasSku
      ? [
          {
            key: 'hasSku',
            label: params.hasSku === 'true' ? 'دارای SKU' : 'بدون SKU',
            onRemove: () => setParams({ hasSku: '' as const }),
          },
        ]
      : []),
    ...(params.attrs
      ? [
          {
            key: 'attrs',
            label: `مشخصات: ${params.attrs}`,
            onRemove: () => setParams({ attrs: '' }),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="محصولات"
        description="مدیریت محصولات و SKUهای کاتالوگ"
        breadcrumbs={[{ label: 'کاتالوگ', href: ROUTES.catalog }, { label: 'محصولات' }]}
        actions={
          canManage ? (
            <Button type="button" onClick={openCreate}>
              محصول جدید
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor="product-search">جستجو</Label>
          <Input
            id="product-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="نام، کد، SKU یا بارکد"
          />
        </div>
        <div className="w-full space-y-1 sm:w-40">
          <Label htmlFor="product-status">وضعیت</Label>
          <select
            id="product-status"
            className={selectClassName}
            value={params.status}
            onChange={(event) =>
              setParams({ status: event.target.value as CatalogStatusFilter })
            }
          >
            <option value="">همه</option>
            <option value="ACTIVE">فعال</option>
            <option value="INACTIVE">غیرفعال</option>
            <option value="ARCHIVED">بایگانی</option>
          </select>
        </div>
        <div className="w-full space-y-1 sm:w-48">
          <Label htmlFor="product-brand-filter">برند</Label>
          <select
            id="product-brand-filter"
            className={selectClassName}
            value={params.brandId}
            onChange={(event) => setParams({ brandId: event.target.value })}
          >
            <option value="">همه</option>
            {filterBrands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </div>
        <div className="w-full space-y-1 sm:min-w-[12rem] sm:flex-1">
          <Label htmlFor="product-category-filter">دسته‌بندی</Label>
          <select
            id="product-category-filter"
            className={selectClassName}
            value={params.categoryId}
            onChange={(event) =>
              setParams({ categoryId: event.target.value, includeDescendants: true })
            }
          >
            <option value="">همه</option>
            {assignableCategories.map((option) => (
              <option key={option.id} value={option.id}>
                {option.path}
              </option>
            ))}
          </select>
        </div>
        {params.categoryId ? (
          <div className="w-full space-y-1 sm:w-44">
            <Label htmlFor="product-descendants">محدوده دسته</Label>
            <select
              id="product-descendants"
              className={selectClassName}
              value={params.includeDescendants ? 'true' : 'false'}
              onChange={(event) =>
                setParams({ includeDescendants: event.target.value !== 'false' })
              }
            >
              <option value="true">شامل زیر‌دسته‌ها</option>
              <option value="false">فقط همین دسته</option>
            </select>
          </div>
        ) : null}
        <div className="w-full space-y-1 sm:w-40">
          <Label htmlFor="product-has-sku">SKU</Label>
          <select
            id="product-has-sku"
            className={selectClassName}
            value={params.hasSku}
            onChange={(event) =>
              setParams({ hasSku: event.target.value as '' | 'true' | 'false' })
            }
          >
            <option value="">همه</option>
            <option value="true">دارای SKU</option>
            <option value="false">بدون SKU</option>
          </select>
        </div>
        <div className="w-full space-y-1 sm:w-48">
          <Label htmlFor="product-sort">مرتب‌سازی</Label>
          <select
            id="product-sort"
            className={selectClassName}
            value={`${params.sortBy}:${params.sortOrder}`}
            onChange={(event) => {
              const option = PRODUCT_SORT_OPTIONS.find((item) => item.value === event.target.value);
              if (!option) return;
              setParams({ sortBy: option.sortBy, sortOrder: option.sortOrder });
            }}
          >
            {PRODUCT_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <FilterChips chips={chips} onClearAll={resetParams} />

      {productsQuery.isLoading ? <TableSkeleton rows={6} /> : null}
      {productsQuery.isError ? (
        <ErrorState
          title="خطا در دریافت محصولات"
          message={mapBusinessError(productsQuery.error)}
        />
      ) : null}

      {!productsQuery.isLoading && !productsQuery.isError && rows.length === 0 ? (
        chips.length > 0 ? (
          <EmptyState
            title="محصولی با این فیلترها پیدا نشد."
            description="عبارت جستجو یا فیلترها را تغییر دهید."
            action={
              <Button type="button" variant="outline" onClick={resetParams}>
                پاک کردن فیلترها
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="هنوز محصولی ثبت نشده است."
            description="محصولات، پایه‌ی SKU، بارکد، انبار و فروش در Hector هستند."
            action={
              canManage ? (
                <Button type="button" onClick={openCreate}>
                  ایجاد اولین محصول
                </Button>
              ) : undefined
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
                      aria-label="انتخاب همه محصولات این صفحه"
                      onChange={() => bulk.togglePage(pageIds)}
                    />
                  </th>
                ) : null}
                <th className="px-4 py-3 font-medium">محصول</th>
                <th className="px-4 py-3 font-medium">کد</th>
                <th className="px-4 py-3 font-medium">برند</th>
                <th className="px-4 py-3 font-medium">دسته‌بندی</th>
                <th className="px-4 py-3 font-medium">تعداد SKU</th>
                <th className="px-4 py-3 font-medium">وضعیت</th>
                <th className="px-4 py-3 font-medium">به‌روزرسانی</th>
                {canManage ? <th className="px-4 py-3 font-medium">عملیات</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((product) => (
                <tr
                  key={product.id}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  onClick={() => router.push(catalogProductPath(product.id))}
                >
                  {canManage ? (
                    <td
                      className="px-3 py-3"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={bulk.isSelected(product.id)}
                        aria-label={`انتخاب محصول ${product.name}`}
                        onChange={() => bulk.toggleId(product.id)}
                      />
                    </td>
                  ) : null}
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">
                      <Link
                        href={catalogProductPath(product.id)}
                        className="hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {product.name}
                      </Link>
                    </div>
                    {product.code ? (
                      <div className="mt-0.5 font-mono text-xs text-slate-500" dir="ltr">
                        {product.code}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-600" dir="ltr">
                    {product.code ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{product.brand?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {product.categoryPath ?? product.category?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">
                    {product.skuCount ?? 0}
                  </td>
                  <td className="px-4 py-3">
                    <Badge>{statusLabel(product.status)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatDateTime(product.updatedAt)}
                  </td>
                  {canManage ? (
                    <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                      <RowActionsMenu
                        actions={[
                          {
                            label: 'ویرایش',
                            onSelect: () => openEdit(product),
                          },
                          ...(product.status === 'ACTIVE'
                            ? [
                                {
                                  label: 'غیرفعال کردن',
                                  onSelect: () =>
                                    setConfirm({ type: 'deactivate', product }),
                                },
                              ]
                            : []),
                          ...(product.status === 'INACTIVE' || product.status === 'ARCHIVED'
                            ? [
                                {
                                  label: 'فعال‌سازی',
                                  onSelect: () => setConfirm({ type: 'activate', product }),
                                },
                              ]
                            : []),
                          ...(product.status !== 'ARCHIVED'
                            ? [
                                {
                                  label: 'بایگانی',
                                  onSelect: () => setConfirm({ type: 'archive', product }),
                                  danger: true,
                                },
                              ]
                            : []),
                        ]}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {canManage ? (
        <CatalogBulkBar
          count={bulk.selectedCount}
          entityLabel="محصول"
          pageSize={params.pageSize}
          matchedTotal={meta?.total ?? 0}
          isQueryMode={bulk.state.mode === 'query'}
          onSelectAllMatching={() => bulk.selectAllMatching(meta?.total ?? 0)}
          onClear={bulk.clear}
          actions={[
            {
              label: 'تغییر برند',
              onClick: () => {
                setBulkBrandId('');
                setBulkDialog('brand');
              },
            },
            {
              label: 'تغییر دسته',
              onClick: () => {
                setBulkCategoryId('');
                setBulkDialog('category');
              },
            },
            {
              label: 'فعال کردن',
              onClick: () => setBulkAction({ type: 'PRODUCT_ACTIVATE' }),
            },
            {
              label: 'غیرفعال کردن',
              onClick: () => setBulkAction({ type: 'PRODUCT_DEACTIVATE' }),
            },
            {
              label: 'آرشیو',
              onClick: () => setBulkAction({ type: 'PRODUCT_ARCHIVE' }),
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

      <Dialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? 'ویرایش محصول' : 'محصول جدید'}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="product-name">نام محصول</Label>
            <Input
              id="product-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={200}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="product-code">کد داخلی</Label>
            <Input
              id="product-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={64}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="product-brand">برند</Label>
            <Input
              id="product-brand-search"
              value={brandFilterInput}
              onChange={(event) => setBrandFilterInput(event.target.value)}
              placeholder="جستجوی برند..."
              className="mb-2"
            />
            <select
              id="product-brand"
              className={selectClassName}
              value={formBrandId}
              onChange={(event) => setFormBrandId(event.target.value)}
            >
              <option value="">(بدون برند)</option>
              {filteredFormBrands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                  {brand.code ? ` (${brand.code})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="product-category">دسته‌بندی</Label>
            <select
              id="product-category"
              className={selectClassName}
              value={formCategoryId}
              onChange={(event) => setFormCategoryId(event.target.value)}
            >
              <option value="">(بدون دسته‌بندی)</option>
              {assignableCategories.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.path}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="product-description">توضیحات</Label>
            <textarea
              id="product-description"
              className="flex min-h-[88px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={4000}
            />
          </div>
          {!editing ? (
            <ProductCreateOptionalSpecs
              ref={createSpecsRef}
              companyId={companyId}
              categoryId={formCategoryId}
            />
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              انصراف
            </Button>
            <Button type="submit" disabled={saveMutation.isPending || !name.trim()}>
              {saveMutation.isPending ? 'در حال ذخیره...' : 'ذخیره'}
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm?.type === 'archive'
            ? 'بایگانی محصول'
            : confirm?.type === 'deactivate'
              ? 'غیرفعال کردن محصول'
              : 'فعال‌سازی محصول'
        }
        description={
          confirm?.type === 'archive'
            ? 'محصول حذف نمی‌شود و سوابق آن حفظ خواهد شد.'
            : confirm?.type === 'deactivate'
              ? 'محصول از فهرست‌های عملیاتی حذف می‌شود اما حذف دائمی نمی‌شود و می‌توانید دوباره فعالش کنید.'
              : 'محصول دوباره فعال می‌شود و در صورت داشتن برند و دسته‌بندی معتبر، قابل استفاده خواهد بود.'
        }
        target={confirm?.product.name}
        confirmLabel={
          confirm?.type === 'archive'
            ? 'بایگانی'
            : confirm?.type === 'deactivate'
              ? 'غیرفعال کردن'
              : 'فعال‌سازی'
        }
        danger={confirm?.type === 'archive'}
        loading={lifecycleLoading}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.type === 'archive') {
            archiveMutation.mutate(confirm.product.id);
          } else if (confirm.type === 'deactivate') {
            deactivateMutation.mutate(confirm.product.id);
          } else {
            activateMutation.mutate(confirm.product.id);
          }
        }}
      />

      <ConfirmDialog
        open={
          Boolean(
            bulkAction &&
              (bulkAction.type === 'PRODUCT_ACTIVATE' ||
                bulkAction.type === 'PRODUCT_DEACTIVATE' ||
                bulkAction.type === 'PRODUCT_ARCHIVE'),
          )
        }
        onOpenChange={(open) => {
          if (!open && !bulkMutation.isPending) setBulkAction(null);
        }}
        title={
          bulkAction?.type === 'PRODUCT_ARCHIVE'
            ? 'آرشیو گروهی محصولات'
            : bulkAction?.type === 'PRODUCT_DEACTIVATE'
              ? 'غیرفعال‌سازی گروهی'
              : 'فعال‌سازی گروهی'
        }
        description={`این عملیات روی ${bulk.selectedCount.toLocaleString('fa-IR')} محصول اعمال می‌شود. آرشیو حذف دائمی نیست.`}
        confirmLabel="اعمال تغییر"
        danger={bulkAction?.type === 'PRODUCT_ARCHIVE'}
        loading={bulkMutation.isPending}
        onConfirm={() => bulkMutation.mutate()}
      />

      <Dialog
        open={bulkDialog === 'brand'}
        onOpenChange={(open) => {
          if (!open) setBulkDialog(null);
        }}
        title="تغییر برند گروهی"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {bulk.selectedCount.toLocaleString('fa-IR')} محصول انتخاب شده‌اند.
          </p>
          <div className="space-y-1">
            <Label htmlFor="bulk-brand">برند جدید</Label>
            <select
              id="bulk-brand"
              className={selectClassName}
              value={bulkBrandId}
              onChange={(event) => setBulkBrandId(event.target.value)}
            >
              <option value="">(بدون برند)</option>
              {filterBrands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setBulkDialog(null)}>
              انصراف
            </Button>
            <Button
              type="button"
              disabled={bulkMutation.isPending}
              onClick={() => {
                setBulkAction({ type: 'PRODUCT_CHANGE_BRAND', brandId: bulkBrandId });
                setBulkDialog(null);
              }}
            >
              ادامه
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={bulkDialog === 'category'}
        onOpenChange={(open) => {
          if (!open) setBulkDialog(null);
        }}
        title="تغییر دسته‌بندی گروهی"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {bulk.selectedCount.toLocaleString('fa-IR')} محصول انتخاب شده‌اند. تغییر دسته، مشخصات فعلی
            را حذف نمی‌کند.
          </p>
          <div className="space-y-1">
            <Label htmlFor="bulk-category">دسته‌بندی جدید</Label>
            <select
              id="bulk-category"
              className={selectClassName}
              value={bulkCategoryId}
              onChange={(event) => setBulkCategoryId(event.target.value)}
            >
              <option value="">(بدون دسته‌بندی)</option>
              {assignableCategories.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.path}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setBulkDialog(null)}>
              انصراف
            </Button>
            <Button
              type="button"
              disabled={bulkMutation.isPending}
              onClick={() => {
                setBulkAction({ type: 'PRODUCT_CHANGE_CATEGORY', categoryId: bulkCategoryId });
                setBulkDialog(null);
              }}
            >
              ادامه
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={
          Boolean(
            bulkAction &&
              (bulkAction.type === 'PRODUCT_CHANGE_BRAND' ||
                bulkAction.type === 'PRODUCT_CHANGE_CATEGORY'),
          )
        }
        onOpenChange={(open) => {
          if (!open && !bulkMutation.isPending) setBulkAction(null);
        }}
        title="تأیید عملیات گروهی"
        description={`تغییر روی ${bulk.selectedCount.toLocaleString('fa-IR')} محصول اعمال می‌شود.`}
        confirmLabel="اعمال تغییر"
        loading={bulkMutation.isPending}
        onConfirm={() => bulkMutation.mutate()}
      />
    </div>
  );
}
