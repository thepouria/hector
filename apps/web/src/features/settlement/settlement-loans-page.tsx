'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { formatSettlementMoney, statusBadgeClass } from '@/features/settlement/settlement-labels';
import { fetchSettlementOutstandingLoans } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { settlementKeys } from '@/lib/query/keys';
import { settlementLoanPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function SettlementLoansPage() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_SETTLEMENTS_READ);

  const listQuery = useQuery({
    queryKey: settlementKeys.loans(companyId, { pageSize: 50 }),
    enabled: Boolean(companyId) && canRead,
    queryFn: () => fetchSettlementOutstandingLoans(companyId, { page: 1, pageSize: 50 }),
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
        title="وام‌ها (تسویه)"
        description="مانده به ارز تعهد نمایش داده می‌شود. پرداخت IRR روی وام USD فقط از طریق شواهد FX تسویه می‌شود."
      />

      {listQuery.isLoading ? (
        <TableSkeleton rows={5} />
      ) : listQuery.isError ? (
        <ErrorState message="بارگذاری وام‌ها ناموفق بود." onRetry={() => listQuery.refetch()} />
      ) : !listQuery.data?.data.length ? (
        <EmptyState title="وام باز نیست" description="تعهد وام تسویه‌نشده‌ای وجود ندارد." />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b text-right text-muted-foreground">
                <th className="px-3 py-2 font-medium">شماره</th>
                <th className="px-3 py-2 font-medium">وام‌دهنده</th>
                <th className="px-3 py-2 font-medium">اصل</th>
                <th className="px-3 py-2 font-medium">بازپرداخت</th>
                <th className="px-3 py-2 font-medium">مانده</th>
                <th className="px-3 py-2 font-medium">سررسید</th>
                <th className="px-3 py-2 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.data.data.map((row) => (
                <tr key={row.loanId} className="border-b">
                  <td className="px-3 py-3">
                    <Link
                      href={settlementLoanPath(row.loanId)}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {row.number}
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    {row.lenderParty?.displayName ?? '—'}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {formatSettlementMoney(row.originalPrincipal, row.currency)}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {formatSettlementMoney(row.repaidPrincipal, row.currency)}
                  </td>
                  <td className="px-3 py-3 tabular-nums font-medium">
                    {formatSettlementMoney(row.outstandingPrincipal, row.currency)}
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
