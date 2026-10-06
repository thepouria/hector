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
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RowActionsMenu } from '@/components/ui/row-actions';
import {
  attributeScopeLabel,
  attributeTypeLabel,
} from '@/features/catalog/attribute-utils';
import { archiveAttributeDefinition, createAttribute, fetchAttributes } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { attributeKeys } from '@/lib/query/keys';
import { ROUTES, catalogAttributePath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { AttributeScope, AttributeType } from '@/types/catalog';

const selectClassName =
  'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm';

function statusLabel(status: string): string {
  if (status === 'ACTIVE') return 'فعال';
  if (status === 'INACTIVE') return 'غیرفعال';
  if (status === 'ARCHIVED') return 'بایگانی';
  return status;
}

const ATTRIBUTE_TYPES: AttributeType[] = [
  'TEXT',
  'NUMBER',
  'BOOLEAN',
  'SINGLE_SELECT',
  'MULTI_SELECT',
];

const ATTRIBUTE_SCOPES: AttributeScope[] = ['PRODUCT', 'SKU', 'BOTH'];

export function AttributesPageClient() {
  const router = useRouter();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.CATALOG_MANAGE);

  const [page, setPage] = React.useState(1);
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [formOpen, setFormOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [type, setType] = React.useState<AttributeType>('TEXT');
  const [scope, setScope] = React.useState<AttributeScope>('PRODUCT');
  const [unit, setUnit] = React.useState('');
  const [description, setDescription] = React.useState('');

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

  const listQuery = useQuery({
    queryKey: attributeKeys.list(companyId, filters),
    enabled: Boolean(companyId) && can(PERMISSIONS.CATALOG_READ),
    queryFn: () => fetchAttributes(companyId, filters),
  });

  React.useEffect(() => {
    if (listQuery.error && isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [listQuery.error, handleUnauthorized]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: attributeKeys.all(companyId) });
  };

  const openCreate = () => {
    setName('');
    setCode('');
    setType('TEXT');
    setScope('PRODUCT');
    setUnit('');
    setDescription('');
    setFormOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      createAttribute(companyId, {
        name: name.trim(),
        code: code.trim(),
        type,
        scope,
        ...(unit.trim() ? { unit: unit.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    onSuccess: async (created) => {
      toast.success('ویژگی ایجاد شد.');
      setFormOpen(false);
      await invalidate();
      router.push(catalogAttributePath(created.id));
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const archiveMutation = useMutation({
    mutationFn: (attributeId: string) => archiveAttributeDefinition(companyId, attributeId),
    onSuccess: async () => {
      toast.success('ویژگی بایگانی شد.');
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.CATALOG_READ)) {
    return <AccessDenied />;
  }

  const rows = listQuery.data?.data ?? [];
  const meta = listQuery.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="مشخصات محصولات"
        description="تعریف مشخصات اختیاری محصول و SKU در کاتالوگ"
        breadcrumbs={[{ label: 'کاتالوگ', href: ROUTES.catalog }, { label: 'مشخصات محصولات' }]}
        actions={
          canManage ? (
            <Button type="button" onClick={openCreate}>
              ویژگی جدید
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <Label htmlFor="attr-search">جستجو</Label>
          <Input
            id="attr-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="نام یا کد"
          />
        </div>
        <div className="w-full space-y-1 sm:w-48">
          <Label htmlFor="attr-status">وضعیت</Label>
          <select
            id="attr-status"
            className={selectClassName}
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

      {listQuery.isLoading ? <TableSkeleton rows={6} /> : null}
      {listQuery.isError ? (
        <ErrorState title="خطا در دریافت ویژگی‌ها" message={mapBusinessError(listQuery.error)} />
      ) : null}

      {!listQuery.isLoading && !listQuery.isError && rows.length === 0 ? (
        <EmptyState
          title="ویژگی‌ای ثبت نشده است"
          description="اولین مشخصهٔ اطلاعاتی را تعریف کنید."
          action={
            canManage ? (
              <Button type="button" onClick={openCreate}>
                ایجاد اولین ویژگی
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
                <th className="px-4 py-3 font-medium">نام</th>
                <th className="px-4 py-3 font-medium">کد</th>
                <th className="px-4 py-3 font-medium">نوع</th>
                <th className="px-4 py-3 font-medium">دامنه</th>
                <th className="px-4 py-3 font-medium">واحد</th>
                <th className="px-4 py-3 font-medium">وضعیت</th>
                <th className="px-4 py-3 font-medium">به‌روزرسانی</th>
                {canManage ? <th className="px-4 py-3 font-medium">عملیات</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  onClick={() => router.push(catalogAttributePath(row.id))}
                >
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link
                      href={catalogAttributePath(row.id)}
                      className="hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600" dir="ltr">
                    {row.code}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{attributeTypeLabel(row.type)}</td>
                  <td className="px-4 py-3 text-slate-600">{attributeScopeLabel(row.scope)}</td>
                  <td className="px-4 py-3 text-slate-600" dir="ltr">
                    {row.unit ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge>{statusLabel(row.status)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(row.updatedAt)}</td>
                  {canManage ? (
                    <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                      <RowActionsMenu
                        actions={[
                          {
                            label: 'جزئیات و ویرایش',
                            onSelect: () => router.push(catalogAttributePath(row.id)),
                          },
                          ...(row.status !== 'ARCHIVED'
                            ? [
                                {
                                  label: 'بایگانی',
                                  onSelect: () => archiveMutation.mutate(row.id),
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

      <Dialog open={formOpen} onOpenChange={setFormOpen} title="ویژگی اطلاعاتی جدید">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="attr-name">نام</Label>
            <Input
              id="attr-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="attr-code">کد</Label>
            <Input
              id="attr-code"
              dir="ltr"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
              maxLength={64}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="attr-type">نوع</Label>
            <select
              id="attr-type"
              className={selectClassName}
              value={type}
              onChange={(event) => setType(event.target.value as AttributeType)}
            >
              {ATTRIBUTE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {attributeTypeLabel(t)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="attr-scope">دامنه</Label>
            <select
              id="attr-scope"
              className={selectClassName}
              value={scope}
              onChange={(event) => setScope(event.target.value as AttributeScope)}
            >
              {ATTRIBUTE_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {attributeScopeLabel(s)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="attr-unit">واحد (اختیاری)</Label>
            <Input
              id="attr-unit"
              dir="ltr"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              maxLength={32}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="attr-desc">توضیحات (اختیاری)</Label>
            <textarea
              id="attr-desc"
              className="flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              انصراف
            </Button>
            <Button
              type="submit"
              disabled={saveMutation.isPending || !name.trim() || !code.trim()}
            >
              {saveMutation.isPending ? 'در حال ذخیره...' : 'ایجاد'}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
