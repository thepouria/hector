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
import { buttonVariants } from '@/components/ui/button';
import { fetchLoans } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeLoanKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { financeLoanPath, ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function LoansListPageClient() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_LOANS_READ);
  const canManage = can(PERMISSIONS.FINANCE_LOANS_MANAGE);

  const listQuery = useQuery({
    queryKey: financeLoanKeys.list(companyId),
    queryFn: () => fetchLoans(companyId, { page: 1, pageSize: 50 }),
    enabled: Boolean(companyId) && canRead,
  });

  if (!canRead) return <AccessDenied />;
  if (listQuery.isError) {
    if (isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
    return <ErrorState message="بارگذاری وام‌ها ناموفق بود." onRetry={() => listQuery.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="وام‌ها"
        description="بدهی ≠ سرمایه. مانده از اصل دریافتی منهای بازپرداخت اصل مشتق می‌شود. ارزها جمع نمی‌شوند."
        actions={
          canManage ? (
            <Link href={ROUTES.financeLoanNew} className={cn(buttonVariants())}>
              ثبت وام
            </Link>
          ) : null
        }
      />
      {listQuery.isLoading ? (
        <TableSkeleton rows={6} />
      ) : !listQuery.data?.data.length ? (
        <EmptyState title="وامی ثبت نشده" description="اولین وام را ثبت کنید." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead>
              <tr className="border-b text-right text-muted-foreground">
                <th className="px-2 py-2 font-medium">شماره</th>
                <th className="px-2 py-2 font-medium">وام‌دهنده</th>
                <th className="px-2 py-2 font-medium">مانده</th>
                <th className="px-2 py-2 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.data.data.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="px-2 py-3">
                    <Link href={financeLoanPath(row.id)} className="text-primary underline-offset-2 hover:underline">
                      {row.number}
                    </Link>
                    {row.overdue ? (
                      <Badge className="mr-2 text-red-700 border-red-200 bg-red-50">
                        سررسید گذشته
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-2 py-3">{row.lenderName}</td>
                  <td className="px-2 py-3 tabular-nums">
                    {row.outstandingPrincipal} {row.currency}
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
