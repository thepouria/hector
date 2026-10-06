'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AccessDenied, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createPayment, fetchFinancialAccounts } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeAccountKeys } from '@/lib/query/keys';
import { financePaymentPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function PaymentCreatePageClient() {
  const router = useRouter();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canCreate = can(PERMISSIONS.FINANCE_PAYMENTS_CREATE);

  const [purposeType, setPurposeType] = React.useState('OTHER');
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
      createPayment(companyId, {
        purposeType,
        accountId,
        amount,
        counterpartyName: counterpartyName || undefined,
        reference: reference || undefined,
        notes: notes || undefined,
        effectiveAt: effectiveAt ? new Date(effectiveAt).toISOString() : undefined,
        postImmediately: true,
        requestId: crypto.randomUUID(),
      }),
    onSuccess: (data) => router.push(financePaymentPath(data.id)),
    onError: (err) => {
      if (isApiClientError(err) && err.status === 401) handleUnauthorized();
      setError(isApiClientError(err) ? err.message : 'ثبت پرداخت ناموفق بود.');
    },
  });

  if (!canCreate) return <AccessDenied />;

  return (
    <div className="mx-auto max-w-xl space-y-6" dir="rtl">
      <PageHeader
        title="ثبت پرداخت"
        description="خروج پول از حساب. ارز از حساب گرفته می‌شود. پرداخت ≠ هزینه و تسویه بدهی تأمین‌کننده نیست."
      />
      {error ? <ErrorState message={error} /> : null}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          const currency = selectedAccount?.currency ?? '?';
          const ok = window.confirm(
            `پست پرداخت ${amount} ${currency} از حساب ${selectedAccount?.code ?? ''}؟`,
          );
          if (!ok) return;
          mutation.mutate();
        }}
      >
        <label className="block space-y-1 text-sm">
          <span>هدف</span>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3"
            value={purposeType}
            onChange={(e) => setPurposeType(e.target.value)}
          >
            <option value="OTHER">سایر</option>
            <option value="SUPPLIER">تأمین‌کننده (بدون تسویه بدهی)</option>
            <option value="EXPENSE">هزینه (فقط برچسب؛ دفتر هزینه در ۴.۷)</option>
            <option value="LOAN">وام</option>
            <option value="REFUND">بازپرداخت</option>
            <option value="CAPITAL_WITHDRAWAL">برداشت سرمایه</option>
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
