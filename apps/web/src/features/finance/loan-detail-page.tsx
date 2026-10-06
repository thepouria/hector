'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AccessDenied, ErrorState, TableSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  createLoanRepayment,
  fetchFinancialAccounts,
  fetchLoan,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeAccountKeys, financeLoanKeys } from '@/lib/query/keys';
import { useSession } from '@/providers/app-providers';

export function LoanDetailPageClient({ loanId }: { loanId: string }) {
  const queryClient = useQueryClient();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_LOANS_READ);
  const canManage = can(PERMISSIONS.FINANCE_LOANS_MANAGE);

  const [accountId, setAccountId] = React.useState('');
  const [principalAmount, setPrincipalAmount] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: financeLoanKeys.detail(companyId, loanId),
    queryFn: () => fetchLoan(companyId, loanId),
    enabled: Boolean(companyId) && canRead,
  });

  const accountsQuery = useQuery({
    queryKey: financeAccountKeys.list(companyId, {
      view: 'options',
      status: 'ACTIVE',
      currency: query.data?.currency,
    }),
    queryFn: () =>
      fetchFinancialAccounts(companyId, {
        page: 1,
        pageSize: 100,
        status: 'ACTIVE',
        currency: query.data?.currency,
        view: 'options',
      }),
    enabled: Boolean(companyId) && canManage && Boolean(query.data?.currency),
  });

  const repayMutation = useMutation({
    mutationFn: () =>
      createLoanRepayment(companyId, loanId, {
        accountId,
        principalAmount,
        postImmediately: true,
        requestId: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      setPrincipalAmount('');
      setError(null);
      await queryClient.invalidateQueries({ queryKey: financeLoanKeys.detail(companyId, loanId) });
      await queryClient.invalidateQueries({ queryKey: financeLoanKeys.list(companyId) });
    },
    onError: (err) => {
      if (isApiClientError(err) && err.status === 401) handleUnauthorized();
      setError(isApiClientError(err) ? err.message : 'بازپرداخت ناموفق بود.');
    },
  });

  if (!canRead) return <AccessDenied />;
  if (query.isLoading) return <TableSkeleton rows={5} />;
  if (query.isError || !query.data) {
    if (isApiClientError(query.error) && query.error.status === 401) handleUnauthorized();
    return <ErrorState message="جزئیات وام یافت نشد." onRetry={() => query.refetch()} />;
  }

  const loan = query.data;
  const canRepay =
    canManage &&
    ['ACTIVE', 'PARTIALLY_REPAID'].includes(loan.status) &&
    Number(loan.outstandingPrincipal) > 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title={loan.number}
        description={`${loan.lenderName} — اصل وام درآمد نیست؛ بازپرداخت اصل هزینه نیست.`}
      />
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">وضعیت</dt>
          <dd>
            <Badge>{loan.status}</Badge>
            {loan.overdue ? (
              <Badge className="mr-2 text-red-700 border-red-200 bg-red-50">
                سررسید گذشته
              </Badge>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">ارز قرارداد</dt>
          <dd>{loan.currency}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">سقف قرارداد</dt>
          <dd className="tabular-nums">
            {loan.contractedPrincipal} {loan.currency}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">اصل دریافتی</dt>
          <dd className="tabular-nums">
            {loan.receivedPrincipal} {loan.currency}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">اصل بازپرداخت‌شده</dt>
          <dd className="tabular-nums">
            {loan.repaidPrincipal} {loan.currency}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">مانده</dt>
          <dd className="tabular-nums font-medium">
            {loan.outstandingPrincipal} {loan.currency}
          </dd>
        </div>
        {loan.referenceFxRate ? (
          <div>
            <dt className="text-muted-foreground">نرخ مرجع</dt>
            <dd className="tabular-nums">{loan.referenceFxRate}</dd>
          </div>
        ) : null}
      </dl>

      {canRepay ? (
        <section className="space-y-3 rounded-lg border p-4">
          <h2 className="text-base font-medium">بازپرداخت اصل</h2>
          <p className="text-sm text-muted-foreground">
            فقط همان ارز وام. بازپرداخت بیش از مانده یا بیش از موجودی حساب رد می‌شود.
          </p>
          {error ? <ErrorState message={error} /> : null}
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              repayMutation.mutate();
            }}
          >
            <label className="block flex-1 space-y-1 text-sm">
              <span>حساب پرداخت</span>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                required
              >
                <option value="">انتخاب</option>
                {(accountsQuery.data?.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block flex-1 space-y-1 text-sm">
              <span>مبلغ اصل</span>
              <Input
                value={principalAmount}
                onChange={(e) => setPrincipalAmount(e.target.value)}
                required
              />
            </label>
            <Button type="submit" disabled={repayMutation.isPending}>
              ثبت بازپرداخت
            </Button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
