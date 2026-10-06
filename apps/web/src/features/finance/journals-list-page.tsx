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
import { fetchJournals } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeJournalKeys } from '@/lib/query/keys';
import { financeJournalPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function JournalsListPageClient() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_JOURNALS_READ);

  const listQuery = useQuery({
    queryKey: financeJournalKeys.list(companyId),
    queryFn: () => fetchJournals(companyId, { page: 1, pageSize: 50 }),
    enabled: Boolean(companyId) && canRead,
  });

  if (!canRead) return <AccessDenied />;
  if (listQuery.isError) {
    if (isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
    return (
      <ErrorState message="بارگذاری اسناد روزنامه ناموفق بود." onRetry={() => listQuery.refetch()} />
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="اسناد روزنامه"
        description="دفتر روزنامه ≠ حرکت نقدی. سند دستی حرکت حساب ایجاد نمی‌کند."
      />
      {listQuery.isLoading ? (
        <TableSkeleton rows={6} />
      ) : !listQuery.data?.data.length ? (
        <EmptyState title="سندی ثبت نشده" description="اسناد خودکار با عملیات مالی ایجاد می‌شوند." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b text-right text-muted-foreground">
                <th className="px-2 py-2 font-medium">شماره</th>
                <th className="px-2 py-2 font-medium">شرح</th>
                <th className="px-2 py-2 font-medium">اثر</th>
                <th className="px-2 py-2 font-medium">بدهکار پایه</th>
                <th className="px-2 py-2 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.data.data.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="px-2 py-2">
                    <Link href={financeJournalPath(row.id)} className="text-primary underline">
                      {row.number}
                    </Link>
                  </td>
                  <td className="px-2 py-2">{row.description}</td>
                  <td className="px-2 py-2 font-mono text-xs">{row.effectType}</td>
                  <td className="px-2 py-2 font-mono">{row.totalDebitBase}</td>
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
