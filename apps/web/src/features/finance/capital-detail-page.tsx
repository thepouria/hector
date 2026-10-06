'use client';

import { useQuery } from '@tanstack/react-query';
import { AccessDenied, ErrorState, TableSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { fetchCapitalContribution } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeCapitalKeys } from '@/lib/query/keys';
import { useSession } from '@/providers/app-providers';

export function CapitalDetailPageClient({ contributionId }: { contributionId: string }) {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_CAPITAL_READ);

  const query = useQuery({
    queryKey: financeCapitalKeys.detail(companyId, contributionId),
    queryFn: () => fetchCapitalContribution(companyId, contributionId),
    enabled: Boolean(companyId) && canRead,
  });

  if (!canRead) return <AccessDenied />;
  if (query.isLoading) return <TableSkeleton rows={4} />;
  if (query.isError || !query.data) {
    if (isApiClientError(query.error) && query.error.status === 401) handleUnauthorized();
    return <ErrorState message="جزئیات آورده یافت نشد." onRetry={() => query.refetch()} />;
  }

  const row = query.data;
  return (
    <div className="space-y-6">
      <PageHeader title={row.number} description={`${row.contributorName} — سرمایه ≠ درآمد`} />
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">وضعیت</dt>
          <dd>
            <Badge>{row.status}</Badge>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">نوع تأمین</dt>
          <dd>{row.fundingType}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">مبلغ</dt>
          <dd className="tabular-nums">
            {row.amount} {row.currency}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">حساب</dt>
          <dd>
            {row.account.code} ({row.account.currency})
          </dd>
        </div>
        {row.notes ? (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">یادداشت</dt>
            <dd>{row.notes}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
