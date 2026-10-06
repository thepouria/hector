'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { AccessDenied, ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createFxRate } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function FxRateCreatePageClient() {
  const router = useRouter();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.FINANCE_FX_MANAGE);
  const [rate, setRate] = React.useState('250000');
  const [rateType, setRateType] = React.useState('REFERENCE');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  if (!canManage) return <AccessDenied />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createFxRate(companyId, {
        baseCurrency: 'USD',
        quoteCurrency: 'IRR',
        rate,
        rateType,
      });
      router.push(ROUTES.financeFxRates);
    } catch (err) {
      if (isApiClientError(err) && err.status === 401) handleUnauthorized();
      setError(isApiClientError(err) ? err.message : 'ثبت نرخ ناموفق بود.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6" dir="rtl">
      <PageHeader
        title="نرخ جدید"
        description={`۱ USD = ${rate || '…'} IRR — جهت همیشه صریح است.`}
      />
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block space-y-1 text-sm">
          <span>نوع نرخ</span>
          <select
            className="w-full rounded-md border px-3 py-2"
            value={rateType}
            onChange={(e) => setRateType(e.target.value)}
          >
            <option value="REFERENCE">REFERENCE</option>
            <option value="VALUATION">VALUATION</option>
            <option value="CONVERSION">CONVERSION</option>
            <option value="SETTLEMENT">SETTLEMENT</option>
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>نرخ (IRR به ازای ۱ USD)</span>
          <Input value={rate} onChange={(e) => setRate(e.target.value)} dir="ltr" />
        </label>
        <p className="text-sm text-slate-600">نمایش: ۱ USD = {rate || '…'} IRR</p>
        {error ? <ErrorState message={error} /> : null}
        <Button type="submit" disabled={saving}>
          {saving ? 'در حال ثبت…' : 'ثبت نرخ'}
        </Button>
      </form>
    </div>
  );
}
