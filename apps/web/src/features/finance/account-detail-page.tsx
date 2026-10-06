'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AccessDenied,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  archiveFinancialAccount,
  fetchAccountMovements,
  fetchFinancialAccount,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeAccountKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function FinanceAccountDetailPageClient() {
  const params = useParams<{ id: string }>();
  const accountId = params.id;
  const { activeCompany, can, handleUnauthorized } = useSession();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_ACCOUNTS_READ);
  const canManage = can(PERMISSIONS.FINANCE_ACCOUNTS_MANAGE);

  const detailQuery = useQuery({
    queryKey: financeAccountKeys.detail(companyId, accountId),
    queryFn: () => fetchFinancialAccount(companyId, accountId),
    enabled: Boolean(companyId) && Boolean(accountId) && canRead,
  });

  const movementsQuery = useQuery({
    queryKey: financeAccountKeys.movements(companyId, accountId, { page: 1 }),
    queryFn: () => fetchAccountMovements(companyId, accountId, { page: 1, pageSize: 50 }),
    enabled: Boolean(companyId) && Boolean(accountId) && canRead,
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveFinancialAccount(companyId, accountId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: financeAccountKeys.all(companyId) });
      toast.success('حساب بایگانی شد');
    },
    onError: (error) => {
      if (isApiClientError(error) && error.status === 401) {
        handleUnauthorized();
        return;
      }
      toast.error(mapBusinessError(error));
    },
  });

  if (!canRead) return <AccessDenied />;
  if (detailQuery.isError) {
    if (isApiClientError(detailQuery.error) && detailQuery.error.status === 401) {
      handleUnauthorized();
    }
    return <ErrorState onRetry={() => void detailQuery.refetch()} />;
  }
  if (detailQuery.isLoading || !detailQuery.data) {
    return <TableSkeleton rows={4} />;
  }

  const account = detailQuery.data;
  const movements = movementsQuery.data?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={account.name}
        description={`${account.code} · ${account.type} · ${account.currency}`}
        actions={
          <div className="flex gap-2">
            <Link href={ROUTES.financeAccounts} className={cn(buttonVariants({ variant: 'outline' }))}>
              بازگشت
            </Link>
            {canManage && account.status !== 'ARCHIVED' ? (
              <Button
                variant="outline"
                disabled={archiveMutation.isPending}
                onClick={() => {
                  if (window.confirm('بایگانی فقط با موجودی صفر مجاز است. ادامه؟')) {
                    archiveMutation.mutate();
                  }
                }}
              >
                بایگانی
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 p-4">
          <div className="text-sm text-slate-500">موجودی فعلی</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">
            {account.balance
              ? `${account.balance.amount} ${account.balance.currency}`
              : '—'}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 p-4">
          <div className="text-sm text-slate-500">وضعیت</div>
          <div className="mt-1 flex items-center gap-2">
            {account.status}
            {account.isDefault ? <Badge>پیش‌فرض {account.currency}</Badge> : null}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 p-4">
          <div className="text-sm text-slate-500">بانک / شبا</div>
          <div className="mt-1 text-sm">
            {account.bankName ?? '—'}
            {account.iban ? <div className="font-mono text-xs">{account.iban}</div> : null}
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">تاریخچه حرکات</h2>
        {movementsQuery.isLoading ? (
          <TableSkeleton rows={4} />
        ) : movements.length === 0 ? (
          <p className="text-sm text-slate-500">حرکتی ثبت نشده است.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-right">
                <tr>
                  <th className="px-3 py-2 font-medium">تاریخ</th>
                  <th className="px-3 py-2 font-medium">جهت</th>
                  <th className="px-3 py-2 font-medium">مبلغ</th>
                  <th className="px-3 py-2 font-medium">نوع</th>
                  <th className="px-3 py-2 font-medium">توضیح</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{formatDateTime(m.effectiveAt)}</td>
                    <td className="px-3 py-2">{m.direction === 'IN' ? 'ورود' : 'خروج'}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {m.amount} {m.currency}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {m.type === 'OPENING_BALANCE' ? 'موجودی افتتاحیه' : m.type}
                    </td>
                    <td className="px-3 py-2">{m.description ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
