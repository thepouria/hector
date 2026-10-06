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
import { fetchFxRates } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeFxKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function FxRatesPageClient() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_FX_READ);
  const canManage = can(PERMISSIONS.FINANCE_FX_MANAGE);

  const listQuery = useQuery({
    queryKey: financeFxKeys.rates(companyId),
    queryFn: () => fetchFxRates(companyId, { page: 1, pageSize: 50 }),
    enabled: Boolean(companyId) && canRead,
  });

  if (!canRead) return <AccessDenied />;
  if (listQuery.isError) {
    if (isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
    return <ErrorState message="بارگذاری نرخ‌ها ناموفق بود." onRetry={() => listQuery.refetch()} />;
  }

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="نرخ‌های ارز"
        description="نرخ‌ها تغییرناپذیرند — برای تغییر، نرخ جدید بسازید. جهت همیشه صریح است."
        actions={
          canManage ? (
            <Link href={ROUTES.financeFxRateNew} className={cn(buttonVariants())}>
              نرخ جدید
            </Link>
          ) : null
        }
      />

      {listQuery.isLoading ? (
        <TableSkeleton rows={6} />
      ) : !listQuery.data?.data.length ? (
        <EmptyState title="نرخی ثبت نشده" description="یک نرخ REFERENCE یا VALUATION ثبت کنید." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-right text-slate-500">
                <th className="px-2 py-2 font-medium">نمایش</th>
                <th className="px-2 py-2 font-medium">نوع</th>
                <th className="px-2 py-2 font-medium">منبع</th>
                <th className="px-2 py-2 font-medium">اعتبار از</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.data.data.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="px-2 py-2 tabular-nums font-medium">{row.rateDisplay}</td>
                  <td className="px-2 py-2">
                    <Badge>{row.rateType}</Badge>
                  </td>
                  <td className="px-2 py-2">{row.sourceType}</td>
                  <td className="px-2 py-2 tabular-nums">
                    {new Date(row.effectiveAt).toLocaleString('fa-IR')}
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
