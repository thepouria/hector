'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
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
import { fetchExpenses } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeExpenseKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { financeExpensePath, ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function ExpensesListPageClient() {
  const searchParams = useSearchParams();
  const paymentStatus = searchParams.get('paymentStatus') ?? '';
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_EXPENSES_READ);
  const canManage = can(PERMISSIONS.FINANCE_EXPENSES_MANAGE);

  const filters = {
    page: 1,
    pageSize: 50,
    ...(paymentStatus ? { paymentStatus } : {}),
  };

  const listQuery = useQuery({
    queryKey: financeExpenseKeys.list(companyId, filters),
    queryFn: () => fetchExpenses(companyId, filters),
    enabled: Boolean(companyId) && canRead,
  });

  if (!canRead) return <AccessDenied />;
  if (listQuery.isError) {
    if (isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
    return <ErrorState message="بارگذاری هزینه‌ها ناموفق بود." onRetry={() => listQuery.refetch()} />;
  }

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title={paymentStatus === 'UNPAID' ? 'هزینه‌های پرداخت‌نشده' : 'هزینه‌ها'}
        description="هزینه اقتصادی ≠ پرداخت نقدی. تأیید هزینه به‌تنهایی حرکت حساب ایجاد نمی‌کند."
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Link
                href={ROUTES.financeExpenseCategories}
                className={cn(buttonVariants({ variant: 'outline' }))}
              >
                دسته‌ها
              </Link>
              <Link href={ROUTES.financeExpenseNew} className={cn(buttonVariants())}>
                هزینه جدید
              </Link>
            </div>
          ) : null
        }
      />
      {listQuery.isLoading ? (
        <TableSkeleton rows={6} />
      ) : !listQuery.data?.data.length ? (
        <EmptyState title="هزینه‌ای ثبت نشده" description="اولین هزینه را ثبت کنید." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b text-right text-muted-foreground">
                <th className="px-2 py-2 font-medium">شماره</th>
                <th className="px-2 py-2 font-medium">دسته</th>
                <th className="px-2 py-2 font-medium">مبلغ</th>
                <th className="px-2 py-2 font-medium">وضعیت</th>
                <th className="px-2 py-2 font-medium">پرداخت</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.data.data.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="px-2 py-2">
                    <Link href={financeExpensePath(row.id)} className="text-blue-700 underline">
                      {row.number}
                    </Link>
                  </td>
                  <td className="px-2 py-2">{row.category.code}</td>
                  <td className="px-2 py-2 tabular-nums">
                    {row.amount} {row.currency}
                  </td>
                  <td className="px-2 py-2">
                    <Badge>{row.status}</Badge>
                  </td>
                  <td className="px-2 py-2">
                    <Badge>{row.paymentStatus}</Badge>
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
