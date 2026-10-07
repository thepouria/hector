'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { formatSettlementMoney, statusBadgeClass } from '@/features/settlement/settlement-labels';
import { fetchSettlementOutstandingPayables } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { settlementKeys } from '@/lib/query/keys';
import { settlementPayablePath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function SettlementPayablesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_SETTLEMENTS_READ);

  const dueState = searchParams.get('dueState') ?? '';
  const currency = searchParams.get('currency') ?? '';
  const filters = {
    page: 1,
    pageSize: 50,
    ...(dueState ? { dueState } : {}),
    ...(currency ? { currency } : {}),
  };

  const listQuery = useQuery({
    queryKey: settlementKeys.payables(companyId, filters),
    enabled: Boolean(companyId) && canRead,
    queryFn: () => fetchSettlementOutstandingPayables(companyId, filters),
  });

  React.useEffect(() => {
    if (listQuery.error && isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [listQuery.error, handleUnauthorized]);

  if (!canRead) return <AccessDenied />;

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="بدهی تأمین‌کننده (تسویه)"
        description="مانده از تعهد و تخصیص‌های فعال مشتق می‌شود. پرداخت دستی روی بدهی وارد نمی‌شود."
      />

      <div className="flex flex-wrap gap-4">
        <div>
          <Label htmlFor="dueState">سررسید</Label>
          <select
            id="dueState"
            className="mt-1 block rounded-md border px-3 py-2 text-sm"
            value={dueState}
            onChange={(e) => {
              const params = new URLSearchParams(searchParams.toString());
              if (!e.target.value) params.delete('dueState');
              else params.set('dueState', e.target.value);
              router.replace(`${pathname}?${params.toString()}`);
            }}
          >
            <option value="">همه</option>
            <option value="OVERDUE">سررسید گذشته</option>
            <option value="DUE">دارای سررسید</option>
            <option value="NOT_DUE">بدون سررسید گذشته</option>
          </select>
        </div>
      </div>

      {listQuery.isLoading ? (
        <TableSkeleton rows={6} />
      ) : listQuery.isError ? (
        <ErrorState message="بارگذاری بدهی‌ها ناموفق بود." onRetry={() => listQuery.refetch()} />
      ) : !listQuery.data?.data.length ? (
        <EmptyState title="بدهی باز نیست" description="تعهد تسویه‌نشده‌ای برای نمایش وجود ندارد." />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b text-right text-muted-foreground">
                <th className="px-3 py-2 font-medium">مرجع</th>
                <th className="px-3 py-2 font-medium">تأمین‌کننده</th>
                <th className="px-3 py-2 font-medium">اصلی</th>
                <th className="px-3 py-2 font-medium">تسویه‌شده</th>
                <th className="px-3 py-2 font-medium">مانده</th>
                <th className="px-3 py-2 font-medium">سررسید</th>
                <th className="px-3 py-2 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.data.data.map((row) => (
                <tr key={row.payableId} className="border-b">
                  <td className="px-3 py-3">
                    <Link
                      href={settlementPayablePath(row.payableId)}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {row.number}
                    </Link>
                  </td>
                  <td className="px-3 py-3">{row.supplier.name}</td>
                  <td className="px-3 py-3 tabular-nums">
                    {formatSettlementMoney(row.originalAmount, row.currency)}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {formatSettlementMoney(row.settledAmount, row.currency)}
                  </td>
                  <td className="px-3 py-3 tabular-nums font-medium">
                    {formatSettlementMoney(row.outstandingAmount, row.currency)}
                  </td>
                  <td className="px-3 py-3">
                    {row.dueDate ? formatDateTime(row.dueDate) : '—'}
                    {row.overdue ? (
                      <span className="mr-2 text-xs text-red-700">سررسید گذشته</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <Badge className={statusBadgeClass(row.status)}>{row.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
