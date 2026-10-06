'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccessDenied, ErrorState, TableSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createAccountTransfer,
  fetchFinancialAccounts,
  type FinancialAccount,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeAccountKeys, financeDashboardKeys } from '@/lib/query/keys';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function AccountTransferCreatePageClient() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? '';
  const canCreate = can(PERMISSIONS.FINANCE_TRANSFERS_CREATE);

  const [sourceId, setSourceId] = React.useState('');
  const [destinationId, setDestinationId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [notes, setNotes] = React.useState('');

  const accountsQuery = useQuery({
    queryKey: financeAccountKeys.list(companyId, { status: 'ACTIVE', view: 'options' }),
    queryFn: () =>
      fetchFinancialAccounts(companyId, {
        status: 'ACTIVE',
        view: 'options',
        pageSize: 100,
      }),
    enabled: Boolean(companyId) && canCreate,
  });

  const accounts = (accountsQuery.data?.data ?? []) as FinancialAccount[];
  const source = accounts.find((a) => a.id === sourceId);
  const destinations = accounts.filter(
    (a) => a.id !== sourceId && (!source || a.currency === source.currency),
  );

  const mutation = useMutation({
    mutationFn: () =>
      createAccountTransfer(companyId, {
        sourceAccountId: sourceId,
        destinationAccountId: destinationId,
        amount: amount.trim(),
        notes: notes || undefined,
        requestId: crypto.randomUUID(),
        postImmediately: true,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: financeAccountKeys.all(companyId) });
      await queryClient.invalidateQueries({ queryKey: financeDashboardKeys.all(companyId) });
      toast.success('انتقال ثبت شد');
      router.push(ROUTES.financeAccounts);
    },
    onError: (error) => {
      if (isApiClientError(error) && error.status === 401) {
        handleUnauthorized();
        return;
      }
      toast.error(mapBusinessError(error));
    },
  });

  if (!canCreate) return <AccessDenied />;
  if (accountsQuery.isError) {
    return <ErrorState onRetry={() => void accountsQuery.refetch()} />;
  }
  if (accountsQuery.isLoading) return <TableSkeleton rows={4} />;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader
        title="انتقال بین حساب‌ها"
        description="فقط هم‌ارز. ارز کل شرکت در این انتقال تغییر نمی‌کند."
      />

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="source">از حساب *</Label>
          <select
            id="source"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value);
              setDestinationId('');
            }}
            required
          >
            <option value="">انتخاب…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="dest">به حساب *</Label>
          <select
            id="dest"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={destinationId}
            onChange={(e) => setDestinationId(e.target.value)}
            required
            disabled={!sourceId}
          >
            <option value="">انتخاب…</option>
            {destinations.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="amount">مبلغ *</Label>
          <Input
            id="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            dir="ltr"
            className="tabular-nums"
            placeholder={source ? `به ${source.currency}` : ''}
          />
          {source ? (
            <p className="text-xs text-slate-500">ارز انتقال: {source.currency}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">یادداشت</Label>
          <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={mutation.isPending}>
            ثبت و پست
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(ROUTES.financeAccounts)}
          >
            انصراف
          </Button>
        </div>
      </form>
    </div>
  );
}
