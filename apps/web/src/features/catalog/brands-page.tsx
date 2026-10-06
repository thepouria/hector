'use client';

import * as React from 'react';
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
  activateBrand,
  archiveBrand,
  createBrand,
  fetchBrands,
  updateBrand,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { brandKeys } from '@/lib/query/keys';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { Brand } from '@/types/catalog';

function statusLabel(status: string): string {
  if (status === 'ACTIVE') return 'فعال';
  if (status === 'INACTIVE') return 'غیرفعال';
  if (status === 'ARCHIVED') return 'بایگانی';
  return status;
}

export function BrandsPageClient() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.CATALOG_MANAGE);

  const [page, setPage] = React.useState(1);
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Brand | null>(null);
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [confirm, setConfirm] = React.useState<
    { type: 'archive' | 'activate'; brand: Brand } | null
  >(null);

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
    status: status || undefined,
    sortBy: 'name',
    sortOrder: 'asc',
  };

  const brandsQuery = useQuery({
    queryKey: brandKeys.list(companyId, filters),
    enabled: Boolean(companyId) && can(PERMISSIONS.CATALOG_READ),
    queryFn: () => fetchBrands(companyId, filters),
  });

  React.useEffect(() => {
    if (
      brandsQuery.error &&
      isApiClientError(brandsQuery.error) &&
      brandsQuery.error.status === 401
    ) {
      handleUnauthorized();
    }
  }, [brandsQuery.error, handleUnauthorized]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: brandKeys.all(companyId) });
  };

  const openCreate = () => {
    setEditing(null);
    setName('');
    setCode('');
    setFormOpen(true);
  };

  const openEdit = (brand: Brand) => {
    setEditing(brand);
    setName(brand.name);
    setCode(brand.code ?? '');
    setFormOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing) {
        return updateBrand(companyId, editing.id, {
          name,
          code: code.trim() ? code.trim() : null,
        });
      }
      return createBrand(companyId, {
        name,
        ...(code.trim() ? { code: code.trim() } : {}),
      });
    },
    onSuccess: async () => {
      toast.success(editing ? 'برند به‌روز شد.' : 'برند ایجاد شد.');
      setFormOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const archiveMutation = useMutation({
    mutationFn: (brandId: string) => archiveBrand(companyId, brandId),
    onSuccess: async () => {
      toast.success('برند بایگانی شد.');
      setConfirm(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const activateMutation = useMutation({
    mutationFn: (brandId: string) => activateBrand(companyId, brandId),
    onSuccess: async () => {
      toast.success('برند فعال شد.');
      setConfirm(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.CATALOG_READ)) {
    return <AccessDenied />;
  }

  const rows = brandsQuery.data?.data ?? [];
  const meta = brandsQuery.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="برندها"
        description="مدیریت برندهای تجاری کاتالوگ شرکت فعال"
        breadcrumbs={[{ label: 'کاتالوگ', href: ROUTES.catalog }, { label: 'برندها' }]}
        actions={
          canManage ? (
            <Button type="button" onClick={openCreate}>
              برند جدید
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <Label htmlFor="brand-search">جستجو</Label>
          <Input
            id="brand-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="نام یا کد برند"
          />
        </div>
        <div className="w-full space-y-1 sm:w-48">
          <Label htmlFor="brand-status">وضعیت</Label>
          <select
            id="brand-status"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">همه</option>
            <option value="ACTIVE">فعال</option>
            <option value="INACTIVE">غیرفعال</option>
            <option value="ARCHIVED">بایگانی</option>
          </select>
        </div>
      </div>

      {brandsQuery.isLoading ? <TableSkeleton rows={6} /> : null}
      {brandsQuery.isError ? (
        <ErrorState
          title="خطا در دریافت برندها"
          message={mapBusinessError(brandsQuery.error)}
        />
      ) : null}

      {!brandsQuery.isLoading && !brandsQuery.isError && rows.length === 0 ? (
        <EmptyState
          title="برندی ثبت نشده است"
          description="اولین برند کاتالوگ را ایجاد کنید."
          action={
            canManage ? (
              <Button type="button" onClick={openCreate}>
                ایجاد اولین برند
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
                <th className="px-4 py-3 font-medium">برند</th>
                <th className="px-4 py-3 font-medium">کد</th>
                <th className="px-4 py-3 font-medium">وضعیت</th>
                <th className="px-4 py-3 font-medium">به‌روزرسانی</th>
                {canManage ? <th className="px-4 py-3 font-medium">عملیات</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((brand) => (
                <tr key={brand.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">{brand.name}</td>
                  <td className="px-4 py-3 text-slate-600">{brand.code ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge>{statusLabel(brand.status)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatDateTime(brand.updatedAt)}
                  </td>
                  {canManage ? (
                    <td className="px-4 py-3">
                      <RowActionsMenu
                        actions={[
                          {
                            label: 'ویرایش',
                            onSelect: () => openEdit(brand),
                          },
                          brand.status === 'ARCHIVED'
                            ? {
                                label: 'فعال‌سازی',
                                onSelect: () => setConfirm({ type: 'activate', brand }),
                              }
                            : {
                                label: 'بایگانی',
                                onSelect: () => setConfirm({ type: 'archive', brand }),
                                danger: true,
                              },
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

      {meta && meta.total > meta.pageSize ? (
        <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
          <span>
            صفحه {page} از {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              قبلی
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              بعدی
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? 'ویرایش برند' : 'برند جدید'}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="brand-name">نام</Label>
            <Input
              id="brand-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="brand-code">کد (اختیاری)</Label>
            <Input
              id="brand-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={64}
            />
          </div>
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
        title={confirm?.type === 'archive' ? 'بایگانی برند' : 'فعال‌سازی برند'}
        description={
          confirm?.type === 'archive'
            ? 'برند حذف نمی‌شود و سوابق آن حفظ خواهد شد.'
            : 'برند دوباره برای انتخاب در محصولات جدید در دسترس قرار می‌گیرد.'
        }
        target={confirm?.brand.name}
        confirmLabel={confirm?.type === 'archive' ? 'بایگانی' : 'فعال‌سازی'}
        danger={confirm?.type === 'archive'}
        loading={archiveMutation.isPending || activateMutation.isPending}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.type === 'archive') {
            archiveMutation.mutate(confirm.brand.id);
          } else {
            activateMutation.mutate(confirm.brand.id);
          }
        }}
      />
    </div>
  );
}
