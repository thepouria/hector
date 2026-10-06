'use client';

import * as React from 'react';
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
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchAccountsSummary, fetchFinancialAccounts } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeAccountKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { financeAccountPath, ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

function typeLabel(type: string): string {
  if (type === 'CASH') return 'صندوق';
  if (type === 'BANK') return 'بانک';
  if (type === 'WALLET') return 'کیف پول';
  return 'سایر';
}

function statusLabel(status: string): string {
  if (status === 'ACTIVE') return 'فعال';
  if (status === 'INACTIVE') return 'غیرفعال';
  if (status === 'ARCHIVED') return 'بایگانی';
  return status;
}

function formatMoney(amount: string, currency: string): string {
  return `${amount} ${currency}`;
}

export function FinanceAccountsPageClient() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_ACCOUNTS_READ);
  const canManage = can(PERMISSIONS.FINANCE_ACCOUNTS_MANAGE);

  const [page, setPage] = React.useState(1);
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const listQuery = useQuery({
    queryKey: financeAccountKeys.list(companyId, { page, search }),
    queryFn: () =>
      fetchFinancialAccounts(companyId, { page, pageSize: 20, search: search || undefined }),
    enabled: Boolean(companyId) && canRead,
  });

  const summaryQuery = useQuery({
    queryKey: financeAccountKeys.summary(companyId),
    queryFn: () => fetchAccountsSummary(companyId),
    enabled: Boolean(companyId) && canRead,
  });

  if (!canRead) {
    return <AccessDenied />;
  }

  if (listQuery.isError) {
    if (isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
    return <ErrorState onRetry={() => void listQuery.refetch()} />;
  }

  const rows = listQuery.data?.data ?? [];
  const meta = listQuery.data?.meta;

  return (
    <div className="space-y-6">
      <PageHeader
        title="حساب‌های مالی"
        description="صندوق، بانک و کیف پول — موجودی از دفتر حرکات محاسبه می‌شود"
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Link
                href={ROUTES.financeAccountTransferNew}
                className={cn(buttonVariants({ variant: 'outline' }))}
              >
                انتقال بین حساب‌ها
              </Link>
              <Link href={ROUTES.financeAccountNew} className={cn(buttonVariants())}>
                حساب جدید
              </Link>
            </div>
          ) : null
        }
      />

      {summaryQuery.data ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {summaryQuery.data.byCurrency.map((bucket) => (
            <div key={bucket.currency} className="rounded-lg border border-slate-200 p-4">
              <div className="text-sm text-slate-500">جمع {bucket.currency}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">
                {formatMoney(bucket.total, bucket.currency)}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex gap-2">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="جستجو کد، نام یا بانک…"
          className="max-w-sm"
        />
      </div>

      {listQuery.isLoading ? (
        <TableSkeleton rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState title="حسابی ثبت نشده" description="اولین حساب نقدی یا بانکی را ایجاد کنید." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-right">
              <tr>
                <th className="px-3 py-2 font-medium">کد</th>
                <th className="px-3 py-2 font-medium">نام</th>
                <th className="px-3 py-2 font-medium">نوع</th>
                <th className="px-3 py-2 font-medium">ارز</th>
                <th className="px-3 py-2 font-medium">موجودی</th>
                <th className="px-3 py-2 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link
                      href={financeAccountPath(row.id)}
                      className="text-slate-900 underline-offset-2 hover:underline"
                    >
                      {row.code}
                    </Link>
                    {row.isDefault ? (
                      <Badge className="mr-2">
                        پیش‌فرض
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{row.name}</td>
                  <td className="px-3 py-2">{typeLabel(row.type)}</td>
                  <td className="px-3 py-2 font-mono">{row.currency}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.balance
                      ? formatMoney(row.balance.amount, row.balance.currency)
                      : '—'}
                  </td>
                  <td className="px-3 py-2">{statusLabel(row.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta && meta.totalPages > 1 ? (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            قبلی
          </Button>
          <span className="text-sm text-slate-600">
            صفحه {meta.page} از {meta.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= meta.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            بعدی
          </Button>
        </div>
      ) : null}
    </div>
  );
}
