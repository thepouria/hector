'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { fetchTrialBalance } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeJournalKeys } from '@/lib/query/keys';
import { useSession } from '@/providers/app-providers';

export function TrialBalancePageClient() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_JOURNALS_READ);

  const query = useQuery({
    queryKey: financeJournalKeys.trialBalance(companyId),
    queryFn: () => fetchTrialBalance(companyId),
    enabled: Boolean(companyId) && canRead,
  });

  if (!canRead) return <AccessDenied />;
  if (query.isError) {
    if (isApiClientError(query.error) && query.error.status === 401) {
      handleUnauthorized();
    }
    return <ErrorState message="بارگذاری تراز آزمایشی ناموفق بود." onRetry={() => query.refetch()} />;
  }

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="تراز آزمایشی"
        description={`مجموع بدهکار و بستانکار اسناد ثبت‌شده در ارز پایه شرکت${
          query.data ? ` (${query.data.baseCurrency})` : ''
        }.`}
      />
      {query.isLoading ? (
        <TableSkeleton rows={8} />
      ) : !query.data?.data.length ? (
        <EmptyState title="ردیفی نیست" description="پس از ثبت اسناد روزنامه، تراز پر می‌شود." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-right text-muted-foreground">
                <th className="px-2 py-2">کد</th>
                <th className="px-2 py-2">نام</th>
                <th className="px-2 py-2">بدهکار</th>
                <th className="px-2 py-2">بستانکار</th>
                <th className="px-2 py-2">خالص</th>
              </tr>
            </thead>
            <tbody>
              {query.data.data.map((row) => (
                <tr key={row.ledgerAccountId} className="border-b">
                  <td className="px-2 py-2 font-mono">{row.code}</td>
                  <td className="px-2 py-2">{row.name}</td>
                  <td className="px-2 py-2 font-mono">{row.debitBase}</td>
                  <td className="px-2 py-2 font-mono">{row.creditBase}</td>
                  <td className="px-2 py-2 font-mono">{row.netBase}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
