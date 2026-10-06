'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AccessDenied, EmptyState, ErrorState, TableSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { buttonVariants } from '@/components/ui/button';
import { fetchExpenseCategories } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeExpenseKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function ExpenseCategoriesPageClient() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_EXPENSES_READ);

  const listQuery = useQuery({
    queryKey: financeExpenseKeys.categories(companyId),
    queryFn: () => fetchExpenseCategories(companyId),
    enabled: Boolean(companyId) && canRead,
  });

  if (!canRead) return <AccessDenied />;
  if (listQuery.isError) {
    if (isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
    return <ErrorState message="بارگذاری دسته‌ها ناموفق بود." onRetry={() => listQuery.refetch()} />;
  }

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="دسته‌های هزینه"
        description="دسته‌های سیستم به‌صورت idempotent از seed ساخته می‌شوند."
        actions={
          <Link href={ROUTES.financeExpenses} className={cn(buttonVariants({ variant: 'outline' }))}>
            بازگشت به هزینه‌ها
          </Link>
        }
      />
      {listQuery.isLoading ? (
        <TableSkeleton rows={6} />
      ) : !listQuery.data?.data.length ? (
        <EmptyState title="دسته‌ای نیست" description="seed را اجرا کنید." />
      ) : (
        <ul className="space-y-2 text-sm">
          {listQuery.data.data.map((c) => (
            <li key={c.id} className="flex justify-between border-b py-2">
              <span>
                <strong>{c.code}</strong> — {c.name}
              </span>
              <span className="text-muted-foreground">{c.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
