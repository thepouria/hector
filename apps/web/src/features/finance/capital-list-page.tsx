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
import { fetchCapitalContributions } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeCapitalKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { financeCapitalPath, ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

function fundingLabel(type: string): string {
  if (type === 'OWNER_EQUITY') return 'سهم مالک';
  if (type === 'PARTNER_EQUITY') return 'سهم شریک';
  if (type === 'OTHER_FUNDING') return 'سایر تأمین';
  return type;
}

export function CapitalListPageClient() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_CAPITAL_READ);
  const canManage = can(PERMISSIONS.FINANCE_CAPITAL_MANAGE);

  const listQuery = useQuery({
    queryKey: financeCapitalKeys.list(companyId),
    queryFn: () => fetchCapitalContributions(companyId, { page: 1, pageSize: 50 }),
    enabled: Boolean(companyId) && canRead,
  });

  if (!canRead) return <AccessDenied />;
  if (listQuery.isError) {
    if (isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
    return <ErrorState message="بارگذاری سرمایه ناموفق بود." onRetry={() => listQuery.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="سرمایه"
        description="آوردهٔ سرمایه ≠ درآمد. جمع ارزهای مختلف بدون تبدیل انجام نمی‌شود."
        actions={
          canManage ? (
            <Link href={ROUTES.financeCapitalNew} className={cn(buttonVariants())}>
              ثبت آورده
            </Link>
          ) : null
        }
      />
      {listQuery.isLoading ? (
        <TableSkeleton rows={6} />
      ) : !listQuery.data?.data.length ? (
        <EmptyState title="آورده‌ای ثبت نشده" description="اولین آوردهٔ سرمایه را ثبت کنید." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b text-right text-muted-foreground">
                <th className="px-2 py-2 font-medium">شماره</th>
                <th className="px-2 py-2 font-medium">آورده‌کننده</th>
                <th className="px-2 py-2 font-medium">نوع</th>
                <th className="px-2 py-2 font-medium">مبلغ</th>
                <th className="px-2 py-2 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.data.data.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="px-2 py-3">
                    <Link href={financeCapitalPath(row.id)} className="text-primary underline-offset-2 hover:underline">
                      {row.number}
                    </Link>
                  </td>
                  <td className="px-2 py-3">{row.contributorName}</td>
                  <td className="px-2 py-3">{fundingLabel(row.fundingType)}</td>
                  <td className="px-2 py-3 tabular-nums">
                    {row.amount} {row.currency}
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
