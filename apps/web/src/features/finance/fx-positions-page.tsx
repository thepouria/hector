'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { fetchFxPositions } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeFxKeys } from '@/lib/query/keys';
import { useSession } from '@/providers/app-providers';

export function FxPositionsPageClient() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_FX_READ);

  const query = useQuery({
    queryKey: financeFxKeys.positions(companyId),
    queryFn: () => fetchFxPositions(companyId),
    enabled: Boolean(companyId) && canRead,
  });

  if (!canRead) return <AccessDenied />;
  if (query.isError) {
    if (isApiClientError(query.error) && query.error.status === 401) {
      handleUnauthorized();
    }
    return <ErrorState message="بارگذاری موقعیت ارزی ناموفق بود." onRetry={() => query.refetch()} />;
  }

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="موقعیت ارزی"
        description="خالص = نقد − بدهی تأمین‌کننده − وام (به‌ازای هر ارز؛ بدون جمع خاموش بین ارزها)."
      />
      {query.isLoading ? (
        <TableSkeleton rows={4} />
      ) : !query.data?.positions.length ? (
        <EmptyState title="موقعیتی نیست" description="حساب، بدهی یا وامی یافت نشد." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-right text-slate-500">
                <th className="px-2 py-2 font-medium">ارز</th>
                <th className="px-2 py-2 font-medium">نقد</th>
                <th className="px-2 py-2 font-medium">بدهی تأمین‌کننده</th>
                <th className="px-2 py-2 font-medium">وام</th>
                <th className="px-2 py-2 font-medium">خالص</th>
              </tr>
            </thead>
            <tbody>
              {query.data.positions.map((row) => (
                <tr key={row.currency} className="border-b">
                  <td className="px-2 py-2 font-medium">{row.currency}</td>
                  <td className="px-2 py-2 tabular-nums">{row.cashBalance}</td>
                  <td className="px-2 py-2 tabular-nums">{row.payableOutstanding}</td>
                  <td className="px-2 py-2 tabular-nums">{row.loanOutstanding}</td>
                  <td className="px-2 py-2 tabular-nums font-medium">{row.net}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">{query.data.signConvention}</p>
        </div>
      )}
    </div>
  );
}
