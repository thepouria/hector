'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { fetchLedgerAccounts } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeJournalKeys } from '@/lib/query/keys';
import { useSession } from '@/providers/app-providers';

export function LedgerAccountsPageClient() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_JOURNALS_READ);

  const listQuery = useQuery({
    queryKey: financeJournalKeys.ledgerAccounts(companyId),
    queryFn: () => fetchLedgerAccounts(companyId, { pageSize: 100 }),
    enabled: Boolean(companyId) && canRead,
  });

  if (!canRead) return <AccessDenied />;
  if (listQuery.isError) {
    if (isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
    return (
      <ErrorState message="بارگذاری حساب‌های دفتر ناموفق بود." onRetry={() => listQuery.refetch()} />
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="حساب‌های دفتر"
        description="نمودار حساب‌ها (CoA). حساب مالی نقدی ≠ حساب دفتر."
      />
      {listQuery.isLoading ? (
        <TableSkeleton rows={8} />
      ) : !listQuery.data?.data.length ? (
        <EmptyState title="حساب دفتری نیست" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-right text-muted-foreground">
                <th className="px-2 py-2">کد</th>
                <th className="px-2 py-2">نام</th>
                <th className="px-2 py-2">نوع</th>
                <th className="px-2 py-2">کلید سیستم</th>
                <th className="px-2 py-2">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.data.data.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="px-2 py-2 font-mono">{row.code}</td>
                  <td className="px-2 py-2">{row.name}</td>
                  <td className="px-2 py-2">{row.type}</td>
                  <td className="px-2 py-2 font-mono text-xs">{row.systemKey ?? '—'}</td>
                  <td className="px-2 py-2">
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
