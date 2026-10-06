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
import { fetchReceipts } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeReceiptKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { financeReceiptPath, ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function ReceiptsListPageClient() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_RECEIPTS_READ);
  const canCreate = can(PERMISSIONS.FINANCE_RECEIPTS_CREATE);

  const listQuery = useQuery({
    queryKey: financeReceiptKeys.list(companyId),
    queryFn: () => fetchReceipts(companyId, { page: 1, pageSize: 50 }),
    enabled: Boolean(companyId) && canRead,
  });

  if (!canRead) return <AccessDenied />;
  if (listQuery.isError) {
    if (isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
    return <ErrorState message="بارگذاری دریافت‌ها ناموفق بود." onRetry={() => listQuery.refetch()} />;
  }

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="دریافت‌ها"
        description="ورود پول به حساب شرکت. دریافت ≠ درآمد و جایگزین سند سرمایه/وام نیست."
        actions={
          canCreate ? (
            <Link href={ROUTES.financeReceiptNew} className={cn(buttonVariants())}>
              دریافت جدید
            </Link>
          ) : null
        }
      />
      {listQuery.isLoading ? (
        <TableSkeleton rows={6} />
      ) : !listQuery.data?.data.length ? (
        <EmptyState title="دریافتی ثبت نشده" description="اولین دریافت مستقل را ثبت کنید." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b text-right text-muted-foreground">
                <th className="px-2 py-2 font-medium">شماره</th>
                <th className="px-2 py-2 font-medium">منبع</th>
                <th className="px-2 py-2 font-medium">مبلغ</th>
                <th className="px-2 py-2 font-medium">حساب</th>
                <th className="px-2 py-2 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.data.data.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="px-2 py-2">
                    <Link href={financeReceiptPath(row.id)} className="text-blue-700 underline">
                      {row.number}
                    </Link>
                  </td>
                  <td className="px-2 py-2">{row.sourceType}</td>
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
