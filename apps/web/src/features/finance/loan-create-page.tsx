'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AccessDenied, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createLoan, fetchFinancialAccounts } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeAccountKeys } from '@/lib/query/keys';
import { financeLoanPath, ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function LoanCreatePageClient() {
  const router = useRouter();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.FINANCE_LOANS_MANAGE);

  const [lenderName, setLenderName] = React.useState('');
  const [currency, setCurrency] = React.useState<'IRR' | 'USD'>('IRR');
  const [contractedPrincipal, setContractedPrincipal] = React.useState('');
  const [accountId, setAccountId] = React.useState('');
  const [disburseAmount, setDisburseAmount] = React.useState('');
  const [referenceFxRate, setReferenceFxRate] = React.useState('');
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

  const accounts = (accountsQuery.data?.data ?? []).filter((a) => a.currency === currency);

  const mutation = useMutation({
    mutationFn: () =>
      createLoan(companyId, {
        lenderType: 'EXTERNAL_PERSON',
        lenderName,
        currency,
        contractedPrincipal,
        receivingAccountId: accountId || undefined,
        referenceFxRate: currency === 'USD' && referenceFxRate ? referenceFxRate : undefined,
        referenceFxBaseCurrency: currency === 'USD' && referenceFxRate ? 'USD' : undefined,
        referenceFxQuoteCurrency: currency === 'USD' && referenceFxRate ? 'IRR' : undefined,
        notes: notes || undefined,
        firstDisbursement: accountId
          ? { accountId, amount: disburseAmount || contractedPrincipal }
          : undefined,
        postImmediately: Boolean(accountId),
        requestId: crypto.randomUUID(),
      }),
    onSuccess: (data) => router.push(financeLoanPath(data.id)),
    onError: (err) => {
      if (isApiClientError(err) && err.status === 401) handleUnauthorized();
      setError(isApiClientError(err) ? err.message : 'ثبت وام ناموفق بود.');
    },
  });

  if (!canManage) return <AccessDenied />;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader
        title="ثبت وام"
        description="وام ≠ درآمد. اصل قرارداد در همان ارز می‌ماند و به ریال تبدیل نمی‌شود."
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
          <span>نام وام‌دهنده</span>
          <Input value={lenderName} onChange={(e) => setLenderName(e.target.value)} required />
        </label>
        <label className="block space-y-1 text-sm">
          <span>ارز قرارداد</span>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3"
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value as 'IRR' | 'USD');
              setAccountId('');
            }}
          >
            <option value="IRR">IRR</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>سقف اصل قرارداد</span>
          <Input
            value={contractedPrincipal}
            onChange={(e) => setContractedPrincipal(e.target.value)}
            required
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>حساب دریافت (اختیاری — با پرداخت فوری)</span>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">بدون پرداخت فوری</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </label>
        {accountId ? (
          <label className="block space-y-1 text-sm">
            <span>مبلغ پرداخت (پیش‌فرض = سقف)</span>
            <Input value={disburseAmount} onChange={(e) => setDisburseAmount(e.target.value)} />
          </label>
        ) : null}
        {currency === 'USD' ? (
          <label className="block space-y-1 text-sm">
            <span>نرخ مرجع (اختیاری، مثلاً ۲۵۰۰۰۰)</span>
            <Input value={referenceFxRate} onChange={(e) => setReferenceFxRate(e.target.value)} />
          </label>
        ) : null}
        <label className="block space-y-1 text-sm">
          <span>یادداشت</span>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="flex gap-2">
          <Button type="submit" disabled={mutation.isPending}>
            ثبت
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push(ROUTES.financeLoans)}>
            انصراف
          </Button>
        </div>
      </form>
    </div>
  );
}
