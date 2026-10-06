'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft, Copy } from 'lucide-react';
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
  activateWarehouseLocation,
  createWarehouseLocation,
  deactivateWarehouseLocation,
  fetchWarehouse,
  fetchWarehouseLocations,
  updateWarehouseLocation,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { WarehouseLocation, WarehouseLocationType } from '@/types/warehouse-location';

const LOCATION_TYPES: WarehouseLocationType[] = ['ZONE', 'AISLE', 'RACK', 'SHELF', 'BIN'];

const typeLabel: Record<WarehouseLocationType, string> = {
  ZONE: 'زون',
  AISLE: 'راهرو',
  RACK: 'قفسه فلزی',
  SHELF: 'قفسه',
  BIN: 'بین',
};

function statusLabel(status: string): string {
  if (status === 'ACTIVE') return 'فعال';
  if (status === 'INACTIVE') return 'غیرفعال';
  return status;
}

type FormMode =
  | { mode: 'create'; parentId: string | null }
  | { mode: 'edit'; location: WarehouseLocation }
  | null;

export function WarehouseLocationsPageClient({ warehouseId }: { warehouseId: string }) {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.WAREHOUSE_MANAGE);

  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [form, setForm] = React.useState<FormMode>(null);
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [type, setType] = React.useState<WarehouseLocationType>('SHELF');
  const [parentId, setParentId] = React.useState<string>('');
  const [confirm, setConfirm] = React.useState<{
    type: 'activate' | 'deactivate';
    location: WarehouseLocation;
  } | null>(null);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const filters = {
    view: 'tree',
    search: search || undefined,
    type: typeFilter || undefined,
    status: statusFilter || undefined,
  };

  const warehouseQuery = useQuery({
    queryKey: warehouseKeys.detail(companyId, warehouseId),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_READ),
    queryFn: () => fetchWarehouse(companyId, warehouseId),
  });

  const locationsQuery = useQuery({
    queryKey: warehouseKeys.locations(companyId, warehouseId, filters),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_READ),
    queryFn: () => fetchWarehouseLocations(companyId, warehouseId, filters),
  });

  React.useEffect(() => {
    const err = warehouseQuery.error ?? locationsQuery.error;
    if (err && isApiClientError(err) && err.status === 401) {
      handleUnauthorized();
    }
  }, [warehouseQuery.error, locationsQuery.error, handleUnauthorized]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: warehouseKeys.locations(companyId, warehouseId),
    });
  };

  const flatOptions = React.useMemo(() => {
    const out: WarehouseLocation[] = [];
    const walk = (nodes: WarehouseLocation[]) => {
      for (const n of nodes) {
        out.push(n);
        if (n.children?.length) walk(n.children);
      }
    };
    walk(locationsQuery.data?.data ?? []);
    return out;
  }, [locationsQuery.data?.data]);

  const openCreate = (parent: string | null) => {
    setCode('');
    setName('');
    setNotes('');
    setType('SHELF');
    setParentId(parent ?? '');
    setForm({ mode: 'create', parentId: parent });
  };

  const openEdit = (location: WarehouseLocation) => {
    setCode(location.code);
    setName(location.name ?? '');
    setNotes(location.notes ?? '');
    setType(location.type);
    setParentId(location.parentId ?? '');
    setForm({ mode: 'edit', location });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form) throw new Error('no form');
      if (form.mode === 'create') {
        return createWarehouseLocation(companyId, warehouseId, {
          parentId: parentId || null,
          type,
          code: code.trim(),
          name: name.trim() || undefined,
          notes: notes.trim() || undefined,
        });
      }
      return updateWarehouseLocation(companyId, warehouseId, form.location.id, {
        parentId: parentId || null,
        type,
        code: code.trim(),
        name: name.trim() ? name.trim() : null,
        notes: notes.trim() ? notes.trim() : null,
      });
    },
    onSuccess: async () => {
      toast.success(form?.mode === 'create' ? 'مکان ایجاد شد.' : 'مکان به‌روزرسانی شد.');
      setForm(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!confirm) throw new Error('no confirm');
      if (confirm.type === 'activate') {
        return activateWarehouseLocation(companyId, warehouseId, confirm.location.id);
      }
      return deactivateWarehouseLocation(companyId, warehouseId, confirm.location.id);
    },
    onSuccess: async () => {
      toast.success('عملیات با موفقیت انجام شد.');
      setConfirm(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.WAREHOUSE_READ)) {
    return <AccessDenied />;
  }

  const tree = locationsQuery.data?.data ?? [];

  const renderNode = (node: WarehouseLocation, depth: number): React.ReactNode => {
    const hasChildren = Boolean(node.children?.length);
    const isOpen = expanded[node.id] ?? depth < 2;
    return (
      <div key={node.id} className="border-t border-slate-100">
        <div
          className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
          style={{ paddingInlineStart: `${12 + depth * 20}px` }}
        >
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
            onClick={() => setExpanded((prev) => ({ ...prev, [node.id]: !isOpen }))}
            aria-label={isOpen ? 'جمع کردن' : 'باز کردن'}
            disabled={!hasChildren}
          >
            {hasChildren ? (
              isOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )
            ) : (
              <span className="h-4 w-4" />
            )}
          </button>
          <span className="font-mono text-xs" dir="ltr">
            {node.code}
          </span>
          <span>{node.name || '—'}</span>
          <Badge>{typeLabel[node.type]}</Badge>
          <Badge
            className={
              node.status === 'ACTIVE'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : undefined
            }
          >
            {statusLabel(node.status)}
          </Badge>
          <button
            type="button"
            className="inline-flex items-center gap-1 font-mono text-xs text-slate-600"
            dir="ltr"
            onClick={async () => {
              await navigator.clipboard.writeText(node.barcode);
              toast.success('بارکد کپی شد.');
            }}
          >
            <Copy className="h-3 w-3" />
            {node.barcode}
          </button>
          {canManage ? (
            <div className="ms-auto">
              <RowActionsMenu
                actions={[
                  { label: 'ویرایش / جابجایی', onSelect: () => openEdit(node) },
                  { label: 'افزودن زیرمجموعه', onSelect: () => openCreate(node.id) },
                  ...(node.status === 'ACTIVE'
                    ? [
                        {
                          label: 'غیرفعال‌سازی',
                          onSelect: () => setConfirm({ type: 'deactivate', location: node }),
                          danger: true,
                        },
                      ]
                    : [
                        {
                          label: 'فعال‌سازی',
                          onSelect: () => setConfirm({ type: 'activate', location: node }),
                        },
                      ]),
                ]}
              />
            </div>
          ) : null}
        </div>
        {hasChildren && isOpen
          ? node.children!.map((child) => renderNode(child, depth + 1))
          : null}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={warehouseQuery.data ? `مکان‌های ${warehouseQuery.data.name}` : 'مکان‌های انبار'}
        description="سلسله‌مراتب فیزیکی انبار. نیازی به تعریف همه سطوح نیست — می‌توانید مستقیماً قفسه بسازید."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href={ROUTES.warehouse}
              className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium hover:bg-slate-50"
            >
              بازگشت به انبارها
            </Link>
            {canManage ? (
              <Button type="button" onClick={() => openCreate(null)}>
                مکان جدید
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1 space-y-1">
          <Label htmlFor="loc-search">جستجو</Label>
          <Input
            id="loc-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="کد، نام یا بارکد"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="loc-type">نوع</Label>
          <select
            id="loc-type"
            className="flex h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">همه</option>
            {LOCATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {typeLabel[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="loc-status">وضعیت</Label>
          <select
            id="loc-status"
            className="flex h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">همه</option>
            <option value="ACTIVE">فعال</option>
            <option value="INACTIVE">غیرفعال</option>
          </select>
        </div>
      </div>

      {locationsQuery.isLoading || warehouseQuery.isLoading ? <TableSkeleton rows={6} /> : null}
      {locationsQuery.isError ? (
        <ErrorState message={mapBusinessError(locationsQuery.error)} />
      ) : null}
      {warehouseQuery.isError ? (
        <ErrorState message={mapBusinessError(warehouseQuery.error)} />
      ) : null}

      {!locationsQuery.isLoading && !locationsQuery.isError && tree.length === 0 ? (
        <EmptyState
          title="هنوز مکانی تعریف نشده است."
          description="برای انبار کوچک می‌توانید مستقیماً قفسه بسازید — نیازی به زون/راهرو نیست."
          action={
            canManage ? (
              <Button type="button" onClick={() => openCreate(null)}>
                ایجاد اولین مکان
              </Button>
            ) : null
          }
        />
      ) : null}

      {tree.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          {tree.map((node) => renderNode(node, 0))}
        </div>
      ) : null}

      <Dialog
        open={Boolean(form)}
        onOpenChange={(open) => {
          if (!open) setForm(null);
        }}
        title={form?.mode === 'edit' ? 'ویرایش مکان' : 'مکان جدید'}
        description="کد عملیاتی الزامی است. بارکد LOC-* توسط سرور تولید می‌شود و پایدار می‌ماند."
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="loc-type-form">نوع *</Label>
            <select
              id="loc-type-form"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value as WarehouseLocationType)}
            >
              {LOCATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {typeLabel[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="loc-code">کد *</Label>
            <Input
              id="loc-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              dir="ltr"
              placeholder="S01"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="loc-name">نام</Label>
            <Input
              id="loc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="قفسه ریمل"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="loc-parent">والد</Label>
            <select
              id="loc-parent"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">ریشه انبار (بدون والد)</option>
              {flatOptions
                .filter((opt) => (form?.mode === 'edit' ? opt.id !== form.location.id : true))
                .map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.code} — {typeLabel[opt.type]}
                    {opt.name ? ` (${opt.name})` : ''}
                  </option>
                ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="loc-notes">یادداشت</Label>
            <textarea
              id="loc-notes"
              className="flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {form?.mode === 'edit' ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs" dir="ltr">
              Barcode: {form.location.barcode}
            </p>
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

      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={confirm?.type === 'activate' ? 'فعال‌سازی مکان' : 'غیرفعال‌سازی مکان'}
        description={
          confirm?.type === 'activate'
            ? `مکان «${confirm.location.code}» فعال شود؟`
            : `مکان «${confirm?.location.code}» غیرفعال شود؟ زیرمجموعه‌های فعال باید ابتدا غیرفعال شوند.`
        }
        confirmLabel="تأیید"
        danger={confirm?.type === 'deactivate'}
        onConfirm={() => actionMutation.mutate()}
        loading={actionMutation.isPending}
      />
    </div>
  );
}
