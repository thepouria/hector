'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AccessDenied, ErrorState, TableSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { approveExpense, fetchExpense, fetchFinancialAccounts, payExpenseNow } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeAccountKeys, financeDashboardKeys, financeExpenseKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import { FinanceEntityHistory } from '@/features/finance/finance-entity-history';
import { useState } from 'react';

export function ExpenseDetailPageClient({ expenseId }: { expenseId: string }) {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_EXPENSES_READ);
  const canManage = can(PERMISSIONS.FINANCE_EXPENSES_MANAGE);
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState('');

  const detailQuery = useQuery({
    queryKey: financeExpenseKeys.detail(companyId, expenseId),
    queryFn: () => fetchExpense(companyId, expenseId),
    enabled: Boolean(companyId) && canRead,
  });

  const accountsQuery = useQuery({
    queryKey: financeAccountKeys.list(companyId, { pageSize: 50, status: 'ACTIVE' }),
    queryFn: () => fetchFinancialAccounts(companyId, { pageSize: 50, status: 'ACTIVE' }),
    enabled: Boolean(companyId) && canManage,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: financeExpenseKeys.all(companyId) });
    void queryClient.invalidateQueries({ queryKey: financeDashboardKeys.all(companyId) });
  };

  const approveMutation = useMutation({
    mutationFn: () => approveExpense(companyId, expenseId),
    onSuccess: invalidate,
  });

  const payMutation = useMutation({
    mutationFn: () =>
      payExpenseNow(companyId, expenseId, {
        accountId,
        requestId: crypto.randomUUID(),
      }),
    onSuccess: invalidate,
  });

  if (!canRead) return <AccessDenied />;
  if (detailQuery.isError) {
    if (isApiClientError(detailQuery.error) && detailQuery.error.status === 401) {
      handleUnauthorized();
    }
    return <ErrorState message="بارگذاری هزینه ناموفق بود." onRetry={() => detailQuery.refetch()} />;
  }
  if (detailQuery.isLoading || !detailQuery.data) return <TableSkeleton rows={4} />;

  const row = detailQuery.data;
  const accounts = accountsQuery.data?.data ?? [];

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title={row.number}
        description={row.description}
        actions={
          <Link href={ROUTES.financeExpenses} className={cn(buttonVariants({ variant: 'outline' }))}>
            بازگشت
          </Link>
        }
      />
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          دسته: <strong>{row.category.code}</strong>
        </div>
        <div>
          مبلغ:{' '}
          <strong className="tabular-nums">
            {row.amount} {row.currency}
          </strong>
        </div>
        <div>
          وضعیت: <Badge>{row.status}</Badge>
        </div>
        <div>
          پرداخت: <Badge>{row.paymentStatus}</Badge>
        </div>
        <div>
          پرداخت‌شده: <span className="tabular-nums">{row.paidAmount}</span>
        </div>
        <div>
          مانده: <span className="tabular-nums">{row.outstandingAmount}</span>
        </div>
      </div>

      {canManage && row.status === 'DRAFT' ? (
        <Button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
          تأیید
        </Button>
      ) : null}

      {canManage && row.status === 'APPROVED' && row.paymentStatus !== 'PAID' ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            <span>حساب پرداخت</span>
            <select
              className="block rounded border px-3 py-2"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">انتخاب…</option>
              {accounts
                .filter((a) => a.currency === row.currency)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
            </select>
          </label>
          <Button
            onClick={() => payMutation.mutate()}
            disabled={!accountId || payMutation.isPending}
          >
            پرداخت الآن
          </Button>
        </div>
      ) : null}

      {row.allocations.length > 0 ? (
        <div className="space-y-2">
          <h3 className="font-medium">تخصیص پرداخت‌ها</h3>
          <ul className="text-sm">
            {row.allocations.map((a) => (
              <li key={a.id} className="tabular-nums">
                {a.amount} {a.currency} → payment {a.paymentId.slice(0, 8)}…
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <FinanceEntityHistory entityType="EXPENSE" entityId={expenseId} />
    </div>
  );
}
