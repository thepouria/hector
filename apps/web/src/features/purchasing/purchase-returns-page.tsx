'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { purchaseReturnStatusLabel } from '@/features/purchasing/purchase-order-labels';
import { fetchPurchaseReturns } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { purchaseReturnKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import {
  ROUTES,
  purchasingOrderPath,
  purchasingReturnPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { PurchaseReturnStatus } from '@/types/purchasing';

export function PurchaseReturnsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canCreate = can(PERMISSIONS.PURCHASING_RETURN_CREATE);

  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState<PurchaseReturnStatus | ''>(
    () => (searchParams.get('status') as PurchaseReturnStatus | null) ?? '',
  );
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    const next = (searchParams.get('status') as PurchaseReturnStatus | null) ?? '';
    setStatus(next);
  }, [searchParams]);

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const filters = {
    page: String(page),
    pageSize: '20',
    status: status || undefined,
    search: search || undefined,
  };

  const query = useQuery({
    queryKey: purchaseReturnKeys.list(companyId, filters),
    enabled: Boolean(companyId) && can(PERMISSIONS.PURCHASING_READ),
    queryFn: () => fetchPurchaseReturns(companyId, filters),
  });

  if (!can(PERMISSIONS.PURCHASING_READ)) return <AccessDenied />;

  const rows = query.data?.data ?? [];
  const meta = query.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="برگشت به تأمین‌کننده"
        description="نیت تجاری برگشت کالا. خروج انبار و تسویه مالی در مراحل بعد."
        breadcrumbs={[
          { label: 'خرید', href: ROUTES.purchasing },
          { label: 'برگشت‌ها' },
        ]}
        actions={
          canCreate ? (
            <Link href={ROUTES.purchasingReturnNew} className={cn(buttonVariants())}>
              ثبت برگشت به تأمین‌کننده
            </Link>
          ) : null
        }
      />

      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        تأیید برگشت به‌معنای کاهش موجودی یا ثبت بستانکاری تأمین‌کننده نیست. اجرای فیزیکی در ماژول
        انبار انجام می‌شود.
      </p>

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="return-search">جستجو</Label>
          <Input
            id="return-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="شماره برگشت یا تأمین‌کننده"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="return-status">وضعیت</Label>
          <select
            id="return-status"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={status}
            onChange={(e) => {
              const next = e.target.value as PurchaseReturnStatus | '';
              setStatus(next);
              setPage(1);
              const params = new URLSearchParams();
              if (next) params.set('status', next);
              router.replace(
                `${ROUTES.purchasingReturns}${params.toString() ? `?${params}` : ''}`,
              );
            }}
          >
            <option value="">همه</option>
            <option value="DRAFT">پیش‌نویس</option>
            <option value="APPROVED">تأیید شده</option>
            <option value="CANCELLED">لغو شده</option>
          </select>
        </div>
      </div>

      {query.isPending ? (
        <TableSkeleton />
      ) : query.isError ? (
        <ErrorState message={mapBusinessError(query.error)} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="برگی ثبت نشده است."
          description="برگشت تجاری به تأمین‌کننده را بدون ادعای خروج انبار ثبت کنید."
          action={
            canCreate ? (
              <Link href={ROUTES.purchasingReturnNew} className={cn(buttonVariants())}>
                ثبت اولین برگشت
              </Link>
            ) : null
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">شماره برگشت</th>
                <th className="px-3 py-2 text-start font-medium">تأمین‌کننده</th>
                <th className="px-3 py-2 text-start font-medium">سفارش خرید</th>
                <th className="px-3 py-2 text-start font-medium">تعداد اقلام</th>
                <th className="px-3 py-2 text-start font-medium">وضعیت</th>
                <th className="px-3 py-2 text-start font-medium">تاریخ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  onClick={() => router.push(purchasingReturnPath(row.id))}
                >
                  <td className="px-3 py-2">
                    <Link
                      href={purchasingReturnPath(row.id)}
                      className="font-medium text-slate-900 underline-offset-2 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {row.number}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{row.supplier.name}</td>
                  <td className="px-3 py-2">
                    {row.purchaseOrder ? (
                      <Link
                        href={purchasingOrderPath(row.purchaseOrder.id)}
                        className="text-slate-700 underline-offset-2 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.purchaseOrder.number}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {row.items?.length ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Badge>{purchaseReturnStatusLabel(row.status)}</Badge>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{formatDateTime(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 ? (
            <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-sm">
              <Button
                type="button"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                قبلی
              </Button>
              <span className="text-slate-500">
                صفحه {page} از {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                بعدی
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
