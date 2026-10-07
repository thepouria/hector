'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AccessDenied,
  ErrorState,
  PageSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  activateSalesCustomer,
  deactivateSalesCustomer,
  fetchSalesCustomer,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { salesKeys } from '@/lib/query/keys';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function SalesCustomerDetailPage({ customerId }: { customerId: string }) {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const queryClient = useQueryClient();
  const canRead = can(PERMISSIONS.SALES_CUSTOMERS_READ);
  const canManage = can(PERMISSIONS.SALES_CUSTOMERS_MANAGE);
  const [toggleConfirm, setToggleConfirm] = React.useState(false);

  const query = useQuery({
    queryKey: salesKeys.customers.detail(companyId, customerId),
    enabled: Boolean(companyId) && canRead,
    queryFn: () => fetchSalesCustomer(companyId, customerId),
  });

  React.useEffect(() => {
    if (query.error && isApiClientError(query.error) && query.error.status === 401) {
      handleUnauthorized();
    }
  }, [query.error, handleUnauthorized]);

  const toggleMut = useMutation({
    mutationFn: async () => {
      const c = query.data!;
      return c.status === 'ACTIVE'
        ? deactivateSalesCustomer(companyId, customerId)
        : activateSalesCustomer(companyId, customerId);
    },
    onSuccess: async () => {
      toast.success('وضعیت به‌روز شد');
      setToggleConfirm(false);
      await queryClient.invalidateQueries({
        queryKey: salesKeys.customers.detail(companyId, customerId),
      });
      await queryClient.invalidateQueries({ queryKey: salesKeys.customers.all(companyId) });
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  if (!canRead) {
    return <AccessDenied message="مجوز مشاهده مشتری ندارید." />;
  }
  if (query.isLoading) return <PageSkeleton />;
  if (query.error) {
    return <ErrorState title="خطا" message={mapBusinessError(query.error)} />;
  }

  const c = query.data!;

  return (
    <div className="space-y-4">
      <PageHeader
        title={c.displayName}
        description={c.type === 'BUSINESS' ? 'مشتری حقوقی' : 'مشتری حقیقی'}
        breadcrumbs={[
          { label: 'فروش', href: ROUTES.sales },
          { label: 'مشتریان', href: ROUTES.salesCustomers },
          { label: c.displayName },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Badge>{c.status === 'ACTIVE' ? 'فعال' : 'غیرفعال'}</Badge>
            {canManage ? (
              <Button variant="outline" onClick={() => setToggleConfirm(true)}>
                {c.status === 'ACTIVE' ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm md:grid-cols-2">
        <div>کد: {c.code ?? '—'}</div>
        <div>موبایل: {c.mobile ?? '—'}</div>
        <div>تلفن: {c.phone ?? '—'}</div>
        <div>ایمیل: {c.email ?? '—'}</div>
        <div>ایجاد: {formatDateTime(c.createdAt)}</div>
        <div>به‌روزرسانی: {formatDateTime(c.updatedAt)}</div>
        {c.notes ? <div className="md:col-span-2">یادداشت: {c.notes}</div> : null}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">آدرس‌ها</h2>
        {(c.addresses ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">آدرسی ثبت نشده است.</p>
        ) : (
          <ul className="space-y-2">
            {c.addresses.map((a) => (
              <li key={a.id} className="rounded border border-slate-200 bg-white px-3 py-2 text-sm">
                {a.isDefault ? <Badge className="me-2">پیش‌فرض</Badge> : null}
                {[a.label, a.recipientName, a.city, a.province, a.addressLine]
                  .filter(Boolean)
                  .join(' · ')}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href={ROUTES.salesCustomers} className="text-sm text-sky-700 hover:underline">
        بازگشت
      </Link>

      <ConfirmDialog
        open={toggleConfirm}
        onOpenChange={setToggleConfirm}
        title={c.status === 'ACTIVE' ? 'غیرفعال‌سازی؟' : 'فعال‌سازی؟'}
        confirmLabel="تأیید"
        onConfirm={() => toggleMut.mutate()}
        loading={toggleMut.isPending}
      />
    </div>
  );
}
