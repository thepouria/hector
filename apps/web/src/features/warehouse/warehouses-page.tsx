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
  activateWarehouse,
  createWarehouse,
  deactivateWarehouse,
  fetchWarehouses,
  setDefaultWarehouse,
  updateWarehouse,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { warehouseLocationsPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { Warehouse } from '@/types/warehouse';
import { useRouter } from 'next/navigation';

const textareaClassName =
  'flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm';

function statusLabel(status: string): string {
  if (status === 'ACTIVE') return 'فعال';
  if (status === 'INACTIVE') return 'غیرفعال';
  return status;
}

type ConfirmState =
  | { type: 'activate' | 'set-default'; warehouse: Warehouse }
  | { type: 'deactivate'; warehouse: Warehouse }
  | null;

type FormMode = { mode: 'create' } | { mode: 'edit'; warehouse: Warehouse } | null;

export function WarehousesPageClient() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.WAREHOUSE_MANAGE);

  const [page, setPage] = React.useState(1);
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [form, setForm] = React.useState<FormMode>(null);
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [makeDefault, setMakeDefault] = React.useState(false);
  const [confirm, setConfirm] = React.useState<ConfirmState>(null);
  const [replacementId, setReplacementId] = React.useState('');

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

  const warehousesQuery = useQuery({
    queryKey: warehouseKeys.list(companyId, filters),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_READ),
    queryFn: () => fetchWarehouses(companyId, filters),
  });

  React.useEffect(() => {
    if (
      warehousesQuery.error &&
      isApiClientError(warehousesQuery.error) &&
      warehousesQuery.error.status === 401
    ) {
      handleUnauthorized();
    }
  }, [warehousesQuery.error, handleUnauthorized]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: warehouseKeys.all(companyId) });
  };

  const openCreate = () => {
    setCode('');
    setName('');
    setAddress('');
    setNotes('');
    setMakeDefault(false);
    setForm({ mode: 'create' });
  };

  const openEdit = (warehouse: Warehouse) => {
    setCode(warehouse.code);
    setName(warehouse.name);
    setAddress(warehouse.address ?? '');
    setNotes(warehouse.notes ?? '');
    setMakeDefault(false);
    setForm({ mode: 'edit', warehouse });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form) throw new Error('no form');
      if (form.mode === 'create') {
        return createWarehouse(companyId, {
          code: code.trim(),
          name: name.trim(),
          address: address.trim() || undefined,
          notes: notes.trim() || undefined,
          isDefault: makeDefault || undefined,
        });
      }
      return updateWarehouse(companyId, form.warehouse.id, {
        code: code.trim(),
        name: name.trim(),
        address: address.trim() ? address.trim() : null,
        notes: notes.trim() ? notes.trim() : null,
      });
    },
    onSuccess: async () => {
      toast.success(form?.mode === 'create' ? 'انبار ایجاد شد.' : 'انبار به‌روزرسانی شد.');
      setForm(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!confirm) throw new Error('no confirm');
      if (confirm.type === 'activate') {
        return activateWarehouse(companyId, confirm.warehouse.id);
      }
      if (confirm.type === 'set-default') {
        return setDefaultWarehouse(companyId, confirm.warehouse.id);
      }
      const activeOthers = (warehousesQuery.data?.data ?? []).filter(
        (w) => w.status === 'ACTIVE' && w.id !== confirm.warehouse.id,
      );
      return deactivateWarehouse(companyId, confirm.warehouse.id, {
        replacementWarehouseId:
          confirm.warehouse.isDefault && activeOthers.length > 0
            ? replacementId || undefined
            : undefined,
      });
    },
    onSuccess: async () => {
      toast.success('عملیات با موفقیت انجام شد.');
      setConfirm(null);
      setReplacementId('');
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.WAREHOUSE_READ)) {
    return <AccessDenied />;
  }

  const rows = warehousesQuery.data?.data ?? [];
  const meta = warehousesQuery.data?.meta;
  const activeOthersForConfirm =
    confirm?.type === 'deactivate' && confirm.warehouse.isDefault
      ? rows.filter((w) => w.status === 'ACTIVE' && w.id !== confirm.warehouse.id)
      : [];
  const needsReplacement = activeOthersForConfirm.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="انبارها"
        description="مدیریت انبارهای شرکت. موجودی و رسید کالا در مراحل بعدی اضافه می‌شود."
        actions={
          canManage ? (
            <Button type="button" onClick={openCreate}>
              انبار جدید
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1 space-y-1">
          <Label htmlFor="wh-search">جستجو</Label>
          <Input
            id="wh-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="کد، نام یا آدرس"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="wh-status">وضعیت</Label>
          <select
            id="wh-status"
            className="flex h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">همه</option>
            <option value="ACTIVE">فعال</option>
            <option value="INACTIVE">غیرفعال</option>
          </select>
        </div>
      </div>

      {warehousesQuery.isLoading ? <TableSkeleton rows={6} /> : null}
      {warehousesQuery.isError ? (
        <ErrorState message={mapBusinessError(warehousesQuery.error)} />
      ) : null}

      {!warehousesQuery.isLoading && !warehousesQuery.isError && rows.length === 0 ? (
        <EmptyState
          title="هنوز انباری تعریف نشده است."
          description="اولین انبار را ایجاد کنید. اولین انبار به‌صورت پیش‌فرض انتخاب می‌شود."
          action={
            canManage ? (
              <Button type="button" onClick={openCreate}>
                ایجاد اولین انبار
              </Button>
            ) : null
          }
        />
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">کد</th>
                <th className="px-3 py-2 text-start font-medium">نام</th>
                <th className="px-3 py-2 text-start font-medium">وضعیت</th>
                <th className="px-3 py-2 text-start font-medium">پیش‌فرض</th>
                <th className="px-3 py-2 text-start font-medium">آدرس</th>
                <th className="px-3 py-2 text-start font-medium">به‌روزرسانی</th>
                <th className="px-3 py-2 text-start font-medium">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((warehouse) => (
                <tr key={warehouse.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                    {warehouse.code}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-start text-slate-900 underline-offset-2 hover:underline"
                      onClick={() => router.push(warehouseLocationsPath(warehouse.id))}
                    >
                      {warehouse.name}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      className={
                        warehouse.status === 'ACTIVE'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : 'border-slate-200 bg-slate-50 text-slate-600'
                      }
                    >
                      {statusLabel(warehouse.status)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    {warehouse.isDefault ? (
                      <Badge className="border-sky-200 bg-sky-50 text-sky-800">پیش‌فرض</Badge>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2 text-slate-600">
                    {warehouse.address || '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-500" dir="ltr">
                    {formatDateTime(warehouse.updatedAt)}
                  </td>
                  <td className="px-3 py-2">
                    <RowActionsMenu
                      actions={[
                        {
                          label: 'مکان‌ها',
                          onSelect: () => {
                            router.push(warehouseLocationsPath(warehouse.id));
                          },
                        },
                        ...(canManage
                          ? [
                              { label: 'ویرایش', onSelect: () => openEdit(warehouse) },
                              ...(warehouse.status === 'ACTIVE' && !warehouse.isDefault
                                ? [
                                    {
                                      label: 'تنظیم به‌عنوان پیش‌فرض',
                                      onSelect: () =>
                                        setConfirm({ type: 'set-default', warehouse }),
                                    },
                                  ]
                                : []),
                              ...(warehouse.status === 'ACTIVE'
                                ? [
                                    {
                                      label: 'غیرفعال‌سازی',
                                      onSelect: () => {
                                        setReplacementId('');
                                        setConfirm({ type: 'deactivate', warehouse });
                                      },
                                      danger: true,
                                    },
                                  ]
                                : [
                                    {
                                      label: 'فعال‌سازی',
                                      onSelect: () =>
                                        setConfirm({ type: 'activate', warehouse }),
                                    },
                                  ]),
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

      {meta && meta.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3 text-sm">
          <Button
            type="button"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            قبلی
          </Button>
          <span>
            صفحه {meta.page} از {meta.totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={page >= meta.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            بعدی
          </Button>
        </div>
      ) : null}

      <Dialog
        open={Boolean(form)}
        onOpenChange={(open) => {
          if (!open) setForm(null);
        }}
        title={form?.mode === 'edit' ? 'ویرایش انبار' : 'انبار جدید'}
        description={
          form?.mode === 'create'
            ? 'اولین انبار فعال شرکت به‌صورت خودکار پیش‌فرض می‌شود.'
            : 'کد و نام را ویرایش کنید. وضعیت و پیش‌فرض از منوی عملیات تغییر می‌کند.'
        }
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="wh-code">کد *</Label>
            <Input
              id="wh-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              dir="ltr"
              placeholder="MAIN"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wh-name">نام *</Label>
            <Input
              id="wh-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="انبار اصلی"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wh-address">آدرس</Label>
            <Input
              id="wh-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wh-notes">یادداشت</Label>
            <textarea
              id="wh-notes"
              className={textareaClassName}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {form?.mode === 'create' ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={makeDefault}
                onChange={(e) => setMakeDefault(e.target.checked)}
              />
              به‌عنوان انبار پیش‌فرض تنظیم شود
            </label>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setForm(null)}>
              انصراف
            </Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              ذخیره
            </Button>
          </div>
        </form>
      </Dialog>

      {needsReplacement ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setConfirm(null);
              setReplacementId('');
            }
          }}
          title="غیرفعال‌سازی انبار پیش‌فرض"
          description={`انبار «${confirm?.warehouse.name}» پیش‌فرض است. یک انبار فعال دیگر را به‌عنوان پیش‌فرض انتخاب کنید.`}
        >
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="wh-replacement">انبار پیش‌فرض جایگزین *</Label>
              <select
                id="wh-replacement"
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={replacementId}
                onChange={(e) => setReplacementId(e.target.value)}
              >
                <option value="">انتخاب کنید</option>
                {activeOthersForConfirm.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={actionMutation.isPending}
                onClick={() => {
                  setConfirm(null);
                  setReplacementId('');
                }}
              >
                انصراف
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={!replacementId || actionMutation.isPending}
                onClick={() => actionMutation.mutate()}
              >
                {actionMutation.isPending ? 'در حال انجام...' : 'تأیید و غیرفعال‌سازی'}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : (
        <ConfirmDialog
          open={Boolean(confirm)}
          onOpenChange={(open) => {
            if (!open) {
              setConfirm(null);
              setReplacementId('');
            }
          }}
          title={
            confirm?.type === 'set-default'
              ? 'تغییر انبار پیش‌فرض'
              : confirm?.type === 'activate'
                ? 'فعال‌سازی انبار'
                : 'غیرفعال‌سازی انبار'
          }
          description={
            confirm?.type === 'set-default'
              ? `انبار «${confirm.warehouse.name}» به‌عنوان پیش‌فرض جایگزین می‌شود.`
              : confirm?.type === 'activate'
                ? `انبار «${confirm?.warehouse.name}» فعال شود؟`
                : `انبار «${confirm?.warehouse.name}» غیرفعال شود؟ تاریخچه حفظ می‌شود.`
          }
          confirmLabel="تأیید"
          danger={confirm?.type === 'deactivate'}
          onConfirm={() => actionMutation.mutate()}
          loading={actionMutation.isPending}
        />
      )}
    </div>
  );
}
