'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
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
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  activateSalesCustomer,
  createSalesCustomer,
  deactivateSalesCustomer,
  fetchSalesCustomers,
  updateSalesCustomer,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { salesKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { ROUTES, salesCustomerPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { CustomerListItem, CustomerType } from '@/types/sales';

export function SalesCustomersPage() {
  const searchParams = useSearchParams();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const queryClient = useQueryClient();
  const canRead = can(PERMISSIONS.SALES_CUSTOMERS_READ);
  const canManage = can(PERMISSIONS.SALES_CUSTOMERS_MANAGE);

  const [page, setPage] = React.useState(1);
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [formOpen, setFormOpen] = React.useState(searchParams.get('create') === '1');
  const [editing, setEditing] = React.useState<CustomerListItem | null>(null);
  const [displayName, setDisplayName] = React.useState('');
  const [type, setType] = React.useState<CustomerType>('INDIVIDUAL');
  const [mobile, setMobile] = React.useState('');
  const [toggle, setToggle] = React.useState<CustomerListItem | null>(null);

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const listQuery = useQuery({
    queryKey: salesKeys.customers.list(companyId, { page, pageSize: 20, search: search || undefined }),
    enabled: Boolean(companyId) && canRead,
    queryFn: () =>
      fetchSalesCustomers(companyId, { page, pageSize: 20, search: search || undefined }),
  });

  React.useEffect(() => {
    if (listQuery.error && isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [listQuery.error, handleUnauthorized]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (editing) {
        return updateSalesCustomer(companyId, editing.id, {
          displayName: displayName.trim(),
          mobile: mobile || null,
        });
      }
      return createSalesCustomer(companyId, {
        type,
        displayName: displayName.trim(),
        mobile: mobile || undefined,
      });
    },
    onSuccess: async () => {
      toast.success(editing ? 'مشتری به‌روز شد' : 'مشتری ایجاد شد');
      setFormOpen(false);
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: salesKeys.customers.all(companyId) });
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  const toggleMut = useMutation({
    mutationFn: async () => {
      if (!toggle) return;
      return toggle.status === 'ACTIVE'
        ? deactivateSalesCustomer(companyId, toggle.id)
        : activateSalesCustomer(companyId, toggle.id);
    },
    onSuccess: async () => {
      toast.success('وضعیت مشتری تغییر کرد');
      setToggle(null);
      await queryClient.invalidateQueries({ queryKey: salesKeys.customers.all(companyId) });
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  if (!canRead) {
    return <AccessDenied message="برای مشاهده مشتریان به مجوز sales.customers.read نیاز است." />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="مشتریان"
        description="مستر مشتری شرکت فعال — مانده بدهی در مالی نگه داشته می‌شود"
        breadcrumbs={[{ label: 'فروش', href: ROUTES.sales }, { label: 'مشتریان' }]}
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setEditing(null);
                setDisplayName('');
                setType('INDIVIDUAL');
                setMobile('');
                setFormOpen(true);
              }}
            >
              مشتری جدید
            </Button>
          ) : null
        }
      />

      <Input
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="جستجوی نام، موبایل، کد…"
      />

      {listQuery.isLoading ? <TableSkeleton rows={6} /> : null}
      {listQuery.error ? (
        <ErrorState title="خطا" message={mapBusinessError(listQuery.error)} />
      ) : null}
      {listQuery.data?.data.length === 0 ? (
        <EmptyState title="مشتری‌ای نیست" description="اولین مشتری را ایجاد کنید." />
      ) : null}

      {listQuery.data && listQuery.data.data.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-right">نام</th>
                  <th className="px-3 py-2 text-right">نوع</th>
                  <th className="px-3 py-2 text-right">موبایل</th>
                  <th className="px-3 py-2 text-right">وضعیت</th>
                  <th className="px-3 py-2 text-right">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {listQuery.data.data.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <Link
                        href={salesCustomerPath(c.id)}
                        className="font-medium text-sky-700 hover:underline"
                      >
                        {c.displayName}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {c.type === 'BUSINESS' ? 'حقوقی' : 'حقیقی'}
                    </td>
                    <td className="px-3 py-2">{c.mobile ?? '—'}</td>
                    <td className="px-3 py-2">
                      <Badge>{c.status === 'ACTIVE' ? 'فعال' : 'غیرفعال'}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      {canManage ? (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditing(c);
                              setDisplayName(c.displayName);
                              setType(c.type);
                              setMobile(c.mobile ?? '');
                              setFormOpen(true);
                            }}
                          >
                            ویرایش
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setToggle(c)}>
                            {c.status === 'ACTIVE' ? 'غیرفعال' : 'فعال'}
                          </Button>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between text-sm">
            <span>
              صفحه {listQuery.data.meta.page} / {listQuery.data.meta.totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                قبلی
              </button>
              <button
                type="button"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                disabled={page >= listQuery.data.meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                بعدی
              </button>
            </div>
          </div>
        </>
      ) : null}

      <Dialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? 'ویرایش مشتری' : 'مشتری جدید'}
      >
        <div className="space-y-3">
          {!editing ? (
            <div className="space-y-1">
              <Label>نوع</Label>
              <select
                className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                value={type}
                onChange={(e) => setType(e.target.value as CustomerType)}
              >
                <option value="INDIVIDUAL">حقیقی</option>
                <option value="BUSINESS">حقوقی</option>
              </select>
            </div>
          ) : null}
          <div className="space-y-1">
            <Label>نام نمایشی *</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>موبایل</Label>
            <Input value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              انصراف
            </Button>
            <Button disabled={saveMut.isPending || !displayName.trim()} onClick={() => saveMut.mutate()}>
              ذخیره
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(toggle)}
        onOpenChange={(open) => !open && setToggle(null)}
        title={toggle?.status === 'ACTIVE' ? 'غیرفعال‌سازی مشتری؟' : 'فعال‌سازی مشتری؟'}
        confirmLabel="تأیید"
        onConfirm={() => toggleMut.mutate()}
        loading={toggleMut.isPending}
      />
    </div>
  );
}
