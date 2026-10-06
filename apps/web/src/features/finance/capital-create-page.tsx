'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AccessDenied, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  createCapitalContribution,
  fetchFinancialAccounts,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeAccountKeys } from '@/lib/query/keys';
import { financeCapitalPath, ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function CapitalCreatePageClient() {
  const router = useRouter();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.FINANCE_CAPITAL_MANAGE);

  const [fundingType, setFundingType] = React.useState('PARTNER_EQUITY');
  const [contributorName, setContributorName] = React.useState('');
  const [accountId, setAccountId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const accountsQuery = useQuery({
    queryKey: financeAccountKeys.list(companyId, { view: 'options', status: 'ACTIVE' }),
    queryFn: () =>
      fetchFinancialAccounts(companyId, {
        page: 1,
        pageSize: 100,
        status: 'ACTIVE',
        view: 'options',
      }),
    enabled: Boolean(companyId) && canManage,
  });

  const mutation = useMutation({
    mutationFn: () =>
      createCapitalContribution(companyId, {
        fundingType,
        contributorType: 'PARTNER',
        contributorName,
        accountId,
        amount,
        notes: notes || undefined,
        postImmediately: true,
        requestId: crypto.randomUUID(),
      }),
    onSuccess: (data) => router.push(financeCapitalPath(data.id)),
    onError: (err) => {
      if (isApiClientError(err) && err.status === 401) handleUnauthorized();
      setError(isApiClientError(err) ? err.message : 'ثبت آورده ناموفق بود.');
    },
  });

  if (!canManage) return <AccessDenied />;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader
        title="ثبت آورده سرمایه"
        description="سرمایه درآمد نیست. ارز آورده باید با حساب مقصد یکی باشد."
      />
      {error ? <ErrorState message={error} /> : null}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          mutation.mutate();
        }}
      >
        <label className="block space-y-1 text-sm">
          <span>نوع تأمین</span>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3"
            value={fundingType}
            onChange={(e) => setFundingType(e.target.value)}
          >
            <option value="OWNER_EQUITY">سهم مالک</option>
            <option value="PARTNER_EQUITY">سهم شریک</option>
            <option value="OTHER_FUNDING">سایر تأمین (نیاز به توضیح)</option>
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>نام آورده‌کننده</span>
          <Input value={contributorName} onChange={(e) => setContributorName(e.target.value)} required />
        </label>
        <label className="block space-y-1 text-sm">
          <span>حساب مقصد</span>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            required
          >
            <option value="">انتخاب حساب</option>
            {(accountsQuery.data?.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>مبلغ</span>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
        <label className="block space-y-1 text-sm">
          <span>یادداشت</span>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="flex gap-2">
          <Button type="submit" disabled={mutation.isPending}>
            ثبت و پست
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push(ROUTES.financeCapital)}>
            انصراف
          </Button>
        </div>
      </form>
    </div>
  );
}
