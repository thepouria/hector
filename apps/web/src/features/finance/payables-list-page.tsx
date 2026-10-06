'use client';

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
import { fetchSupplierPayables, fetchSupplierPayablesSummary } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financePayableKeys } from '@/lib/query/keys';
import { financePayablePath, financeSupplierStatementPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function PayablesListPageClient() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_PAYABLES_READ);

  const listQuery = useQuery({
    queryKey: financePayableKeys.list(companyId),
    queryFn: () => fetchSupplierPayables(companyId, { page: 1, pageSize: 50 }),
    enabled: Boolean(companyId) && canRead,
  });

  const summaryQuery = useQuery({
    queryKey: financePayableKeys.summary(companyId),
    queryFn: () => fetchSupplierPayablesSummary(companyId),
    enabled: Boolean(companyId) && canRead,
  });

  if (!canRead) return <AccessDenied />;
  if (listQuery.isError) {
    if (isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
    return (
      <ErrorState
        message="بارگذاری حساب‌های پرداختنی ناموفق بود."
        onRetry={() => listQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="حساب‌های پرداختنی"
        description="بدهی تأمین‌کننده از رسید کالا شناخته می‌شود. مانده همیشه مشتق است؛ ارزها جمع نمی‌شوند."
      />

      {summaryQuery.data?.byCurrency?.length ? (
        <div className="flex flex-wrap gap-4 text-sm">
          {summaryQuery.data.byCurrency.map((row) => (
            <div key={row.currency} className="min-w-[140px]">
              <div className="text-muted-foreground">{row.currency}</div>
              <div className="tabular-nums font-medium">
                {row.outstandingTotal} ({row.payableCount})
              </div>
              {Number(row.overdueTotal) > 0 ? (
                <div className="text-xs text-red-700">سررسید گذشته: {row.overdueTotal}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {listQuery.isLoading ? (
        <TableSkeleton rows={6} />
      ) : !listQuery.data?.data.length ? (
        <EmptyState
          title="بدهی ثبت نشده"
          description="با پست رسید کالا، بدهی شناخته می‌شود."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b text-right text-muted-foreground">
                <th className="px-2 py-2 font-medium">شماره</th>
                <th className="px-2 py-2 font-medium">تأمین‌کننده</th>
                <th className="px-2 py-2 font-medium">نوع</th>
                <th className="px-2 py-2 font-medium">مانده</th>
                <th className="px-2 py-2 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.data.data.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="px-2 py-3">
                    <Link
                      href={financePayablePath(row.id)}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {row.number}
                    </Link>
                    {row.overdue ? (
                      <Badge className="mr-2 border-red-200 bg-red-50 text-red-700">
                        سررسید گذشته
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-2 py-3">
                    <Link
                      href={financeSupplierStatementPath(row.supplierId)}
                      className="underline-offset-2 hover:underline"
                    >
                      {row.supplierName ?? row.supplierId.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-2 py-3">{row.purchaseType}</td>
                  <td className="px-2 py-3 tabular-nums">
                    {row.outstandingAmount} {row.currency}
                  </td>
                  <td className="px-2 py-3">
                    <Badge>{row.status}</Badge>
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
