'use client';

import { useQuery } from '@tanstack/react-query';
import { AccessDenied, ErrorState, TableSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { fetchJournal } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeJournalKeys } from '@/lib/query/keys';
import { useSession } from '@/providers/app-providers';

export function JournalDetailPageClient({ journalId }: { journalId: string }) {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_JOURNALS_READ);

  const detailQuery = useQuery({
    queryKey: financeJournalKeys.detail(companyId, journalId),
    queryFn: () => fetchJournal(companyId, journalId),
    enabled: Boolean(companyId) && canRead && Boolean(journalId),
  });

  if (!canRead) return <AccessDenied />;
  if (detailQuery.isError) {
    if (isApiClientError(detailQuery.error) && detailQuery.error.status === 401) {
      handleUnauthorized();
    }
    return (
      <ErrorState message="بارگذاری سند ناموفق بود." onRetry={() => detailQuery.refetch()} />
    );
  }
  if (detailQuery.isLoading || !detailQuery.data) return <TableSkeleton rows={4} />;

  const row = detailQuery.data;
  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title={row.number}
        description={row.description}
        actions={<Badge>{row.status}</Badge>}
      />
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">اثر</dt>
          <dd className="font-mono">{row.effectType}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">منبع</dt>
          <dd className="font-mono">{row.sourceType}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">بدهکار پایه</dt>
          <dd className="font-mono">
            {row.totalDebitBase} {row.baseCurrency}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">بستانکار پایه</dt>
          <dd className="font-mono">
            {row.totalCreditBase} {row.baseCurrency}
          </dd>
        </div>
      </dl>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-right text-muted-foreground">
              <th className="px-2 py-2">حساب</th>
              <th className="px-2 py-2">جهت</th>
              <th className="px-2 py-2">اصل</th>
              <th className="px-2 py-2">پایه</th>
            </tr>
          </thead>
          <tbody>
            {row.lines.map((line) => (
              <tr key={line.id} className="border-b">
                <td className="px-2 py-2">
                  {line.ledgerAccountCode} — {line.ledgerAccountName}
                </td>
                <td className="px-2 py-2">{line.direction}</td>
                <td className="px-2 py-2 font-mono">
                  {line.originalAmount} {line.originalCurrency}
                </td>
                <td className="px-2 py-2 font-mono">
                  {line.baseAmount} {line.baseCurrency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
