'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccessDenied, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  activateProduct,
  archiveProduct,
  deactivateProduct,
  fetchBrands,
  fetchCategoryTree,
  fetchProduct,
  updateProduct,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { brandKeys, categoryKeys, productKeys } from '@/lib/query/keys';
import { ROUTES, catalogProductSkusPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { CategoryTreeNode } from '@/types/catalog';
import { EntityAttributesSection } from '@/features/catalog/entity-attributes-section';
import { EntityHistory } from '@/features/catalog/entity-history';
import { ProductSkusPanel } from '@/features/catalog/product-skus-panel';
import { ProductVariantsPanel } from '@/features/catalog/product-variants-panel';

const selectClassName =
  'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm';

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-900">{children}</div>
    </div>
  );
}

export function ProductDetailPageClient({ productId }: { productId: string }) {
  const router = useRouter();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.CATALOG_MANAGE);

  const [editOpen, setEditOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [formBrandId, setFormBrandId] = React.useState('');
  const [formCategoryId, setFormCategoryId] = React.useState('');
  const [brandFilterInput, setBrandFilterInput] = React.useState('');
  const [confirm, setConfirm] = React.useState<'deactivate' | 'activate' | 'archive' | null>(null);

  const productQuery = useQuery({
    queryKey: productKeys.detail(companyId, productId),
    enabled: Boolean(companyId) && can(PERMISSIONS.CATALOG_READ),
    queryFn: () => fetchProduct(companyId, productId),
  });

  const categoryTreeQuery = useQuery({
    queryKey: categoryKeys.tree(companyId),
    enabled: Boolean(companyId) && editOpen && canManage,
    queryFn: () => fetchCategoryTree(companyId),
  });

  const formBrandsQuery = useQuery({
    queryKey: brandKeys.list(companyId, { status: 'ACTIVE', page: 1, pageSize: 100, for: 'product-detail' }),
    enabled: Boolean(companyId) && editOpen && canManage,
    queryFn: () => fetchBrands(companyId, { status: 'ACTIVE', page: 1, pageSize: 100 }),
  });

  React.useEffect(() => {
    if (
      productQuery.error &&
      isApiClientError(productQuery.error) &&
      productQuery.error.status === 401
    ) {
      handleUnauthorized();
    }
  }, [productQuery.error, handleUnauthorized]);

  const assignableCategories = React.useMemo(
    () => collectAssignableCategoryOptions(categoryTreeQuery.data ?? []),
    [categoryTreeQuery.data],
  );

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
    await queryClient.invalidateQueries({ queryKey: productKeys.detail(companyId, productId) });
  };

  const openEdit = () => {
    const product = productQuery.data;
    if (!product) return;
    setName(product.name);
    setCode(product.code ?? '');
    setDescription(product.description ?? '');
    setFormBrandId(product.brandId ?? '');
    setFormCategoryId(product.categoryId ?? '');
    setBrandFilterInput('');
    setEditOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      updateProduct(companyId, productId, {
        name,
        code: code.trim() ? code.trim() : null,
        description: description.trim() ? description.trim() : null,
        brandId: formBrandId ? formBrandId : null,
        categoryId: formCategoryId ? formCategoryId : null,
      }),
    onSuccess: async () => {
      toast.success('محصول به‌روز شد.');
      setEditOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const deactivateMutation = useMutation({
    mutationFn: () => deactivateProduct(companyId, productId),
    onSuccess: async () => {
      toast.success('محصول غیرفعال شد.');
      setConfirm(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const activateMutation = useMutation({
    mutationFn: () => activateProduct(companyId, productId),
    onSuccess: async () => {
      toast.success('محصول فعال شد.');
      setConfirm(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveProduct(companyId, productId),
    onSuccess: async () => {
      toast.success('محصول بایگانی شد.');
      setConfirm(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.CATALOG_READ)) {
    return <AccessDenied />;
  }

  if (productQuery.isLoading) {
    return <PageSkeleton />;
  }

  if (productQuery.error) {
    if (isApiClientError(productQuery.error) && productQuery.error.status === 403) {
      return <AccessDenied />;
    }
    if (isApiClientError(productQuery.error) && productQuery.error.status === 404) {
      return (
        <div className="space-y-4">
          <ErrorState
            title="محصول پیدا نشد"
            message="این محصول در شرکت فعال وجود ندارد یا حذف شده است."
          />
          <Button variant="outline" onClick={() => router.replace(ROUTES.catalogProducts)}>
            بازگشت به فهرست محصولات
          </Button>
        </div>
      );
    }
    return (
      <ErrorState
        message={isApiClientError(productQuery.error) ? productQuery.error.message : undefined}
        requestId={isApiClientError(productQuery.error) ? productQuery.error.requestId : undefined}
        onRetry={() => void productQuery.refetch()}
      />
    );
  }

  const product = productQuery.data!;
  const lifecycleLoading =
    deactivateMutation.isPending || activateMutation.isPending || archiveMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title={product.name}
        description={product.code ? `کد: ${product.code}` : undefined}
        breadcrumbs={[
          { label: 'کاتالوگ', href: ROUTES.catalog },
          { label: 'محصولات', href: ROUTES.catalogProducts },
          { label: product.name },
        ]}
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={openEdit}>
                ویرایش
              </Button>
              {product.status === 'ACTIVE' ? (
                <Button type="button" variant="outline" onClick={() => setConfirm('deactivate')}>
                  غیرفعال کردن
                </Button>
              ) : null}
              {product.status === 'INACTIVE' || product.status === 'ARCHIVED' ? (
                <Button type="button" variant="outline" onClick={() => setConfirm('activate')}>
                  فعال‌سازی
                </Button>
              ) : null}
              {product.status !== 'ARCHIVED' ? (
                <Button type="button" variant="outline" onClick={() => setConfirm('archive')}>
                  بایگانی
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <Field label="نام">{product.name}</Field>
        <Field label="کد داخلی">{product.code ?? '—'}</Field>
        <Field label="وضعیت">
          <Badge>{statusLabel(product.status)}</Badge>
        </Field>
        <Field label="برند">{product.brand?.name ?? '—'}</Field>
        <Field label="دسته‌بندی">
          {product.categoryPath ?? product.category?.name ?? '—'}
        </Field>
        <Field label="ایجاد">{formatDateTime(product.createdAt)}</Field>
        <Field label="به‌روزرسانی">{formatDateTime(product.updatedAt)}</Field>
        <Field label="تعداد SKU">
          <span className="tabular-nums">{product.skuCount ?? 0}</span>
          {typeof product.activeSkuCount === 'number' ? (
            <span className="ms-2 text-xs text-slate-500">
              ({product.activeSkuCount} فعال)
            </span>
          ) : null}
          <div className="mt-2">
            <Link
              href={catalogProductSkusPath(product.id)}
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              مشاهده SKUها
            </Link>
          </div>
        </Field>
        <div className="sm:col-span-2">
          <Field label="توضیحات">
            {product.description?.trim() ? product.description : '—'}
          </Field>
        </div>
      </div>

      <EntityAttributesSection
        entity="product"
        entityId={productId}
        categoryId={product.categoryId}
        sectionTitle="مشخصات محصول"
        editDialogTitle="ویرایش مشخصات محصول"
        canManage={canManage}
      />

      <ProductVariantsPanel productId={productId} canManage={canManage} />

      <ProductSkusPanel
        productId={productId}
        productCode={product.code}
        productName={product.name}
        productStatus={product.status}
        canManage={canManage}
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">تاریخچه</h2>
        <EntityHistory entityType="PRODUCT" entityId={productId} />
      </section>

      <Link
        href={ROUTES.catalogProducts}
        className="inline-flex text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        ← بازگشت به فهرست محصولات
      </Link>

      <Dialog open={editOpen} onOpenChange={setEditOpen} title="ویرایش محصول">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="detail-product-name">نام محصول</Label>
            <Input
              id="detail-product-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={200}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="detail-product-code">کد داخلی</Label>
            <Input
              id="detail-product-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={64}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="detail-product-brand">برند</Label>
            <Input
              value={brandFilterInput}
              onChange={(event) => setBrandFilterInput(event.target.value)}
              placeholder="جستجوی برند..."
              className="mb-2"
            />
            <select
              id="detail-product-brand"
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
            <Label htmlFor="detail-product-category">دسته‌بندی</Label>
            <select
              id="detail-product-category"
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
            <Label htmlFor="detail-product-description">توضیحات</Label>
            <textarea
              id="detail-product-description"
              className="flex min-h-[88px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={4000}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
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
          confirm === 'archive'
            ? 'بایگانی محصول'
            : confirm === 'deactivate'
              ? 'غیرفعال کردن محصول'
              : 'فعال‌سازی محصول'
        }
        description={
          confirm === 'archive'
            ? 'محصول حذف نمی‌شود و سوابق آن حفظ خواهد شد.'
            : confirm === 'deactivate'
              ? 'محصول از فهرست‌های عملیاتی حذف می‌شود اما حذف دائمی نمی‌شود و می‌توانید دوباره فعالش کنید.'
              : 'محصول دوباره فعال می‌شود و در صورت داشتن برند و دسته‌بندی معتبر، قابل استفاده خواهد بود.'
        }
        target={product.name}
        confirmLabel={
          confirm === 'archive'
            ? 'بایگانی'
            : confirm === 'deactivate'
              ? 'غیرفعال کردن'
              : 'فعال‌سازی'
        }
        danger={confirm === 'archive'}
        loading={lifecycleLoading}
        onConfirm={() => {
          if (confirm === 'archive') {
            archiveMutation.mutate();
          } else if (confirm === 'deactivate') {
            deactivateMutation.mutate();
          } else if (confirm === 'activate') {
            activateMutation.mutate();
          }
        }}
      />
    </div>
  );
}
