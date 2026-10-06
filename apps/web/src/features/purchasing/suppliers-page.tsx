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
  activateSupplier,
  archiveSupplier,
  createSupplier,
  deactivateSupplier,
  fetchSuppliers,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { supplierKeys } from '@/lib/query/keys';
import { ROUTES, purchasingSupplierPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { SupplierListItem } from '@/types/purchasing';

const textareaClassName =
  'flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm';

function statusLabel(status: string): string {
  if (status === 'ACTIVE') return 'فعال';
  if (status === 'INACTIVE') return 'غیرفعال';
  if (status === 'ARCHIVED') return 'بایگانی';
  return status;
}

type ConfirmState =
  | { type: 'deactivate' | 'activate' | 'archive'; supplier: SupplierListItem }
  | null;

export function SuppliersPageClient() {
  const router = useRouter();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? '';
  const canCreate = can(PERMISSIONS.PURCHASING_CREATE);
  const canManage = can(PERMISSIONS.PURCHASING_MANAGE);

  const [page, setPage] = React.useState(1);
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [formOpen, setFormOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [legalName, setLegalName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [confirm, setConfirm] = React.useState<ConfirmState>(null);

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

  const suppliersQuery = useQuery({
    queryKey: supplierKeys.list(companyId, filters),
    enabled: Boolean(companyId) && can(PERMISSIONS.PURCHASING_READ),
    queryFn: () => fetchSuppliers(companyId, filters),
  });

  React.useEffect(() => {
    if (
      suppliersQuery.error &&
      isApiClientError(suppliersQuery.error) &&
      suppliersQuery.error.status === 401
    ) {
      handleUnauthorized();
    }
  }, [suppliersQuery.error, handleUnauthorized]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: supplierKeys.all(companyId) });
  };

  const resetForm = () => {
    setName('');
    setLegalName('');
    setCode('');
    setPhone('');
    setEmail('');
    setAddress('');
  };

  const openCreate = () => {
    resetForm();
    setFormOpen(true);
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createSupplier(companyId, {
        name: name.trim(),
        ...(legalName.trim() ? { legalName: legalName.trim() } : {}),
        ...(code.trim() ? { code: code.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(address.trim() ? { address: address.trim() } : {}),
      }),
    onSuccess: async (created) => {
      toast.success('تأمین‌کننده ایجاد شد.');
      setFormOpen(false);
      await invalidate();
      router.push(purchasingSupplierPath(created.id));
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const deactivateMutation = useMutation({
    mutationFn: (supplierId: string) => deactivateSupplier(companyId, supplierId),
    onSuccess: async () => {
      toast.success('تأمین‌کننده غیرفعال شد.');
      setConfirm(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const activateMutation = useMutation({
    mutationFn: (supplierId: string) => activateSupplier(companyId, supplierId),
    onSuccess: async () => {
      toast.success('تأمین‌کننده فعال شد.');
      setConfirm(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const archiveMutation = useMutation({
    mutationFn: (supplierId: string) => archiveSupplier(companyId, supplierId),
    onSuccess: async () => {
      toast.success('تأمین‌کننده بایگانی شد.');
      setConfirm(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.PURCHASING_READ)) {
    return <AccessDenied />;
  }

  const rows = suppliersQuery.data?.data ?? [];
  const meta = suppliersQuery.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;
  const lifecycleLoading =
    deactivateMutation.isPending || activateMutation.isPending || archiveMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="تأمین‌کنندگان"
        description="مدیریت تأمین‌کنندگان و مخاطبین شرکت فعال"
        breadcrumbs={[
          { label: 'خرید', href: ROUTES.purchasing },
          { label: 'تأمین‌کنندگان' },
        ]}
        actions={
          canCreate ? (
            <Button type="button" onClick={openCreate}>
              تأمین‌کننده جدید
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <Label htmlFor="supplier-search">جستجو</Label>
          <Input
            id="supplier-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="نام، کد، تلفن یا مخاطب"
          />
        </div>
        <div className="w-full space-y-1 sm:w-48">
          <Label htmlFor="supplier-status">وضعیت</Label>
          <select
            id="supplier-status"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">همه (غیر بایگانی)</option>
            <option value="ACTIVE">فعال</option>
            <option value="INACTIVE">غیرفعال</option>
            <option value="ARCHIVED">بایگانی</option>
          </select>
        </div>
      </div>

      {suppliersQuery.isLoading ? <TableSkeleton rows={6} /> : null}
      {suppliersQuery.isError ? (
        <ErrorState
          title="خطا در دریافت تأمین‌کنندگان"
          message={mapBusinessError(suppliersQuery.error)}
          onRetry={() => void suppliersQuery.refetch()}
        />
      ) : null}

      {!suppliersQuery.isLoading && !suppliersQuery.isError && rows.length === 0 ? (
        <EmptyState
          title="تأمین‌کننده‌ای ثبت نشده است"
          description="اولین تأمین‌کننده را برای شرکت فعال ایجاد کنید."
          action={
            canCreate ? (
              <Button type="button" onClick={openCreate}>
                ایجاد اولین تأمین‌کننده
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
                <th className="px-4 py-3 font-medium">کد</th>
                <th className="px-4 py-3 font-medium">مخاطب اصلی</th>
                <th className="px-4 py-3 font-medium">وضعیت</th>
                <th className="px-4 py-3 font-medium">به‌روزرسانی</th>
                {canManage ? <th className="px-4 py-3 font-medium">عملیات</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((supplier) => (
                <tr
                  key={supplier.id}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  onClick={() => router.push(purchasingSupplierPath(supplier.id))}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={purchasingSupplierPath(supplier.id)}
                      className="font-medium text-slate-900 hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {supplier.name}
                    </Link>
                    {supplier.legalName ? (
                      <div className="mt-0.5 text-xs text-slate-500">{supplier.legalName}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600" dir="ltr">
                    {supplier.code ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {supplier.primaryContact ? (
                      <span>
                        {supplier.primaryContact.name}
                        {supplier.primaryContact.mobile || supplier.primaryContact.phone ? (
                          <span className="mt-0.5 block text-xs text-slate-500" dir="ltr">
                            {supplier.primaryContact.mobile ?? supplier.primaryContact.phone}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge>{statusLabel(supplier.status)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatDateTime(supplier.updatedAt)}
                  </td>
                  {canManage ? (
                    <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                      <RowActionsMenu
                        actions={[
                          {
                            label: 'مشاهده جزئیات',
                            onSelect: () => router.push(purchasingSupplierPath(supplier.id)),
                          },
                          ...(supplier.status === 'ACTIVE'
                            ? [
                                {
                                  label: 'غیرفعال کردن',
                                  onSelect: () =>
                                    setConfirm({ type: 'deactivate', supplier }),
                                },
                              ]
                            : []),
                          ...(supplier.status === 'INACTIVE' || supplier.status === 'ARCHIVED'
                            ? [
                                {
                                  label: 'فعال‌سازی',
                                  onSelect: () =>
                                    setConfirm({ type: 'activate', supplier }),
                                },
                              ]
                            : []),
                          ...(supplier.status !== 'ARCHIVED'
                            ? [
                                {
                                  label: 'بایگانی',
                                  onSelect: () => setConfirm({ type: 'archive', supplier }),
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

      <Dialog open={formOpen} onOpenChange={setFormOpen} title="تأمین‌کننده جدید">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="supplier-name">نام</Label>
            <Input
              id="supplier-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={200}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="supplier-legal-name">نام حقوقی (اختیاری)</Label>
            <Input
              id="supplier-legal-name"
              value={legalName}
              onChange={(event) => setLegalName(event.target.value)}
              maxLength={200}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="supplier-code">کد (اختیاری)</Label>
            <Input
              id="supplier-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={64}
              dir="ltr"
              className="text-left"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="supplier-phone">تلفن (اختیاری)</Label>
              <Input
                id="supplier-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                maxLength={64}
                dir="ltr"
                className="text-left"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="supplier-email">ایمیل (اختیاری)</Label>
              <Input
                id="supplier-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={254}
                dir="ltr"
                className="text-left"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="supplier-address">آدرس (اختیاری)</Label>
            <textarea
              id="supplier-address"
              className={textareaClassName}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              maxLength={500}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              انصراف
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !name.trim()}>
              {createMutation.isPending ? 'در حال ذخیره...' : 'ذخیره'}
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
            ? 'بایگانی تأمین‌کننده'
            : confirm?.type === 'deactivate'
              ? 'غیرفعال کردن تأمین‌کننده'
              : 'فعال‌سازی تأمین‌کننده'
        }
        description={
          confirm?.type === 'archive'
            ? 'تأمین‌کننده حذف نمی‌شود و سوابق آن حفظ خواهد شد.'
            : confirm?.type === 'deactivate'
              ? 'تأمین‌کننده در فهرست‌های فعال نمایش داده نمی‌شود تا دوباره فعال شود.'
              : 'تأمین‌کننده دوباره در فهرست فعال در دسترس قرار می‌گیرد.'
        }
        target={confirm?.supplier.name}
        confirmLabel={
          confirm?.type === 'archive'
            ? 'بایگانی'
            : confirm?.type === 'deactivate'
              ? 'غیرفعال کردن'
              : 'فعال‌سازی'
        }
        danger={confirm?.type === 'archive' || confirm?.type === 'deactivate'}
        loading={lifecycleLoading}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.type === 'archive') {
            archiveMutation.mutate(confirm.supplier.id);
          } else if (confirm.type === 'deactivate') {
            deactivateMutation.mutate(confirm.supplier.id);
          } else {
            activateMutation.mutate(confirm.supplier.id);
          }
        }}
      />
    </div>
  );
}
