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
import { fetchPayments } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financePaymentKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { financePaymentPath, ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function PaymentsListPageClient() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_PAYMENTS_READ);
  const canCreate = can(PERMISSIONS.FINANCE_PAYMENTS_CREATE);

  const listQuery = useQuery({
    queryKey: financePaymentKeys.list(companyId),
    queryFn: () => fetchPayments(companyId, { page: 1, pageSize: 50 }),
    enabled: Boolean(companyId) && canRead,
  });

  if (!canRead) return <AccessDenied />;
  if (listQuery.isError) {
    if (isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
    return <ErrorState message="بارگذاری پرداخت‌ها ناموفق بود." onRetry={() => listQuery.refetch()} />;
  }

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="پرداخت‌ها"
        description="خروج پول از حساب شرکت. پرداخت با هدف SUPPLIER هنوز بدهی تأمین‌کننده را تسویه نمی‌کند (فاز ۴.۹)."
        actions={
          canCreate ? (
            <Link href={ROUTES.financePaymentNew} className={cn(buttonVariants())}>
              پرداخت جدید
            </Link>
          ) : null
        }
      />
      {listQuery.isLoading ? (
        <TableSkeleton rows={6} />
      ) : !listQuery.data?.data.length ? (
        <EmptyState title="پرداختی ثبت نشده" description="اولین پرداخت مستقل را ثبت کنید." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b text-right text-muted-foreground">
                <th className="px-2 py-2 font-medium">شماره</th>
                <th className="px-2 py-2 font-medium">هدف</th>
                <th className="px-2 py-2 font-medium">مبلغ</th>
                <th className="px-2 py-2 font-medium">حساب</th>
                <th className="px-2 py-2 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.data.data.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="px-2 py-2">
                    <Link href={financePaymentPath(row.id)} className="text-blue-700 underline">
                      {row.number}
                    </Link>
                  </td>
                  <td className="px-2 py-2">{row.purposeType}</td>
                  <td className="px-2 py-2 tabular-nums">
                    {row.amount} {row.currency}
                  </td>
                  <td className="px-2 py-2">{row.account.code}</td>
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
