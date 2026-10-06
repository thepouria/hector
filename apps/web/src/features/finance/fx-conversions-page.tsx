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
import { fetchFxConversions } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeFxKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { financeFxConversionPath, ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function FxConversionsPageClient() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_FX_READ);
  const canManage = can(PERMISSIONS.FINANCE_FX_MANAGE);

  const listQuery = useQuery({
    queryKey: financeFxKeys.conversions(companyId),
    queryFn: () => fetchFxConversions(companyId, { page: 1, pageSize: 50 }),
    enabled: Boolean(companyId) && canRead,
  });

  if (!canRead) return <AccessDenied />;
  if (listQuery.isError) {
    if (isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
    return (
      <ErrorState message="بارگذاری تبدیل‌ها ناموفق بود." onRetry={() => listQuery.refetch()} />
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="تبدیل ارز"
        description="خروج از حساب مبدأ + ورود به حساب مقصد با نرخ صریح. هم‌ارز نیست — برای هم‌ارز از انتقال استفاده کنید."
        actions={
          canManage ? (
            <Link href={ROUTES.financeFxConversionNew} className={cn(buttonVariants())}>
              تبدیل جدید
            </Link>
          ) : null
        }
      />

      {listQuery.isLoading ? (
        <TableSkeleton rows={6} />
      ) : !listQuery.data?.data.length ? (
        <EmptyState title="تبدیلی ثبت نشده" description="یک تبدیل بین حساب‌های ارزی مختلف بسازید." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-right text-slate-500">
                <th className="px-2 py-2 font-medium">شماره</th>
                <th className="px-2 py-2 font-medium">از</th>
                <th className="px-2 py-2 font-medium">به</th>
                <th className="px-2 py-2 font-medium">نرخ</th>
                <th className="px-2 py-2 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.data.data.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="px-2 py-2">
                    <Link
                      href={financeFxConversionPath(row.id)}
                      className="text-blue-700 underline"
                    >
                      {row.number}
                    </Link>
                  </td>
                  <td className="px-2 py-2 tabular-nums">
                    {row.fromAmount} {row.fromCurrency}
                  </td>
                  <td className="px-2 py-2 tabular-nums">
                    {row.toAmount} {row.toCurrency}
                  </td>
                  <td className="px-2 py-2 tabular-nums">{row.rateDisplay}</td>
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
