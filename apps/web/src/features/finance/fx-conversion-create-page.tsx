'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AccessDenied, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  createFxConversion,
  fetchFinancialAccounts,
  previewFxConvert,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeAccountKeys } from '@/lib/query/keys';
import { financeFxConversionPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function FxConversionCreatePageClient() {
  const router = useRouter();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.FINANCE_FX_MANAGE);

  const accountsQuery = useQuery({
    queryKey: financeAccountKeys.list(companyId, { pageSize: 100 }),
    queryFn: () => fetchFinancialAccounts(companyId, { page: 1, pageSize: 100 }),
    enabled: Boolean(companyId) && canManage,
  });

  const [sourceAccountId, setSourceAccountId] = React.useState('');
  const [destinationAccountId, setDestinationAccountId] = React.useState('');
  const [fromAmount, setFromAmount] = React.useState('');
  const [appliedRate, setAppliedRate] = React.useState('250000');
  const [toAmount, setToAmount] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const accounts = accountsQuery.data?.data ?? [];
  const source = accounts.find((a) => a.id === sourceAccountId);
  const destination = accounts.find((a) => a.id === destinationAccountId);

  async function refreshPreview() {
    if (!source || !destination || !fromAmount || !appliedRate) return;
    if (source.currency === destination.currency) {
      setError('تبدیل هم‌ارز مجاز نیست — از انتقال حساب استفاده کنید.');
      setToAmount('');
      return;
    }
    try {
      const preview = await previewFxConvert(companyId, {
        fromAmount,
        fromCurrency: source.currency,
        toCurrency: destination.currency,
        appliedRate,
        rateBaseCurrency: 'USD',
        rateQuoteCurrency: 'IRR',
      });
      setToAmount(preview.toAmount);
      setError(null);
    } catch (err) {
      setError(isApiClientError(err) ? err.message : 'پیش‌نمایش ناموفق بود.');
    }
  }

  if (!canManage) return <AccessDenied />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!source || !destination || !toAmount) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createFxConversion(companyId, {
        sourceAccountId,
        destinationAccountId,
        fromAmount,
        fromCurrency: source.currency,
        toAmount,
        toCurrency: destination.currency,
        appliedRate,
        rateBaseCurrency: 'USD',
        rateQuoteCurrency: 'IRR',
        postImmediately: true,
        requestId: crypto.randomUUID(),
      });
      router.push(financeFxConversionPath(created.id));
    } catch (err) {
      if (isApiClientError(err) && err.status === 401) handleUnauthorized();
      setError(isApiClientError(err) ? err.message : 'ثبت تبدیل ناموفق بود.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6" dir="rtl">
      <PageHeader
        title="تبدیل جدید"
        description="۱ USD = N IRR — مبالغ اصلی ارز حفظ می‌شوند."
      />
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block space-y-1 text-sm">
          <span>حساب مبدأ</span>
          <select
            className="w-full rounded-md border px-3 py-2"
            value={sourceAccountId}
            onChange={(e) => setSourceAccountId(e.target.value)}
          >
            <option value="">انتخاب…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} ({a.currency})
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>حساب مقصد</span>
          <select
            className="w-full rounded-md border px-3 py-2"
            value={destinationAccountId}
            onChange={(e) => setDestinationAccountId(e.target.value)}
          >
            <option value="">انتخاب…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} ({a.currency})
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>مبلغ مبدأ</span>
          <Input value={fromAmount} onChange={(e) => setFromAmount(e.target.value)} dir="ltr" />
        </label>
        <label className="block space-y-1 text-sm">
          <span>نرخ (۱ USD = N IRR)</span>
          <Input value={appliedRate} onChange={(e) => setAppliedRate(e.target.value)} dir="ltr" />
        </label>
        <Button type="button" variant="outline" onClick={() => void refreshPreview()}>
          محاسبه مبلغ مقصد
        </Button>
        <p className="text-sm">
          نمایش نرخ: ۱ USD = {appliedRate || '…'} IRR
          {toAmount ? (
            <>
              <br />
              مقصد: {toAmount} {destination?.currency}
            </>
          ) : null}
        </p>
        {error ? <ErrorState message={error} /> : null}
        <Button type="submit" disabled={saving || !toAmount}>
          {saving ? 'در حال ثبت…' : 'ثبت و پست'}
        </Button>
      </form>
    </div>
  );
}
