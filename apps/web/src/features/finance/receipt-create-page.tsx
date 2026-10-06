'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AccessDenied, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createReceipt, fetchFinancialAccounts } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeAccountKeys } from '@/lib/query/keys';
import { financeReceiptPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function ReceiptCreatePageClient() {
  const router = useRouter();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canCreate = can(PERMISSIONS.FINANCE_RECEIPTS_CREATE);

  const [sourceType, setSourceType] = React.useState('OTHER');
  const [accountId, setAccountId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [effectiveAt, setEffectiveAt] = React.useState('');
  const [counterpartyName, setCounterpartyName] = React.useState('');
  const [reference, setReference] = React.useState('');
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
    enabled: Boolean(companyId) && canCreate,
  });

  const selectedAccount = (accountsQuery.data?.data ?? []).find((a) => a.id === accountId);

  const mutation = useMutation({
    mutationFn: () =>
      createReceipt(companyId, {
        sourceType,
        accountId,
        amount,
        counterpartyName: counterpartyName || undefined,
        reference: reference || undefined,
        notes: notes || undefined,
        effectiveAt: effectiveAt ? new Date(effectiveAt).toISOString() : undefined,
        postImmediately: true,
        requestId: crypto.randomUUID(),
      }),
    onSuccess: (data) => router.push(financeReceiptPath(data.id)),
    onError: (err) => {
      if (isApiClientError(err) && err.status === 401) handleUnauthorized();
      setError(isApiClientError(err) ? err.message : 'ثبت دریافت ناموفق بود.');
    },
  });

  if (!canCreate) return <AccessDenied />;

  return (
    <div className="mx-auto max-w-xl space-y-6" dir="rtl">
      <PageHeader
        title="ثبت دریافت"
        description="ورود پول به حساب. ارز از حساب گرفته می‌شود. دریافت ≠ درآمد؛ سرمایه/وام از سندهای اختصاصی پست می‌شوند."
      />
      {error ? <ErrorState message={error} /> : null}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          const currency = selectedAccount?.currency ?? '?';
          const ok = window.confirm(
            `پست دریافت ${amount} ${currency} به حساب ${selectedAccount?.code ?? ''}؟`,
          );
          if (!ok) return;
          mutation.mutate();
        }}
      >
        <label className="block space-y-1 text-sm">
          <span>منبع</span>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3"
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
          >
            <option value="OTHER">سایر</option>
            <option value="CUSTOMER">مشتری</option>
            <option value="CAPITAL">سرمایه (برچسب؛ نه سند Capital)</option>
            <option value="LOAN">وام (برچسب؛ نه سند Loan)</option>
            <option value="REFUND">بازپرداخت</option>
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>حساب</span>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            required
          >
            <option value="">انتخاب…</option>
            {(accountsQuery.data?.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </label>
        {selectedAccount ? (
          <p className="text-xs text-muted-foreground">ارز سند: {selectedAccount.currency}</p>
        ) : null}
        <label className="block space-y-1 text-sm">
          <span>مبلغ</span>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
        <label className="block space-y-1 text-sm">
          <span>تاریخ اثر (اختیاری)</span>
          <Input
            type="datetime-local"
            value={effectiveAt}
            onChange={(e) => setEffectiveAt(e.target.value)}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>طرف مقابل (اختیاری)</span>
          <Input
            value={counterpartyName}
            onChange={(e) => setCounterpartyName(e.target.value)}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>مرجع (اختیاری)</span>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>یادداشت</span>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <Button type="submit" disabled={mutation.isPending || !accountId || !amount}>
          تأیید و پست
        </Button>
      </form>
    </div>
  );
}
