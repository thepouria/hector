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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RowActionsMenu } from '@/components/ui/row-actions';
import {
  attributeScopeLabel,
  attributeTypeLabel,
} from '@/features/catalog/attribute-utils';
import {
  archiveAttributeDefinition,
  createAttributeOption,
  fetchAttribute,
  setAttributeOptionActive,
  updateAttribute,
  updateAttributeOption,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { attributeKeys } from '@/lib/query/keys';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

function statusLabel(status: string): string {
  if (status === 'ACTIVE') return 'فعال';
  if (status === 'INACTIVE') return 'غیرفعال';
  if (status === 'ARCHIVED') return 'بایگانی';
  return status;
}

export function AttributeDetailPageClient({ attributeId }: { attributeId: string }) {
  const router = useRouter();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.CATALOG_MANAGE);

  const [name, setName] = React.useState('');
  const [unit, setUnit] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [newOptionValue, setNewOptionValue] = React.useState('');
  const [confirmArchive, setConfirmArchive] = React.useState(false);

  const detailQuery = useQuery({
    queryKey: attributeKeys.detail(companyId, attributeId),
    enabled: Boolean(companyId) && can(PERMISSIONS.CATALOG_READ),
    queryFn: () => fetchAttribute(companyId, attributeId),
  });

  React.useEffect(() => {
    if (
      detailQuery.error &&
      isApiClientError(detailQuery.error) &&
      detailQuery.error.status === 401
    ) {
      handleUnauthorized();
    }
  }, [detailQuery.error, handleUnauthorized]);

  React.useEffect(() => {
    const attr = detailQuery.data;
    if (!attr) return;
    setName(attr.name);
    setUnit(attr.unit ?? '');
    setDescription(attr.description ?? '');
  }, [detailQuery.data]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: attributeKeys.all(companyId) });
    await queryClient.invalidateQueries({ queryKey: attributeKeys.detail(companyId, attributeId) });
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      updateAttribute(companyId, attributeId, {
        name: name.trim(),
        unit: unit.trim() ? unit.trim() : null,
        description: description.trim() ? description.trim() : null,
      }),
    onSuccess: async () => {
      toast.success('ویژگی به‌روز شد.');
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveAttributeDefinition(companyId, attributeId),
    onSuccess: async () => {
      toast.success('ویژگی بایگانی شد.');
      setConfirmArchive(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const addOptionMutation = useMutation({
    mutationFn: () => createAttributeOption(companyId, attributeId, { value: newOptionValue.trim() }),
    onSuccess: async () => {
      toast.success('گزینه اضافه شد.');
      setNewOptionValue('');
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const toggleOptionMutation = useMutation({
    mutationFn: ({ optionId, active }: { optionId: string; active: boolean }) =>
      setAttributeOptionActive(companyId, optionId, active),
    onSuccess: async () => {
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const renameOptionMutation = useMutation({
    mutationFn: ({ optionId, value }: { optionId: string; value: string }) =>
      updateAttributeOption(companyId, optionId, { value }),
    onSuccess: async () => {
      toast.success('گزینه به‌روز شد.');
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.CATALOG_READ)) {
    return <AccessDenied />;
  }

  if (detailQuery.isLoading) return <PageSkeleton />;

  if (detailQuery.error || !detailQuery.data) {
    return (
      <div className="space-y-4">
        <ErrorState title="ویژگی پیدا نشد" message={mapBusinessError(detailQuery.error)} />
        <Button variant="outline" onClick={() => router.push(ROUTES.catalogAttributes)}>
          بازگشت
        </Button>
      </div>
    );
  }

  const attr = detailQuery.data;
  const isSelect = attr.type === 'SINGLE_SELECT' || attr.type === 'MULTI_SELECT';
  const options = [...(attr.options ?? [])].sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-6">
      <PageHeader
        title={attr.name}
        description={`کد: ${attr.code}`}
        breadcrumbs={[
          { label: 'کاتالوگ', href: ROUTES.catalog },
          { label: 'مشخصات محصولات', href: ROUTES.catalogAttributes },
          { label: attr.name },
        ]}
        actions={
          canManage && attr.status !== 'ARCHIVED' ? (
            <Button type="button" variant="outline" onClick={() => setConfirmArchive(true)}>
              بایگانی
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <div>
          <div className="text-xs text-slate-500">نوع</div>
          <div className="mt-1 text-sm">{attributeTypeLabel(attr.type)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">دامنه</div>
          <div className="mt-1 text-sm">{attributeScopeLabel(attr.scope)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">وضعیت</div>
          <div className="mt-1">
            <Badge>{statusLabel(attr.status)}</Badge>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">کد</div>
          <div className="mt-1 font-mono text-sm" dir="ltr">
            {attr.code}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">به‌روزرسانی</div>
          <div className="mt-1 text-sm">{formatDateTime(attr.updatedAt)}</div>
        </div>
      </div>

      {canManage && attr.status !== 'ARCHIVED' ? (
        <form
          className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate();
          }}
        >
          <h2 className="text-base font-semibold text-slate-900">ویرایش اطلاعات</h2>
          <div className="space-y-1">
            <Label htmlFor="detail-attr-name">نام</Label>
            <Input
              id="detail-attr-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="detail-attr-unit">واحد (اختیاری)</Label>
            <Input
              id="detail-attr-unit"
              dir="ltr"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              maxLength={32}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="detail-attr-desc">توضیحات (اختیاری)</Label>
            <textarea
              id="detail-attr-desc"
              className="flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={saveMutation.isPending || !name.trim()}>
              {saveMutation.isPending ? 'در حال ذخیره...' : 'ذخیره'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <p>
            <span className="text-slate-500">واحد: </span>
            {attr.unit ?? '—'}
          </p>
          <p className="mt-2">
            <span className="text-slate-500">توضیحات: </span>
            {attr.description?.trim() ? attr.description : '—'}
          </p>
        </div>
      )}

      {isSelect ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-base font-semibold text-slate-900">گزینه‌ها</h2>
          {options.length === 0 ? (
            <p className="text-sm text-slate-500">هنوز گزینه‌ای تعریف نشده است.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {options.map((option) => (
                <li key={option.id} className="flex items-center justify-between gap-3 py-2">
                  <span className={option.isActive ? 'text-slate-900' : 'text-slate-400 line-through'}>
                    {option.value}
                  </span>
                  {canManage && attr.status !== 'ARCHIVED' ? (
                    <RowActionsMenu
                      actions={[
                        {
                          label: 'ویرایش مقدار',
                          onSelect: () => {
                            const next = window.prompt('مقدار گزینه', option.value);
                            if (next?.trim()) {
                              renameOptionMutation.mutate({ optionId: option.id, value: next.trim() });
                            }
                          },
                        },
                        option.isActive
                          ? {
                              label: 'غیرفعال',
                              onSelect: () =>
                                toggleOptionMutation.mutate({ optionId: option.id, active: false }),
                            }
                          : {
                              label: 'فعال‌سازی',
                              onSelect: () =>
                                toggleOptionMutation.mutate({ optionId: option.id, active: true }),
                            },
                      ]}
                    />
                  ) : (
                    <Badge>{option.isActive ? 'فعال' : 'غیرفعال'}</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canManage && attr.status !== 'ARCHIVED' ? (
            <form
              className="mt-4 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                addOptionMutation.mutate();
              }}
            >
              <Input
                value={newOptionValue}
                onChange={(event) => setNewOptionValue(event.target.value)}
                placeholder="مقدار گزینه جدید"
                maxLength={120}
              />
              <Button type="submit" disabled={addOptionMutation.isPending || !newOptionValue.trim()}>
                افزودن
              </Button>
            </form>
          ) : null}
        </section>
      ) : null}

      <Link href={ROUTES.catalogAttributes} className="text-sm text-slate-600 hover:text-slate-900">
        ← بازگشت به فهرست
      </Link>

      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title="بایگانی ویژگی"
        description="تعریف ویژگی بایگانی می‌شود؛ مقادیر ثبت‌شده روی محصولات حفظ می‌شوند."
        target={attr.name}
        confirmLabel="بایگانی"
        danger
        loading={archiveMutation.isPending}
        onConfirm={() => archiveMutation.mutate()}
      />
    </div>
  );
}
